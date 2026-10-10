import { afterEach, describe, expect, it } from 'vitest'
import {
  authHeaders,
  cleanup,
  createTestApp,
  insertUser,
  login,
  ORIGIN,
  sessionFrom,
  type TestCtx,
} from './helpers.js'
import { openDatabase } from '../src/database/connection.js'
import { migrate } from '../src/database/migrate.js'
import { buildApp } from '../src/app.js'

let ctx: TestCtx
afterEach(() => {
  if (ctx) cleanup(ctx)
})

describe('auth', () => {
  it('登录成功返回用户与 CSRF Token，并设置 Session Cookie', async () => {
    ctx = await createTestApp()
    await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { username: 'Alice', password: 'password-123456' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.user.username).toBe('alice')
    expect(body.csrf_token).toBeTruthy()
    expect(res.cookies.some((c) => c.name === 'famsid')).toBe(true)

    const s = sessionFrom(res)
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `famsid=${s.cookie}` } })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.username).toBe('alice')
  })

  it('密码错误与用户不存在返回一致的 401，不泄露账号是否存在', async () => {
    ctx = await createTestApp()
    await insertUser(ctx.db, { username: 'alice' })
    const wrongPw = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { username: 'alice', password: 'wrong-password-x' },
    })
    const noUser = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { username: 'ghost', password: 'wrong-password-x' },
    })
    expect(wrongPw.statusCode).toBe(401)
    expect(noUser.statusCode).toBe(401)
    expect(wrongPw.json().code).toBe('INVALID_CREDENTIALS')
    expect(noUser.json().message).toBe(wrongPw.json().message)
  })

  it('同账号连续 5 次失败后限流 429', async () => {
    ctx = await createTestApp()
    await insertUser(ctx.db, { username: 'alice' })
    for (let i = 0; i < 5; i++) {
      const r = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: ORIGIN },
        payload: { username: 'alice', password: 'wrong-password-x' },
      })
      expect(r.statusCode).toBe(401)
    }
    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { username: 'alice', password: 'password-123456' },
    })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().code).toBe('RATE_LIMITED')
  })

  it('写请求缺少/不匹配 Origin 时返回 403', async () => {
    ctx = await createTestApp()
    const missing = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'a', password: 'b' },
    })
    expect(missing.statusCode).toBe(403)
    expect(missing.json().code).toBe('ORIGIN_REJECTED')

    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://evil.example.com' },
      payload: { username: 'a', password: 'b' },
    })
    expect(wrong.statusCode).toBe(403)

    const viaReferer = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { referer: `${ORIGIN}/login` },
      payload: { username: 'a', password: 'b' },
    })
    expect(viaReferer.statusCode).not.toBe(403)
  })

  it('已登录写请求缺少 CSRF Token 返回 403', async () => {
    ctx = await createTestApp()
    const alice = await insertUser(ctx.db, {})
    const s = await login(ctx, alice.username, alice.password)
    const noToken = await ctx.app.inject({
      method: 'POST',
      url: '/api/shops',
      headers: { cookie: `famsid=${s.cookie}`, origin: ORIGIN },
      payload: { name: '小店' },
    })
    expect(noToken.statusCode).toBe(403)
    expect(noToken.json().code).toBe('CSRF_REJECTED')

    const badToken = await ctx.app.inject({
      method: 'POST',
      url: '/api/shops',
      headers: { cookie: `famsid=${s.cookie}`, origin: ORIGIN, 'x-csrf-token': 'bogus' },
      payload: { name: '小店' },
    })
    expect(badToken.statusCode).toBe(403)
  })

  it('退出登录后 Session 失效', async () => {
    ctx = await createTestApp()
    const alice = await insertUser(ctx.db, {})
    const s = await login(ctx, alice.username, alice.password)
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: authHeaders(s),
    })
    expect(out.statusCode).toBe(200)
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `famsid=${s.cookie}` } })
    expect(me.statusCode).toBe(401)
  })

  it('Session 在应用重启后仍有效（SQLite 持久化）', async () => {
    ctx = await createTestApp()
    const alice = await insertUser(ctx.db, {})
    const s = await login(ctx, alice.username, alice.password)
    void ctx.app.close()
    ctx.db.close()

    const config = ctx.config
    const db2 = openDatabase(config.databasePath)
    await migrate(db2)
    const app2 = await buildApp(config, db2)
    try {
      const me = await app2.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `famsid=${s.cookie}` } })
      expect(me.statusCode).toBe(200)
      expect(me.json().user.username).toBe('alice')
    } finally {
      void app2.close()
      db2.close()
    }
  })

  it('停用用户登录被拒，已有 Session 被撤销', async () => {
    ctx = await createTestApp()
    const alice = await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
    const bob = await insertUser(ctx.db, { username: 'bob', password: 'password-123456' })
    const s = await login(ctx, bob.username, bob.password)

    const op = await login(ctx, alice.username, alice.password)
    const disable = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${bob.id}/active`,
      headers: authHeaders(op),
      payload: { is_active: false, operator_password: alice.password },
    })
    expect(disable.statusCode).toBe(200)

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `famsid=${s.cookie}` } })
    expect(me.statusCode).toBe(401)

    const relogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { username: 'bob', password: bob.password },
    })
    expect(relogin.statusCode).toBe(401)
  })

  it('首登改密限制：改密前仅开放本人信息/改密/退出', async () => {
    ctx = await createTestApp()
    const alice = await insertUser(ctx.db, {})
    const op = await login(ctx, alice.username, alice.password)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeaders(op),
      payload: {
        username: 'newbie',
        display_name: 'Newbie',
        password: 'temp-password-123',
        operator_password: alice.password,
      },
    })
    expect(created.statusCode).toBe(201)

    const s = await login(ctx, 'newbie', 'temp-password-123')
    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/shops',
      headers: authHeaders(s),
      payload: { name: '小店' },
    })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().code).toBe('MUST_CHANGE_PASSWORD')

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `famsid=${s.cookie}` } })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.must_change_password).toBe(true)

    const change = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(s),
      payload: { old_password: 'temp-password-123', new_password: 'new-password-456' },
    })
    expect(change.statusCode).toBe(200)

    const s2 = await login(ctx, 'newbie', 'new-password-456')
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/shops',
      headers: authHeaders(s2),
      payload: { name: '小店' },
    })
    expect(ok.statusCode).toBe(201)
  })

  it('旧密码错误时改密失败；新密码过短被拒', async () => {
    ctx = await createTestApp()
    const alice = await insertUser(ctx.db, {})
    const s = await login(ctx, alice.username, alice.password)
    const wrongOld = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(s),
      payload: { old_password: 'wrong-old-password', new_password: 'new-password-456' },
    })
    expect(wrongOld.statusCode).toBe(400)
    expect(wrongOld.json().code).toBe('WRONG_PASSWORD')

    const tooShort = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeaders(s),
      payload: { old_password: alice.password, new_password: 'short' },
    })
    expect(tooShort.statusCode).toBe(400)
  })

  it('健康检查可匿名访问', async () => {
    ctx = await createTestApp()
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' })
  })

  it('/api 未匹配路径返回 JSON 404 而非 HTML', async () => {
    ctx = await createTestApp()
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.json().code).toBe('NOT_FOUND')
  })
})
