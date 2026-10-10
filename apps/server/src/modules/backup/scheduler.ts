import type { BackupService } from './service.js'

/**
 * 备份调度：启动完成后先检查一次，此后每分钟检查一次。
 * 本地按间隔执行；Google Drive 按周日北京时间 03:00 执行，并补执行本周漏掉的任务。
 */
export function startBackupScheduler(backup: BackupService, onError?: (err: unknown) => void): () => void {
  const check = (): void => {
    void backup.checkAndRunScheduled().catch((err) => {
      onError?.(err)
    })
  }
  const initial = setTimeout(check, 5000)
  initial.unref()
  const timer = setInterval(check, 60_000)
  timer.unref()
  return () => { clearTimeout(initial); clearInterval(timer) }
}
