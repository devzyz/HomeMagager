import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { badRequest, notFound } from '../lib/errors.js'
import { parseWith } from '../lib/validate.js'
import { nowIso } from '../lib/time.js'
import { uuid } from '../lib/ids.js'
import { requireAuth } from '../plugins/hooks.js'
import type { DictionaryRow } from '../types.js'

const NameBody = Type.Object({ name: Type.String() })
const ActiveBody = Type.Object({ is_active: Type.Boolean() })
const SortBody = Type.Object({ ids: Type.Array(Type.String(), { minItems: 1 }) })

function validateName(label: string, input: string): string {
  const name = input.trim()
  const len = [...name].length
  if (len < 1 || len > 50) throw badRequest(`${label}名称需为 1~50 个字符`)
  return name
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
}

export interface DictionaryOptions {
  basePath: '/api/shops' | '/api/categories'
  table: 'shops' | 'expense_categories'
  label: string
}

/** 店铺/类别共用：新增、改名、排序、启停；不提供物理删除 */
export function registerDictionaryRoutes(app: FastifyInstance, opts: DictionaryOptions): void {
  const { basePath, table, label } = opts
  const listSql = `SELECT * FROM ${table} ORDER BY sort_order, name, created_at`
  const byId = `SELECT * FROM ${table} WHERE id = ?`

  app.get(basePath, { preHandler: requireAuth }, async () => {
    const rows = app.db.prepare(listSql).all() as DictionaryRow[]
    return {
      items: rows.map((r) => ({ ...r, is_active: r.is_active === 1 })),
    }
  })

  app.post(basePath, { preHandler: requireAuth }, async (req, reply) => {
    const body = parseWith(NameBody, req.body)
    const name = validateName(label, body.name)
    const max = app.db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table}`).get() as { m: number }
    const id = uuid()
    const now = nowIso()
    try {
      app.db
        .prepare(`INSERT INTO ${table} (id, name, is_active, sort_order, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)`)
        .run(id, name, max.m + 1, now, now)
    } catch (err) {
      if (isUniqueViolation(err)) throw badRequest(`${label}名称已存在`, 'NAME_TAKEN')
      throw err
    }
    const row = app.db.prepare(byId).get(id) as DictionaryRow
    void reply.code(201)
    return { item: { ...row, is_active: row.is_active === 1 } }
  })

  app.patch(`${basePath}/:id`, { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const body = parseWith(NameBody, req.body)
    const name = validateName(label, body.name)
    const row = app.db.prepare(byId).get(id) as DictionaryRow | undefined
    if (!row) throw notFound(`${label}不存在`)
    try {
      app.db.prepare(`UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ?`).run(name, nowIso(), id)
    } catch (err) {
      if (isUniqueViolation(err)) throw badRequest(`${label}名称已存在`, 'NAME_TAKEN')
      throw err
    }
    return { message: '名称已更新' }
  })

  app.patch(`${basePath}/:id/active`, { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const body = parseWith(ActiveBody, req.body)
    const row = app.db.prepare(byId).get(id) as DictionaryRow | undefined
    if (!row) throw notFound(`${label}不存在`)
    app.db.prepare(`UPDATE ${table} SET is_active = ?, updated_at = ? WHERE id = ?`).run(body.is_active ? 1 : 0, nowIso(), id)
    return { message: body.is_active ? '已启用' : '已停用' }
  })

  app.patch(`${basePath}/sort`, { preHandler: requireAuth }, async (req) => {
    const body = parseWith(SortBody, req.body)
    const tx = app.db.transaction(() => {
      const stmt = app.db.prepare(`UPDATE ${table} SET sort_order = ?, updated_at = ? WHERE id = ?`)
      body.ids.forEach((id, i) => stmt.run(i + 1, nowIso(), id))
    })
    tx()
    const rows = app.db.prepare(listSql).all() as DictionaryRow[]
    return { items: rows.map((r) => ({ ...r, is_active: r.is_active === 1 })) }
  })
}
