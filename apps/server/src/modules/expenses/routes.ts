import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { parseWith } from '../../lib/validate.js'
import { pagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/hooks.js'
import { fsUnlinkQuiet } from '../../lib/files.js'
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  updateExpense,
  type ExpensePayload,
} from './service.js'
import { parseExpenseFilter } from './filter.js'

const ExpensePayloadSchema = Type.Object({
  shop_id: Type.String(),
  category_id: Type.String(),
  amount: Type.String(),
  bill_month: Type.String(),
  paid_date: Type.String(),
  remark: Type.Optional(Type.String()),
})

const CreateBody = Type.Intersect([
  ExpensePayloadSchema,
  Type.Object({ id: Type.Optional(Type.String()) }),
])

const UpdateBody = Type.Intersect([
  ExpensePayloadSchema,
  Type.Object({ version: Type.Integer({ minimum: 1 }) }),
])

const ListQuery = Type.Object({
  page: Type.Optional(Type.String()),
  page_size: Type.Optional(Type.String()),
  shop_id: Type.Optional(Type.String()),
  category_id: Type.Optional(Type.String()),
  bill_month_from: Type.Optional(Type.String()),
  bill_month_to: Type.Optional(Type.String()),
  paid_date_from: Type.Optional(Type.String()),
  paid_date_to: Type.Optional(Type.String()),
  keyword: Type.Optional(Type.String()),
})

export function registerExpenseRoutes(app: FastifyInstance): void {
  app.get('/api/expenses', { preHandler: requireAuth }, async (req) => {
    parseWith(ListQuery, req.query)
    const { page, pageSize } = pagination(req.query)
    const filter = parseExpenseFilter(req.query as Record<string, unknown>)
    const r = listExpenses(app.db, filter, page, pageSize)
    return {
      items: r.items,
      total: r.total,
      page: r.page,
      page_size: r.pageSize,
      total_amount_cents: r.totalAmountCents,
    }
  })

  app.get('/api/expenses/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const item = getExpense(app.db, id)
    return { item }
  })

  app.post('/api/expenses', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseWith(CreateBody, req.body)
    const operator = req.user!
    const payload: ExpensePayload = body
    const r = createExpense(app.db, operator.id, payload, { id: body.id })
    void reply.code(r.deduplicated ? 200 : 201)
    return r.deduplicated ? { item: r.item, deduplicated: true } : { item: r.item }
  })

  app.patch('/api/expenses/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const body = parseWith(UpdateBody, req.body)
    const operator = req.user!
    const item = updateExpense(app.db, operator.id, id, body.version, body)
    return { item }
  })

  app.delete('/api/expenses/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const { attachmentFiles } = deleteExpense(app.db, id)
    for (const name of attachmentFiles) {
      void fsUnlinkQuiet(app.config.uploadDir, name)
    }
    return { message: '已删除' }
  })
}
