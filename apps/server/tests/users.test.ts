import { afterEach, describe, expect, it } from 'vitest'
import { authHeaders, cleanup, createTestApp, insertUser, login, type SessionRef, type TestCtx } from './helpers.js'
import { setUserActive } from '../src/modules/users/service.js'

let ctx: TestCtx
afterEach(() => {
  if (ctx) cleanup(ctx)
})

describe('users', () => {
  async function setup(): Promise<{ alice: Awaited<ReturnType<typeof insertUser>>; s: SessionRef }> {
    ctx = await createTestApp()
    const alice = await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
    const s = await login(ctx, alice.username, alice.password)
    return { alice, s }
  }

  it('创建成员：规范化用户名、首登需改密；重复/非法输入被拒', async () => {
    const { alice, s } = await setup()
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(s),
      payload: { username: '  Bob_01 ', display_name: ' 小鲍 ', password: 'password-bob-123', operator_password: alice.password },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().user).toMatchObject({ username: 'bob_01', display_name: '小鲍', must_change_password: true })

    const dupe = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(s),
      payload: { username: 'BOB_01', display_name: 'x', password: 'password-bob-123', operator_password: alice.password },
    })
    expect(dupe.statusCode).toBe(400)
    expect(dupe.json().code).toBe('USERNAME_TAKEN')

    const badName = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(s),
      payload: { username: 'ab', display_name: 'x', password: 'password-bob-123', operator_password: alice.password },
    })
    expect(badName.statusCode).toBe(400)

    const shortPw = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(s),
      payload: { username: 'carl', display_name: 'x', password: 'short', operator_password: alice.password },
    })
    expect(shortPw.statusCode).toBe(400)

    const wrongOp = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(s),
      payload: { username: 'carl', display_name: 'x', password: 'password-carl-1', operator_password: 'wrong-password!' },
    })
    expect(wrongOp.statusCode).toBe(403)
    expect(wrongOp.json().code).toBe('OPERATOR_PASSWORD_WRONG')
  })

  it('未登录访问用户列表返回 401', async () => {
    await setup()
    const res = await ctx.app.inject({ method: 'GET', url: '/api/users' })
    expect(res.statusCode).toBe(401)
  })

  it('只能修改自己的显示名', async () => {
    const { alice, s } = await setup()
    const bob = await insertUser(ctx.db, { username: 'bob' })
    const other = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${bob.id}/display-name`,
      headers: authHeaders(s),
      payload: { display_name: '新名字' },
    })
    expect(other.statusCode).toBe(403)

    const own = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${alice.id}/display-name`,
      headers: authHeaders(s),
      payload: { display_name: ' 新名字 ' },
    })
    expect(own.statusCode).toBe(200)
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `famsid=${s.cookie}` } })
    expect(me.json().user.display_name).toBe('新名字')
  })

  it('不能停用自己；操作者密码错误被拒', async () => {
    const { alice, s } = await setup()
    const self = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${alice.id}/active`,
      headers: authHeaders(s),
      payload: { is_active: false, operator_password: alice.password },
    })
    expect(self.statusCode).toBe(400)
    expect(self.json().code).toBe('CANNOT_DISABLE_SELF')

    const bob = await insertUser(ctx.db, { username: 'bob' })
    const wrongOp = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${bob.id}/active`,
      headers: authHeaders(s),
      payload: { is_active: false, operator_password: 'not-my-password' },
    })
    expect(wrongOp.statusCode).toBe(403)
  })

  it('停用其他成员生效，启用恢复', async () => {
    const { alice, s } = await setup()
    const bob = await insertUser(ctx.db, { username: 'bob', password: 'password-123456' })
    const off = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${bob.id}/active`,
      headers: authHeaders(s),
      payload: { is_active: false, operator_password: alice.password },
    })
    expect(off.statusCode).toBe(200)
    const loginBlocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://localhost:3000' },
      payload: { username: 'bob', password: bob.password },
    })
    expect(loginBlocked.statusCode).toBe(401)

    const on = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${bob.id}/active`,
      headers: authHeaders(s),
      payload: { is_active: true, operator_password: alice.password },
    })
    expect(on.statusCode).toBe(200)
  })

  it('事务内保证至少一个启用账号（服务层直测 409 保护）', async () => {
    const { alice } = await setup()
    const bob = await insertUser(ctx.db, { username: 'bob' })
    // 构造：唯一启用账号只剩 bob，此时停用 bob 必须被事务保护拒绝
    ctx.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(alice.id)
    expect(() =>
      setUserActive(ctx.db, bob.id, false, () => {}),
    ).toThrowError(/至少一个启用账号/)
    const row = ctx.db.prepare('SELECT is_active FROM users WHERE id = ?').get(bob.id) as { is_active: number }
    expect(row.is_active).toBe(1)
  })

  it('重置他人密码：目标需首登改密且旧 Session 失效', async () => {
    const { alice, s } = await setup()
    const bob = await insertUser(ctx.db, { username: 'bob', password: 'password-123456' })
    const bobSession = await login(ctx, bob.username, bob.password)

    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/users/${bob.id}/reset-password`,
      headers: authHeaders(s),
      payload: { operator_password: alice.password, new_password: 'reset-password-9' },
    })
    expect(reset.statusCode).toBe(200)

    // 旧 Session 失效
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `famsid=${bobSession.cookie}` } })
    expect(me.statusCode).toBe(401)

    // 用新密码登录，需改密
    const relogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://localhost:3000' },
      payload: { username: 'bob', password: 'reset-password-9' },
    })
    expect(relogin.statusCode).toBe(200)
    expect(relogin.json().user.must_change_password).toBe(true)
  })

  it('不能通过重置接口重置自己的密码', async () => {
    const { alice, s } = await setup()
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/users/${alice.id}/reset-password`,
      headers: authHeaders(s),
      payload: { operator_password: alice.password, new_password: 'whatever-password' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('USE_CHANGE_PASSWORD')
  })
})
