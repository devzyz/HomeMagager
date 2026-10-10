// Run only login throttling and first-visit confirmation regressions from Windows.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { makeHarness, readEnv, status, multipart } from './remote-http-client.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const fixtureDir = path.resolve(root, process.argv[2] || 'artifacts/autodl/remote-tests/rtmv15cege152e')
const previous = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'results.json'), 'utf8'))
const test = readEnv(path.join(fixtureDir, 'test-user.env'))
const credential = readEnv(process.env.HM_REMOTE_ENV || path.join(root, 'artifacts/autodl/.env'))
const marker = 'fix-' + crypto.randomBytes(6).toString('hex')
const dir = path.join(root, 'artifacts/autodl/fix-tests', marker)
fs.mkdirSync(dir, { recursive: true })
const h = makeHarness(credential.BASE_URL, dir)
h.secrets.add(credential.PASSWORD)
h.secrets.add(test.PASSWORD)
const admin = h.client(), user = h.client(), anon = h.client()
const expenses = new Set()
let target, shop, category, browser
const restore = []
try {
  await admin.login(credential.USERNAME, credential.PASSWORD)
  target = status(await admin.request('GET', '/api/users'), 200).items.find((x) => x.username === test.USERNAME)
  shop = status(await admin.request('GET', '/api/shops'), 200).items.find((x) => x.name.startsWith(previous.testPrefix) && x.name.includes('-shops-0'))
  category = status(await admin.request('GET', '/api/categories'), 200).items.find((x) => x.name.startsWith(previous.testPrefix) && x.name.includes('-categories-0'))
  assert(target && shop && category, 'Existing isolated test fixtures are required')
  restore.push(['users', target.id, target.is_active], ['shops', shop.id, shop.is_active], ['categories', category.id, category.is_active])
  status(await admin.request('PATCH', `/api/users/${target.id}/active`, { is_active: true, operator_password: credential.PASSWORD }), 200)
  for (const [kind, item] of [['shops', shop], ['categories', category]]) status(await admin.request('PATCH', `/api/${kind}/${item.id}/active`, { is_active: true }), 200)
  await user.login(test.USERNAME, test.PASSWORD)
  const png = fs.readFileSync(path.join(root, 'artifacts/autodl/test-fixtures/receipt.png'))
  browser = await chromium.launch({ headless: true })
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const label = viewport.width === 1280 ? 'desktop' : 'mobile'
    const item = status(await user.request('POST', '/api/expenses', {
      shop_id: shop.id, category_id: category.id, amount: '1.00', bill_month: '2026-08', paid_date: '2026-08-20', remark: marker + '-' + label,
    }), 201).item
    expenses.add(item.id)
    const attachment = status(await user.request('POST', `/api/expenses/${item.id}/attachments`, multipart(png, 'receipt.png', 'image/png')), 201).item
    const context = await browser.newContext({ baseURL: credential.BASE_URL, viewport })
    const page = await context.newPage()
    try {
      await page.goto('/login')
      await page.getByPlaceholder('用户名', { exact: true }).fill(test.USERNAME)
      await page.getByPlaceholder('密码', { exact: true }).fill(test.PASSWORD)
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.waitForURL('**/dashboard')
      await page.goto('/expenses/' + item.id, { waitUntil: 'networkidle' })
      await h.check(`${label}: first-visit confirmation can be cancelled by mouse`, async () => {
        await page.getByRole('button', { name: '删除', exact: true }).first().click()
        const box = page.locator('.el-message-box')
        await expect(box).toBeVisible()
        await page.screenshot({ path: path.join(dir, label + '-confirm.png'), fullPage: false })
        await box.getByRole('button', { name: '取消', exact: true }).click({ timeout: 5000 })
        await expect(box).not.toBeVisible()
        status(await user.request('GET', '/api/expenses/' + item.id), 200)
      })
      await h.check(`${label}: attachment confirmation deletes by mouse`, async () => {
        // Start with a fresh document so no settings/payroll route supplies CSS.
        await page.goto('/expenses/' + item.id, { waitUntil: 'networkidle' })
        await page.getByRole('button', { name: '删除', exact: true }).nth(1).click()
        const box = page.locator('.el-message-box')
        await expect(box).toBeVisible()
        await box.getByRole('button', { name: '删除', exact: true }).click({ timeout: 5000 })
        await expect(box).not.toBeVisible()
        await expect(page.getByText('receipt.png', { exact: true })).toHaveCount(0)
        status(await user.request('GET', `/api/attachments/${attachment.id}/file`), 404)
      })
      await h.check(`${label}: expense confirmation deletes by mouse`, async () => {
        await page.goto('/expenses/' + item.id, { waitUntil: 'networkidle' })
        await page.getByRole('button', { name: '删除', exact: true }).first().click()
        const box = page.locator('.el-message-box')
        await expect(box).toBeVisible()
        await box.getByRole('button', { name: '删除', exact: true }).click({ timeout: 5000 })
        await page.waitForURL(/\/expenses(?:\?|$)/)
        status(await user.request('GET', '/api/expenses/' + item.id), 404)
        expenses.delete(item.id)
      })
    } finally {
      await context.close()
    }
  }
  for (const username of [test.USERNAME, marker + '-missing']) {
    await h.check(`login: concurrent failures limited for ${username === test.USERNAME ? 'existing' : 'missing'} account`, async () => {
      const responses = await Promise.all(Array.from({ length: 8 }, () => anon.request('POST', '/api/auth/login', { username, password: 'wrong-password-' + marker })))
      assert.equal(responses.filter((r) => r.status === 401).length, 5)
      assert.equal(responses.filter((r) => r.status === 429).length, 3)
      status(await anon.request('POST', '/api/auth/login', { username, password: 'wrong-password-' + marker }), 429, 'RATE_LIMITED')
    })
  }
} catch (error) {
  h.results.push({ name: 'targeted test setup', status: 'failed', error: h.sanitize(error.message) })
  console.log('FAIL targeted setup: ' + h.sanitize(error.message))
} finally {
  if (browser) await browser.close()
  for (const id of expenses) {
    try { const res = await admin.request('DELETE', '/api/expenses/' + id); assert([200, 404].includes(res.status)); h.cleanups.push({ kind: 'expense', id, status: 'deleted' }) }
    catch (e) { h.cleanups.push({ kind: 'expense', id, status: 'failed', error: h.sanitize(e.message) }) }
  }
  for (const [kind, id, active] of restore) {
    try { status(await admin.request('PATCH', `/api/${kind}/${id}/active`, { is_active: active, ...(kind === 'users' ? { operator_password: credential.PASSWORD } : {}) }), 200); h.cleanups.push({ kind, id, status: 'restored' }) }
    catch (e) { h.cleanups.push({ kind, id, status: 'failed', error: h.sanitize(e.message) }) }
  }
  try { status(await admin.request('POST', '/api/auth/logout'), 200) } catch { /* cleanup only */ }
  const report = h.save({ scope: 'Only concurrent login throttling and first-visit mouse confirmations' })
  const failed = report.results.filter((r) => r.status === 'failed')
  const summary = { directory: dir, passed: report.results.length - failed.length, failed: failed.length, cleanupFailures: report.cleanups.filter((r) => r.status === 'failed').length }
  fs.writeFileSync(path.join(root, 'artifacts/autodl/fix-tests/latest.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
  process.exitCode = failed.length || summary.cleanupFailures ? 1 : 0
}