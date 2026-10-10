import { expect, test } from '@playwright/test'
import { login, pickSelect } from './helpers'

test.describe('expense flow', () => {
  test('店铺 → 费用录入 → 列表 → Dashboard → 报表 → Excel → 备份', async ({ page }) => {
    await login(page)

    // 1. 新增店铺
    await page.goto('/settings/shops')
    await page.click('button:has-text("新增店铺")')
    await page.locator('.el-dialog input').fill('E2E东门店')
    await page.locator('.el-dialog').getByRole('button', { name: '保存' }).click()
    await expect(page.locator('text=E2E东门店')).toBeVisible()

    // 2. 新增费用（初始类别来自迁移：水费等）
    await page.goto('/expenses/new')
    await pickSelect(page, '店铺', 'E2E东门店')
    await pickSelect(page, '类别', '水费')
    await page.locator('input[placeholder="0.00"]').fill('128.50')
    await page.click('button:has-text("保存费用")')
    await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]+$/, { timeout: 15000 })
    await expect(page.locator('text=¥128.50')).toBeVisible()

    // 3. 列表可见
    await page.goto('/expenses')
    await expect(page.locator('text=128.50').first()).toBeVisible()

    // 4. Dashboard 出现数据
    await page.goto('/dashboard')
    await expect(page.locator('.stat-value').first()).toContainText('¥128.50')

    // 5. 报表页汇总一致
    await page.goto('/reports')
    await expect(page.locator('text=¥128.50').first()).toBeVisible()

    // 6. Excel 下载
    const downloadPromise = page.waitForEvent('download')
    await page.click('button:has-text("导出 Excel")')
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('费用报表.xlsx')

    // 7. 备份页触发真实备份
    await page.goto('/settings/backup')
    await page.click('button:has-text("立即本地备份")')
    await expect(page.locator('.el-tag:has-text("success")').first()).toBeVisible({ timeout: 30000 })
  })

  test('编辑费用与删除确认', async ({ page }) => {
    await login(page)
    await page.goto('/expenses/new')
    await pickSelect(page, '店铺', 'E2E东门店')
    await pickSelect(page, '类别', '电费')
    await page.locator('input[placeholder="0.00"]').fill('66.60')
    await page.click('button:has-text("保存费用")')
    await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]+$/, { timeout: 15000 })

    await page.click('button:has-text("编辑")')
    const amountInput = page.locator('input[placeholder="0.00"]')
    // 等待表单异步加载出原值后再修改，避免加载覆盖输入
    await expect(amountInput).toHaveValue('66.60', { timeout: 15000 })
    await amountInput.fill('77.70')
    await page.click('button:has-text("保存修改")')
    await expect(page.locator('text=¥77.70')).toBeVisible({ timeout: 15000 })

    await page.click('button:has-text("删除")')
    // ElMessageBox 默认聚焦确认按钮，用 Enter 确认（避免遮挡导致的点击拦截）
    await expect(page.locator('.el-message-box')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/expenses/, { timeout: 15000 })
  })
})
