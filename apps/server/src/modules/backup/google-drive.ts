import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { AppConfig } from '../../config.js'

export const ARCHIVE_NAME = /^family-expense-\d{8}-\d{6}-[0-9a-f]{8}\.sqlite\.gz$/
export type RcloneRunner = (args: string[], signal: AbortSignal) => Promise<void>

export interface CloudBackupAdapter {
  configured(): boolean
  remotePath(fileName: string): string
  publish(dir: string, fileName: string, signal: AbortSignal): Promise<string>
  remove(remotePath: string, fileName: string, signal: AbortSignal): Promise<void>
}

/** No shell, no credentials in arguments, and no third-party stderr in public errors. */
export class GoogleDriveBackup implements CloudBackupAdapter {
  constructor(private readonly config: AppConfig, private readonly runner?: RcloneRunner) {}

  configured(): boolean {
    return this.config.googleDriveEnabled && !!this.config.googleDriveConfig && fs.existsSync(this.config.googleDriveConfig)
  }

  remotePath(fileName: string): string {
    if (!ARCHIVE_NAME.test(fileName)) throw new Error('非法云备份组名称')
    return `${this.config.googleDriveRemote}:homeManager/${fileName}`
  }

  private async run(args: string[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (!this.config.googleDriveConfig) throw new Error('Google Drive 尚未配置授权')
    const flags = ['--config', this.config.googleDriveConfig, '--drive-scope=drive.file', '--drive-skip-shortcuts',
      '--retries=2', '--low-level-retries=2', '--timeout=45s', '--contimeout=15s', '--stats=0', '--log-level=ERROR']
    try {
      if (this.runner) await this.runner([...args, ...flags], signal)
      else await new Promise<void>((resolve, reject) => {
        execFile(this.config.rcloneBin, [...args, ...flags], { signal, windowsHide: true, maxBuffer: 1024 * 1024 }, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    } catch {
      if (signal.aborted) throw new Error('Google Drive 备份超时或被中止')
      throw new Error(`Google Drive 操作 ${args[0]} 失败；请检查授权、网络、rclone 配置及剩余空间`)
    }
  }

  async publish(dir: string, fileName: string, signal: AbortSignal): Promise<string> {
    if (!this.configured()) throw new Error('Google Drive 尚未启用或授权文件不存在')
    const remote = this.remotePath(fileName)
    const manifest = `${fileName}.json`
    // The manifest is copied only after database + attachments have been verified.
    await this.run(['mkdir', `${this.config.googleDriveRemote}:homeManager`], signal)
    await this.run(['copy', dir, remote, '--immutable', '--exclude', `/${manifest}`], signal)
    await this.run(['check', dir, remote, '--download', '--exclude', `/${manifest}`], signal)
    await this.run(['copyto', path.join(dir, manifest), `${remote}/${manifest}`, '--immutable'], signal)
    await this.run(['check', dir, remote, '--download'], signal)
    return remote
  }

  async remove(remote: string, fileName: string, signal: AbortSignal): Promise<void> {
    // Never purge a root, an arbitrary path, or a group from a different configured remote.
    if (remote !== this.remotePath(fileName)) throw new Error('拒绝清理不属于当前备份目标的目录')
    await this.run(['purge', remote, '--drive-use-trash=false'], signal)
  }
}
