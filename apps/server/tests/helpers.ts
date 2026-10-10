import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { loadConfig, type AppConfig } from '../src/config.js'
import { openDatabase, type DB } from '../src/database/connection.js'
import { migrate } from '../src/database/migrate.js'
import { buildApp } from '../src/app.js'
import { hashPassword } from '../src/security/password.js'
import { uuid } from '../src/lib/ids.js'
import { nowIso } from '../src/lib/time.js'

export const ORIGIN = 'http://localhost:3000'

export interface TestCtx {
  app: FastifyInstance
  db: DB
  config: AppConfig
  dir: string
}

export async function createTestApp(): Promise<TestCtx> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-'))
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: path.join(dir, 'db', 'test.db'),
    UPLOAD_DIR: path.join(dir, 'uploads'),
    BACKUP_DIR: path.join(dir, 'backups'),
    SESSION_SECRET: 't'.repeat(64),
    PORT: '3000',
  })
  const db = openDatabase(config.databasePath)
  await migrate(db)
  const app = await buildApp(config, db)
  return { app, db, config, dir }
}

export function cleanup(ctx: TestCtx): void {
  void ctx.app.close()
  ctx.db.close()
  fs.rmSync(ctx.dir, { recursive: true, force: true })
}

export interface SessionRef {
  cookie: string
  csrf: string
}

export function authHeaders(s: SessionRef | null): Record<string, string> {
  const h: Record<string, string> = { origin: ORIGIN }
  if (s) {
    h.cookie = `famsid=${s.cookie}`
    h['x-csrf-token'] = s.csrf
  }
  return h
}

export function sessionFrom(res: { cookies: { name: string; value: string }[]; json: () => any }): SessionRef {
  const c = res.cookies.find((k) => k.name === 'famsid')
  if (!c) throw new Error('login response did not set session cookie')
  return { cookie: c.value, csrf: res.json().csrf_token }
}

export interface SeedUser {
  id: string
  username: string
  display_name: string
  password: string
}

export async function insertUser(
  db: DB,
  opts: { username?: string; password?: string; displayName?: string; mustChange?: boolean; isActive?: boolean } = {},
): Promise<SeedUser> {
  const id = uuid()
  const username = opts.username ?? 'alice'
  const password = opts.password ?? 'password-123456'
  const now = nowIso()
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    username,
    opts.displayName ?? 'Alice',
    await hashPassword(password),
    opts.isActive === false ? 0 : 1,
    opts.mustChange ? 1 : 0,
    now,
    now,
  )
  return { id, username, display_name: opts.displayName ?? 'Alice', password }
}

export async function login(ctx: TestCtx, username: string, password: string): Promise<SessionRef> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: ORIGIN },
    payload: { username, password },
  })
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`)
  return sessionFrom(res)
}
