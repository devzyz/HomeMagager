import { expect, test } from '@playwright/test'
import { login, pickSelect } from './helpers'

test('店铺筛选在首页、费用、报表和设置往返时保持同步', async ({ page }) => {
  await login(page)
  await page.goto('/settings/shops')
  await page.getByRole('button', { name: '新增店铺', exact: true }).click()
  const shopName = `联动测试店铺${Date.now()}`
  await page.locator('.el-dialog input').fill(shopName)
  await page.locator('.el-dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.app-nav').getByText('首页', { exact: true }).click()
  await page.locator('.app-header .el-select').click()
  await page.getByRole('option', { name: shopName, exact: true }).click()
  await expect(page).toHaveURL(/shop=/)
  const shop = new URL(page.url()).searchParams.get('shop')
  expect(shop).toBeTruthy()
  for (const name of ['费用', '报表', '设置', '首页']) {
    await page.locator('.app-nav').getByText(name, { exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(
      ({ 费用: '/expenses', 报表: '/reports', 设置: '/settings/profile', 首页: '/dashboard' } as Record<string, string>)[name],
    )
    if (name !== '设置') {
      await expect(page.locator('.app-header .el-select')).toContainText(shopName)
      expect(new URL(page.url()).searchParams.get('shop')).toBe(shop)
    }
  }
  await page.reload()
  await expect(page.locator('.app-header .el-select')).toContainText(shopName)
  await page.locator('.app-header .el-select').click()
  await page.getByRole('option', { name: '全部店铺', exact: true }).click()
  await expect(page).not.toHaveURL(/shop=/)
  for (const name of ['费用', '报表', '首页']) {
    await page.locator('.app-nav').getByText(name, { exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(
      ({ 费用: '/expenses', 报表: '/reports', 首页: '/dashboard' } as Record<string, string>)[name],
    )
    await expect(page.locator('.app-header .el-select')).toContainText('全部店铺')
    expect(new URL(page.url()).searchParams.has('shop')).toBe(false)
  }
})

test('手机日期筛选面板完整显示且可选择范围', async ({ page }) => {
  await login(page)
  await page.goto('/reports')
  await page.getByPlaceholder('缴费日起', { exact: true }).click()
  const panel = page.locator('.el-date-range-picker:visible')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const firstCalendar = panel.locator('.el-date-range-picker__content').first()
  const days = firstCalendar.locator('td.available:not(.prev-month):not(.next-month)')
  await days.nth(0).click()
  await days.nth(1).click()
  await expect(page).toHaveURL(/pd_from=.*pd_to=/)
})

test('移动端：访问入口验证后恢复草稿，保存成功后清除', async ({ page }) => {
  await login(page)
  await page.goto('/expenses/new')
  await pickSelect(page, '店铺', 'E2E东门店')
  await pickSelect(page, '类别', '水费')
  await page.locator('input[placeholder="0.00"]').fill('12.34')
  await page.route('**/api/expenses', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Verify access</html>' })
    } else await route.continue()
  })
  await page.getByRole('button', { name: '保存费用', exact: true }).click()
  await expect(page.locator('.connection-notice')).toBeVisible()
  await page.getByRole('button', { name: '重新打开', exact: true }).click()
  await expect(page.locator('input[placeholder="0.00"]')).toHaveValue('12.34')
  await page.unroute('**/api/expenses')
  await page.getByRole('button', { name: '保存费用', exact: true }).click()
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]+$/)
  await page.goto('/expenses/new')
  await expect(page.locator('input[placeholder="0.00"]')).toHaveValue('')
})

test('移动端视口：登录 → 新增费用 → 卡片列表', async ({ page }) => {
  await login(page)

  await page.goto('/expenses/new')
  await pickSelect(page, '店铺', 'E2E东门店')
  await pickSelect(page, '类别', '水费')
  await page.locator('input[placeholder="0.00"]').fill('9.90')
  await page.click('button:has-text("保存费用")')
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]+$/, { timeout: 15000 })

  await page.goto('/expenses')
  await expect(page.locator('text=9.90').first()).toBeVisible()
  // 底部导航可达
  for (const label of ['首页', '费用', '报表', '设置']) {
    await expect(page.locator('.app-nav').getByText(label, { exact: true })).toBeVisible()
  }
})
