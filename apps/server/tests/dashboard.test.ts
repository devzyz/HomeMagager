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

async function seed(): Promise<Seed> {
  ctx = await createTestApp()
  const alice = await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
  const s = await login(ctx, alice.username, alice.password)
  const shopA = await ctx.app.inject({ method: 'POST', url: '/api/shops', headers: authHeaders(s), payload: { name: 'A店' } })
  const shopB = await ctx.app.inject({ method: 'POST', url: '/api/shops', headers: authHeaders(s), payload: { name: 'B店' } })
  const cats = await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: authHeaders(s) })
  const catId = cats.json().items[0].id as string
  return { s, aliceId: alice.id, shopA: shopA.json().item.id, shopB: shopB.json().item.id, catId }
}

interface Seed {
  s: SessionRef
  aliceId: string
  shopA: string
  shopB: string
  catId: string
}

function insertExpense(seedInfo: Seed, shopId: string, catId: string, amountCents: number, billMonth: string): void {
  const now = new Date().toISOString()
  ctx.db
    .prepare(
      'INSERT INTO expenses (id, shop_id, category_id, amount_cents, bill_month, paid_date, remark, created_by, updated_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)',
    )
    .run(
      crypto.randomUUID(),
      shopId,
      catId,
      amountCents,
      billMonth,
      `${billMonth}-10`,
      seedInfo.aliceId,
      seedInfo.aliceId,
      now,
      now,
    )
}

describe('dashboard', () => {
  it('月合计、年累计、环比、12 个月趋势（补 0）、类别与店铺对比', async () => {
    const seedInfo = await seed()
    insertExpense(seedInfo, seedInfo.shopA, seedInfo.catId, 10000, '2026-07')
    insertExpense(seedInfo, seedInfo.shopA, seedInfo.catId, 20000, '2026-08')
    insertExpense(seedInfo, seedInfo.shopB, seedInfo.catId, 30000, '2026-08')
    insertExpense(seedInfo, seedInfo.shopA, seedInfo.catId, 5000, '2026-09')

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: authHeaders(seedInfo.s),
      query: { month: '2026-08' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.month_total_cents).toBe(50000)
    expect(body.month_count).toBe(2)
    expect(body.year_total_cents).toBe(65000)
    expect(body.prev_month).toBe('2026-07')
    expect(body.prev_month_total_cents).toBe(10000)
    expect(body.month_over_prev).toBe(4)
    expect(body.month_is_current).toBe(false)

    expect(body.trend.length).toBe(12)
    expect(body.trend[11]).toEqual({ month: '2026-08', total_cents: 50000 })
    expect(body.trend[10]).toEqual({ month: '2026-07', total_cents: 10000 })
    expect(body.trend[0].total_cents).toBe(0)

    expect(body.shops).toEqual([
      { shop_id: seedInfo.shopB, name: 'B店', total_cents: 30000 },
      { shop_id: seedInfo.shopA, name: 'A店', total_cents: 20000 },
    ])
    expect(body.categories.length).toBe(1)
    expect(body.categories[0].total_cents).toBe(50000)
  })

  it('店铺筛选影响全部统计', async () => {
    const seedInfo = await seed()
    insertExpense(seedInfo, seedInfo.shopA, seedInfo.catId, 10000, '2026-08')
    insertExpense(seedInfo, seedInfo.shopB, seedInfo.catId, 50000, '2026-08')
    insertExpense(seedInfo, seedInfo.shopA, seedInfo.catId, 2500, '2026-12')
    insertExpense(seedInfo, seedInfo.shopA, seedInfo.catId, 90000, '2025-12')
    insertExpense(seedInfo, seedInfo.shopA, seedInfo.catId, 90000, '2027-01')
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: authHeaders(seedInfo.s),
      query: { month: '2026-08', shop_id: seedInfo.shopA },
    })
    const body = res.json()
    expect(body.month_total_cents).toBe(10000)
    expect(body.year_total_cents).toBe(12500)
    expect(body.shops).toBeNull()
  })

  it('无记录月份补 0；上月为 0 时环比为 null；不虚构占比', async () => {
    const seedInfo = await seed()
    insertExpense(seedInfo, seedInfo.shopA, seedInfo.catId, 10000, '2026-08')
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: authHeaders(seedInfo.s),
      query: { month: '2026-09' },
    })
    const body = res.json()
    expect(body.month_total_cents).toBe(0)
    expect(body.prev_month_total_cents).toBe(10000)
    expect(body.month_over_prev).toBe(-1)
    expect(body.categories).toEqual([])

    const res2 = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: authHeaders(seedInfo.s),
      query: { month: '2026-02' },
    })
    const body2 = res2.json()
    expect(body2.month_total_cents).toBe(0)
    expect(body2.prev_month_total_cents).toBe(0)
    expect(body2.month_over_prev).toBeNull()
  })

  it('默认返回当前月并标注 month_is_current', async () => {
    const seedInfo = await seed()
    const res = await ctx.app.inject({ method: 'GET', url: '/api/dashboard', headers: authHeaders(seedInfo.s) })
    const body = res.json()
    expect(body.month_is_current).toBe(true)
    expect(body.month).toMatch(/^\d{4}-\d{2}$/)
  })
})
