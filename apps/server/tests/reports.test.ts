import JSZip from 'jszip'
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
  aliceId: string
  shopA: string
  catId: string
  catName: string
}

async function seed(): Promise<Seed> {
  ctx = await createTestApp()
  const alice = await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
  const s = await login(ctx, alice.username, alice.password)
  const shopA = await ctx.app.inject({ method: 'POST', url: '/api/shops', headers: authHeaders(s), payload: { name: 'A店' } })
  const cats = await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: authHeaders(s) })
  const cat = cats.json().items[0]
  const add = (amountCents: number, billMonth: string, remark: string | null): void => {
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        'INSERT INTO expenses (id, shop_id, category_id, amount_cents, bill_month, paid_date, remark, created_by, updated_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .run(crypto.randomUUID(), shopA.json().item.id, cat.id, amountCents, billMonth, `${billMonth}-15`, remark, alice.id, alice.id, now, now)
  }
  add(10000, '2026-07', '水费7月')
  add(20000, '2026-08', '=公式注入测试')
  add(5000, '2026-08', null)
  return { s, aliceId: alice.id, shopA: shopA.json().item.id, catId: cat.id, catName: cat.name as string }
}

describe('reports', () => {
  it('汇总与列表口径一致（同筛选同合计）', async () => {
    const seedInfo = await seed()
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/expenses',
      headers: authHeaders(seedInfo.s),
      query: { bill_month_from: '2026-08', bill_month_to: '2026-08' },
    })
    const report = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports',
      headers: authHeaders(seedInfo.s),
      query: { bill_month_from: '2026-08', bill_month_to: '2026-08' },
    })
    expect(report.statusCode).toBe(200)
    expect(report.json().total_count).toBe(list.json().total)
    expect(report.json().total_amount_cents).toBe(list.json().total_amount_cents)
    expect(report.json().categories[0]).toMatchObject({ count: 2, total_cents: 25000 })
    expect(report.json().stat_basis).toContain('账单月份')
    expect(report.json().filter_description).toContain('2026-08')
  })

  it('打印数据在 1000 条以内可用，超限明确拒绝', async () => {
    const seedInfo = await seed()
    const now = new Date().toISOString()
    ctx.db.transaction(() => {
      const stmt = ctx.db.prepare(
        'INSERT INTO expenses (id, shop_id, category_id, amount_cents, bill_month, paid_date, remark, created_by, updated_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)',
      )
      for (let i = 0; i < 1100; i++) {
        stmt.run(crypto.randomUUID(), seedInfo.shopA, seedInfo.catId, 100, '2026-05', '2026-05-01', seedInfo.aliceId, seedInfo.aliceId, now, now)
      }
    })()

    const print = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports/print-data',
      headers: authHeaders(seedInfo.s),
      query: { bill_month_from: '2026-05', bill_month_to: '2026-05' },
    })
    expect(print.statusCode).toBe(400)
    expect(print.json().code).toBe('EXPORT_LIMIT')

    // Excel 上限是 10000：1100 条可以导出
    const excelUnder = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports/excel',
      headers: authHeaders(seedInfo.s),
      query: { bill_month_from: '2026-05', bill_month_to: '2026-05' },
    })
    expect(excelUnder.statusCode).toBe(200)

    // 超过 10000 条 → 拒绝导出（在生成文件前拦截，不静默截断）
    const now2 = new Date().toISOString()
    ctx.db.transaction(() => {
      const stmt = ctx.db.prepare(
        'INSERT INTO expenses (id, shop_id, category_id, amount_cents, bill_month, paid_date, remark, created_by, updated_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)',
      )
      for (let i = 0; i < 10001; i++) {
        stmt.run(crypto.randomUUID(), seedInfo.shopA, seedInfo.catId, 100, '2026-04', '2026-04-01', seedInfo.aliceId, seedInfo.aliceId, now2, now2)
      }
    })()
    const excelOver = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports/excel',
      headers: authHeaders(seedInfo.s),
      query: { bill_month_from: '2026-04', bill_month_to: '2026-04' },
    })
    expect(excelOver.statusCode).toBe(400)
    expect(excelOver.json().code).toBe('EXPORT_LIMIT')

    // 汇总查询不受明细导出上限影响
    const summary = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports',
      headers: authHeaders(seedInfo.s),
      query: { bill_month_from: '2026-04', bill_month_to: '2026-04' },
    })
    expect(summary.statusCode).toBe(200)
    expect(summary.json().total_count).toBe(10001)

    // 缩小范围后可用
    const ok = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports/print-data',
      headers: authHeaders(seedInfo.s),
      query: { bill_month_from: '2026-05', bill_month_to: '2026-05', paid_date_from: '2026-05-01', paid_date_to: '2026-05-01', keyword: '不存在的备注' },
    })
    expect(ok.statusCode).toBe(200)
  })

  it('Excel：数字类型金额、字符串备注、分类汇总与总计、文件名编码', async () => {
    const seedInfo = await seed()
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports/excel',
      headers: authHeaders(seedInfo.s),
      query: { shop_id: seedInfo.shopA, bill_month_from: '2026-08', bill_month_to: '2026-08' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
    const disposition = String(res.headers['content-disposition'])
    expect(disposition).toContain("filename*=UTF-8''")
    expect(disposition).toContain(encodeURIComponent('A店'))

    // exceljs 流式写出的文件可被 Excel 正常打开，但其自带读取器不兼容流式格式，
    // 因此这里直接校验 zip 内的 XML 内容
    const zip = await JSZip.loadAsync(res.rawPayload)
    const workbookXml = await zip.file('xl/workbook.xml')!.async('string')
    expect(workbookXml).toContain('费用明细')
    expect(workbookXml).toContain('分类汇总')
    expect(workbookXml).toContain('说明')

    const sharedStrings = await zip.file('xl/sharedStrings.xml')!.async('string')
    expect(sharedStrings).toContain('合计')
    expect(sharedStrings).toContain('=公式注入测试')
    expect(sharedStrings).toContain('按账单月份统计（bill_month）')

    const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    // 金额为数字类型单元格（200.00 元）；行序按 paid_date/id 排序，不绑定行号
    expect(sheet1).toMatch(/<c r="D\d+" s="\d+"><v>200<\/v><\/c>/)
    // 合计行金额 250 元
    expect(sheet1).toMatch(/<c r="D\d+" s="\d+"><v>250<\/v><\/c>/)

    const styles = await zip.file('xl/styles.xml')!.async('string')
    expect(styles).toContain('#,##0.00')
  })

  it('空结果导出成功且只有表头', async () => {
    const seedInfo = await seed()
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports/excel',
      headers: authHeaders(seedInfo.s),
      query: { keyword: '绝对不存在的备注xyz' },
    })
    expect(res.statusCode).toBe(200)
    const zip = await JSZip.loadAsync(res.rawPayload)
    const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    const shared = await zip.file('xl/sharedStrings.xml')!.async('string')
    // 只有表头 + 合计行；合计 0 笔
    expect(shared).toContain('0 笔')
    expect(sheet1).toMatch(/<c r="D2" s="\d+"><v>0<\/v><\/c>/)
  })
})
