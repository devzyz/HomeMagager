import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, createTestApp, insertUser, ORIGIN, type TestCtx } from './helpers.js'

let ctx: TestCtx
afterEach(() => { if (ctx) cleanup(ctx) })

const credentials = { username: 'alice', password: 'correct-password-123' }
async function request(username: string, password: string) {
  return ctx.app.inject({
    method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN },
    payload: { username, password },
  })
}

describe('concurrent login throttling', () => {
  it.each(['alice', 'missing-user'])('limits concurrent failures for %s to five verifications', async (username) => {
    ctx = await createTestApp()
    await insertUser(ctx.db, credentials)
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(username, 'wrong-password-123')))
    expect(responses.filter((r) => r.statusCode === 401)).toHaveLength(5)
    expect(responses.filter((r) => r.statusCode === 429)).toHaveLength(3)
    expect((await request(username, 'wrong-password-123')).statusCode).toBe(429)
  })

  it('limits concurrent failures across accounts to thirty for the same IP', async () => {
    ctx = await createTestApp()
    const responses = await Promise.all(Array.from({ length: 40 }, (_, i) => request(`missing-${i}`, 'wrong-password-123')))
    expect(responses.filter((r) => r.statusCode === 401)).toHaveLength(30)
    expect(responses.filter((r) => r.statusCode === 429)).toHaveLength(10)
  })

  it('releases in-flight slots after successful password verification', async () => {
    ctx = await createTestApp()
    await insertUser(ctx.db, credentials)
    for (let batch = 0; batch < 2; batch++) {
      const responses = await Promise.all(Array.from({ length: 5 }, () => request(credentials.username, credentials.password)))
      expect(responses.every((r) => r.statusCode === 200)).toBe(true)
    }
    expect((await request(credentials.username, credentials.password)).statusCode).toBe(200)
  })
})