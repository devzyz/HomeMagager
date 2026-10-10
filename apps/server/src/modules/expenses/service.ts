import type { DB } from '../../types.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { parseAmountToCents } from '../../lib/money.js'
import { validateBillMonth, validatePaidDate } from '../../lib/dates.js'
import { uuid } from '../../lib/ids.js'
import { nowIso } from '../../lib/time.js'
import { buildWhereClause, type ExpenseFilter } from './filter.js'

export interface ExpenseSqlRow {
  id: string
  shop_id: string
  category_id: string
  amount_cents: number
  bill_month: string
  paid_date: string
  remark: string | null
  created_by: string
  updated_by: string
  version: number
  created_at: string
  updated_at: string
  shop_name?: string
  category_name?: string
  attachment_count?: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ExpensePayload {
  shop_id: string
  category_id: string
  amount: string
  bill_month: string
  paid_date: string
  remark?: string
}

interface Validated {
  shopId: string
  categoryId: string
  amountCents: number
  billMonth: string
  paidDate: string
  remark: string | null
}

function normalizeRemark(remark: string | undefined): string | null {
  const t = (remark ?? '').trim()
  if (!t) return null
  if ([...t].length > 1000) throw badRequest('备注最多 1000 字')
  return t
}

function validatePayload(db: DB, p: ExpensePayload, current?: ExpenseSqlRow): Validated {
  // 编辑时保留原停用关联是允许的；变更关联只能选择启用项
  let shopId: string
  if (current && p.shop_id === current.shop_id) {
    shopId = p.shop_id
  } else {
    const shop = db.prepare('SELECT id, is_active FROM shops WHERE id = ?').get(p.shop_id) as
      | { id: string; is_active: 0 | 1 }
      | undefined
    if (!shop) throw badRequest('所选店铺不存在')
    if (shop.is_active !== 1) throw badRequest('所选店铺已停用，不能用于新增/变更')
    shopId = shop.id
  }

  let categoryId: string
  if (current && p.category_id === current.category_id) {
    categoryId = p.category_id
  } else {
    const cat = db.prepare('SELECT id, is_active FROM expense_categories WHERE id = ?').get(p.category_id) as
      | { id: string; is_active: 0 | 1 }
      | undefined
    if (!cat) throw badRequest('所选类别不存在')
    if (cat.is_active !== 1) throw badRequest('所选类别已停用，不能用于新增/变更')
    categoryId = cat.id
  }

  if (typeof p.amount !== 'string') throw badRequest('金额需以字符串提供')
  const cents = parseAmountToCents(p.amount)
  if (typeof cents !== 'number') throw badRequest(cents.error)

  const bm = validateBillMonth(p.bill_month)
  if (typeof bm !== 'string') throw badRequest(`账单月份：${bm.error}`)
  const pd = validatePaidDate(p.paid_date)
  if (typeof pd !== 'string') throw badRequest(pd.error)

  return {
    shopId,
    categoryId,
    amountCents: cents,
    billMonth: bm,
    paidDate: pd,
    remark: normalizeRemark(p.remark),
  }
}

function payloadMatches(row: ExpenseSqlRow, v: Validated): boolean {
  return (
    row.shop_id === v.shopId &&
    row.category_id === v.categoryId &&
    row.amount_cents === v.amountCents &&
    row.bill_month === v.billMonth &&
    row.paid_date === v.paidDate &&
    (row.remark ?? null) === v.remark
  )
}

/**
 * 新增费用：一次操作生成 UUID，网络重试复用同 ID。
 * 同 ID + 相同数据 → 返回已有记录；同 ID + 不同数据 → 409。
 */
export function createExpense(
  db: DB,
  operatorId: string,
  payload: ExpensePayload,
  opts: { id?: string },
): { item: ExpenseSqlRow; deduplicated: boolean } {
  let id: string
  if (opts.id !== undefined && opts.id !== '') {
    if (!UUID_RE.test(opts.id)) throw badRequest('费用 ID 格式不正确')
    id = opts.id.toLowerCase()
  } else {
    id = uuid()
  }

  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseSqlRow | undefined
  if (existing) {
    const v = validatePayload(db, payload, existing)
    if (payloadMatches(existing, v)) {
      return { item: withNames(db, existing), deduplicated: true }
    }
    throw conflict('相同 ID 的费用已存在但内容不同，请刷新后重新提交', 'DUPLICATE_ID')
  }

  const v = validatePayload(db, payload)
  const now = nowIso()
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO expenses (id, shop_id, category_id, amount_cents, bill_month, paid_date, remark, created_by, updated_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    ).run(id, v.shopId, v.categoryId, v.amountCents, v.billMonth, v.paidDate, v.remark, operatorId, operatorId, now, now)
  })
  tx()
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseSqlRow
  return { item: withNames(db, row), deduplicated: false }
}

