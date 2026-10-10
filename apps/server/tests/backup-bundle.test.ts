import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp, cleanup, insertUser, type TestCtx } from './helpers.js'
import { restoreFromArchive } from '../src/modules/backup/restore.js'
import { uuid } from '../src/lib/ids.js'

let ctx: TestCtx
afterEach(() => { if (ctx) cleanup(ctx) })

async function backupWithAttachment() {
  ctx = await createTestApp()
  const user = await insertUser(ctx.db)
  const now = new Date().toISOString()
  const shop = uuid(), expense = uuid(), name = `${uuid()}.pdf`
  ctx.db.prepare('INSERT INTO shops (id, name, is_active, sort_order, created_at, updated_at) VALUES (?, ?, 1, 0, ?, ?)').run(shop, 'Test shop', now, now)
  const category = ctx.db.prepare('SELECT id FROM expense_categories LIMIT 1').get() as { id: string }
  ctx.db.prepare('INSERT INTO expenses (id, shop_id, category_id, amount_cents, bill_month, paid_date, created_by, updated_by, version, created_at, updated_at) VALUES (?, ?, ?, 100, ?, ?, ?, ?, 1, ?, ?)').run(expense, shop, category.id, '2026-08', '2026-08-20', user.id, user.id, now, now)
  const bytes = Buffer.from('%PDF-1.7\nreceipt evidence')
  fs.mkdirSync(ctx.config.uploadDir, { recursive: true })
  fs.writeFileSync(path.join(ctx.config.uploadDir, name), bytes)
  ctx.db.prepare('INSERT INTO expense_attachments (id, expense_id, original_name, stored_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uuid(), expense, 'receipt.pdf', name, 'application/pdf', bytes.length, now)
  const service = ctx.app.backup
  const { runId } = service.trigger('local', 'manual')
  await service.waitForRun(runId)
  expect(service.getRun(runId)?.status).toBe('success')
  const archive = path.join(service.localDir, service.getRun(runId)!.file_name!)
  return { service, name, bytes, archive }
}

describe('complete local backup', () => {
  it('restores attachments and preserves unrelated existing files', async () => {
    const { name, bytes, archive } = await backupWithAttachment()
    const uploads = path.join(ctx.dir, 'restored-uploads')
    fs.mkdirSync(uploads)
    fs.writeFileSync(path.join(uploads, 'keep.txt'), 'existing')
    const result = await restoreFromArchive({ archivePath: archive, metaPath: `${archive}.json`, targetDbPath: path.join(ctx.dir, 'restored.db'), targetUploadDir: uploads })
    expect(result.attachments).toBe(1)
    expect(fs.readFileSync(path.join(uploads, name))).toEqual(bytes)
    expect(fs.readFileSync(path.join(uploads, 'keep.txt'), 'utf8')).toBe('existing')
  })
  it('rejects damaged attachments before touching the target database', async () => {
    const { name, archive } = await backupWithAttachment()
    fs.writeFileSync(path.join(`${archive}.attachments`, name), 'broken')
    const target = path.join(ctx.dir, 'untouched.db')
    fs.writeFileSync(target, 'original database')
    await expect(restoreFromArchive({ archivePath: archive, metaPath: `${archive}.json`, targetDbPath: target, targetUploadDir: path.join(ctx.dir, 'restored-uploads') })).rejects.toThrow(/附件/)
    expect(fs.readFileSync(target, 'utf8')).toBe('original database')
  })
  it('missing attachments fail the new backup without deleting the previous complete backup', async () => {
    const { service, name, archive } = await backupWithAttachment()
    fs.unlinkSync(path.join(ctx.config.uploadDir, name))
    const { runId } = service.trigger('local', 'manual')
    await service.waitForRun(runId)
    expect(service.getRun(runId)?.status).toBe('failed')
    expect(fs.existsSync(archive)).toBe(true)
    expect(service.isRunning()).toBe(false)
  })
  it('reports invalid gzip as a rejected operation', async () => {
    ctx = await createTestApp()
    const archive = path.join(ctx.dir, 'broken.gz')
    fs.writeFileSync(archive, 'not gzip')
    await expect(restoreFromArchive({ archivePath: archive, targetDbPath: path.join(ctx.dir, 'new.db') })).rejects.toThrow()
    expect(fs.existsSync(path.join(ctx.dir, 'new.db'))).toBe(false)
  })
  it('continues to support legacy database-only backups', async () => {
    const { archive } = await backupWithAttachment()
    const meta = JSON.parse(fs.readFileSync(`${archive}.json`, 'utf8'))
    delete meta.format_version
    delete meta.attachments
    meta.attachments_included = false
    fs.writeFileSync(`${archive}.json`, JSON.stringify(meta))
    const result = await restoreFromArchive({ archivePath: archive, metaPath: `${archive}.json`, targetDbPath: path.join(ctx.dir, 'legacy.db') })
    expect(result.expenses).toBe(1)
    expect(result.attachments).toBe(0)
  })
  it('local success never advances cloud due dates', async () => {
    const { service } = await backupWithAttachment()
    expect(service.nextDueAt('local')).not.toBeNull()
    expect(service.nextDueAt('aliyundrive')).toBeNull()
    expect(service.cooldownUntil('aliyundrive')).toBeNull()
  })
})
