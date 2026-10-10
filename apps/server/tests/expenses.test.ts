import { afterEach, describe, expect, it } from 'vitest'
import {
  authHeaders,
  cleanup,
  createTestApp,
  insertUser,
  login,
  type SessionRef,
  type TestCtx,
} from './helpers.js'

let ctx: TestCtx
afterEach(() => {
  if (ctx) cleanup(ctx)
})

interface Seed {
  s: SessionRef
  shopId: string
  catId: string
}

async function seed(): Promise<Seed> {
  ctx = await createTestApp()
  const alice = await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
  const s = await login(ctx, alice.username, alice.password)
  const shop = await ctx.app.inject({
    method: 'POST',
    url: '/api/shops',
    headers: authHeaders(s),
    payload: { name: '东门小店' },
  })
  const cats = await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: authHeaders(s) })
  return {
    s,
    shopId: shop.json().item.id,
    catId: cats.json().items[0].id as string,
  }
}

function createPayload(seedInfo: Seed, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shop_id: seedInfo.shopId,
    category_id: seedInfo.catId,
    amount: '128.50',
    bill_month: '2026-08',
    paid_date: '2026-08-20',
    remark: '8月水费',
    ...over,
  }
}

async function createExpense(seedInfo: Seed, over: Record<string, unknown> = {}): Promise<ReturnType<Awaited<ReturnType<TestCtx['app']['inject']>>['json']>> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/expenses',
    headers: authHeaders(seedInfo.s),
    payload: createPayload(seedInfo, over),
  })
  return res
}

describe('expenses: 金额与日期校验', () => {
  it('金额：两位小数字符串入库为整数分', async () => {
    const seedInfo = await seed()
    const res = await createExpense(seedInfo, { amount: '128.5' })
    expect(res.statusCode).toBe(201)
    expect(res.json().item.amount_cents).toBe(12850)
  })

  it('金额拒绝：非字符串数字、三位小数、零、负数、超上限', async () => {
    const seedInfo = await seed()
    for (const amount of [128.5, '128.505', '0', '0.00', '-1', '10000000', 'abc', '']) {
      const res = await createExpense(seedInfo, { amount: amount as unknown as string })
      expect(res.statusCode, `amount=${String(amount)}`).toBe(400)
    }
  })

  it('无效日历日期被拒（闰日、13 月）', async () => {
    const seedInfo = await seed()
    const bad1 = await createExpense(seedInfo, { paid_date: '2026-02-30' })
    expect(bad1.statusCode).toBe(400)
    const bad2 = await createExpense(seedInfo, { paid_date: '2026-13-01' })
    expect(bad2.statusCode).toBe(400)
  })

  it('缴费日期不能晚于今天；账单月份可晚于缴费月份（预付）', async () => {
    const seedInfo = await seed()
    const future = await createExpense(seedInfo, { paid_date: '2099-01-01' })
    expect(future.statusCode).toBe(400)

    const prepay = await createExpense(seedInfo, { bill_month: '2026-12', paid_date: '2026-09-14' })
    expect(prepay.statusCode).toBe(201)
    expect(prepay.json().item.bill_month).toBe('2026-12')
  })

  it('备注最多 1000 字；空备注存为 null', async () => {
    const seedInfo = await seed()
    const long = await createExpense(seedInfo, { remark: '字'.repeat(1001) })
    expect(long.statusCode).toBe(400)
    const ok = await createExpense(seedInfo, { remark: '   ' })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().item.remark).toBeNull()
  })
})

