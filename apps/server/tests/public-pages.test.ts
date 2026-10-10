import { afterEach, expect, it } from 'vitest'
import { createTestApp, cleanup, type TestCtx } from './helpers.js'
let ctx: TestCtx
afterEach(() => { if (ctx) cleanup(ctx) })
it('public introduction and privacy policy work without login while business APIs remain protected', async () => {
  ctx = await createTestApp()
  for (const url of ['/privacy', '/about']) {
    const res = await ctx.app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('HomeManager')
    expect(res.body).toContain('Google Drive')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
  }
  expect((await ctx.app.inject({ method: 'GET', url: '/api/backup/status' })).statusCode).toBe(401)
  expect((await ctx.app.inject({ method: 'GET', url: '/api/expenses' })).statusCode).toBe(401)
})
