import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, cleanup, type TestCtx } from './helpers.js'
import { BackupService, mostRecentDriveSlot } from '../src/modules/backup/service.js'
import { GoogleDriveBackup, type CloudBackupAdapter } from '../src/modules/backup/google-drive.js'

let ctx: TestCtx
let calls: string[][]
afterEach(() => { vi.useRealTimers(); if (ctx) cleanup(ctx) })
async function setup() {
  ctx = await createTestApp()
  ctx.config.googleDriveEnabled = true
  ctx.config.googleDriveConfig = path.join(ctx.dir, 'rclone.conf')
  fs.writeFileSync(ctx.config.googleDriveConfig, '[homemanager]\ntype = drive\n')
  calls = []
  return new GoogleDriveBackup(ctx.config, async (args) => { calls.push(args) })
}

class FileCloud implements CloudBackupAdapter {
  fail = false
  removed: string[] = []
  constructor(readonly dir: string) { fs.mkdirSync(dir) }
  configured() { return true }
  remotePath(name: string) { return `homemanager:homeManager/${name}` }
  async publish(dir: string, name: string) {
    if (this.fail) throw new Error('Google Drive 上传校验失败')
    fs.cpSync(dir, path.join(this.dir, name), { recursive: true })
    return this.remotePath(name)
  }
  async remove(remote: string, name: string) {
    expect(remote).toBe(this.remotePath(name))
    this.removed.push(name)
    fs.rmSync(path.join(this.dir, name), { recursive: true, force: true })
  }
}

describe('Google Drive backup', () => {
  it('uploads the completion manifest after verifying payload, then verifies the complete group', async () => {
    const adapter = await setup()
    const name = 'family-expense-20261010-030000-1234abcd.sqlite.gz'
    await adapter.publish(ctx.dir, name, AbortSignal.timeout(10000))
    expect(calls.map((c) => c[0])).toEqual(['mkdir', 'copy', 'check', 'copyto', 'check'])
    expect(calls[2]).toContain('--download')
    expect(calls[2]).toContain(`/${name}.json`)
    expect(calls[3][2]).toBe(`homemanager:homeManager/${name}/${name}.json`)
    expect(calls[4]).toContain('--download')
    expect(calls[4]).not.toContain('--exclude')
    expect(calls.every((c) => c.includes('--drive-scope=drive.file'))).toBe(true)
  })
  it('verification failure never uploads the completion marker and does not reveal stderr credentials', async () => {
    await setup()
    const adapter = new GoogleDriveBackup(ctx.config, async (args) => {
      calls.push(args)
      if (args[0] === 'check') throw new Error('refresh_token=SECRET access_token=SECRET')
    })
    await expect(adapter.publish(ctx.dir, 'family-expense-20261010-030000-1234abcd.sqlite.gz', AbortSignal.timeout(10000))).rejects.toThrow('Google Drive 操作 check 失败')
    expect(calls.map((c) => c[0])).toEqual(['mkdir', 'copy', 'check'])
  })
  it('refuses root or foreign directory deletion; only permanently deletes its exact recorded group', async () => {
    const adapter = await setup()
    const name = 'family-expense-20261010-030000-1234abcd.sqlite.gz'
    await expect(adapter.remove('homemanager:homeManager', name, AbortSignal.timeout(10000))).rejects.toThrow('拒绝清理')
    expect(calls).toHaveLength(0)
    await adapter.remove(adapter.remotePath(name), name, AbortSignal.timeout(10000))
    expect(calls[0].slice(0, 3)).toEqual(['purge', adapter.remotePath(name), '--drive-use-trash=false'])
  })
  it('keeps five successful groups and preserves old backups on failure, independently of local retention', async () => {
    await setup()
    const cloud = new FileCloud(path.join(ctx.dir, 'fake-drive'))
    const service = new BackupService(ctx.db, ctx.config, cloud)
    const local = service.trigger('local', 'manual')
    await service.waitForRun(local.runId)
    const localAt = service.latestRun('local', 'success')!.started_at
    for (let i = 0; i < 7; i++) {
      const { runId } = service.trigger('googledrive', 'manual')
      await service.waitForRun(runId)
      expect(service.getRun(runId)?.status).toBe('success')
    }
    expect(fs.readdirSync(cloud.dir)).toHaveLength(5)
    expect(cloud.removed).toHaveLength(2)
    expect(service.latestRun('local', 'success')!.started_at).toBe(localAt)
    const before = fs.readdirSync(cloud.dir).sort()
    cloud.fail = true
    const failed = service.trigger('googledrive', 'manual')
    await service.waitForRun(failed.runId)
    expect(service.getRun(failed.runId)?.status).toBe('failed')
    expect(fs.readdirSync(cloud.dir).sort()).toEqual(before)
    expect(service.cooldownUntil('googledrive')).not.toBeNull()
    expect(fs.readdirSync(path.join(ctx.config.backupDir, 'tmp'))).toHaveLength(0)
  })
  it('cloud cleanup failure keeps a verified new group successful and retains older groups', async () => {
    await setup()
    ctx.config.googleDriveKeep = 1
    const cloud = new FileCloud(path.join(ctx.dir, 'fake-drive'))
    const service = new BackupService(ctx.db, ctx.config, cloud)
    const first = service.trigger('googledrive', 'manual')
    await service.waitForRun(first.runId)
    vi.spyOn(cloud, 'remove').mockRejectedValue(new Error('network down'))
    const second = service.trigger('googledrive', 'manual')
    await service.waitForRun(second.runId)
    expect(service.getRun(second.runId)).toMatchObject({ status: 'success', error_message: expect.stringContaining('旧云备份清理未完成') })
    expect(fs.readdirSync(cloud.dir)).toHaveLength(2)
  })
  it('Sunday 03:00 is based on Shanghai, and local success does not suppress due cloud backup', async () => {
    await setup()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T18:59:59Z'))
    const cloud = new FileCloud(path.join(ctx.dir, 'fake-drive'))
    const service = new BackupService(ctx.db, ctx.config, cloud)
    const first = service.trigger('googledrive', 'manual')
    await service.waitForRun(first.runId)
    const local = service.trigger('local', 'manual')
    await service.waitForRun(local.runId)
    expect(service.nextDueAt('googledrive')).toBe('2026-10-10T19:00:00.000Z')
    expect(await service.checkAndRunScheduled()).toBe(false)
    vi.setSystemTime(new Date('2026-10-10T19:00:01Z'))
    expect(await service.checkAndRunScheduled()).toBe(true)
    expect(fs.readdirSync(cloud.dir)).toHaveLength(2)
    expect(service.nextDueAt('googledrive')).toBe('2026-10-17T19:00:00.000Z')
    expect(mostRecentDriveSlot(new Date('2026-10-10T18:59:59Z').getTime())).toBe(new Date('2026-10-03T19:00:00Z').getTime())
  })
})
