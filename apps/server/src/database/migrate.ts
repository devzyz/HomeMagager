import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './connection.js'
import { nowIso } from '../lib/time.js'

/** 迁移目录（仓库根 migrations/）：src/database 或 dist/database 距仓库根均为 4 层 */
export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'migrations')

export function appliedVersions(db: DB): string[] {
  const rows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as { version: string }[]
  return rows.map((r) => r.version)
}

/**
 * 执行待应用的迁移。若库中已有历史迁移且本次要应用新版本，
 * 先用 better-sqlite3 backup API 在旁边生成一份一致性备份，失败则停止升级。
 */
export async function migrate(db: DB, dir: string = MIGRATIONS_DIR): Promise<{ applied: string[]; preBackup?: string }> {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const before = appliedVersions(db)
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const pending = files.filter((f) => !before.includes(f.replace(/\.sql$/, '')))
  if (pending.length === 0) return { applied: [] }

  let preBackup: string | undefined
  if (before.length > 0) {
    preBackup = `${db.name}.pre-migration-${Date.now()}.bak`
    // backup API 生成一致性快照，不复制运行中的主库文件
    await db.backup(preBackup)
  }

  for (const file of pending) {
    const version = file.replace(/\.sql$/, '')
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    const run = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, nowIso())
    })
    try {
      run()
    } catch (err) {
      throw new Error(`迁移 ${version} 执行失败，已停止本次升级：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { applied: pending, preBackup }
}
