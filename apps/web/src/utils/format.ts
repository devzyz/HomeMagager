const cnyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 整数分 → ¥1,234.56 */
export function formatCents(cents: number): string {
  return cnyFormatter.format(cents / 100)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 浏览器本地今天（家庭成员在中国，默认与业务时区一致） */
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function currentMonthStr(): string {
  return todayStr().slice(0, 7)
}

const AMOUNT_RE = /^\d{1,7}(\.\d{1,2})?$/

/** 前端与服务端同规则的金额预校验 */
export function isValidAmount(input: string): boolean {
  return AMOUNT_RE.test(input.trim()) && parseAmountToCentsOrNull(input) !== null
}

export function parseAmountToCentsOrNull(input: string): number | null {
  const s = input.trim()
  if (!AMOUNT_RE.test(s)) return null
  const [intPart, fracPart = ''] = s.split('.')
  const cents = Number(intPart) * 100 + Number(`${fracPart}00`.slice(0, 2))
  if (cents < 1 || cents > 999999999) return null
  return cents
}
