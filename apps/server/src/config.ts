import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { loadEnvFile } from 'node:process'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')

export type AppEnv = 'development' | 'production' | 'test'

export interface AppConfig {
  env: AppEnv
  host: string
  port: number
  baseUrl: string | null
  trustProxy: false | string
  sessionSecret: string
  sessionMaxAgeDays: number
  databasePath: string
  uploadDir: string
  backupDir: string
  backupIntervalDays: number
  localBackupKeep: number
  aliyunDriveEnabled: boolean
  googleDriveEnabled: boolean
  googleDriveConfig: string | null
  googleDriveRemote: string
  googleDriveKeep: number
  rcloneBin: string
  allowedOrigins: string[]
}

function readStr(env: Record<string, string | undefined>, key: string): string | undefined {
  const v = env[key]
  const t = typeof v === 'string' ? v.trim() : undefined
  return t ? t : undefined
}

function readNum(env: Record<string, string | undefined>, key: string, def: number, min: number, max: number): number {
  const raw = readStr(env, key)
  if (raw === undefined) return def
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`环境变量 ${key} 必须是 ${min}~${max} 之间的整数，当前值: ${raw}`)
  }
  return n
}

function readBool(env: Record<string, string | undefined>, key: string, def: boolean): boolean {
  const raw = readStr(env, key)
  if (raw === undefined) return def
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`环境变量 ${key} 必须是 true 或 false，当前值: ${raw}`)
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  // Resolve from the repository, including when pnpm runs from apps/server.
  // Existing process variables take precedence. Explicit test environments stay isolated.
  if (env === process.env && env.NODE_ENV !== 'test') {
    const envFile = path.join(REPO_ROOT, '.env')
    if (fs.existsSync(envFile)) loadEnvFile(envFile)
  }
  const nodeEnv = (readStr(env, 'NODE_ENV') ?? 'development') as AppEnv
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV 不合法: ${nodeEnv}`)
  }
  const isProd = nodeEnv === 'production'

  const port = readNum(env, 'PORT', 3000, 0, 65535)
  const databasePath = path.resolve(
    REPO_ROOT,
    readStr(env, 'DATABASE_PATH') ?? path.join(REPO_ROOT, 'data', 'database', 'family-expense.db'),
  )
  const uploadDir = path.resolve(REPO_ROOT, readStr(env, 'UPLOAD_DIR') ?? path.join(REPO_ROOT, 'data', 'uploads'))
  const backupDir = path.resolve(REPO_ROOT, readStr(env, 'BACKUP_DIR') ?? path.join(REPO_ROOT, 'data', 'backups'))

  let sessionSecret = readStr(env, 'SESSION_SECRET') ?? ''
  if (!sessionSecret) {
    if (isProd) {
      throw new Error('SESSION_SECRET 未配置：生产环境必须提供至少 32 字节（64 个十六进制字符）的随机密钥')
    }
    sessionSecret = crypto.randomBytes(32).toString('hex')
  } else if (sessionSecret.length < 64) {
    if (isProd) throw new Error('SESSION_SECRET 至少需要 32 字节（64 个十六进制字符）')
  }

  let baseUrl = readStr(env, 'BASE_URL') ?? null
  if (baseUrl) {
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('BASE_URL 必须为不含路径、凭据或查询参数的 HTTP(S) 站点地址')
    }
    baseUrl = url.origin
    if (isProd && !baseUrl.startsWith('https://')) throw new Error('BASE_URL 生产环境必须为 HTTPS')
  } else if (isProd) {
    throw new Error('BASE_URL 未配置：生产环境必须提供 HTTPS 访问入口')
  }

  const proxy = readStr(env, 'TRUST_PROXY') ?? 'false'
  if (!['false', 'loopback'].includes(proxy)) {
    throw new Error('TRUST_PROXY 仅支持 false 或 loopback（仅信任本机隧道代理）')
  }

  const googleDriveRemote = readStr(env, 'GOOGLE_DRIVE_REMOTE') ?? 'homemanager'
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(googleDriveRemote)) throw new Error('GOOGLE_DRIVE_REMOTE 必须是合法的 rclone 配置名称')
  const googleDriveConfig = readStr(env, 'GOOGLE_DRIVE_CONFIG')
  const allowedOrigins = new Set<string>()
  if (baseUrl) allowedOrigins.add(baseUrl.replace(/\/$/, ''))
  if (!isProd) {
    allowedOrigins.add(`http://localhost:${port}`)
    allowedOrigins.add(`http://127.0.0.1:${port}`)
    allowedOrigins.add('http://localhost:5173')
    allowedOrigins.add('http://127.0.0.1:5173')
  }

  return {
    env: nodeEnv,
    host: readStr(env, 'HOST') ?? '127.0.0.1',
    port,
    baseUrl,
    trustProxy: proxy === 'false' ? false : 'loopback',
    sessionSecret,
    sessionMaxAgeDays: readNum(env, 'SESSION_MAX_AGE_DAYS', 7, 1, 365),
    databasePath,
    uploadDir,
    backupDir,
    backupIntervalDays: readNum(env, 'BACKUP_INTERVAL_DAYS', 7, 1, 3650),
    localBackupKeep: readNum(env, 'LOCAL_BACKUP_KEEP', 2, 1, 100),
    aliyunDriveEnabled: readBool(env, 'ALIYUN_DRIVE_ENABLED', false),
    googleDriveEnabled: readBool(env, 'GOOGLE_DRIVE_ENABLED', false),
    googleDriveConfig: googleDriveConfig ? path.resolve(REPO_ROOT, googleDriveConfig) : null,
    googleDriveRemote,
    googleDriveKeep: readNum(env, 'GOOGLE_DRIVE_KEEP', 5, 1, 100),
    rcloneBin: readStr(env, 'RCLONE_BIN') ?? 'rclone',
    allowedOrigins: [...allowedOrigins],
  }
}
