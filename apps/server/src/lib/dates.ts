import { businessToday } from './time.js'

const BILL_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const PAID_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MIN_YEAR = 2000
const MAX_YEAR = 2100

/** 账单月份 YYYY-MM：校验格式与真实月份范围 */
export function validateBillMonth(input: string): string | { error: string } {
  const s = input.trim()
  if (!BILL_MONTH_RE.test(s)) return { error: '账单月份格式需为 YYYY-MM' }
  const year = Number(s.slice(0, 4))
  if (year < MIN_YEAR || year > MAX_YEAR) return { error: `账单月份年份需在 ${MIN_YEAR}~${MAX_YEAR} 之间` }
  return s
}

/** 缴费日期 YYYY-MM-DD：校验真实日历日期，且不得晚于业务时区的今天 */
export function validatePaidDate(input: string): string | { error: string } {
  const s = input.trim()
  if (!PAID_DATE_RE.test(s)) return { error: '缴费日期格式需为 YYYY-MM-DD' }
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  if (y < MIN_YEAR || y > MAX_YEAR) return { error: `缴费日期年份需在 ${MIN_YEAR}~${MAX_YEAR} 之间` }
  const dt = new Date(Date.UTC(y, m - 1, d))
  const isReal =
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  if (!isReal) return { error: '缴费日期不是真实存在的日历日期' }
  if (s > businessToday()) return { error: '缴费日期不能晚于今天' }
  return s
}
