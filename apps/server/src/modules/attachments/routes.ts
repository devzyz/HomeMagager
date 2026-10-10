import fs from 'node:fs'
import path from 'node:path'
import { createReadStream, createWriteStream } from 'node:fs'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { badRequest, notFound } from '../../lib/errors.js'
import { requireAuth } from '../../plugins/hooks.js'
import { uuid } from '../../lib/ids.js'
import { nowIso } from '../../lib/time.js'
import { diskSpace, sanitizeOriginalName } from '../../lib/files.js'
import {
  MAX_CONCURRENT_UPLOADS,
  MAX_FILE_BYTES,
  MAX_PER_EXPENSE,
  MULTIPART_LIMIT_BYTES,
  Semaphore,
  assertDiskSpace,
  detectFileType,
  fileSizeError,
  sweepTmpFiles,
  validateDeclared,
} from './service.js'

interface AttachmentRow {
  id: string
  expense_id: string
  original_name: string
  stored_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

interface MultipartFilePart {
  filename: string
  mimetype: string
  file: NodeJS.ReadableStream
  truncated?: boolean
}

export function publicAttachment(a: AttachmentRow): Record<string, unknown> {
  return {
    id: a.id,
    expense_id: a.expense_id,
    original_name: a.original_name,
    mime_type: a.mime_type,
    size_bytes: a.size_bytes,
    created_at: a.created_at,
  }
}

async function writeStreamToFile(
  req: FastifyRequest,
  tmpPath: string,
): Promise<{ truncated: boolean; size: number; filename: string; mimetype: string }> {
  // 流上限放到 MAX+1：恰好 10 MiB 的合法文件可完整写完，超过必然被截断
  const part = await req.file({ limits: { fileSize: MAX_FILE_BYTES + 1, files: 1 } })
  if (!part) throw badRequest('未找到上传文件，请使用 multipart/form-data 且字段包含一个文件')
  const typed = part as unknown as MultipartFilePart
  const declaredName = typed.filename ?? ''
  const declaredMime = typed.mimetype ?? ''
  validateDeclared(declaredName, declaredMime)

  return await new Promise<{ truncated: boolean; size: number; filename: string; mimetype: string }>((resolve, reject) => {
    let limited = false
    const out = createWriteStream(tmpPath)
    typed.file.on('limit', () => {
      limited = true
    })
    typed.file.on('error', reject)
    out.on('error', reject)
    out.on('finish', () => {
      const busboyTruncated = (typed.file as { truncated?: boolean }).truncated === true
      fs.stat(tmpPath, (err, st) => {
        if (err) reject(err)
        else resolve({ truncated: limited || busboyTruncated, size: st.size, filename: declaredName, mimetype: declaredMime })
      })
    })
    typed.file.pipe(out)
  })
}

export function registerAttachmentRoutes(app: FastifyInstance): void {
  const uploadDir = app.config.uploadDir
  const tmpDir = path.join(uploadDir, 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  sweepTmpFiles(tmpDir)

  const uploadSlots = new Semaphore(MAX_CONCURRENT_UPLOADS)

  const getMeta = (id: string): AttachmentRow | undefined =>
    app.db.prepare('SELECT * FROM expense_attachments WHERE id = ?').get(id) as AttachmentRow | undefined

  app.get('/api/expenses/:id/attachments', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const exists = app.db.prepare('SELECT 1 FROM expenses WHERE id = ?').get(id)
    if (!exists) throw notFound('费用不存在')
    const rows = app.db
      .prepare('SELECT * FROM expense_attachments WHERE expense_id = ? ORDER BY created_at, id')
      .all(id) as AttachmentRow[]
    return { items: rows.map(publicAttachment) }
  })

  app.post(
    '/api/expenses/:id/attachments',
    { preHandler: requireAuth, bodyLimit: MULTIPART_LIMIT_BYTES },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const exists = app.db.prepare('SELECT 1 FROM expenses WHERE id = ?').get(id)
      if (!exists) throw notFound('费用不存在')

      await uploadSlots.acquire()
      let tmpPath: string | null = null
      try {
        const space = await diskSpace(uploadDir)
        assertDiskSpace(space ? space.freeBytes : null)

        tmpPath = path.join(tmpDir, `${uuid()}.part`)
        const { truncated, size, filename, mimetype } = await writeStreamToFile(req, tmpPath)
        if (truncated || size > MAX_FILE_BYTES) throw fileSizeError()

        // 读文件头校验真实类型
        const header = Buffer.alloc(16)
        const fd = fs.openSync(tmpPath, 'r')
        try {
          const read = fs.readSync(fd, header, 0, 16, 0)
          const detected = detectFileType(header.subarray(0, read))
          if (!detected) throw badRequest('文件内容不是有效的 JPEG/PNG/WEBP/PDF', 'UNSUPPORTED_FORMAT')
          validateDeclared(filename, mimetype, detected)

          const storedName = `${uuid()}${detected.ext}`
          const finalPath = path.join(uploadDir, storedName)
          fs.renameSync(tmpPath, tmpPath === finalPath ? tmpPath : finalPath)
          tmpPath = null

          const metaId = uuid()
          const now = nowIso()
          const originalName = sanitizeOriginalName(filename)
          try {
            const tx = app.db.transaction(() => {
              const cnt = app.db
                .prepare('SELECT COUNT(*) AS c FROM expense_attachments WHERE expense_id = ?')
                .get(id) as { c: number }
              if (cnt.c >= MAX_PER_EXPENSE) {
                throw badRequest(`每笔费用最多 ${MAX_PER_EXPENSE} 个附件`, 'ATTACHMENT_LIMIT')
              }
              app.db
                .prepare(
                  'INSERT INTO expense_attachments (id, expense_id, original_name, stored_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                )
                .run(metaId, id, originalName, storedName, detected.mime, size, now)
            })
            tx()
          } catch (err) {
            fs.unlinkSync(finalPath)
            throw err
          }

          const meta = getMeta(metaId) as AttachmentRow
          void reply.code(201)
          return { item: publicAttachment(meta) }
        } finally {
          fs.closeSync(fd)
        }
      } catch (err) {
        if (tmpPath) {
          try {
            fs.unlinkSync(tmpPath)
          } catch {
            // 清理失败忽略
          }
        }
        throw err
      } finally {
        uploadSlots.release()
      }
    },
  )

  app.get('/api/attachments/:id/file', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const meta = getMeta(id)
    if (!meta) throw notFound('附件不存在')
    if (/[/\\]|\.\./.test(meta.stored_name)) throw badRequest('附件标识非法')
    const filePath = path.join(uploadDir, meta.stored_name)
    if (!fs.existsSync(filePath)) {
      throw notFound('附件文件缺失（可能尚未随备份恢复），费用记录不受影响')
    }
    const query = req.query as Record<string, unknown>
    const download = query.download === '1' || meta.mime_type === 'application/pdf'
    const ext = path.extname(meta.stored_name)
    const asciiFallback = `attachment${ext}`
    const encoded = encodeURIComponent(meta.original_name)
    void reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .header(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      )
      .type(meta.mime_type)
    return reply.send(createReadStream(filePath))
  })

  app.delete('/api/attachments/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string }
    const meta = getMeta(id)
    if (!meta) throw notFound('附件不存在')
    const tx = app.db.transaction(() => {
      app.db.prepare('DELETE FROM expense_attachments WHERE id = ?').run(id)
    })
    tx()
    try {
      fs.unlinkSync(path.join(uploadDir, meta.stored_name))
    } catch {
      app.log.warn({ stored_name: meta.stored_name }, 'attachment file cleanup failed')
    }
    return { message: '附件已删除' }
  })
}
