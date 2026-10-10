// Explicit, isolated validation data only. Never run this against a real household database.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadConfig } from '../apps/server/dist/config.js'
import { openDatabase } from '../apps/server/dist/database/connection.js'
import { migrate } from '../apps/server/dist/database/migrate.js'
import { hashPassword } from '../apps/server/dist/security/password.js'

if (!process.env.DATABASE_PATH || !process.env.VALIDATION_ACCESS_FILE) throw new Error('Explicit validation database and credential file required')
const config = loadConfig()
const db = openDatabase(config.databasePath)
await migrate(db)
try {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n) {
    if (!fs.existsSync(process.env.VALIDATION_ACCESS_FILE)) throw new Error('Refusing to modify an existing database')
    console.log('Existing isolated validation dataset retained.')
  } else {
    const username = 'preview'
    const password = crypto.randomBytes(24).toString('base64url')
    const userId = crypto.randomUUID(), now = new Date().toISOString()
    db.prepare('INSERT INTO users (id, username, display_name, password_hash, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?, ?)')
      .run(userId, username, '家庭管理 · 演示账号', await hashPassword(password), now, now)
    const shopIds = ['东门店', '南街店', '西湖社区生活服务中心店'].map((name, index) => {
      const id = crypto.randomUUID()
      db.prepare('INSERT INTO shops (id, name, is_active, sort_order, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)').run(id, name, index, now, now)
      return id
    })
    const cats = db.prepare('SELECT id, name FROM expense_categories ORDER BY sort_order').all()
    const current = new Date()
    const paid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(current)
    const insert = db.prepare('INSERT INTO expenses (id, shop_id, category_id, amount_cents, bill_month, paid_date, remark, created_by, updated_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date(Date.UTC(current.getFullYear(), current.getMonth() - offset, 1))
      const month = date.toISOString().slice(0, 7)
      for (let i = 0; i < 8; i++) {
        insert.run(crypto.randomUUID(), shopIds[i % 3], cats[i].id, [26800, 85640, 480000, 36000, 12580, 9900, 18000, 6500][i] + offset * 170, month, paid, `${month} ${cats[i].name}（演示数据）`, userId, userId, now, now)
      }
    }
    fs.mkdirSync(path.dirname(process.env.VALIDATION_ACCESS_FILE), { recursive: true })
    fs.writeFileSync(process.env.VALIDATION_ACCESS_FILE, JSON.stringify({ username, password }), { mode: 0o600 })
    console.log('Isolated validation dataset created: 3 shops, 48 expenses. Credentials saved without printing.')
  }
} finally { db.close() }
