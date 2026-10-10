// Drive a local Chromium browser against the already-deployed remote app; no mocks.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium,expect,devices } from '@playwright/test'
import { status,routes } from './remote-http-client.mjs'

export async function browserChecks(h,state,api,png) {
  const browser=await chromium.launch({headless:true})
  const contexts=[]
  const errors=[],failed=[],serverErrors=[]
  function watch(page,label) {
    page.on('pageerror',e=>errors.push({label,error:h.sanitize(e.message)}))
    page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')failed.push({label,url:r.url(),error:r.failure()?.errorText})})
    page.on('response',async res=>{
      const request=res.request(),url=new URL(res.url()),timing=request.timing()
      const route=routes.find(([method,pattern])=>method===request.method()&&new RegExp('^'+pattern.replace(/:[a-z_]+/g,'[^/]+')+'$').test(url.pathname))
      h.requests.push({client:'browser',case:'browser '+label,method:request.method(),path:url.pathname+url.search,status:res.status(),route:route?.join(' '),durationMs:timing.responseEnd>=0?Math.round(timing.responseEnd):undefined})
      if(res.status()>=500)serverErrors.push({label,status:res.status(),url:res.url()})
      if(res.request().method()==='POST'&&new URL(res.url()).pathname==='/api/expenses'&&res.status()===201) {
        try {state.expenses.add((await res.json()).item.id)}catch{}
      }
    })
  }
  async function login(page) {
    await page.goto('/login')
    await page.getByPlaceholder('用户名',{exact:true}).fill(state.testUsername)
    await page.getByPlaceholder('密码',{exact:true}).fill(state.testPassword)
    await page.getByRole('button',{name:'登录',exact:true}).click()
    await page.waitForURL('**/dashboard',{timeout:20000})
  }
  async function select(page,label,name) {
    await page.locator('.el-form-item',{hasText:label}).first().locator('.el-select__wrapper').click()
    await page.getByRole('option',{name,exact:true}).click()
  }
  try {
    const desktop=await browser.newContext({baseURL:state.baseURL,viewport:{width:1280,height:900},acceptDownloads:true})
    contexts.push(desktop)
    const page=await desktop.newPage();watch(page,'desktop')
    await h.check('browser desktop: real UI login and dashboard',async()=>{await login(page);await page.goto('/dashboard?shop='+state.shops[0].id);await expect(page.getByText(/本月合计/)).toBeVisible();await page.screenshot({path:path.join(state.dir,'desktop-dashboard.png'),fullPage:true})},true)
    let uiExpense
    await h.check('browser desktop: create expense from form',async()=>{
      await page.goto('/expenses/new?shop='+state.shops[0].id)
      await select(page,'类别',state.categories[0].name)
      await page.locator('input[placeholder="0.00"]').fill('33.33')
      await page.locator('textarea').fill(state.prefix+'-browser')
      const created=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/expenses'&&res.request().method()==='POST')
      await page.getByRole('button',{name:'保存费用',exact:true}).click()
      const response=await created;assert.equal(response.status(),201)
      uiExpense=(await response.json()).item;state.expenses.add(uiExpense.id)
      await page.waitForURL('**/expenses/'+uiExpense.id)
      await expect(page.getByText('¥33.33',{exact:true})).toBeVisible()
      await page.screenshot({path:path.join(state.dir,'desktop-expense.png'),fullPage:true})
    },true)
    await h.check('browser desktop: actual image upload and download',async()=>{
      const response=page.waitForResponse(res=>res.request().method()==='POST'&&res.url().includes('/attachments'))
      await page.locator('input[type=file]').setInputFiles({name:'browser-receipt.png',mimeType:'image/png',buffer:png})
      assert.equal((await response).status(),201)
      await expect(page.getByText('browser-receipt.png',{exact:true})).toBeVisible()
      await expect.poll(()=>page.locator('.el-image img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true)
      const downloaded=page.waitForEvent('download')
      await page.getByRole('button',{name:'下载',exact:true}).click()
      const file=await downloaded;assert.equal(file.suggestedFilename(),'browser-receipt.png')
      const destination=path.join(state.dir,'browser-receipt.png');await file.saveAs(destination);assert.deepEqual(fs.readFileSync(destination),png)
    })
    await h.check('browser desktop: edit and reload persistent expense',async()=>{
      await page.getByRole('button',{name:'编辑',exact:true}).click()
      await expect(page.locator('input[placeholder="0.00"]')).toHaveValue('33.33')
      await page.locator('input[placeholder="0.00"]').fill('44.44')
      await page.getByRole('button',{name:'保存修改',exact:true}).click()
      await page.waitForURL('**/expenses/'+uiExpense.id)
      await expect(page.getByText('¥44.44',{exact:true})).toBeVisible()
      await page.reload();await expect(page.getByText('¥44.44',{exact:true})).toBeVisible()
      assert.equal(status(await api.request('GET','/api/expenses/'+uiExpense.id),200).item.amount_cents,4444)
    })
    await h.check('browser desktop: filtered list and report match UI write',async()=>{
      await page.goto('/expenses?shop='+state.shops[0].id+'&kw='+encodeURIComponent(state.prefix+'-browser'))
      await expect(page.getByText(/^¥?44\.44$/).first()).toBeVisible()
      await page.goto('/reports?shop='+state.shops[0].id+'&kw='+encodeURIComponent(state.prefix+'-browser'))
      await expect(page.getByText('¥44.44',{exact:true}).first()).toBeVisible()
      const promised=page.waitForEvent('download')
      await page.getByRole('button',{name:'导出 Excel',exact:true}).click()
      const download=await promised;assert(download.suggestedFilename().endsWith('费用报表.xlsx'));await download.saveAs(path.join(state.dir,'browser-report.xlsx'))
    })
    await h.check('browser desktop: real print page and local PDF',async()=>{
      await page.getByRole('button',{name:'打印 / 存 PDF',exact:true}).click()
      await page.waitForURL('**/reports/print?**')
      await expect(page.locator('.print-table tbody tr')).toHaveCount(1)
      await expect(page.locator('.print-table tfoot')).toContainText('44.44')
      const pdf=await page.pdf({path:path.join(state.dir,'browser-print.pdf'),format:'A4',printBackground:true});assert(pdf.subarray(0,5).toString()==='%PDF-');assert(pdf.length>1000)
      await page.screenshot({path:path.join(state.dir,'desktop-print.png'),fullPage:true})
    })
    await h.check('browser desktop: delete expense and attachment from UI',async()=>{
      await page.goto('/expenses/'+uiExpense.id)
      await page.getByRole('button',{name:'删除',exact:true}).first().click()
      await expect(page.locator('.el-message-box')).toBeVisible()
      await page.locator('.el-message-box').getByRole('button',{name:'删除',exact:true}).click()
      await page.waitForURL(/\/expenses(?:\?|$)/)
      status(await api.request('GET','/api/expenses/'+uiExpense.id),404)
      state.expenses.delete(uiExpense.id)
    })
    for(const route of ['/settings/shops','/settings/categories','/settings/users','/settings/profile','/settings/backup']) await h.check('browser desktop: page loads '+route,async()=>{
      await page.goto(route,{waitUntil:'networkidle'});assert(new URL(page.url()).pathname===route);await expect(page.locator('.el-message--error')).toHaveCount(0)
    })
    const mobile=await browser.newContext({...devices['iPhone 13'],baseURL:state.baseURL,acceptDownloads:true})
    contexts.push(mobile)
    const phone=await mobile.newPage();watch(phone,'mobile')
    await h.check('browser mobile: login and navigation',async()=>{await login(phone);await phone.goto('/dashboard?shop='+state.shops[0].id);for(const label of ['首页','费用','工资','报表','设置'])await expect(phone.locator('.app-nav').getByText(label,{exact:true})).toBeVisible()},true)
    for(const route of ['/dashboard','/expenses','/reports']) await h.check('browser mobile: responsive page '+route,async()=>{await phone.goto(route+'?shop='+state.shops[0].id,{waitUntil:'networkidle'});assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await expect(phone.locator('.el-message--error')).toHaveCount(0)})
    await h.check('browser mobile: date-range selector fits and updates filter',async()=>{await phone.goto('/reports?shop='+state.shops[0].id);await phone.getByPlaceholder('缴费日起',{exact:true}).click();const panel=phone.locator('.el-date-range-picker:visible');await expect(panel).toBeVisible();const bounds=await panel.boundingBox();assert(bounds.x>=0);assert(bounds.x+bounds.width<=phone.viewportSize().width);const dates=panel.locator('.el-date-range-picker__content').first().locator('td.available:not(.prev-month):not(.next-month)');await dates.nth(0).click();await dates.nth(1).click();await expect(phone).toHaveURL(/pd_from=.*pd_to=/)})
    await h.check('browser mobile: wage calendar, worked day, leave and clear',async()=>{
      const member=state.payroll[0]
      await phone.goto('/payroll/'+member.id)
      await expect(phone.getByRole('heading',{name:state.prefix+'-工资',exact:true})).toBeVisible()
      const cell=phone.locator('.day-cell.today');const date=await cell.getAttribute('data-date');state.days.add(member.id+'|'+date)
      await cell.click()
      await phone.getByLabel('上班时长（小时）',{exact:true}).fill('7.5')
      await phone.getByLabel('当天时薪（元 / 小时）',{exact:true}).fill('25.50')
      await phone.getByRole('button',{name:'保存',exact:true}).click()
      await expect(cell).toHaveClass(/worked/);await expect(cell).toContainText('191.25');await expect(phone.locator('.summary')).toContainText('191.25')
      await phone.reload();await expect(cell).toContainText('191.25')
      assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
      await phone.screenshot({path:path.join(state.dir,'mobile-payroll.png'),fullPage:true})
      await cell.click();await phone.getByRole('dialog').locator('label').filter({hasText:'请假'}).click();await phone.getByRole('button',{name:'保存',exact:true}).click();await expect(cell).toHaveClass(/leave/);await expect(phone.locator('.summary')).toContainText('0.00')
      await cell.click();await phone.getByRole('button',{name:'清除记录',exact:true}).click();await expect(cell).toHaveClass(/unrecorded/)
    })
    await h.check('browser mobile: real create/delete without draft mock',async()=>{
      await phone.goto('/expenses/new?shop='+state.shops[0].id)
      await select(phone,'类别',state.categories[0].name)
      await phone.locator('input[placeholder="0.00"]').fill('9.90')
      await phone.locator('textarea').fill(state.prefix+'-mobile')
      await phone.reload();await expect(phone.locator('input[placeholder="0.00"]')).toHaveValue('9.90')
      const posted=phone.waitForResponse(res=>res.request().method()==='POST'&&new URL(res.url()).pathname==='/api/expenses')
      await phone.getByRole('button',{name:'保存费用',exact:true}).click()
      const response=await posted;assert.equal(response.status(),201);const row=(await response.json()).item;state.expenses.add(row.id)
      await phone.waitForURL('**/expenses/'+row.id);await expect(phone.getByText('¥9.90',{exact:true})).toBeVisible()
      await phone.goto('/expenses?shop='+state.shops[0].id+'&kw='+encodeURIComponent(state.prefix+'-mobile'));await expect(phone.getByText('¥9.90',{exact:true}).first()).toBeVisible()
      await phone.screenshot({path:path.join(state.dir,'mobile-expenses.png'),fullPage:true})
      status(await api.request('DELETE','/api/expenses/'+row.id),200);state.expenses.delete(row.id)
      await phone.goto('/expenses/new?shop='+state.shops[0].id);await expect(phone.locator('input[placeholder="0.00"]')).toHaveValue('')
    })
    await h.check('browser: logout redirects and closes authenticated access',async()=>{await phone.goto('/settings/profile');await phone.getByRole('button',{name:'退出登录',exact:true}).click();await phone.waitForURL('**/login');await phone.goto('/expenses');await expect(phone).toHaveURL(/login/)})
    await h.check('browser: no JavaScript failures or server errors',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(serverErrors,[])})
    fs.writeFileSync(path.join(state.dir,'browser-results.json'),JSON.stringify({errors,failed,serverErrors},null,2))
  } finally {
    for(const context of contexts) await context.close()
    await browser.close()
  }
}