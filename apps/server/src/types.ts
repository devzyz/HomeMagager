import type { DB } from './database/connection.js'
import type { SessionManager } from './security/session.js'
import type { LoginRateLimiter } from './security/loginLimiter.js'
import type { BackupService } from './modules/backup/service.js'
import type { AppConfig } from './config.js'

export interface UserRow {
  id: string
  username: string
  display_name: string
  password_hash: string
  is_active: 0 | 1
  must_change_password: 0 | 1
  created_at: string
  updated_at: string
}

export interface DictionaryRow {
  id: string
  name: string
  is_active: 0 | 1
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SessionContext {
  rawId: string
  csrfToken: string
  expiresAt: string
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
    db: DB
    sessions: SessionManager
    limiter: LoginRateLimiter
    backup: BackupService
  }
  interface FastifyRequest {
    /** 当前请求的 Session（若 Cookie 有效） */
    sessionCtx: SessionContext | null
    /** 当前登录用户（每次请求实时查库，包含启用状态） */
    user: UserRow | null
  }
}

export type { DB }
