import { badRequest } from './errors.js'

/** 列表分页统一校验，避免非整数进入 SQLite LIMIT/OFFSET。 */
export function pagination(query: unknown): { page: number; pageSize: number } {
  const q = query as Record<string, unknown>
  function integer(key: string, fallback: number, max: number): number {
    const raw = q[key]
    if (raw === undefined || raw === '') return fallback
    const n = typeof raw === 'string' ? Number(raw) : NaN
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw badRequest(`${key} 需为 1~${max} 的整数`)
    }
    return n
  }
  return { page: integer('page', 1, 1000000), pageSize: integer('page_size', 20, 100) }
}
