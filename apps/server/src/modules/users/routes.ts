import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  hashPassword,
  verifyPassword,
  validateUsername,
  validateDisplayName,
  validatePassword,
} from '../../security/password.js'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { parseWith } from '../../lib/validate.js'
import { nowIso, } from '../../lib/time.js'
import { uuid } from '../../lib/ids.js'
import { requireAuth } from '../../plugins/hooks.js'
import { publicUser } from '../auth/routes.js'
import { setUserActive } from './service.js'
import type { UserRow } from '../../types.js'

const CreateUserBody = Type.Object({
  username: Type.String(),
  display_name: Type.String(),
  password: Type.String(),
  operator_password: Type.String(),
})
const DisplayNameBody = Type.Object({ display_name: Type.String() })
const ActiveBody = Type.Object({ is_active: Type.Boolean(), operator_password: Type.String() })
const ResetPasswordBody = Type.Object({ operator_password: Type.String(), new_password: Type.String() })

async function assertOperatorPassword(
  app: FastifyInstance,
  operator: UserRow,
  password: string,
): Promise<void> {
  const ok = await verifyPassword(operator.password_hash, password)
  if (!ok) throw forbidden('操作者密码验证失败', 'OPERATOR_PASSWORD_WRONG')
}

export function registerUserRoutes(app: FastifyInstance): void {
  app.get('/api/users', { preHandler: requireAuth }, async (_req) => {
    const rows = app.db.prepare('SELECT * FROM users ORDER BY created_at, username').all() as UserRow[]
    return { items: rows.map(publicUser) }
  })

  app.post('/api/users', { preHandler: requireAuth }, async (req, reply) => {
    const operator = req.user as UserRow
    const body = parseWith(CreateUserBody, req.body)
    await assertOperatorPassword(app, operator, body.operator_password)

    const username = validateUsername(body.username)
    if ('error' in username) throw badRequest(username.error)
    const displayName = validateDisplayName(body.display_name)
    if (typeof displayName !== 'string') throw badRequest(displayName.error)
    const password = validatePassword(body.password)
    if (typeof password !== 'string') throw badRequest(password.error)

    const exists = app.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username.username)
    if (exists) throw badRequest('用户名已存在', 'USERNAME_TAKEN')

    const passwordHash = await hashPassword(password)
    const id = uuid()
    const now = nowIso()
    app.db
      .prepare(
        'INSERT INTO users (id, username, display_name, password_hash, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
      )
      .run(id, username.username, displayName, passwordHash, now, now)
    const row = app.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow
    void reply.code(201)
    return { user: publicUser(row) }
  })

  app.patch('/api/users/:id/display-name', { preHandler: requireAuth }, async (req) => {
    const operator = req.user as UserRow
    const { id } = req.params as { id: string }
    if (operator.id !== id) throw forbidden('只能修改自己的显示名')
    const body = parseWith(DisplayNameBody, req.body)
    const displayName = validateDisplayName(body.display_name)
    if (typeof displayName !== 'string') throw badRequest(displayName.error)
    const r = app.db
      .prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
      .run(displayName, nowIso(), id)
    if (r.changes === 0) throw notFound('用户不存在')
    return { message: '显示名已更新' }
  })

  app.patch('/api/users/:id/active', { preHandler: requireAuth }, async (req) => {
    const operator = req.user as UserRow
    const { id } = req.params as { id: string }
    const body = parseWith(ActiveBody, req.body)
    if (!body.is_active && operator.id === id) {
      throw badRequest('不能停用当前登录的账号', 'CANNOT_DISABLE_SELF')
    }
    await assertOperatorPassword(app, operator, body.operator_password)

    const target = app.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
    if (!target) throw notFound('用户不存在')

    setUserActive(app.db, id, body.is_active, (uid) => app.sessions.destroyAllForUser(uid))
    return { message: body.is_active ? '已启用' : '已停用' }
  })

  app.post('/api/users/:id/reset-password', { preHandler: requireAuth }, async (req) => {
    const operator = req.user as UserRow
    const { id } = req.params as { id: string }
    if (operator.id === id) throw badRequest('请使用“修改密码”功能修改自己的密码', 'USE_CHANGE_PASSWORD')
    const body = parseWith(ResetPasswordBody, req.body)
    await assertOperatorPassword(app, operator, body.operator_password)
    const password = validatePassword(body.new_password)
    if (typeof password !== 'string') throw badRequest(password.error)

    const target = app.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
    if (!target) throw notFound('用户不存在')

    const passwordHash = await hashPassword(password)
    const tx = app.db.transaction(() => {
      app.db
        .prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
        .run(passwordHash, nowIso(), id)
      app.sessions.destroyAllForUser(id)
    })
    tx()
    return { message: '已重置密码，对方下次登录时需修改密码' }
  })
}
