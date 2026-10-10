import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'

export interface AttachmentArtifact {
  stored_name: string
  size_bytes: number
  sha256: string
}

/** Stored attachment names are flat, generated UUID filenames, never user paths. */
export function attachmentPath(dir: string, name: string): string {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/i.test(name)) {
    throw new Error('备份包含非法附件文件名')
  }
  const file = path.join(dir, name)
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('备份附件不能是符号链接')
  return file
}

export async function fileHash(file: string, signal?: AbortSignal): Promise<string> {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), hash, { signal })
  return hash.digest('hex')
}

/** The manifest is the completion marker; upload it last when a cloud provider is added. */
export async function copyAttachments(
  rows: { stored_name: string; size_bytes: number }[], sourceDir: string, targetDir: string, signal: AbortSignal,
): Promise<AttachmentArtifact[]> {
  fs.mkdirSync(targetDir, { recursive: true })
  const artifacts: AttachmentArtifact[] = []
  for (const row of rows) {
    signal.throwIfAborted()
    const source = attachmentPath(sourceDir, row.stored_name)
    const target = attachmentPath(targetDir, row.stored_name)
    await pipeline(fs.createReadStream(source), fs.createWriteStream(target, { flags: 'wx' }), { signal })
    const size = fs.statSync(target).size
    if (size !== row.size_bytes) throw new Error('附件大小与数据库记录不一致，备份已停止')
    artifacts.push({ stored_name: row.stored_name, size_bytes: size, sha256: await fileHash(target, signal) })
  }
  return artifacts
}