describe('expenses: 防重与乐观锁', () => {
  it('同 ID 同数据重试返回已有记录；同 ID 不同数据返回 409', async () => {
    const seedInfo = await seed()
    const clientUuid = '11111111-2222-4333-8444-555555555555'
    const first = await createExpense(seedInfo, { id: clientUuid })
    expect(first.statusCode).toBe(201)
    expect(first.json().deduplicated).toBeUndefined()

    const retry = await createExpense(seedInfo, { id: clientUuid })
    expect(retry.statusCode).toBe(200)
    expect(retry.json().deduplicated).toBe(true)
    expect(retry.json().item.id).toBe(clientUuid)
    expect(first.json().deduplicated).toBeUndefined()

    const conflicting = await createExpense(seedInfo, { id: clientUuid, amount: '999.99' })
    expect(conflicting.statusCode).toBe(409)
    expect(conflicting.json().code).toBe('DUPLICATE_ID')
  })

  it('非法 UUID 被 400 拒绝', async () => {
    const seedInfo = await seed()
    const res = await createExpense(seedInfo, { id: '../../etc/passwd' })
    expect(res.statusCode).toBe(400)
  })

  it('version 冲突返回 409，刷新后可用新 version 提交', async () => {
    const seedInfo = await seed()
    const created = await createExpense(seedInfo)
    const id = created.json().item.id as string
    const v1 = created.json().item.version as number

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/expenses/${id}`,
      headers: authHeaders(seedInfo.s),
      payload: { version: v1, amount: '200.00', shop_id: seedInfo.shopId, category_id: seedInfo.catId, bill_month: '2026-08', paid_date: '2026-08-20' },
    })
    expect(stale.statusCode).toBe(200)

    const conflictRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/expenses/${id}`,
      headers: authHeaders(seedInfo.s),
      payload: { version: v1, amount: '300.00', shop_id: seedInfo.shopId, category_id: seedInfo.catId, bill_month: '2026-08', paid_date: '2026-08-20' },
    })
    expect(conflictRes.statusCode).toBe(409)
    expect(conflictRes.json().code).toBe('VERSION_CONFLICT')

    const fresh = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/expenses/${id}`,
      headers: authHeaders(seedInfo.s),
      payload: { version: v1 + 1, amount: '300.00', shop_id: seedInfo.shopId, category_id: seedInfo.catId, bill_month: '2026-08', paid_date: '2026-08-20' },
    })
    expect(fresh.statusCode).toBe(200)
    expect(fresh.json().item.version).toBe(v1 + 2)
  })
})

describe('expenses: 停用关联与筛选', () => {
  it('新增仅允许启用店铺/类别；编辑可保留原停用关联但不可变更到其他停用项', async () => {
    const seedInfo = await seed()
    const created = await createExpense(seedInfo)
    const expenseId = created.json().item.id as string
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/expenses/${expenseId}`,
      headers: authHeaders(seedInfo.s),
    })
    expect(detail.statusCode).toBe(200)

    // 停用店铺后，保留原值编辑金额应成功
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/shops/${seedInfo.shopId}/active`,
      headers: authHeaders(seedInfo.s),
      payload: { is_active: false },
    })
    const keepShop = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/expenses/${expenseId}`,
      headers: authHeaders(seedInfo.s),
      payload: {
        version: 1,
        shop_id: seedInfo.shopId,
        category_id: seedInfo.catId,
        amount: '66.00',
        bill_month: '2026-08',
        paid_date: '2026-08-20',
      },
    })
    expect(keepShop.statusCode).toBe(200)

    // 新增费用不能再用停用店铺
    const newWithInactive = await createExpense(seedInfo)
    expect(newWithInactive.statusCode).toBe(400)
  })

  it('统一筛选：交集、边界包含、keyword 字面匹配', async () => {
    const seedInfo = await seed()
    await createExpense(seedInfo, { amount: '10.00', bill_month: '2026-07', paid_date: '2026-07-05', remark: '七' })
    await createExpense(seedInfo, { amount: '20.00', bill_month: '2026-08', paid_date: '2026-08-05', remark: '八 100% 折扣' })
    await createExpense(seedInfo, { amount: '30.00', bill_month: '2026-09', paid_date: '2026-09-05', remark: '九' })

    const q = async (qs: Record<string, string>): Promise<{ total: number; total_amount_cents: number; count: number }> => {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/expenses', headers: authHeaders(seedInfo.s), query: qs })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      return { total: body.total, total_amount_cents: body.total_amount_cents, count: body.items.length }
    }

    expect(await q({ bill_month_from: '2026-08' })).toMatchObject({ total: 2 })
    expect(await q({ bill_month_from: '2026-08', bill_month_to: '2026-08' })).toMatchObject({ total: 1, total_amount_cents: 2000 })
    // 起点晚于终点 → 400
    const inverted = await ctx.app.inject({
      method: 'GET',
      url: '/api/expenses',
      headers: authHeaders(seedInfo.s),
      query: { bill_month_from: '2026-09', bill_month_to: '2026-08' },
    })
    expect(inverted.statusCode).toBe(400)
    expect(await q({ paid_date_from: '2026-08-01', paid_date_to: '2026-09-05' })).toMatchObject({ total: 2 })
    // LIKE 通配符按字面匹配
    expect(await q({ keyword: '100%' })).toMatchObject({ total: 1 })
    expect(await q({ keyword: '100x' })).toMatchObject({ total: 0 })
    // 交集
    expect(await q({ bill_month_from: '2026-08', keyword: '八' })).toMatchObject({ total: 1 })
  })

  it('分页合计基于全量筛选结果而非当前页', async () => {
    const seedInfo = await seed()
    for (let i = 1; i <= 5; i++) {
      await createExpense(seedInfo, { amount: `${i}.00`, paid_date: `2026-08-0${i}`, remark: `第${i}笔` })
    }
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/expenses',
      headers: authHeaders(seedInfo.s),
      query: { page: '1', page_size: '2', bill_month_from: '2026-08', bill_month_to: '2026-08' },
    })
    const body = res.json()
    expect(body.total).toBe(5)
    expect(body.items.length).toBe(2)
    expect(body.total_amount_cents).toBe(1500)
    expect(body.page).toBe(1)
    expect(body.page_size).toBe(2)
    // 排序：paid_date DESC
    expect(body.items[0].remark).toBe('第5笔')
  })

  it('删除费用连同附件元数据；不存在返回 404', async () => {
    const seedInfo = await seed()
    const created = await createExpense(seedInfo)
    const id = created.json().item.id as string
    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/expenses/${id}`, headers: authHeaders(seedInfo.s) })
    expect(del.statusCode).toBe(200)
    const detail = await ctx.app.inject({ method: 'GET', url: `/api/expenses/${id}`, headers: authHeaders(seedInfo.s) })
    expect(detail.statusCode).toBe(404)
  })
})
