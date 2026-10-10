import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authHeaders,
  cleanup,
  createTestApp,
  insertUser,
  login,
  type SessionRef,
  type TestCtx,
} from './helpers.js'
import { BackupService } from '../src/modules/backup/service.js'
import { restoreFromArchive } from '../src/modules/backup/restore.js'
import { uuid } from '../src/lib/ids.js'

let ctx: TestCtx
afterEach(() => {
  if (ctx) cleanup(ctx)
})

interface Seed {
  s: SessionRef
  service: BackupService
  shopId: string
  catId: string
  aliceId: string
}

async function seed(): Promise<Seed> {
  ctx = await createTestApp()
  const alice = await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
  const s = await login(ctx, alice.username, alice.password)
  const shop = await ctx.app.inject({ method: 'POST', url: '/api/shops', headers: authHeaders(s), payload: { name: 'A店' } })
  const cats = await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: authHeaders(s) })
  const service = new BackupService(ctx.db, ctx.config)
  return { s, service, shopId: shop.json().item.id, catId: cats.json().items[0].id, aliceId: alice.id }
}

function addExpense(seedInfo: Seed, cents = 1000, remark = 'x'): void {
  const now = new Date().toISOString()
  ctx.db
    .prepare(
      'INSERT INTO expenses (id, shop_id, category_id, amount_cents, bill_month, paid_date, remark, created_by, updated_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    )
    .run(uuid(), seedInfo.shopId, seedInfo.catId, cents, '2026-08', '2026-08-20', remark, seedInfo.aliceId, seedInfo.aliceId, now, now)
}

describe('backup', () => {
  it.each(['page=1.5', 'page=Infinity', 'page_size=1.5', 'page_size=abc', 'page=0', 'page_size=101'])('非法分页返回 400：%s', async (query) => {
    const { s } = await seed()
    const res = await ctx.app.inject({
      method: 'GET', url: `/api/backup/runs?${query}`, headers: authHeaders(s),
    })
    expect(res.statusCode).toBe(400)
  })

  it('备份历史默认分页与指定分页正常返回', async () => {
    const { s } = await seed()
    for (const query of ['', '?page=2&page_size=5']) {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/backup/runs${query}`, headers: authHeaders(s) })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ items: [], total: 0, page: query ? 2 : 1, page_size: query ? 5 : 20 })
    }
  })

  it('手动本地备份：成功、哈希一致、元数据完整、Session 不入档', async () => {
    const seedInfo = await seed()
    addExpense(seedInfo)
    const { runId } = seedInfo.service.trigger('local', 'manual')
    await seedInfo.service.waitForRun(runId)

    const run = seedInfo.service.getRun(runId)
    expect(run?.status).toBe('success')
    expect(run?.file_name).toMatch(/^family-expense-\d{8}-\d{6}-[0-9a-f]{8}\.sqlite\.gz$/)

    const archivePath = path.join(seedInfo.service.localDir, run!.file_name!)
    const metaPath = `${archivePath}.json`
    expect(fs.existsSync(archivePath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(metaPath, 'utf8'))).toMatchObject({
      file_name: run!.file_name,
      sha256: run!.sha256,
      attachments_included: true,
      provider: 'local',
    })

    // 解压验证：Session 清空、业务数据在。
    // 注意：快照为 WAL 模式库，不能从内存 Buffer 打开，先落盘
    const plainPath = path.join(ctx.dir, 'verify-plain.db')
    fs.writeFileSync(plainPath, zlib.gunzipSync(fs.readFileSync(archivePath)))
    const db = new Database(plainPath)
    try {
      expect((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c).toBe(0)
      expect((db.prepare('SELECT COUNT(*) AS c FROM expenses').get() as { c: number }).c).toBe(1)
      expect((db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c).toBe(1)
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      db.close()
      fs.unlinkSync(plainPath)
    }
  })

  it('活跃写入期间执行备份，快照保持一致性', async () => {
    const seedInfo = await seed()
    const writer = (async () => {
      for (let i = 0; i < 80; i++) {
        addExpense(seedInfo, 100 + i, `并发写入${i}`)
        await new Promise((r) => setTimeout(r, 2))
      }
    })()
    const { runId } = seedInfo.service.trigger('local', 'manual')
    await seedInfo.service.waitForRun(runId)
    await writer

    const run = seedInfo.service.getRun(runId)
    expect(run?.status).toBe('success')
    const archivePath = path.join(seedInfo.service.localDir, run!.file_name!)
    const plainPath = path.join(ctx.dir, 'verify-plain2.db')
    fs.writeFileSync(plainPath, zlib.gunzipSync(fs.readFileSync(archivePath)))
    const db = new Database(plainPath)
    try {
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally {
      db.close()
      fs.unlinkSync(plainPath)
    }
  })

  it('重复触发返回现有任务，不另起一个', async () => {
    const seedInfo = await seed()
    const first = seedInfo.service.trigger('local', 'manual')
    const second = seedInfo.service.trigger('local', 'manual')
    expect(second.runId).toBe(first.runId)
    expect(second.alreadyRunning).toBe(true)
    await seedInfo.service.waitForRun(first.runId)
    expect(seedInfo.service.getRun(first.runId)?.status).toBe('success')
  })

  it('到期检查：从未成功→到期；1 天前成功→不到期；8 天前→到期', async () => {
    const seedInfo = await seed()
    expect(await seedInfo.service.checkAndRunScheduled()).toBe(true)

    const { runId } = seedInfo.service.trigger('local', 'manual')
    await seedInfo.service.waitForRun(runId)

    // 全部成功记录改为 1 天前 → 不到期（默认 7 天间隔）
    ctx.db
      .prepare('UPDATE backup_runs SET started_at = ?')
      .run(new Date(Date.now() - 1 * 86400000).toISOString())
    expect(await seedInfo.service.checkAndRunScheduled()).toBe(false)

    // 全部改为 8 天前 → 到期
    ctx.db
      .prepare('UPDATE backup_runs SET started_at = ?')
      .run(new Date(Date.now() - 8 * 86400000).toISOString())
    expect(await seedInfo.service.checkAndRunScheduled()).toBe(true)
  })

  it('失败冷却：上次失败 30 分钟内自动任务跳过，手动不受限', async () => {
    const seedInfo = await seed()
    // 构造 30 分钟前的失败记录
    ctx.db
      .prepare("INSERT INTO backup_runs (id, provider, trigger_type, status, started_at, finished_at, error_message) VALUES (?, 'local', 'scheduled', 'failed', ?, ?, '磁盘空间不足')")
      .run(uuid(), new Date(Date.now() - 30 * 60000).toISOString(), new Date(Date.now() - 29 * 60000).toISOString())
    expect(seedInfo.service.cooldownUntil()).not.toBeNull()
    expect(await seedInfo.service.checkAndRunScheduled()).toBe(false)

    const { runId } = seedInfo.service.trigger('local', 'manual')
    await seedInfo.service.waitForRun(runId)
    expect(seedInfo.service.getRun(runId)?.status).toBe('success')
  })

  it('重启后遗留 running 标记为 interrupted', async () => {
    const seedInfo = await seed()
    ctx.db
      .prepare("INSERT INTO backup_runs (id, provider, trigger_type, status, started_at) VALUES (?, 'local', 'manual', 'running', ?)")
      .run(uuid(), new Date().toISOString())
    seedInfo.service.markInterruptedOnStartup()
    const rows = ctx.db.prepare("SELECT status FROM backup_runs WHERE status = 'interrupted'").all()
    expect(rows.length).toBe(1)
  })

  it('保留策略：仅保留最近 N 组备份', async () => {
    const seedInfo = await seed()
    for (let i = 0; i < 3; i++) {
      const { runId } = seedInfo.service.trigger('local', 'manual')
      await seedInfo.service.waitForRun(runId)
      // 确保文件名时间戳不同
      await new Promise((r) => setTimeout(r, 1100))
    }
    const archives = fs.readdirSync(seedInfo.service.localDir).filter((f) => f.endsWith('.gz'))
    expect(archives.length).toBe(2)
    // .gz 与 .json 成组
    const metas = fs.readdirSync(seedInfo.service.localDir).filter((f) => f.endsWith('.json'))
    expect(metas.length).toBe(2)
  })

  it('恢复闭环：备份 → 恢复到独立目录 → 数据与账号核对', async () => {
    const seedInfo = await seed()
    addExpense(seedInfo, 1234, '恢复验证')
    addExpense(seedInfo, 5678, '恢复验证2')
    const { runId } = seedInfo.service.trigger('local', 'manual')
    await seedInfo.service.waitForRun(runId)
    const run = seedInfo.service.getRun(runId)!
    const archivePath = path.join(seedInfo.service.localDir, run.file_name!)

    const targetDir = fs.mkdtempSync(path.join(path.dirname(ctx.dir), 'restore-target-'))
    try {
      const result = await restoreFromArchive({
        archivePath,
        metaPath: `${archivePath}.json`,
        targetDbPath: path.join(targetDir, 'restored.db'),
      })
      expect(result.users).toBe(1)
      expect(result.expenses).toBe(2)
      expect(result.migrated).toEqual([])

      const restored = new Database(path.join(targetDir, 'restored.db'))
      try {
        expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
        expect((restored.prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number }).c).toBe(0)
        const remarks = restored.prepare('SELECT remark FROM expenses ORDER BY remark').all() as { remark: string }[]
        expect(remarks.map((r) => r.remark)).toEqual(['恢复验证', '恢复验证2'])
      } finally {
        restored.close()
      }
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('恢复拒绝来自更新版本的备份', async () => {
    const seedInfo = await seed()
    const { runId } = seedInfo.service.trigger('local', 'manual')
    await seedInfo.service.waitForRun(runId)
    const run = seedInfo.service.getRun(runId)!
    const archivePath = path.join(seedInfo.service.localDir, run.file_name!)

    const targetDir = fs.mkdtempSync(path.join(path.dirname(ctx.dir), 'restore-target-'))
    try {
      // 构造一个不含 0001_init 迁移的"旧版应用"，备份中的 0001_init 即为未知版本
      const fakeMigrations = path.join(ctx.dir, 'fake-migrations')
      fs.mkdirSync(fakeMigrations, { recursive: true })
      fs.writeFileSync(path.join(fakeMigrations, '0000_legacy.sql'), 'CREATE TABLE legacy_marker (id TEXT);')
      await expect(
        restoreFromArchive({
          archivePath,
          targetDbPath: path.join(targetDir, 'restored.db'),
          migrationsDir: fakeMigrations,
        }),
      ).rejects.toThrow(/未知迁移/)
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
  })
})
