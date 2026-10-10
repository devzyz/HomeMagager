import type { DB } from '../../types.js'
import { buildWhereClause, type ExpenseFilter } from '../expenses/filter.js'

export interface CategorySummary {
  category_id: string
  name: string
  count: number
  total_cents: number
}

export interface ReportSummary {
  totalCount: number
  totalCents: number
  categories: CategorySummary[]
}

/** 报表/Excel/打印共用的汇总逻辑：同一筛选、同一读快照 */
export function summarize(db: DB, filter: ExpenseFilter): ReportSummary {
  const { sql, params } = buildWhereClause(filter)
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents), 0) AS s FROM expenses e ${sql}`)
    .get(...params) as { c: number; s: number }
  const categories = db
    .prepare(
      `SELECT e.category_id, c.name, COUNT(*) AS count, SUM(e.amount_cents) AS total_cents
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       ${sql}
       GROUP BY e.category_id, c.name
       ORDER BY total_cents DESC, c.name`,
    )
    .all(...params) as CategorySummary[]
  return { totalCount: totalRow.c, totalCents: totalRow.s, categories }
}

/** 筛选条件的人类可读描述（写进 Excel 与打印页） */
export function describeFilter(filter: ExpenseFilter, shopName: string): string {
  const parts: string[] = [`店铺：${shopName}`]
  if (filter.categoryId) parts.push('指定类别')
  if (filter.billMonthFrom || filter.billMonthTo) {
    parts.push(`账单月份 ${filter.billMonthFrom ?? '…'} ~ ${filter.billMonthTo ?? '…'}`)
  }
  if (filter.paidDateFrom || filter.paidDateTo) {
    parts.push(`缴费日期 ${filter.paidDateFrom ?? '…'} ~ ${filter.paidDateTo ?? '…'}`)
  }
  if (filter.keyword) parts.push(`备注含“${filter.keyword}”`)
  return parts.join(' · ')
}
