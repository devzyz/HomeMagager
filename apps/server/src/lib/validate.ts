import { type TSchema, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { badRequest } from './errors.js'

/** 校验请求体/查询参数；失败抛 400，错误信息含字段路径（不含内部细节） */
export function parseWith<T extends TSchema>(schema: T, value: unknown): Static<T> {
  const withDefaults = Value.Default(schema, structuredClone(value))
  if (Value.Check(schema, withDefaults)) {
    return withDefaults as Static<T>
  }
  const errors = [...Value.Errors(schema, withDefaults)]
  const first = errors[0]
  const field = first?.path?.replace(/^\//, '').replace(/\//g, '.') || '参数'
  const msg = first?.message ?? '格式不正确'
  throw badRequest(`${field} ${msg}`, 'VALIDATION')
}
