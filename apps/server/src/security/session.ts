import crypto from 'node:crypto'
import type { DB } from '../database/connection.js'
import { nowIso } from '../lib/time.js'

const sha256 = (v: string): string => crypto.createHash('sha256').update(v).digest('hex')

export interface SessionRow {
  userId: string
  csrfToken: string
  createdAt: string
  expiresAt: string
}

interface SessionSqlRow {
  user_id: string
  csrf_token: string
  created_at: string
  expires_at: string
}

/**
 * Session 管理：原始 Session ID 只出现在 Cookie 中，
 * 服务端仅保存其 SHA-256 摘要；绝对有效期，SQLite 持久化。
 */
export class SessionManager {
  constructor(
    private readonly db: DB,
    private readonly maxAgeDays: number,
  ) {}

  create(userId: string): { id: string; csrfToken: string; expiresAt: string } {
    const id = crypto.randomBytes(32).toString('base64url')
    const csrfToken = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + this.maxAgeDays * 86400000).toISOString()
    this.db
      .prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(id), userId, csrfToken, nowIso(), expiresAt)
    return { id, csrfToken, expiresAt }
  }

  get(id: string | undefined): SessionRow | null {
    if (!id) return null
    const row = this.db
      .prepare('SELECT user_id, csrf_token, created_at, expires_at FROM sessions WHERE id_hash = ?')
      .get(sha256(id)) as SessionSqlRow | undefined
    if (!row) return null
    if (row.expires_at <= nowIso()) {
      this.destroy(id)
      return null
    }
    return { userId: row.user_id, csrfToken: row.csrf_token, createdAt: row.created_at, expiresAt: row.expires_at }
  }

  destroy(id: string | undefined): void {
    if (!id) return
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(id))
  }

  destroyAllForUser(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }

  purgeExpired(): number {
    const r = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso())
    return r.changes
  }
}
