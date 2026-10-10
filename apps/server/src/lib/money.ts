// 金额统一使用整数分；输入为十进制字符串，禁止浮点乘 100
const AMOUNT_RE = /^\d{1,7}(\.\d{1,2})?$/
export const MAX_AMOUNT_CENTS = 999999999

export function parseAmountToCents(input: string): number | { error: string } {
  const s = input.trim()
  if (!AMOUNT_RE.test(s)) {
    return { error: '金额格式不正确：需为最多两位小数的正数（如 128.50），单笔最大 9999999.99' }
  }
  const [intPart, fracPart = ''] = s.split('.')
  const cents = Number(intPart) * 100 + Number(`${fracPart}00`.slice(0, 2))
  if (cents < 1 || cents > MAX_AMOUNT_CENTS) {
    return { error: '单笔金额需在 ¥0.01 ~ ¥9,999,999.99 之间' }
  }
  return cents
}

/** 展示用：分 → 两位小数字符串（整数运算） */
export function centsToYuan(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const yuan = Math.floor(abs / 100)
  const fen = String(abs % 100).padStart(2, '0')
  return `${sign}${yuan}.${fen}`
}
