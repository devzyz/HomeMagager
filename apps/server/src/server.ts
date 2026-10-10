import { loadConfig } from './config.js'
import { openDatabase } from './database/connection.js'
import { migrate } from './database/migrate.js'
import { buildApp } from './app.js'
import { startBackupScheduler } from './modules/backup/scheduler.js'

const config = loadConfig()
const db = openDatabase(config.databasePath)
const { applied } = await migrate(db)
if (applied.length > 0) {
  console.log(`[migrate] 已应用迁移: ${applied.join(', ')}`)
}

const app = await buildApp(config, db)
// 进程重启后清理遗留的 running 备份标记，再启动每分钟到期检查
app.backup.markInterruptedOnStartup()
const stopBackupScheduler = startBackupScheduler(app.backup, (err) => {
  console.error('[backup] 调度检查失败:', err)
})
await app.listen({ host: config.host, port: config.port })
console.log(`[server] 已启动: http://localhost:${config.port} (env=${config.env})`)

const purgeTimer = setInterval(() => {
  try {
    app.sessions.purgeExpired()
  } catch (err) {
    console.error('[session] 清理过期 Session 失败:', err)
  }
}, 3600_000)
purgeTimer.unref()

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] 收到 ${signal}，正在关闭...`)
  stopBackupScheduler()
  try {
    await app.close()
    await app.backup.waitForCurrent()
  } finally {
    db.close()
    process.exit(0)
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
