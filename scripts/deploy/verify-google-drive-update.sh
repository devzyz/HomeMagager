#!/usr/bin/env bash
set -euo pipefail
BASE=/root/autodl-tmp/homemanager
export PATH="$BASE/runtime/node/bin:$PATH"
cd "$BASE/app"
node --input-type=module - <<'JS'
import { loadConfig } from './apps/server/dist/config.js'
import { openDatabase } from './apps/server/dist/database/connection.js'
import { buildApp } from './apps/server/dist/app.js'
const config = loadConfig()
const db = openDatabase(config.databasePath)
const app = await buildApp(config, db)
try {
  console.log(JSON.stringify({integrity: db.pragma('integrity_check', {simple:true}), foreign_key_errors: db.pragma('foreign_key_check').length, versions: db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(x => x.version), users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c, expenses: db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c, attachments: db.prepare('SELECT COUNT(*) AS c FROM expense_attachments').get().c, payroll_members: db.prepare('SELECT COUNT(*) AS c FROM payroll_members').get().c, cloud_enabled: config.googleDriveEnabled, cloud_authorized: app.backup.cloudConfigured()}))
  for (const [url,expected] of [['/privacy',200], ['/about',200], ['/api/expenses',401], ['/api/backup/status',401]]) {
    const result = await app.inject({method:'GET',url})
    if (result.statusCode !== expected) throw new Error('Unexpected response for ' + url)
    console.log(JSON.stringify({url,status:result.statusCode}))
  }
} finally { await app.close(); db.close() }
JS
/root/miniconda3/bin/supervisorctl -c "$BASE/config/supervisor.ini" status
printf 'Google IPv4 OAuth connectivity: '
curl -4 --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}\n' https://oauth2.googleapis.com/token || true
printf 'Google Drive API connectivity: '
curl -4 --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}\n' https://www.googleapis.com/drive/v3/files || true
