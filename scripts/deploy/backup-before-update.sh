#!/usr/bin/env bash
set -euo pipefail
BASE=/root/autodl-tmp/homemanager
export PATH="$BASE/runtime/node/bin:$PATH"
cd "$BASE/app"
node --input-type=module - <<'JS'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './apps/server/dist/config.js'
import { openDatabase } from './apps/server/dist/database/connection.js'
import { BackupService } from './apps/server/dist/modules/backup/service.js'
const config = loadConfig()
config.backupDir = path.join('/root/autodl-tmp/homemanager/data/deploy-backups', new Date().toISOString().replace(/[:.]/g, '-'))
const db = openDatabase(config.databasePath)
try {
  const service = new BackupService(db, config)
  const { runId } = service.trigger('local', 'manual')
  await service.waitForRun(runId)
  const row = service.getRun(runId)
  if (row?.status !== 'success') throw new Error('Pre-deployment complete backup failed')
  const meta = JSON.parse(fs.readFileSync(path.join(service.localDir, row.file_name + '.json'), 'utf8'))
  console.log(JSON.stringify({backup_dir: config.backupDir, file_name: row.file_name, attachments: meta.attachments.length, sha256: row.sha256}))
  console.log(JSON.stringify(Object.fromEntries(['users', 'expenses', 'expense_attachments', 'payroll_members', 'payroll_entries'].map(t => {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)
    return [t, exists ? db.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c : null]
  }))))
} finally { db.close() }
JS
