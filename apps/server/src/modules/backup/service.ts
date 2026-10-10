import fs from 'node:fs'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import type { AppConfig } from '../../config.js'
import type { DB } from '../../types.js'
import { nowIso, businessToday } from '../../lib/time.js'
import { uuid } from '../../lib/ids.js'
import { diskSpace } from '../../lib/files.js'
import { copyAttachments, fileHash } from './artifacts.js'
import { GoogleDriveBackup, type CloudBackupAdapter } from './google-drive.js'

export type BackupProvider = 'local' | 'aliyundrive' | 'googledrive'
export type BackupTrigger = 'manual' | 'scheduled'
export type BackupStatus = 'running' | 'success' | 'failed' | 'interrupted'

export const MIN_FREE_BYTES = 256 * 1024 * 1024
export const BACKUP_TOTAL_TIMEOUT_MS = 10 * 60 * 1000
/** 自动失败后的冷却时间 */
export const FAILURE_COOLDOWN_MS = 60 * 60 * 1000

const ARCHIVE_RE = /^family-expense-\d{8}-\d{6}-[0-9a-f]{8}\.sqlite\.gz$/

export interface BackupRunRow {
  id: string
  provider: BackupProvider
  trigger_type: BackupTrigger
  status: BackupStatus
  started_at: string
  finished_at: string | null
  snapshot_at: string | null
  file_name: string | null
  size_bytes: number | null
  sha256: string | null
  remote_file_id: string | null
  remote_path: string | null
  error_message: string | null
}

const tzFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** 业务时区的备份文件名时间戳：YYYYMMDD-HHmmss */
function archiveTimestamp(): string {
  const parts = tzFormatter.formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const day = `${get('year')}${get('month')}${get('day')}`
  const time = `${get('hour') === '24' ? '00' : get('hour')}${get('minute')}${get('second')}`
  return `${day}-${time}`
}

const WEEK_MS = 7 * 86400000
/** Most recent Sunday 03:00 in Asia/Shanghai, independent of server timezone. */
export function mostRecentDriveSlot(now = Date.now()): number {
  const shanghai = new Date(now + 8 * 3600000)
  let slot = Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate(), 3) - 8 * 3600000 - shanghai.getUTCDay() * 86400000
  if (slot > now) slot -= WEEK_MS
  return slot
}

