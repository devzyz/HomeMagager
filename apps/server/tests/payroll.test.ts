import { afterEach, describe, expect, it } from 'vitest'
import { authHeaders, cleanup, createTestApp, insertUser, login, type TestCtx } from './helpers.js'
import { businessToday } from '../src/lib/time.js'

let ctx: TestCtx
afterEach(() => { if (ctx) cleanup(ctx) })

async function setup() {
  ctx = await createTestApp()
  const user = await insertUser(ctx.db)
  const session = await login(ctx, user.username, user.password)
  const headers = authHeaders(session)
  const response = await ctx.app.inject({ method: 'POST', url: '/api/payroll/members', headers, payload: { name: '  小王  ', hourly_rate_cents: 2055 } })
  expect(response.statusCode).toBe(201)
  expect(response.json().item.name).toBe('小王')
  const base = `/api/payroll/members/${response.json().item.id}`
  return { headers, base }
}

describe('工资成员和每日工资', () => {
  it('保存、修改工时、按日四舍五入、请假、清除和成员隔离', async () => {
    const { headers, base } = await setup()
    const write = (date: string, status: string, hours: number) => ctx.app.inject({ method: 'PATCH', url: `${base}/days/${date}`, headers, payload: { status, hours_hundredths: hours, hourly_rate_cents: 2055 } })
    expect((await write('2024-02-29', 'worked', 125)).statusCode).toBe(200)
    expect((await write('2024-02-28', 'worked', 800)).statusCode).toBe(200)
    expect((await write('2024-02-28', 'worked', 750)).statusCode).toBe(200)
    expect((await write('2024-02-27', 'leave', 0)).statusCode).toBe(200)
    await write('2024-03-01', 'worked', 100)
    let calendar = (await ctx.app.inject({ url: `${base}/calendar?month=2024-02`, headers })).json()
    expect(calendar.days).toHaveLength(3)
    expect(calendar.summary).toEqual({ amount_cents: 17982, hours_hundredths: 875, worked_days: 2, leave_days: 1 })
    expect(calendar.days[2].amount_cents).toBe(2569)

    await ctx.app.inject({ method: 'PATCH', url: base, headers, payload: { name: '小王', hourly_rate_cents: 3000 } })
    calendar = (await ctx.app.inject({ url: `${base}/calendar?month=2024-02`, headers })).json()
    expect(calendar.member.hourly_rate_cents).toBe(3000)
    expect(calendar.days[2].hourly_rate_cents).toBe(2055)
    expect(calendar.summary.amount_cents).toBe(17982)

    const second = await ctx.app.inject({ method: 'POST', url: '/api/payroll/members', headers, payload: { name: '小李', hourly_rate_cents: 1000 } })
    const other = await ctx.app.inject({ url: `/api/payroll/members/${second.json().item.id}/calendar?month=2024-02`, headers })
    expect(other.json().days).toEqual([])
    await write('2024-02-28', 'leave', 0)
    await ctx.app.inject({ method: 'DELETE', url: `${base}/days/2024-02-29`, headers })
    calendar = (await ctx.app.inject({ url: `${base}/calendar?month=2024-02`, headers })).json()
    expect(calendar.summary).toEqual({ amount_cents: 0, hours_hundredths: 0, worked_days: 0, leave_days: 2 })
  })

  it('默认当前业务月份，未来预记不计入实际汇总', async () => {
    const { headers, base } = await setup()
    const today = businessToday()
    const current = (await ctx.app.inject({ url: `${base}/calendar`, headers })).json()
    expect(current.month).toBe(today.slice(0, 7))
    expect(current.today).toBe(today)
    const next = new Date(`${today}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    const future = next.toISOString().slice(0, 10)
    const saved = await ctx.app.inject({ method: 'PATCH', url: `${base}/days/${future}`, headers, payload: { status: 'worked', hours_hundredths: 800, hourly_rate_cents: 2000 } })
    expect(saved.statusCode).toBe(200)
    const result = (await ctx.app.inject({ url: `${base}/calendar?month=${future.slice(0, 7)}`, headers })).json()
    expect(result.days[0].amount_cents).toBe(16000)
    expect(result.summary.amount_cents).toBe(0)
    expect(result.summary.worked_days).toBe(0)
  })

  it('拒绝无效日期、月份、工时、时薪及空姓名', async () => {
    const { headers, base } = await setup()
    const body = { status: 'worked', hours_hundredths: 800, hourly_rate_cents: 2000 }
    for (const date of ['2025-02-29', '2024-04-31', '2024-13-01', '1999-12-31', '2024-2-01']) {
      expect((await ctx.app.inject({ method: 'PATCH', url: `${base}/days/${date}`, headers, payload: body })).statusCode).toBe(400)
    }
    for (const override of [{ hours_hundredths: 0 }, { hours_hundredths: -1 }, { hours_hundredths: 2401 }, { hours_hundredths: 1.5 }, { hourly_rate_cents: 0 }, { hourly_rate_cents: 9999999 }, { status: 'leave' }, { status: 'invalid' }]) {
      expect((await ctx.app.inject({ method: 'PATCH', url: `${base}/days/2024-02-29`, headers, payload: { ...body, ...override } })).statusCode).toBe(400)
    }
    expect((await ctx.app.inject({ url: `${base}/calendar?month=2024-13`, headers })).statusCode).toBe(400)
    expect((await ctx.app.inject({ method: 'POST', url: '/api/payroll/members', headers, payload: { name: ' ', hourly_rate_cents: 2000 } })).statusCode).toBe(400)
    expect((await ctx.app.inject({ url: '/api/payroll/members/missing/calendar', headers })).statusCode).toBe(404)
  })

  it('工资读写沿用登录、来源和 CSRF 校验', async () => {
    const { headers, base } = await setup()
    expect((await ctx.app.inject({ url: '/api/payroll/members' })).statusCode).toBe(401)
    expect((await ctx.app.inject({ url: `${base}/calendar` })).statusCode).toBe(401)
    expect((await ctx.app.inject({ method: 'PATCH', url: `${base}/days/2024-02-29`, headers: { origin: headers.origin! } , payload: {} })).statusCode).toBe(401)
    expect((await ctx.app.inject({ method: 'DELETE', url: `${base}/days/2024-02-29`, headers: { cookie: headers.cookie!, origin: headers.origin! } })).statusCode).toBe(403)
    expect((await ctx.app.inject({ method: 'DELETE', url: `${base}/days/2024-02-29`, headers: { ...headers, origin: 'https://example.com' } })).statusCode).toBe(403)
  })
})
