import readline from 'node:readline/promises'
import { loadConfig } from '../config.js'
import { openDatabase } from '../database/connection.js'
import { migrate } from '../database/migrate.js'
import {
  hashPassword,
  validateUsername,
  validateDisplayName,
  validatePassword,
} from '../security/password.js'
import { uuid } from '../lib/ids.js'
import { nowIso } from '../lib/time.js'

interface InitFlags {
  username?: string
  displayName?: string
  password?: string
}

function parseFlags(argv: string[]): InitFlags {
  const flags: InitFlags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--username') flags.username = argv[++i]
    else if (a === '--display-name') flags.displayName = argv[++i]
    else if (a === '--password') flags.password = argv[++i]
  }
  return flags
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const interactive = !flags.username || !flags.password

  const config = loadConfig()
  const db = openDatabase(config.databasePath)
  const { applied } = await migrate(db)
  if (applied.length > 0) console.log(`[migrate] 已应用迁移: ${applied.join(', ')}`)

  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c
  if (count > 0) {
    console.log('已存在家庭账号，仅在用户表为空时允许初始化。如需重置密码请使用 user:reset-password。')
    db.close()
    process.exit(1)
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    let username = ''
    let displayName = ''
    let password = ''

    if (interactive) {
      console.log('创建首个家庭账号（仅当用户表为空时可用）')
      for (;;) {
        username = (await rl.question('用户名（3~32 位小写字母/数字/_/-）: ') ?? '').trim().toLowerCase()
        const v = validateUsername(username)
        if ('error' in v) {
          console.log(`× ${v.error}`)
          continue
        }
        username = v.username
        break
      }
      for (;;) {
        displayName = (await rl.question('显示名（1~50 字）: ') ?? '').trim()
        const v = validateDisplayName(displayName)
        if (typeof v !== 'string') {
          console.log(`× ${v.error}`)
          continue
        }
        displayName = v
        break
      }
      for (;;) {
        password = await rl.question('密码（12~128 字符）: ')
        const v = validatePassword(password)
        if (typeof v !== 'string') {
          console.log(`× ${v.error}`)
          continue
        }
        const confirm = await rl.question('再次输入密码: ')
        if (confirm !== password) {
          console.log('× 两次输入不一致')
          continue
        }
        break
      }
    } else {
      const v1 = validateUsername(flags.username ?? '')
      if ('error' in v1) {
        console.error(`× ${v1.error}`)
        process.exit(1)
      }
      username = v1.username
      const v2 = validateDisplayName(flags.displayName ?? flags.username ?? '')
      if (typeof v2 !== 'string') {
        console.error(`× ${v2.error}`)
        process.exit(1)
      }
      displayName = v2
      const v3 = validatePassword(flags.password ?? '')
      if (typeof v3 !== 'string') {
        console.error(`× ${v3.error}`)
        process.exit(1)
      }
      password = v3
    }

    const passwordHash = await hashPassword(password)
    const now = nowIso()
    db.prepare(
      'INSERT INTO users (id, username, display_name, password_hash, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?, ?)',
    ).run(uuid(), username, displayName, passwordHash, now, now)

    console.log(`√ 已创建账号 ${username}（${displayName}），可以登录了。`)
  } finally {
    rl.close()
    db.close()
  }
}

main().catch((err) => {
  console.error('初始化失败:', err instanceof Error ? err.message : err)
  process.exit(1)
})
