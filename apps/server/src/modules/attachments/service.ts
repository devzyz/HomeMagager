import fs from 'node:fs'
import path from 'node:path'
import { badRequest, payloadTooLarge } from '../../lib/errors.js'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PER_EXPENSE = 5
export const MIN_FREE_BYTES = 256 * 1024 * 1024
export const MAX_CONCURRENT_UPLOADS = 2
export const MULTIPART_LIMIT_BYTES = 11 * 1024 * 1024

export type DetectedType = { ext: '.jpg' | '.png' | '.webp' | '.pdf'; mime: string }

/** 文件签名检测：仅凭内容判断真实类型，不信任请求头 */
export function detectFileType(header: Buffer): DetectedType | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' }
  }
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return { ext: '.png', mime: 'image/png' }
  }
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString('latin1') === 'RIFF' &&
    header.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { ext: '.webp', mime: 'image/webp' }
  }
  if (header.length >= 5 && header.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { ext: '.pdf', mime: 'application/pdf' }
  }
  return null
}

export const EXT_WHITELIST = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf'])
export const MIME_WHITELIST = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

export function validateDeclared(filename: string, mimetype: string, detected?: DetectedType): void {
  const ext = path.extname(filename).toLowerCase()
  if (!EXT_WHITELIST.has(ext)) {
    throw badRequest(
      '仅支持 JPEG/PNG/WEBP/PDF 附件；HEIC 等其他格式请先在手机上转换为 JPG/PDF 再上传',
      'UNSUPPORTED_FORMAT',
    )
  }
  if (!MIME_WHITELIST.has(mimetype)) {
    throw badRequest('附件类型不被支持', 'UNSUPPORTED_FORMAT')
  }
  if (detected && (mimetype !== detected.mime || (ext === '.jpeg' ? '.jpg' : ext) !== detected.ext)) {
    throw badRequest('附件扩展名、声明类型与实际文件内容不一致', 'UNSUPPORTED_FORMAT')
  }
}

export function assertDiskSpace(freeBytes: number | null): void {
  if (freeBytes !== null && freeBytes < MIN_FREE_BYTES) {
    throw badRequest('服务器磁盘空间不足，暂时无法上传新附件，请联系管理员清理', 'DISK_FULL')
  }
}

export function fileSizeError(): ReturnType<typeof payloadTooLarge> {
  return payloadTooLarge('单个附件不能超过 10 MiB')
}

export class Semaphore {
  private queue: (() => void)[] = []
  private active = 0

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active++
  }

  release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

/** 清理超过 24 小时的遗留临时文件 */
export function sweepTmpFiles(tmpDir: string): void {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000
    for (const name of fs.readdirSync(tmpDir)) {
      const p = path.join(tmpDir, name)
      try {
        const st = fs.statSync(p)
        if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(p)
      } catch {
        // 单个文件失败不影响其余清理
      }
    }
  } catch {
    // tmp 目录不存在等情况忽略
  }
}
