import { test, expect, type Page } from '@playwright/test'
import { login } from './helpers'

async function seed(page: Page) {
  await login(page)
  const me = await (await page.request.get('/api/auth/me')).json()
  const headers = { origin: new URL(page.url()).origin, 'x-csrf-token': me.csrf_token }
  const name = `回归-${crypto.randomUUID()}`
  const created = await page.request.post('/api/shops', { headers, data: { name } })
  expect(created.ok()).toBeTruthy()
  const shop = (await created.json()).item
  const category = (await (await page.request.get('/api/categories')).json()).items[0]
  const saved = await page.request.post('/api/expenses', { headers, data: {
    shop_id: shop.id, category_id: category.id, amount: '12.34', bill_month: '2024-08', paid_date: '2024-08-15', remark: '筛选回归',
  } })
  expect(saved.ok()).toBeTruthy()
  return { shop, category }
}

test('组合筛选贯穿报表、Excel 与打印，未提交关键字不改变导出', async ({ page }) => {
  const { shop, category } = await seed(page)
  const query = new URLSearchParams({ shop: shop.id, category: category.id, bm_from: '2024-08', bm_to: '2024-08', pd_from: '2024-08-01', pd_to: '2024-08-31', kw: '筛选回归' })
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reports')
  await page.goto(`/reports?${query}`)
  expect((await (await loaded).json()).total_amount_cents).toBe(1234)
  await page.getByPlaceholder('备注关键字').fill('未提交的新关键字')
  const exported = page.waitForRequest(r => new URL(r.url()).pathname === '/api/reports/excel')
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click()
  const excelParams = new URL((await exported).url()).searchParams
  expect.soft(excelParams.get('keyword')).toBe('筛选回归')
  const printed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reports/print-data')
  await page.getByRole('button', { name: '打印 / 存 PDF', exact: true }).click()
  const response = await printed
  const params = new URL(response.url()).searchParams
  for (const [key, value] of Object.entries({ shop_id: shop.id, category_id: category.id, bill_month_from: '2024-08', bill_month_to: '2024-08', paid_date_from: '2024-08-01', paid_date_to: '2024-08-31', keyword: '筛选回归' })) {
    expect.soft(params.get(key)).toBe(value)
  }
  const printData = await response.json()
  expect(printData.total_amount_cents).toBe(1234)
  expect(printData.items).toHaveLength(1)
})

test('首页全部与单店铺往返、无数据再恢复后图表可见', async ({ page }) => {
  const { shop } = await seed(page)
  await page.goto('/dashboard?month=2024-08')
  const shopChart = page.locator('.el-card').filter({ hasText: '店铺对比' })
  const pieChart = page.locator('.el-card').filter({ hasText: '类别占比' })
  await expect(shopChart.locator('canvas')).toHaveCount(1)
  await page.locator('.app-header .el-select').click()
  await page.getByRole('option', { name: shop.name, exact: true }).click()
  await expect(shopChart).toHaveCount(0)
  await page.locator('.app-header .el-select').click()
  await page.getByRole('option', { name: '全部店铺', exact: true }).click()
  await expect(shopChart.locator('canvas')).toHaveCount(1)
  const month = page.locator('.dash-toolbar input')
  await month.fill('2024-09')
  await month.press('Enter')
  await expect(pieChart).toContainText('该月暂无数据')
  await month.fill('2024-08')
  await month.press('Enter')
  await expect(pieChart.locator('canvas')).toHaveCount(1)
  await expect(shopChart.locator('canvas')).toHaveCount(1)
})
