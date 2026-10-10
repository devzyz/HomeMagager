import { expect, type Page } from '@playwright/test'

export async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.fill('input[placeholder="用户名"]', 'e2e')
  await page.fill('input[placeholder="密码"]', 'e2e-password-123')
  await page.click('button:has-text("登录")')
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 })
}

/** Element Plus 的 el-select 将 placeholder 渲染为 span 而非 input 属性，按表单项标签定位 */
export async function pickSelect(page: Page, label: string, option: string): Promise<void> {
  const item = page.locator('.el-form-item', { hasText: label }).first()
  await item.locator('.el-select__wrapper').first().click()
  await page.locator(`.el-select-dropdown__item:has-text("${option}")`).first().click()
}
