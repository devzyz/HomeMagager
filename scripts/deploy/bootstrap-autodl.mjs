// Initialize an empty AutoDL database with a generated first-login credential.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadConfig } from '../../apps/server/dist/config.js'
import { openDatabase } from '../../apps/server/dist/database/connection.js'
import { migrate } from '../../apps/server/dist/database/migrate.js'
import { hashPassword } from '../../apps/server/dist/security/password.js'

const config = loadConfig()
const db = openDatabase(config.databasePath)
try {
  await migrate(db)
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get()
  if (count !== 0) {
    console.log('Existing users retained; bootstrap skipped.')
  } else {
    const credential = path.resolve(process.env.HOMEMANAGER_BOOTSTRAP_FILE)
    if (fs.existsSync(credential)) throw new Error('Bootstrap credential exists but database is empty; inspect before initializing.')
    const password = crypto.randomBytes(24).toString('base64url')
    fs.writeFileSync(credential, `USERNAME=admin\nPASSWORD=${password}\nBASE_URL=${config.baseUrl}\n`, { mode: 0o600, flag: 'wx' })
    const hash = await hashPassword(password)
    const now = new Date().toISOString()
    db.prepare('INSERT INTO users (id, username, display_name, password_hash, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)')
      .run(crypto.randomUUID(), 'admin', '管理员', hash, now, now)
    console.log('Created admin; password change required at first login. Credential saved privately.')
  }
} finally {
  db.close()
}