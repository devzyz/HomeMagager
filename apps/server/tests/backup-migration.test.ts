import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { expect, it, vi } from 'vitest'
import { openDatabase } from '../src/database/connection.js'
import { migrate, MIGRATIONS_DIR } from '../src/database/migrate.js'

it('awaits an intact pre-migration snapshot, preserves backup history and refuses upgrade when snapshot fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-migration-'))
  const migrations = path.join(dir, 'migrations')
  fs.mkdirSync(migrations)
  fs.copyFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), path.join(migrations, '0001_init.sql'))
  const db = openDatabase(path.join(dir, 'old.db'))
  try {
    await migrate(db, migrations)
    db.prepare("INSERT INTO backup_runs (id, provider, trigger_type, status, started_at) VALUES ('legacy','local','manual','success','2026-10-10')").run()
    fs.copyFileSync(path.join(MIGRATIONS_DIR, '0003_google_drive_backup.sql'), path.join(migrations, '0003_google_drive_backup.sql'))
    const backupSpy = vi.spyOn(db, 'backup').mockRejectedValueOnce(new Error('disk full'))
    await expect(migrate(db, migrations)).rejects.toThrow('disk full')
    expect(db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get()).toMatchObject({ c: 1 })
    backupSpy.mockRestore()
    const result = await migrate(db, migrations)
    expect(result.preBackup).toBeTruthy()
    const snapshot = openDatabase(result.preBackup!)
    try {
      expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(snapshot.prepare('SELECT * FROM backup_runs').get()).toMatchObject({ id: 'legacy', provider: 'local' })
      expect(() => snapshot.prepare("INSERT INTO backup_runs (id, provider, trigger_type, status, started_at) VALUES ('new','googledrive','manual','running','2026-10-10')").run()).toThrow()
    } finally { snapshot.close() }
    expect(db.prepare('SELECT * FROM backup_runs').get()).toMatchObject({ id: 'legacy', provider: 'local' })
    expect(() => db.prepare("INSERT INTO backup_runs (id, provider, trigger_type, status, started_at) VALUES ('new','googledrive','manual','running','2026-10-10')").run()).not.toThrow()
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
