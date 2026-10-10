import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { hashPassword, verifyPassword, validatePassword, normalizeUsername } from '../../security/password.js'
import { badRequest, unauthorized } from '../../lib/errors.js'
import { parseWith } from '../../lib/validate.js'
import { nowIso } from '../../lib/time.js'
import { setSessionCookie, clearSessionCookie } from '../../lib/cookies.js'
import { requireAuth } from '../../plugins/hooks.js'
import type { UserRow } from '../../types.js'

const LoginBody = Type.Object({ username: Type.String(), password: Type.String() })
const ChangePasswordBody = Type.Object({ old_password: Type.String(), new_password: Type.String() })

export function publicUser(u: UserRow): Record<string, unknown> {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    is_active: u.is_active === 1,
    must_change_password: u.must_change_password === 1,
    created_at: u.created_at,
  }
}

/** 用户不存在时也执行一次等价验证，避免通过耗时区分账号是否存在 */
let dummyHash: string | null = null
async function dummyVerify(password: string): Promise<void> {
  if (!dummyHash) {
    dummyHash = await hashPassword('dummy-password-for-timing-equalization')
  }
  await verifyPassword(dummyHash, password)
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/login', async (req, reply) => {
    const body = parseWith(LoginBody, req.body)
    const username = normalizeUsername(body.username)
    const ip = req.ip
    const gate = app.limiter.reserve(username, ip)
    if (!gate.ok) {
      const mins = Math.max(1, Math.ceil(gate.retryAfterSec / 60))
      void reply.code(429).send({ code: 'RATE_LIMITED', message: `登录尝试过于频繁，请约 ${mins} 分钟后再试`, request_id: req.id })
      return
    }
    try {
      const user = app.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
      const verified = user ? await verifyPassword(user.password_hash, body.password) : await dummyVerify(body.password)
      if (!user || !verified) {
        app.limiter.recordFailure(username, ip)
        throw unauthorized('用户名或密码错误', 'INVALID_CREDENTIALS')
      }
      if (user.is_active !== 1) {
        // 与密码错误返回完全一致的错误，不泄露账号状态
        throw unauthorized('用户名或密码错误', 'INVALID_CREDENTIALS')
      }
      app.limiter.recordSuccess(username, ip)
      const sess = app.sessions.create(user.id)
      setSessionCookie(reply, app.config, sess.id)
      return { user: publicUser(user), csrf_token: sess.csrfToken }
    } finally {
      gate.release()
    }
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    return { user: publicUser(req.user as UserRow), csrf_token: req.sessionCtx?.csrfToken }
  })

  app.post('/api/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.user as UserRow
    const body = parseWith(ChangePasswordBody, req.body)
    const oldOk = await verifyPassword(user.password_hash, body.old_password)
    if (!oldOk) throw badRequest('当前密码不正确', 'WRONG_PASSWORD')
    const pw = validatePassword(body.new_password)
    if (typeof pw !== 'string') throw badRequest(pw.error)
    const newHash = await hashPassword(pw)
    const tx = app.db.transaction(() => {
      app.db
        .prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
        .run(newHash, nowIso(), user.id)
      app.sessions.destroyAllForUser(user.id)
    })
    tx()
    clearSessionCookie(reply, app.config)
    return { message: '密码已修改，请使用新密码重新登录' }
  })

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    app.sessions.destroy(req.sessionCtx?.rawId)
    clearSessionCookie(reply, app.config)
    return { message: '已退出登录' }
  })
}
