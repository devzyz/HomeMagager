// Real browser smoke check against the AutoDL backend over the local SSH tunnel.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '../..')
const state = path.join(root, 'artifacts/autodl')
const credential = Object.fromEntries(fs.readFileSync(path.join(state, '.env'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
  const i = line.indexOf('=')
  return [line.slice(0, i), line.slice(i + 1)]
}))
const baseURL = credential.BASE_URL
const checks = []
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  const failed = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => failed.push(request.url()))
  const health = await context.request.get('/api/health')
  assert.equal(health.status(), 200)
  assert.deepEqual(await health.json(), { status: 'ok', database: 'ok' })
  checks.push('Remote health and SQLite: OK')
  const anonymous = await context.request.get('/api/shops')
  assert.equal(anonymous.status(), 401)
  checks.push('Anonymous protected API: denied')
  const wrongOrigin = await context.request.post('/api/auth/login', { headers: { Origin: 'https://invalid.example' }, data: { username: credential.USERNAME, password: credential.PASSWORD } })
  assert.equal(wrongOrigin.status(), 403)
  assert.equal((await wrongOrigin.json()).code, 'ORIGIN_REJECTED')
  checks.push('Untrusted Origin: denied')
  await page.goto('/login', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: '家庭费用管理' })).toBeVisible()
  await page.screenshot({ path: path.join(state, 'login.png'), fullPage: true })
  await page.getByPlaceholder('用户名', { exact: true }).fill(credential.USERNAME)
  await page.getByPlaceholder('密码', { exact: true }).fill(credential.PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/settings/profile')
  await expect(page.getByText('首次登录或密码已被重置，请先修改密码后再使用其他功能', { exact: true })).toBeVisible()
  checks.push('Browser login and first-login password change page: OK')
  const me = await context.request.get('/api/auth/me')
  assert.equal(me.status(), 200)
  const session = await me.json()
  assert.equal(session.user.username, credential.USERNAME)
  assert.equal(session.user.must_change_password, true)
  const cookies = await context.cookies()
  assert(cookies.some(cookie => cookie.httpOnly && cookie.sameSite === 'Lax'))
  const gate = await context.request.get('/api/shops')
  assert.equal(gate.status(), 403)
  assert.equal((await gate.json()).code, 'MUST_CHANGE_PASSWORD')
  checks.push('Session cookie and password-change gate: OK')
  await page.screenshot({ path: path.join(state, 'first-login.png'), fullPage: true })
  const logout = await context.request.post('/api/auth/logout', { headers: { Origin: baseURL, 'x-csrf-token': session.csrf_token } })
  assert.equal(logout.status(), 200)
  const loggedOut = await context.request.get('/api/auth/me')
  assert.equal(loggedOut.status(), 401)
  checks.push('Logout invalidates session: OK')
  await page.goto('/login', { waitUntil: 'networkidle' })
  assert.deepEqual(errors, [], 'Unexpected browser JavaScript errors')
  assert.deepEqual(failed, [], 'Unexpected browser request failures')
  checks.push('Browser JavaScript and static assets: OK')
  fs.writeFileSync(path.join(state, 'smoke-result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), baseURL, checks }, null, 2))
  console.log(checks.join('\n'))
} finally {
  await browser.close()
}