import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SESSION_COOKIE, clearSessionCookie } from '../lib/cookies.js'
import type { UserRow } from '../types.js'

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const GATE_ALLOWED = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout']

const timingSafeEqualStr = (a: string, b: string): boolean => {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * 来源校验：所有写请求（/api 下非 GET）必须携带 Origin，缺失时验证 Referer，
 * 均缺失或不匹配则拒绝。
 */
async function originGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.url.startsWith('/api') || !WRITE_METHODS.has(req.method)) return
  const allowed = req.server.config.allowedOrigins
  let src: string | null = null
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin) {
    src = origin
  } else {
    const referer = req.headers.referer
    if (typeof referer === 'string' && referer) {
      try {
        src = new URL(referer).origin
      } catch {
        src = null
      }
    }
  }
  if (!src || !allowed.includes(src.replace(/\/$/, ''))) {
    void reply.code(403).send({ code: 'ORIGIN_REJECTED', message: '请求来源校验失败', request_id: req.id })
  }
}

/** Session 解析：Cookie → 服务端摘要查库；同时实时校验用户启用状态 */
async function sessionGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  req.sessionCtx = null
  req.user = null
  const raw = req.cookies[SESSION_COOKIE]
  if (!raw) return
  const sess = req.server.sessions.get(raw)
  if (!sess) return
  const user = req.server.db.prepare('SELECT * FROM users WHERE id = ?').get(sess.userId) as
    | UserRow
    | undefined
  if (!user || !user.is_active) {
    req.server.sessions.destroy(raw)
    clearSessionCookie(reply, req.server.config)
    return
  }
  req.sessionCtx = { rawId: raw, csrfToken: sess.csrfToken, expiresAt: sess.expiresAt }
  req.user = user
}

/** CSRF：已登录用户的写请求必须携带与 Session 绑定的 Token */
async function csrfGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user || !req.sessionCtx || !WRITE_METHODS.has(req.method)) return
  const token = req.headers['x-csrf-token']
  if (typeof token !== 'string' || !timingSafeEqualStr(token, req.sessionCtx.csrfToken)) {
    void reply.code(403).send({ code: 'CSRF_REJECTED', message: 'CSRF 校验失败，请刷新页面后重试', request_id: req.id })
  }
}

const isGateAllowed = (url: string): boolean =>
  GATE_ALLOWED.some((p) => url === p || url.startsWith(`${p}?`) || url.startsWith(`${p}/`))

/** 路由级鉴权：未登录 401；需改密用户仅放行本人信息/改密/退出 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    void reply.code(401).send({ code: 'UNAUTHORIZED', message: '未登录或登录已过期', request_id: req.id })
    return
  }
  if (req.user.must_change_password && !isGateAllowed(req.url)) {
    void reply
      .code(403)
      .send({ code: 'MUST_CHANGE_PASSWORD', message: '首次登录或密码被重置，请先修改密码', request_id: req.id })
  }
}

export function registerCoreHooks(app: FastifyInstance): void {
  app.addHook('onRequest', originGuard)
  app.addHook('onRequest', sessionGuard)
  app.addHook('preHandler', csrfGuard)
}
