import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { parseWith } from '../../lib/validate.js'
import { badRequest } from '../../lib/errors.js'
import { requireAuth } from '../../plugins/hooks.js'
import { validateBillMonth } from '../../lib/dates.js'
import { businessCurrentMonth, addMonths, monthsEndingAt } from '../../lib/time.js'

const DashboardQuery = Type.Object({
  month: Type.Optional(Type.String()),
  shop_id: Type.Optional(Type.String()),
})

interface MonthTotalRow {
  bill_month: string
  s: number | null
}

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get('/api/dashboard', { preHandler: requireAuth }, async (req) => {
    const q = parseWith(DashboardQuery, req.query)

    let month = businessCurrentMonth()
    if (q.month) {
      const v = validateBillMonth(q.month)
      if (typeof v !== 'string') throw badRequest(`month：${v.error}`)
      month = v
    }
    const shopId = q.shop_id && q.shop_id !== 'all' ? q.shop_id : undefined
    const shopCond = shopId ? 'AND shop_id = ?' : ''
    const shopParams = shopId ? [shopId] : []

    const sumFor = (cond: string, params: unknown[]): number => {
      const r = app.db
        .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s, COUNT(*) AS c FROM expenses WHERE ${cond}`)
        .get(...params) as { s: number; c: number }
      return r.s
    }

    const monthTotal = sumFor(`bill_month = ? ${shopCond}`, [month, ...shopParams])
    const monthCount = (
      app.db.prepare(`SELECT COUNT(*) AS c FROM expenses WHERE bill_month = ? ${shopCond}`).get(month, ...shopParams) as {
        c: number
      }
    ).c

    const prevMonth = addMonths(month, -1)
    const prevTotal = sumFor(`bill_month = ? ${shopCond}`, [prevMonth, ...shopParams])

    const yearStart = `${month.slice(0, 4)}-01`
    const yearEnd = `${month.slice(0, 4)}-12`
    const yearTotal = sumFor(`bill_month >= ? AND bill_month <= ? ${shopCond}`, [yearStart, yearEnd, ...shopParams])

    // 连续 12 个月趋势：无记录月份补 0
    const months = monthsEndingAt(month, 12)
    const trendRows = app.db
      .prepare(
        `SELECT bill_month, SUM(amount_cents) AS s FROM expenses WHERE bill_month >= ? AND bill_month <= ? ${shopCond} GROUP BY bill_month`,
      )
      .all(months[0], month, ...shopParams) as MonthTotalRow[]
    const trendMap = new Map(trendRows.map((r) => [r.bill_month, r.s ?? 0]))
    const trend = months.map((m) => ({ month: m, total_cents: trendMap.get(m) ?? 0 }))

    // 当月类别占比（仅含有记录的类别）
    const categories = app.db
      .prepare(
        `SELECT e.category_id, c.name, SUM(e.amount_cents) AS total_cents FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.bill_month = ? ${shopCond ? 'AND e.shop_id = ?' : ''} GROUP BY e.category_id, c.name HAVING total_cents > 0 ORDER BY total_cents DESC`,
      )
      .all(month, ...shopParams) as { category_id: string; name: string; total_cents: number }[]

    // 全部店铺时给出店铺对比
    let shops: { shop_id: string; name: string; total_cents: number }[] | null = null
    if (!shopId) {
      shops = app.db
        .prepare(
          `SELECT e.shop_id, s.name, SUM(e.amount_cents) AS total_cents FROM expenses e JOIN shops s ON s.id = e.shop_id WHERE e.bill_month = ? GROUP BY e.shop_id, s.name HAVING total_cents > 0 ORDER BY total_cents DESC`,
        )
        .all(month) as { shop_id: string; name: string; total_cents: number }[]
    }

    return {
      month,
      shop_id: shopId ?? null,
      month_total_cents: monthTotal,
      month_count: monthCount,
      year_total_cents: yearTotal,
      prev_month: prevMonth,
      prev_month_total_cents: prevTotal,
      month_over_prev: prevTotal === 0 ? null : (monthTotal - prevTotal) / prevTotal,
      trend,
      categories,
      shops,
      month_is_current: month === businessCurrentMonth(),
    }
  })
}