/** 修改费用：version 条件更新防覆盖他人修改 */
export function updateExpense(
  db: DB,
  operatorId: string,
  id: string,
  version: number,
  payload: ExpensePayload,
): ExpenseSqlRow {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseSqlRow | undefined
  if (!row) throw notFound('费用不存在')
  if (row.version !== version) {
    throw conflict('记录已被他人修改，请刷新后重试', 'VERSION_CONFLICT')
  }
  const v = validatePayload(db, payload, row)
  const tx = db.transaction(() => {
    const r = db
      .prepare(
        'UPDATE expenses SET shop_id = ?, category_id = ?, amount_cents = ?, bill_month = ?, paid_date = ?, remark = ?, updated_by = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
      )
      .run(v.shopId, v.categoryId, v.amountCents, v.billMonth, v.paidDate, v.remark, operatorId, nowIso(), id, version)
    if (r.changes === 0) throw conflict('记录已被他人修改，请刷新后重试', 'VERSION_CONFLICT')
  })
  tx()
  const updated = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseSqlRow
  return withNames(db, updated)
}

/** 删除费用（含附件元数据）；文件清理由调用方在事务提交后执行 */
export function deleteExpense(db: DB, id: string): { attachmentFiles: string[] } {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT id FROM expenses WHERE id = ?').get(id)
    if (!row) throw notFound('费用不存在')
    const files = db
      .prepare('SELECT stored_name FROM expense_attachments WHERE expense_id = ?')
      .all(id) as { stored_name: string }[]
    db.prepare('DELETE FROM expense_attachments WHERE expense_id = ?').run(id)
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
    return files.map((f) => f.stored_name)
  })
  return { attachmentFiles: tx() }
}

export function getExpense(db: DB, id: string): ExpenseSqlRow {
  const row = db
    .prepare(
      'SELECT e.*, s.name AS shop_name, c.name AS category_name, (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.id) AS attachment_count FROM expenses e JOIN shops s ON s.id = e.shop_id JOIN expense_categories c ON c.id = e.category_id WHERE e.id = ?',
    )
    .get(id) as ExpenseSqlRow | undefined
  if (!row) throw notFound('费用不存在')
  return row
}

function withNames(db: DB, row: ExpenseSqlRow): ExpenseSqlRow {
  return getExpense(db, row.id)
}

export interface ExpenseListResult {
  items: ExpenseSqlRow[]
  total: number
  page: number
  pageSize: number
  totalAmountCents: number
}

export function listExpenses(db: DB, filter: ExpenseFilter, page: number, pageSize: number): ExpenseListResult {
  const { sql: whereSql, params } = buildWhereClause(filter)
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents), 0) AS s FROM expenses e ${whereSql}`)
    .get(...params) as { c: number; s: number }
  const total = totalRow.c
  const totalAmount = totalRow.s
  if (!Number.isSafeInteger(totalAmount)) throw new Error('汇总金额超出安全整数范围')

  const offset = (page - 1) * pageSize
  const items = db
    .prepare(
      `SELECT e.*, s.name AS shop_name, c.name AS category_name, (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.id) AS attachment_count FROM expenses e JOIN shops s ON s.id = e.shop_id JOIN expense_categories c ON c.id = e.category_id ${whereSql} ORDER BY e.paid_date DESC, e.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as ExpenseSqlRow[]
  return { items, total, page, pageSize, totalAmountCents: totalAmount }
}
