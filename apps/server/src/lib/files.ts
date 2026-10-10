import fs from 'node:fs'
import path from 'node:path'

/** 静默删除文件（记录到调用方日志体系之外也可接受）；永不抛出 */
export function fsUnlinkQuiet(dir: string, name: string): void {
  try {
    fs.unlinkSync(path.join(dir, name))
  } catch {
    // 文件清理失败不影响主流程；由孤立文件检查命令兜底
  }
}

export function sanitizeOriginalName(input: string | undefined): string {
  const base = path.basename(input ?? '').replace(/[\x00-\x1f\x7f]/g, '')
  const name = base.trim() || 'file'
  return [...name].length > 255 ? [...name].slice(0, 255).join('') : name
}

export interface DiskSpace {
  freeBytes: number
  totalBytes: number
}

export async function diskSpace(dir: string): Promise<DiskSpace | null> {
  try {
    const s = await fs.promises.statfs(dir)
    return { freeBytes: s.bsize * s.bavail, totalBytes: s.bsize * s.blocks }
  } catch {
    return null
  }
}
