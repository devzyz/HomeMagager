import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { badRequest, notFound } from '../../lib/errors.js'
import { parseWith } from '../../lib/validate.js'
import { businessToday, nowIso } from '../../lib/time.js'
import { validateBillMonth } from '../../lib/dates.js'
import { uuid } from '../../lib/ids.js'
import { requireAuth } from '../../plugins/hooks.js'

const Rate = Type.Integer({ minimum: 1, maximum: 999999 })
const MemberBody = Type.Object({ name: Type.String({ maxLength: 100 }), hourly_rate_cents: Rate })
const DayBody = Type.Object({
  status: Type.Union([Type.Literal('worked'), Type.Literal('leave')]),
  hours_hundredths: Type.Integer({ minimum: 0, maximum: 2400 }),
  hourly_rate_cents: Rate,
})
interface Member {
  id: string
  name: string
  hourly_rate_cents: number
  created_at: string
  updated_at: string
}
interface Day {
  work_date: string
  status: 'worked' | 'leave'
  hours_hundredths: number
  hourly_rate_cents: number
  amount_cents: number
}

function validDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof validateBillMonth(date.slice(0, 7)) !== 'string') {
    throw badRequest('日期需为 2000~2100 年的 YYYY-MM-DD')
  }
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest('日期不是真实存在的日历日期')
  }
  return date
}

export function registerPayrollRoutes(app: FastifyInstance): void {
  function memberById(id: string): Member {
    const member = app.db.prepare('SELECT * FROM payroll_members WHERE id = ?').get(id) as Member | undefined
    if (!member) throw notFound('工资成员不存在')
    return member
  }
  function memberInput(input: unknown) {
    const body = parseWith(MemberBody, input)
    const name = body.name.trim()
    if (!name || [...name].length > 50) throw badRequest('姓名需为 1~50 个字符')
    return { ...body, name }
  }

  app.get('/api/payroll/members', { preHandler: requireAuth }, async () => ({
    items: app.db.prepare('SELECT * FROM payroll_members ORDER BY created_at, id').all(),
  }))

  app.post('/api/payroll/members', { preHandler: requireAuth }, async (req, reply) => {
    const body = memberInput(req.body)
    const id = uuid()
    const now = nowIso()
    app.db.prepare('INSERT INTO payroll_members (id, name, hourly_rate_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, body.name, body.hourly_rate_cents, now, now)
    void reply.code(201)
    return { item: memberById(id) }
  })

  app.patch('/api/payroll/members/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    memberById(id)
    const body = memberInput(req.body)
    app.db.prepare('UPDATE payroll_members SET name = ?, hourly_rate_cents = ?, updated_at = ? WHERE id = ?')
      .run(body.name, body.hourly_rate_cents, nowIso(), id)
    return { item: memberById(id) }
  })

  app.get('/api/payroll/members/:id/calendar', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const member = memberById(id)
    const query = parseWith(Type.Object({ month: Type.Optional(Type.String()) }), req.query)
    const today = businessToday()
    const month = validateBillMonth(query.month ?? today.slice(0, 7))
    if (typeof month !== 'string') throw badRequest(month.error.replaceAll('账单', '工资'))
    const days = app.db.prepare('SELECT work_date, status, hours_hundredths, hourly_rate_cents, amount_cents FROM payroll_days WHERE member_id = ? AND work_date >= ? AND work_date <= ? ORDER BY work_date')
      .all(id, `${month}-01`, `${month}-31`) as Day[]
    const actual = days.filter((day) => day.work_date <= today)
    return {
      member, month, today, days,
      summary: {
        amount_cents: actual.reduce((sum, day) => sum + day.amount_cents, 0),
        hours_hundredths: actual.reduce((sum, day) => sum + day.hours_hundredths, 0),
        worked_days: actual.filter((day) => day.status === 'worked').length,
        leave_days: actual.filter((day) => day.status === 'leave').length,
      },
    }
  })

  app.patch('/api/payroll/members/:id/days/:date', { preHandler: requireAuth }, async (req) => {
    const { id, date } = req.params as { id: string; date: string }
    memberById(id)
    validDate(date)
    const body = parseWith(DayBody, req.body)
    if (body.status === 'worked' && body.hours_hundredths === 0) throw badRequest('上班时长需大于 0，最多 24 小时')
    if (body.status === 'leave' && body.hours_hundredths !== 0) throw badRequest('请假当天工时需为 0')
    const amount = Math.round(body.hourly_rate_cents * body.hours_hundredths / 100)
    app.db.prepare(`INSERT INTO payroll_days (member_id, work_date, status, hours_hundredths, hourly_rate_cents, amount_cents, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(member_id, work_date) DO UPDATE SET status = excluded.status, hours_hundredths = excluded.hours_hundredths,
      hourly_rate_cents = excluded.hourly_rate_cents, amount_cents = excluded.amount_cents,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(id, date, body.status, body.hours_hundredths, body.hourly_rate_cents, amount, req.user!.id, nowIso())
    return { message: '当天记录已保存' }
  })

  app.delete('/api/payroll/members/:id/days/:date', { preHandler: requireAuth }, async (req) => {
    const { id, date } = req.params as { id: string; date: string }
    memberById(id)
    validDate(date)
    app.db.prepare('DELETE FROM payroll_days WHERE member_id = ? AND work_date = ?').run(id, date)
    return { message: '当天记录已清除' }
  })
}
