import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('deployment configuration', () => {
  it('defaults to loopback with untrusted forwarded headers', () => {
    expect(loadConfig({ NODE_ENV: 'test' })).toMatchObject({ host: '127.0.0.1', trustProxy: false, aliyunDriveEnabled: false })
  })
  it('normalizes the production origin and only trusts the local proxy', () => {
    const config = loadConfig({ NODE_ENV: 'production', BASE_URL: 'https://HOME.example.com:443/', SESSION_SECRET: 'a'.repeat(64), TRUST_PROXY: 'loopback' })
    expect(config.baseUrl).toBe('https://home.example.com')
    expect(config.allowedOrigins).toEqual(['https://home.example.com'])
    expect(config.trustProxy).toBe('loopback')
  })
  it.each(['https://example.com/path', 'https://user:pass@example.com', 'https://example.com/?x=1', 'https://example.com/#x', 'file:///tmp'])('rejects invalid origin %s', (url) => {
    expect(() => loadConfig({ BASE_URL: url })).toThrow()
  })
  it('refuses blanket proxy trust', () => {
    expect(() => loadConfig({ TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/)
  })
  it('requires HTTPS and secrets in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/)
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64), BASE_URL: 'http://localhost:3000' })).toThrow(/HTTPS/)
  })
})
