import readline from 'node:readline/promises'
import { loadConfig } from '../config.js'
import { openDatabase } from '../database/connection.js'
import { migrate } from '../database/migrate.js'
import { hashPassword, validatePassword, normalizeUsername } from '../security/password.js'
import { nowIso } from '../lib/time.js'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const username = normalizeUsername(flag('--username') ?? '')
  let password = flag('--password') ?? ''

  const config = loadConfig()
  const db = openDatabase(config.databasePath)
  await migrate(db)

  const user = db.prepare('SELECT id, display_name FROM users WHERE username = ?').get(username) as
    | { id: string; display_name: string }
    | undefined
  if (!user) {
    console.error(`× 用户不存在: ${username}`)
    db.close()
    process.exit(1)
  }

  if (!password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    password = (await rl.question(`为 ${user.display_name} 设置新密码（12~128 字符）: `)) ?? ''
    rl.close()
  }
  const v = validatePassword(password)
  if (typeof v !== 'string') {
    console.error(`× ${v.error}`)
    db.close()
    process.exit(1)
  }

  const passwordHash = await hashPassword(v)
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(
      passwordHash,
      nowIso(),
      user.id,
    )
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
  })
  tx()
  console.log(`√ 已重置 ${user.display_name} 的密码，其所有登录已失效；下次登录需修改密码。`)
  db.close()
}

main().catch((err) => {
  console.error('重置失败:', err instanceof Error ? err.message : err)
  process.exit(1)
})
