import { expect, test } from '@playwright/test'
import { login } from './helpers'

test.describe('auth', () => {
  test('未登录跳转登录页；错误密码有提示；登录成功进入 Dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/login/)

    await page.fill('input[placeholder="用户名"]', 'e2e')
    await page.fill('input[placeholder="密码"]', 'wrong-password-xyz')
    await page.click('button:has-text("登录")')
    await expect(page.locator('.el-message--error')).toBeVisible({ timeout: 15000 })

    await login(page)
    await expect(page.locator('text=本月合计')).toBeVisible()
  })

  test('修改显示名与退出登录', async ({ page }) => {
    await login(page)
    await page.goto('/settings/profile')
    const nameInput = page.locator('.el-card', { hasText: '账号信息' }).locator('input').first()
    await nameInput.fill('E2E改名')
    await page.click('button:has-text("保存")')
    await expect(page.locator('.el-message--success')).toBeVisible()
    await expect(nameInput).toHaveValue('E2E改名')

    await page.click('button:has-text("退出登录")')
    await expect(page).toHaveURL(/login/, { timeout: 15000 })
  })
})