export class BackupService {
  private runLock = false
  private currentRunId: string | null = null
  private currentPromise: Promise<void> | null = null

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly cloud: CloudBackupAdapter = new GoogleDriveBackup(config),
  ) {}

  cloudConfigured(): boolean { return this.cloud.configured() }

  get localDir(): string {
    return path.join(this.config.backupDir, 'local')
  }

  isRunning(): boolean {
    return this.runLock
  }

  get currentRun(): string | null {
    return this.currentRunId
  }

  /** 进程重启后调用：遗留的 running 标记为 interrupted */
  markInterruptedOnStartup(): void {
    const rows = this.db
      .prepare("SELECT id FROM backup_runs WHERE status = 'running'")
      .all() as { id: string }[]
    for (const r of rows) {
      this.db
        .prepare("UPDATE backup_runs SET status = 'interrupted', finished_at = ?, error_message = ? WHERE id = ?")
        .run(nowIso(), '进程重启，任务中断', r.id)
    }
  }

  getRun(id: string): BackupRunRow | undefined {
    return this.db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(id) as BackupRunRow | undefined
  }

  latestRun(provider: BackupProvider, status?: BackupStatus): BackupRunRow | undefined {
    if (status) {
      return this.db
        .prepare('SELECT * FROM backup_runs WHERE provider = ? AND status = ? ORDER BY started_at DESC LIMIT 1')
        .get(provider, status) as BackupRunRow | undefined
    }
    return this.db
      .prepare('SELECT * FROM backup_runs WHERE provider = ? ORDER BY started_at DESC LIMIT 1')
      .get(provider) as BackupRunRow | undefined
  }

  /** 下次自动备份到期时间（本地 Provider）；null = 从未成功（随时到期） */
  nextDueAt(provider: BackupProvider = 'local'): string | null {
    const last = this.latestRun(provider, 'success')
    if (provider === 'googledrive') {
      const slot = mostRecentDriveSlot()
      return new Date(last && new Date(last.started_at).getTime() >= slot ? slot + WEEK_MS : slot).toISOString()
    }
    if (!last) return null
    const due = new Date(last.started_at).getTime() + this.config.backupIntervalDays * 86400000
    return new Date(due).toISOString()
  }

  /** 失败冷却：距上次失败不足 1 小时则返回解除时间 */
  cooldownUntil(provider: BackupProvider = 'local'): string | null {
    const last = this.latestRun(provider)
    if (!last || last.status !== 'failed') return null
    const until = new Date(last.started_at).getTime() + FAILURE_COOLDOWN_MS
    return Date.now() < until ? new Date(until).toISOString() : null
  }

  /** 手动/调度触发入口；已有任务在跑时返回现有任务，不另起一个 */
  trigger(
    provider: BackupProvider,
    triggerType: BackupTrigger,
  ): { runId: string; alreadyRunning: boolean } {
    if (provider === 'aliyundrive') throw new Error('阿里云盘未接入')
    if (provider === 'googledrive' && !this.cloudConfigured()) throw new Error('Google Drive 尚未启用或未完成授权')
    if (this.runLock && this.currentRunId) {
      return { runId: this.currentRunId, alreadyRunning: true }
    }
    const runId = uuid()
    this.db
      .prepare(
        "INSERT INTO backup_runs (id, provider, trigger_type, status, started_at) VALUES (?, ?, ?, 'running', ?)",
      )
      .run(runId, provider, triggerType, nowIso())
    this.runLock = true
    this.currentRunId = runId
    this.currentPromise = this.runBundle(runId, provider).finally(() => {
      this.runLock = false
      this.currentRunId = null
      this.currentPromise = null
    })
    return { runId, alreadyRunning: false }
  }

  /** 等待当前任务结束（测试与优雅关闭用） */
  async waitForCurrent(): Promise<void> {
    if (this.currentPromise) await this.currentPromise
  }

  /** 调度检查：到期则执行 scheduled 备份；返回本次是否触发 */
  async checkAndRunScheduled(): Promise<boolean> {
    if (this.runLock) return false
    let triggered = false
    const providers: BackupProvider[] = this.cloudConfigured() ? ['googledrive', 'local'] : ['local']
    for (const provider of providers) {
      if (this.cooldownUntil(provider)) continue
      const due = this.nextDueAt(provider)
      if (due !== null && new Date(due).getTime() > Date.now()) continue
      const { runId } = this.trigger(provider, 'scheduled')
      await this.waitForRun(runId)
      triggered = true
    }
    return triggered
  }

  waitForRun(runId: string): Promise<void> {
    if (this.currentRunId === runId && this.currentPromise) return this.currentPromise
    return Promise.resolve()
  }

  private async runBundle(runId: string, provider: BackupProvider): Promise<void> {
    const tmpDir = path.join(this.config.backupDir, 'tmp')
    const archiveDir = provider === 'local' ? this.localDir : path.join(tmpDir, `drive-${runId}`)
    let remotePath: string | null = null
    const snapPath = path.join(tmpDir, `snap-${runId}.db`)
    let archivePath: string | null = null
    const signal = AbortSignal.timeout(BACKUP_TOTAL_TIMEOUT_MS)
    try {
      fs.mkdirSync(archiveDir, { recursive: true })
      fs.mkdirSync(tmpDir, { recursive: true })
      // 磁盘水位检查：至少预留 256 MiB + 主库体积的约 2.5 倍（快照 + 压缩临时空间）
      const space = await diskSpace(this.config.backupDir)
      if (space) {
        const mainDbBytes = fs.statSync(this.config.databasePath).size
        const attachmentsBytes = (this.db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM expense_attachments').get() as { bytes: number }).bytes
        const need = MIN_FREE_BYTES + mainDbBytes * 2.5 + attachmentsBytes
        if (space.freeBytes < need) {
          throw new Error(`磁盘空间不足（剩余 ${Math.floor(space.freeBytes / 1048576)} MiB），已停止本次备份`)
        }
      }

      // 1. better-sqlite3 backup API：一致性快照（不直接复制运行中的主库文件）
      await this.db.backup(snapPath, { progress: () => { signal.throwIfAborted(); return 100 } })
      signal.throwIfAborted()
      const snapshotAt = nowIso()

      // 2. 在快照副本中清空 Session，并做完整性/外键检查
      const snapDb = new Database(snapPath)
      let schemaVersions: string[]
      let attachments: { stored_name: string; size_bytes: number }[]
      try {
        snapDb.exec('DELETE FROM sessions')
        const integrity = snapDb.pragma('integrity_check', { simple: true })
        if (integrity !== 'ok') throw new Error(`快照完整性检查失败: ${integrity}`)
        const fkViolations = snapDb.pragma('foreign_key_check')
        if (Array.isArray(fkViolations) && fkViolations.length > 0) throw new Error('快照外键检查失败')
        schemaVersions = (snapDb.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: string }[]).map((r) => r.version)
        attachments = snapDb.prepare('SELECT stored_name, size_bytes FROM expense_attachments ORDER BY stored_name').all() as { stored_name: string; size_bytes: number }[]
      } finally {
        snapDb.close()
      }

      // 3. 流式 gzip 压缩；SHA-256 对最终归档文件计算（恢复时以归档校验）
      const fileName = `family-expense-${archiveTimestamp()}-${crypto.randomBytes(4).toString('hex')}.sqlite.gz`
      archivePath = path.join(archiveDir, fileName)
      const gzip = createGzip()
      const source = createReadStream(snapPath)
      const dest = fs.createWriteStream(archivePath)
      await pipeline(source, gzip, dest, { signal })
      const sha256 = await fileHash(archivePath, signal)
      const sizeBytes = fs.statSync(archivePath).size
      const attachmentFiles = await copyAttachments(attachments, this.config.uploadDir, `${archivePath}.attachments`, signal)

      // 4. JSON 校验元数据
      const meta = {
        file_name: fileName,
        size_bytes: sizeBytes,
        sha256,
        created_at: nowIso(),
        snapshot_at: snapshotAt,
        app_version: 'v1-dev',
        schema_versions: schemaVersions,
        format_version: 2,
        attachments_included: true,
        attachments: attachmentFiles,
        provider,
      }
      signal.throwIfAborted()
      fs.writeFileSync(`${archivePath}.json.tmp`, JSON.stringify(meta, null, 2))
      fs.renameSync(`${archivePath}.json.tmp`, `${archivePath}.json`)

      if (provider === 'googledrive') {
        remotePath = this.cloud.remotePath(fileName)
        this.db.prepare('UPDATE backup_runs SET remote_path = ?, file_name = ? WHERE id = ?').run(remotePath, fileName, runId)
        await this.cloud.publish(archiveDir, fileName, signal)
      }
      this.db
        .prepare(
          "UPDATE backup_runs SET status = 'success', finished_at = ?, snapshot_at = ?, file_name = ?, size_bytes = ?, sha256 = ?, remote_path = ? WHERE id = ?",
        )
        .run(nowIso(), snapshotAt, fileName, sizeBytes, sha256, remotePath, runId)

      // Retention errors must not turn a verified new backup into a failed/deleted backup.
      if (provider === 'local') this.applyRetention()
      else {
        try { await this.applyCloudRetention(signal) }
        catch { this.db.prepare('UPDATE backup_runs SET error_message = ? WHERE id = ?').run('新备份已完成；旧云备份清理未完成，将在后续成功备份后重试', runId) }
      }
    } catch (err) {
      const message = sanitizeError(err instanceof Error ? err.message : String(err))
      this.db
        .prepare("UPDATE backup_runs SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?")
        .run(nowIso(), message, runId)
      if (remotePath && archivePath) {
        try { await this.cloud.remove(remotePath, path.basename(archivePath), AbortSignal.timeout(30000)) }
        catch { /* failed partial uploads are never counted as completed backups */ }
      }
      if (archivePath) {
        for (const suffix of ['.attachments', '.json', '.json.tmp']) {
          try { fs.rmSync(`${archivePath}${suffix}`, { recursive: true, force: true }) } catch { /* best effort */ }
        }
        try {
          fs.unlinkSync(archivePath)
        } catch {
          // 清理失败忽略
        }
      }
    } finally {
      if (provider === 'googledrive') {
        try { fs.rmSync(archiveDir, { recursive: true, force: true }) } catch { /* best effort */ }
      }
      try {
        fs.unlinkSync(snapPath)
      } catch {
        // 临时快照清理失败忽略
      }
    }
  }

  private async applyCloudRetention(signal: AbortSignal): Promise<void> {
    const rows = this.db.prepare("SELECT * FROM backup_runs WHERE provider = 'googledrive' AND status = 'success' AND remote_path IS NOT NULL ORDER BY finished_at DESC, rowid DESC").all() as BackupRunRow[]
    const owned = rows.filter((r) => r.file_name && ARCHIVE_RE.test(r.file_name) && r.remote_path === this.cloud.remotePath(r.file_name))
    for (const row of owned.slice(this.config.googleDriveKeep)) {
      await this.cloud.remove(row.remote_path!, row.file_name!, signal)
      this.db.prepare('UPDATE backup_runs SET remote_path = NULL WHERE id = ?').run(row.id)
    }
  }

  /** Only retire completed groups, ordered by recorded completion rather than random filename suffixes. */
  private applyRetention(): void {
    const keep = this.config.localBackupKeep
    const archives = (this.db.prepare("SELECT file_name FROM backup_runs WHERE provider = 'local' AND status = 'success' ORDER BY finished_at DESC, rowid DESC").all() as { file_name: string }[])
      .map((row) => row.file_name)
      .filter((name) => ARCHIVE_RE.test(name) && fs.existsSync(path.join(this.localDir, name)))
    for (const name of archives.slice(keep)) {
      try {
        fs.unlinkSync(path.join(this.localDir, name))
      } catch {
        // 单个删除失败不影响其余
      }
      try {
        fs.unlinkSync(path.join(this.localDir, `${name}.json`))
      } catch {
        // 元数据可能不存在
      }
      try { fs.rmSync(path.join(this.localDir, `${name}.attachments`), { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
}

/** 备份错误信息脱敏：去掉本地路径 */
export function sanitizeError(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s"']+/g, '[路径]')
    .replace(/\/[\w.-]+\/[\w./-]+/g, '[路径]')
}

export { businessToday }
