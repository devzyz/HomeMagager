/** 业务时区固定为 Asia/Shanghai，与服务器时区无关 */
const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export const nowIso = (): string => new Date().toISOString()

/** 业务时区的今天，格式 YYYY-MM-DD */
export const businessToday = (): string => dayFormatter.format(new Date())

/** 业务时区当前月份，格式 YYYY-MM */
export const businessCurrentMonth = (): string => businessToday().slice(0, 7)

/** 月份字符串加减 n 个月（n 可为负），返回 YYYY-MM */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 以 endMonth 结尾的连续 count 个月（升序，含 endMonth） */
export function monthsEndingAt(endMonth: string, count: number): string[] {
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(endMonth, -i))
  return out
}
