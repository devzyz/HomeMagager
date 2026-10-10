import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { badRequest } from '../../lib/errors.js'
import { parseWith } from '../../lib/validate.js'
import { pagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/hooks.js'
import type { BackupService, BackupRunRow } from './service.js'

const TriggerBody = Type.Object({ provider: Type.Union([Type.Literal('local'), Type.Literal('aliyundrive'), Type.Literal('googledrive')]) })

function publicRun(r: BackupRunRow): Record<string, unknown> {
  return {
    id: r.id,
    provider: r.provider,
    trigger_type: r.trigger_type,
    status: r.status,
    started_at: r.started_at,
    finished_at: r.finished_at,
    snapshot_at: r.snapshot_at,
    file_name: r.file_name,
    size_bytes: r.size_bytes,
    error_message: r.error_message,
  }
}

export function registerBackupRoutes(app: FastifyInstance, backup: BackupService): void {
  app.get('/api/backup/status', { preHandler: requireAuth }, async () => {
    const running = backup.isRunning()
    const lastSuccess = backup.latestRun('local', 'success')
    const lastRun = backup.latestRun('local')
    return {
      running,
      current_run_id: backup.currentRun,
      local: {
        interval_days: app.config.backupIntervalDays,
        keep: app.config.localBackupKeep,
        attachments_included: true,
        last_success_at: lastSuccess?.started_at ?? null,
        last_file_name: lastSuccess?.file_name ?? null,
        last_size_bytes: lastSuccess?.size_bytes ?? null,
      },
      cloud: {
        provider: 'googledrive',
        enabled: backup.cloudConfigured(),
        state: backup.cloudConfigured() ? 'ready' : app.config.googleDriveEnabled ? 'credentials_missing' : 'disabled',
        reason: backup.cloudConfigured() ? 'Google Drive 已配置；实际上传结果以备份历史为准' : 'Google Drive 尚未启用或尚未完成首次授权；本地备份可正常使用',
        keep: app.config.googleDriveKeep,
        schedule: '每周日北京时间 03:00',
        directory: '/homeManager/',
        next_due_at: backup.cloudConfigured() ? backup.nextDueAt('googledrive') : null,
        cooldown_until: backup.cooldownUntil('googledrive'),
        last_success_at: backup.latestRun('googledrive', 'success')?.finished_at ?? null,
        last_run: backup.latestRun('googledrive') ? publicRun(backup.latestRun('googledrive')!) : null,
      },
      next_due_at: backup.nextDueAt(),
      cooldown_until: backup.cooldownUntil(),
      last_run: lastRun ? publicRun(lastRun) : null,
    }
  })

  app.get('/api/backup/runs', { preHandler: requireAuth }, async (req) => {
    const { page, pageSize } = pagination(req.query)
    const total = (app.db.prepare('SELECT COUNT(*) AS c FROM backup_runs').get() as { c: number }).c
    const rows = app.db
      .prepare('SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize) as BackupRunRow[]
    return { items: rows.map(publicRun), total, page, page_size: pageSize }
  })

  app.post('/api/backup/runs', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseWith(TriggerBody, req.body)
    if (body.provider === 'aliyundrive') {
      throw badRequest('云端备份（阿里云盘）本开发版未接入，暂无法执行', 'CLOUD_NOT_CONFIGURED')
    }
    if (body.provider === 'googledrive' && !backup.cloudConfigured()) {
      throw badRequest('Google Drive 尚未启用或尚未完成首次授权', 'CLOUD_NOT_CONFIGURED')
    }
    const { runId, alreadyRunning } = backup.trigger(body.provider, 'manual')
    void reply.code(alreadyRunning ? 200 : 202)
    return { job_id: runId, status: 'running', already_running: alreadyRunning }
  })
}
