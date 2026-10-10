// e2e 专用启动脚本：独立临时数据目录，绝不指向开发/生产数据
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'tmp', 'e2e')
fs.rmSync(dataDir, { recursive: true, force: true })

const distServer = path.join(root, 'apps', 'server', 'dist', 'server.js')
console.log('[e2e] 构建当前源码...')
execSync('pnpm -r run build', { cwd: root, stdio: 'inherit' })

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '3111',
  HOST: '127.0.0.1',
  DATABASE_PATH: path.join(dataDir, 'database', 'e2e.db'),
  UPLOAD_DIR: path.join(dataDir, 'uploads'),
  BACKUP_DIR: path.join(dataDir, 'backups'),
  SESSION_SECRET: 'e2e-e2e-e2e-e2e-e2e-e2e-e2e-e2e-e2e-e2e-e2e-e2e',
}

console.log('[e2e] 初始化 e2e 账号...')
execSync(
  `node "${path.join(root, 'apps', 'server', 'dist', 'cli', 'user-init.js')}" --username e2e --display-name E2E --password e2e-password-123`,
  { cwd: root, env, stdio: 'inherit' },
)

console.log('[e2e] 启动服务: http://127.0.0.1:3111')
const child = spawn(process.execPath, [distServer], { cwd: root, env, stdio: 'inherit' })
const shutdown = () => {
  child.kill('SIGTERM')
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
child.on('exit', (code) => {
  console.log(`[e2e] 服务退出 code=${code}`)
  process.exit(code ?? 0)
})
