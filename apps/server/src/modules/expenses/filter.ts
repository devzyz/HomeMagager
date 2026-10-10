import { badRequest } from '../../lib/errors.js'
import { validateBillMonth, validatePaidDate } from '../../lib/dates.js'

/** 统一筛选：起止均包含边界；不同条件取交集 */
export interface ExpenseFilter {
  shopId?: string
  categoryId?: string
  billMonthFrom?: string
  billMonthTo?: string
  paidDateFrom?: string
  paidDateTo?: string
  keyword?: string
}

type RawQuery = Record<string, unknown>

function str(query: RawQuery, key: string): string | undefined {
  const v = query[key]
  const s = typeof v === 'string' ? v.trim() : undefined
  return s ? s : undefined
}

export function parseExpenseFilter(query: RawQuery): ExpenseFilter {
  const f: ExpenseFilter = {}
  f.shopId = str(query, 'shop_id')
  f.categoryId = str(query, 'category_id')

  const bmFrom = str(query, 'bill_month_from')
  const bmTo = str(query, 'bill_month_to')
  if (bmFrom) {
    const v = validateBillMonth(bmFrom)
    if (typeof v !== 'string') throw badRequest(`bill_month_from：${v.error}`)
    f.billMonthFrom = v
  }
  if (bmTo) {
    const v = validateBillMonth(bmTo)
    if (typeof v !== 'string') throw badRequest(`bill_month_to：${v.error}`)
    f.billMonthTo = v
  }
  if (f.billMonthFrom && f.billMonthTo && f.billMonthFrom > f.billMonthTo) {
    throw badRequest('bill_month_from 不能晚于 bill_month_to')
  }

  const pdFrom = str(query, 'paid_date_from')
  const pdTo = str(query, 'paid_date_to')
  if (pdFrom) {
    const v = validatePaidDate(pdFrom)
    if (typeof v !== 'string') throw badRequest(`paid_date_from：${v.error}`)
    f.paidDateFrom = v
  }
  if (pdTo) {
    const v = validatePaidDate(pdTo)
    if (typeof v !== 'string') throw badRequest(`paid_date_to：${v.error}`)
    f.paidDateTo = v
  }
  if (f.paidDateFrom && f.paidDateTo && f.paidDateFrom > f.paidDateTo) {
    throw badRequest('paid_date_from 不能晚于 paid_date_to')
  }

  const kw = str(query, 'keyword')
  if (kw) {
    if ([...kw].length > 100) throw badRequest('keyword 最多 100 字')
    f.keyword = kw
  }
  return f
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/** 由受控代码生成 WHERE，全部参数绑定 */
export function buildWhereClause(filter: ExpenseFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (filter.shopId) {
    clauses.push('e.shop_id = ?')
    params.push(filter.shopId)
  }
  if (filter.categoryId) {
    clauses.push('e.category_id = ?')
    params.push(filter.categoryId)
  }
  if (filter.billMonthFrom) {
    clauses.push('e.bill_month >= ?')
    params.push(filter.billMonthFrom)
  }
  if (filter.billMonthTo) {
    clauses.push('e.bill_month <= ?')
    params.push(filter.billMonthTo)
  }
  if (filter.paidDateFrom) {
    clauses.push('e.paid_date >= ?')
    params.push(filter.paidDateFrom)
  }
  if (filter.paidDateTo) {
    clauses.push('e.paid_date <= ?')
    params.push(filter.paidDateTo)
  }
  if (filter.keyword) {
    clauses.push(`e.remark LIKE ? ESCAPE '\\'`)
    params.push(`%${escapeLike(filter.keyword)}%`)
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
}
