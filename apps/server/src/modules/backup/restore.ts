import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'
import type { DB } from '../../types.js'
import { migrate, MIGRATIONS_DIR } from '../../database/migrate.js'
import { attachmentPath, fileHash, type AttachmentArtifact } from './artifacts.js'

export interface RestoreOptions {
  /** 备份归档文件（.sqlite.gz） */
  archivePath: string
  /** 校验元数据（可选；提供时校验文件名与哈希） */
  metaPath?: string
  /** 目标数据库文件路径（应用主库） */
  targetDbPath: string
  /** Required for v2 backups containing attachments. Existing unrelated files are retained. */
  targetUploadDir?: string
  /** 当前应用可用的迁移文件目录（用于版本兼容性判断） */
  migrationsDir?: string
  /** 跳过“目标库存在”确认（CLI 已确认后调用） */
  assumeConfirmed?: boolean
}

export interface RestoreResult {
  sha256: string
  schemaVersions: string[]
  users: number
  expenses: number
  migrated: string[]
  rollbackDir: string | null
  attachments: number
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * 离线恢复：校验 → 解压 → 完整性/外键/版本检查 → 保留回滚副本 → 成组替换 .db/-wal/-shm → 按需迁移。
 * 必须在应用停止后执行，禁止在正常运行的服务内覆盖数据库。
 */
export async function restoreFromArchive(opts: RestoreOptions): Promise<RestoreResult> {
  const { archivePath, targetDbPath } = opts
  if (!fs.existsSync(archivePath)) throw new Error(`备份归档不存在: ${archivePath}`)

  // 1. 元数据校验
  let meta: { file_name?: string; sha256?: string; format_version?: number; attachments_included?: boolean; attachments?: AttachmentArtifact[] } | null = null
  if (opts.metaPath) {
    meta = JSON.parse(fs.readFileSync(opts.metaPath, 'utf8')) as { file_name?: string; sha256?: string }
    if (meta.file_name && path.basename(archivePath) !== meta.file_name) {
      throw new Error('元数据与归档文件名不一致，可能不是同一组备份')
    }
    if (meta.format_version !== undefined && meta.format_version !== 2) throw new Error('不支持的备份格式版本')
    if (meta.format_version === 2 && (!meta.sha256 || !meta.attachments_included || !Array.isArray(meta.attachments))) {
      throw new Error('备份校验清单不完整')
    }
  }

  // 2. 哈希校验
  const actualSha = await sha256File(archivePath)
  if (meta?.sha256 && meta.sha256 !== actualSha) {
    throw new Error('SHA-256 校验失败：归档文件与元数据不一致，已停止恢复')
  }

  // 3. 解压到临时目录
  const targetDir = path.dirname(targetDbPath)
  fs.mkdirSync(targetDir, { recursive: true })
  const tmpDir = fs.mkdtempSync(path.join(targetDir, 'restore-'))
  const extractedPath = path.join(tmpDir, 'restored.db')
  try {
    const source = createReadStream(archivePath)
    const gunzip = createGunzip()
    const dest = fs.createWriteStream(extractedPath)
    await pipeline(source, gunzip, dest)

    // 4. 完整性 / 外键 / 版本兼容性
    const restored = new Database(extractedPath)
    let schemaVersions: string[]
    let attachmentRows: { stored_name: string; size_bytes: number }[]
    try {
      restored.pragma('foreign_keys = ON')
      const integrity = restored.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error(`备份完整性检查失败: ${integrity}`)
      const fk = restored.pragma('foreign_key_check')
      if (Array.isArray(fk) && fk.length > 0) throw new Error('备份外键检查失败')
      schemaVersions = (
        restored.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: string }[]
      ).map((r) => r.version)
      attachmentRows = restored.prepare('SELECT stored_name, size_bytes FROM expense_attachments ORDER BY stored_name').all() as { stored_name: string; size_bytes: number }[]
    } finally {
      restored.close()
    }

    // 版本兼容性：备份中存在当前应用不认识的迁移版本 → 备份来自更新版本，拒绝恢复
    const migrationsDir = opts.migrationsDir ?? MIGRATIONS_DIR
    const knownVersions = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
    const unknown = schemaVersions.filter((v) => !knownVersions.includes(v))
    if (unknown.length > 0) {
      throw new Error(`备份来自更新的应用版本（含未知迁移 ${unknown.join(', ')}），已拒绝恢复`)
    }

    // Validate every attachment before touching the target database or uploads.
    const files = meta?.attachments_included ? meta.attachments : undefined
    if (meta?.attachments_included && !Array.isArray(files)) throw new Error('备份附件清单缺失')
    if (files) {
      if (files.length !== attachmentRows.length) throw new Error('附件清单与数据库不一致')
      const names = new Set<string>()
      for (const file of files) {
        const row = attachmentRows.find((r) => r.stored_name === file.stored_name)
        if (!row || names.has(file.stored_name) || row.size_bytes !== file.size_bytes || !/^[0-9a-f]{64}$/.test(file.sha256)) {
          throw new Error('附件清单与数据库不一致')
        }
        names.add(file.stored_name)
        const sourceFile = attachmentPath(`${archivePath}.attachments`, file.stored_name)
        if (fs.statSync(sourceFile).size !== file.size_bytes || await fileHash(sourceFile) !== file.sha256) {
          throw new Error('附件 SHA-256 校验失败')
        }
      }
      if (files.length && !opts.targetUploadDir) throw new Error('恢复完整备份必须指定附件目标目录')
      // UUID filenames are immutable. Refuse collisions instead of overwriting existing evidence.
      if (opts.targetUploadDir) {
        for (const file of files) {
          const targetFile = attachmentPath(opts.targetUploadDir, file.stored_name)
          if (fs.existsSync(targetFile) && await fileHash(targetFile) !== file.sha256) {
            throw new Error('目标附件存在同名但内容不同的文件，已停止恢复')
          }
        }
      }
    }

    // Run migrations against the staged database; a migration failure leaves the live database intact.
    const staged: DB = new Database(extractedPath)
    let migrated: string[]
    let users: number
    let expenses: number
    try {
      staged.pragma('foreign_keys = ON')
      staged.exec('DELETE FROM sessions')
      migrated = (await migrate(staged, migrationsDir)).applied
      users = (staged.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c
      expenses = (staged.prepare('SELECT COUNT(*) AS c FROM expenses').get() as { c: number }).c
      staged.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      staged.close()
    }

    if (files?.length && opts.targetUploadDir) {
      fs.mkdirSync(opts.targetUploadDir, { recursive: true })
      for (const file of files) {
        const targetFile = attachmentPath(opts.targetUploadDir, file.stored_name)
        if (!fs.existsSync(targetFile)) {
          // Stage in the same directory so an interrupted copy never leaves a partial final file.
          const partial = `${targetFile}.${crypto.randomUUID()}.restore-tmp`
          try {
            await pipeline(fs.createReadStream(attachmentPath(`${archivePath}.attachments`, file.stored_name)), fs.createWriteStream(partial, { flags: 'wx' }))
            if (await fileHash(partial) !== file.sha256) throw new Error('附件恢复校验失败')
            fs.renameSync(partial, targetFile)
          } finally {
            fs.rmSync(partial, { force: true })
          }
        }
      }
    }

    // 5. 保留当前数据库目录作为回滚副本（.db / -wal / -shm 成组）
    let rollbackDir: string | null = null
    const targetBase = path.basename(targetDbPath)
    const groupExists =
      fs.existsSync(targetDbPath) ||
      fs.existsSync(`${targetDbPath}-wal`) ||
      fs.existsSync(`${targetDbPath}-shm`)
    if (groupExists) {
      rollbackDir = fs.mkdtempSync(path.join(targetDir, 'rollback-'))
    }

    // Stage lives on the target filesystem: activate via rename after moving the old group.
    const moved: string[] = []
    try {
      if (rollbackDir) {
        for (const suffix of ['', '-wal', '-shm']) {
          const old = `${targetDbPath}${suffix}`
          if (fs.existsSync(old)) {
            fs.renameSync(old, path.join(rollbackDir, `${targetBase}${suffix}`))
            moved.push(suffix)
          }
        }
      }
      fs.renameSync(extractedPath, targetDbPath)
    } catch (err) {
      if (rollbackDir) {
        for (const suffix of moved) {
          const old = path.join(rollbackDir, `${targetBase}${suffix}`)
          fs.renameSync(old, `${targetDbPath}${suffix}`)
        }
      }
      throw err
    }

    return { sha256: actualSha, schemaVersions, users, expenses, migrated, rollbackDir, attachments: files?.length ?? 0 }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
