import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, setConnectionHandler, setUnauthorizedHandler } from '../../web/src/api/client.js'

afterEach(() => { vi.unstubAllGlobals(); setConnectionHandler(null); setUnauthorizedHandler(null) })

describe('API gateway responses', () => {
  it('rejects HTML login pages instead of accepting null data', async () => {
    const notice = vi.fn()
    setConnectionHandler(notice)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } })))
    await expect(api.get('/expenses')).rejects.toMatchObject({ code: 'ACCESS_REVALIDATION_REQUIRED' })
    expect(notice).toHaveBeenCalledOnce()
  })
  it('offers re-opening on network or cross-origin authentication failure', async () => {
    const notice = vi.fn()
    setConnectionHandler(notice)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.get('/expenses')).rejects.toMatchObject({ code: 'NETWORK' })
    expect(notice).toHaveBeenCalledOnce()
  })
  it('retains application 401 handling', async () => {
    const unauthorized = vi.fn()
    setUnauthorizedHandler(unauthorized)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'UNAUTHORIZED' }, { status: 401 })))
    await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledOnce()
  })
  it('rejects a malformed successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('broken')))
    await expect(api.get('/expenses')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
