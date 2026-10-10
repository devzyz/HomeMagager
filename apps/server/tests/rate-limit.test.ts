import { it, expect } from 'vitest'
import { createTestApp, cleanup } from './helpers.js'

it('API throttling does not prevent the page shell from loading', async () => {
  const ctx = await createTestApp()
  ctx.app.get('/validation-static.js', async () => '/* static asset */')
  try {
    for (let i = 0; i < 1000; i++) await ctx.app.inject('/api/health')
    expect((await ctx.app.inject('/api/health')).statusCode).toBe(429)
    expect((await ctx.app.inject('/validation-static.js')).statusCode).toBe(200)
  } finally { cleanup(ctx) }
})
