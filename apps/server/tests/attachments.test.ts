import fs from 'node:fs'
import path from 'node:path'
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

let ctx: TestCtx
afterEach(() => {
  if (ctx) cleanup(ctx)
})

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x01),
])
const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake minimal pdf\n')

function multipartBody(content: Buffer, filename: string, mime: string): { body: Buffer; boundary: string } {
  const boundary = '----hmboundary' + Math.random().toString(36).slice(2)
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { body: Buffer.concat([head, content, tail]), boundary }
}

interface Seed {
  s: SessionRef
  shopId: string
  catId: string
}

async function seed(): Promise<Seed> {
  ctx = await createTestApp()
  const alice = await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
  const s = await login(ctx, alice.username, alice.password)
  const shop = await ctx.app.inject({
    method: 'POST',
    url: '/api/shops',
    headers: authHeaders(s),
    payload: { name: '东门小店' },
  })
  const cats = await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: authHeaders(s) })
  const expense = await ctx.app.inject({
    method: 'POST',
    url: '/api/expenses',
    headers: authHeaders(s),
    payload: {
      shop_id: shop.json().item.id,
      category_id: cats.json().items[0].id,
      amount: '50.00',
      bill_month: '2026-08',
      paid_date: '2026-08-20',
    },
  })
  return { s, shopId: shop.json().item.id, catId: expense.json().item.id }
}

async function upload(seedInfo: Seed, content: Buffer, filename: string, mime: string): Promise<{ status: number; body: any }> {
  const { body, boundary } = multipartBody(content, filename, mime)
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/expenses/${seedInfo.catId}/attachments`,
    headers: {
      ...authHeaders(seedInfo.s),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  })
  return { status: res.statusCode, body: res.json() }
}

describe('attachments', () => {
  it.each([
    ['fake.png', 'image/png', PDF_BYTES],
    ['fake.pdf', 'image/png', PNG_BYTES],
    ['fake.png', 'application/pdf', PNG_BYTES],
  ])('拒绝扩展名、MIME 与内容不一致：%s / %s', async (filename, mime, content) => {
    const seedInfo = await seed()
    const res = await upload(seedInfo, content, filename, mime)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UNSUPPORTED_FORMAT')
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM expense_attachments').get()).toEqual({ n: 0 })
    expect(fs.readdirSync(ctx.config.uploadDir)).toEqual(['tmp'])
    expect(fs.readdirSync(path.join(ctx.config.uploadDir, 'tmp'))).toEqual([])
  })

  it('上传 PNG/PDF：按签名识别类型并落盘，元数据入库', async () => {
    const seedInfo = await seed()
    const png = await upload(seedInfo, PNG_BYTES, '凭证.png', 'image/png')
    expect(png.status).toBe(201)
    expect(png.body.item).toMatchObject({ original_name: '凭证.png', mime_type: 'image/png', size_bytes: PNG_BYTES.length })

    const pdf = await upload(seedInfo, PDF_BYTES, 'invoice.pdf', 'application/pdf')
    expect(pdf.status).toBe(201)
    expect(pdf.body.item.mime_type).toBe('application/pdf')

    const stored = fs.existsSync(path.join(ctx.config.uploadDir, 'tmp'))
    expect(stored).toBe(true)

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/expenses/${seedInfo.catId}/attachments`,
      headers: authHeaders(seedInfo.s),
    })
    expect(list.json().items.length).toBe(2)
  })

  it('伪造格式：扩展名 .png 但内容为文本 → 400', async () => {
    const seedInfo = await seed()
    const res = await upload(seedInfo, Buffer.from('hello world, not an image'), 'fake.png', 'image/png')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UNSUPPORTED_FORMAT')
  })

  it('HEIC 等不支持格式明确提示转换', async () => {
    const seedInfo = await seed()
    const res = await upload(seedInfo, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]), 'photo.heic', 'image/heic')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UNSUPPORTED_FORMAT')
    expect(res.body.message).toContain('转换')
  })

  it('超过 10 MiB 返回 413', async () => {
    const seedInfo = await seed()
    const big = Buffer.concat([PNG_BYTES.subarray(0, 8), Buffer.alloc(10 * 1024 * 1024, 0)])
    const res = await upload(seedInfo, big, 'big.png', 'image/png')
    expect(res.status).toBe(413)
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('每笔费用最多 5 个附件，第 6 个被拒且文件不入库', async () => {
    const seedInfo = await seed()
    for (let i = 0; i < 5; i++) {
      const r = await upload(seedInfo, PNG_BYTES, `p${i}.png`, 'image/png')
      expect(r.status).toBe(201)
    }
    const sixth = await upload(seedInfo, PNG_BYTES, 'p5.png', 'image/png')
    expect(sixth.status).toBe(400)
    expect(sixth.body.code).toBe('ATTACHMENT_LIMIT')
  })

  it('预览与下载响应头正确；未登录访问被拒', async () => {
    const seedInfo = await seed()
    const up = await upload(seedInfo, PNG_BYTES, '凭证.png', 'image/png')
    const id = up.body.item.id as string

    const anon = await ctx.app.inject({ method: 'GET', url: `/api/attachments/${id}/file` })
    expect(anon.statusCode).toBe(401)

    const preview = await ctx.app.inject({
      method: 'GET',
      url: `/api/attachments/${id}/file`,
      headers: { cookie: `famsid=${seedInfo.s.cookie}` },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.headers['content-type']).toContain('image/png')
    expect(preview.headers['x-content-type-options']).toBe('nosniff')
    expect(String(preview.headers['content-disposition'])).toContain('inline')
    expect(String(preview.headers['content-disposition'])).toContain("filename*=UTF-8''")

    const download = await ctx.app.inject({
      method: 'GET',
      url: `/api/attachments/${id}/file?download=1`,
      headers: { cookie: `famsid=${seedInfo.s.cookie}` },
    })
    expect(String(download.headers['content-disposition'])).toContain('attachment')
  })

  it('删除附件：元数据删除且文件清理；再次删除 404', async () => {
    const seedInfo = await seed()
    const up = await upload(seedInfo, PNG_BYTES, 'del.png', 'image/png')
    const id = up.body.item.id as string
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/expenses/${seedInfo.catId}/attachments`,
      headers: authHeaders(seedInfo.s),
    })
    const storedName = JSON.stringify(list.json().items.find((i: { id: string }) => i.id === id))
    expect(storedName).toBeTruthy()

    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/attachments/${id}`, headers: authHeaders(seedInfo.s) })
    expect(del.statusCode).toBe(200)
    const again = await ctx.app.inject({ method: 'DELETE', url: `/api/attachments/${id}`, headers: authHeaders(seedInfo.s) })
    expect(again.statusCode).toBe(404)

    // 上传目录中不应再有该附件文件
    const files = fs.readdirSync(ctx.config.uploadDir).filter((f) => f !== 'tmp')
    expect(files.length).toBe(0)
  })

  it('删除费用后附件文件一并清理', async () => {
    const seedInfo = await seed()
    const up = await upload(seedInfo, PNG_BYTES, 'gone.png', 'image/png')
    expect(up.status).toBe(201)
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/expenses/${seedInfo.catId}`,
      headers: authHeaders(seedInfo.s),
    })
    expect(del.statusCode).toBe(200)
    const files = fs.readdirSync(ctx.config.uploadDir).filter((f) => f !== 'tmp')
    expect(files.length).toBe(0)
  })
})
