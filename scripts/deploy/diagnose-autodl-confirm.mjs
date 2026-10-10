// Reproduce the first-visit confirmation defect from a fresh local browser context.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import {makeHarness,readEnv,status,multipart} from './remote-http-client.mjs'
const root=path.resolve(import.meta.dirname,'../..'),run=process.argv[2]
assert(/^rt[a-z0-9]+$/.test(run))
const dir=path.join(root,'artifacts/autodl/remote-tests',run)
const old=JSON.parse(fs.readFileSync(path.join(dir,'results.json'),'utf8'))
const credential=readEnv(path.join(root,'artifacts/autodl/.env'))
const test=readEnv(path.join(dir,'test-user.env'))
const h=makeHarness(old.baseURL,dir),admin=h.client(),user=h.client()
h.secrets.add(credential.PASSWORD);h.secrets.add(test.PASSWORD)
let target,shop,category,expenseId,browser
const evidence={run,baseURL:old.baseURL,execution:'local Chromium -> local SSH tunnel -> AutoDL HTTP'}
const cleanup=[]
try {
  await admin.login(credential.USERNAME,credential.PASSWORD)
  target=status(await admin.request('GET','/api/users'),200).items.find(x=>x.username===test.USERNAME);assert(target)
  shop=status(await admin.request('GET','/api/shops'),200).items.find(x=>x.name.startsWith(old.testPrefix)&&x.name.includes('-shops-0'));assert(shop)
  category=status(await admin.request('GET','/api/categories'),200).items.find(x=>x.name.startsWith(old.testPrefix)&&x.name.includes('-categories-0'));assert(category)
  status(await admin.request('PATCH',`/api/users/${target.id}/active`,{is_active:true,operator_password:credential.PASSWORD}),200)
  status(await admin.request('PATCH',`/api/shops/${shop.id}/active`,{is_active:true}),200)
  status(await admin.request('PATCH',`/api/categories/${category.id}/active`,{is_active:true}),200)
  await user.login(test.USERNAME,test.PASSWORD)
  const item=status(await user.request('POST','/api/expenses',{shop_id:shop.id,category_id:category.id,amount:'1.00',bill_month:'2026-08',paid_date:'2026-08-20',remark:old.testPrefix+'-confirm-diagnosis'}),201).item
  expenseId=item.id
  const png=fs.readFileSync(path.join(root,'artifacts/autodl/test-fixtures/receipt.png'))
  status(await user.request('POST',`/api/expenses/${expenseId}/attachments`,multipart(png,'receipt.png','image/png')),201)
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext({baseURL:old.baseURL,viewport:{width:1280,height:900}})
  const page=await context.newPage()
  await page.goto('/login');await page.getByPlaceholder('用户名',{exact:true}).fill(test.USERNAME);await page.getByPlaceholder('密码',{exact:true}).fill(test.PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/dashboard')
  await page.goto('/expenses/'+expenseId,{waitUntil:'networkidle'})
  await page.getByRole('button',{name:'删除',exact:true}).first().click()
  const box=page.locator('.el-message-box');await expect(box).toBeVisible()
  const button=box.getByRole('button',{name:'删除',exact:true})
  await button.scrollIntoViewIfNeeded()
  evidence.before=await button.evaluate(el=>{
    const rect=el.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2),overlay=el.closest('.el-overlay'),dialog=el.closest('.el-message-box')
    return {button:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},hit:{tag:hit?.tagName,className:hit?.className,text:hit?.textContent},overlay:overlay?{position:getComputedStyle(overlay).position,zIndex:getComputedStyle(overlay).zIndex}:null,dialog:{position:getComputedStyle(dialog).position,display:getComputedStyle(dialog).display},styles:[...document.styleSheets].map(x=>x.href).filter(Boolean)}
  })
  await page.screenshot({path:path.join(dir,'delete-confirm-blocked.png'),fullPage:false})
  try {await button.click({timeout:3000});evidence.freshClick='succeeded'}catch(error){evidence.freshClick='blocked';evidence.error=h.sanitize(error.message)}
  if(evidence.freshClick==='blocked') {
    await page.keyboard.press('Escape')
    await expect(box).not.toBeVisible()
    await page.locator('.app-nav').getByText('工资',{exact:true}).click()
    await expect(page.getByRole('heading',{name:'工资成员',exact:true})).toBeVisible()
    await page.locator('.app-nav').getByText('费用',{exact:true}).click()
    await page.getByPlaceholder('搜索备注关键字',{exact:true}).fill(old.testPrefix+'-confirm-diagnosis')
    await page.getByPlaceholder('搜索备注关键字',{exact:true}).press('Enter')
    await page.getByText(old.testPrefix+'-confirm-diagnosis',{exact:true}).click()
    await page.waitForURL('**/expenses/'+expenseId)
    await page.getByRole('button',{name:'删除',exact:true}).first().click();await expect(box).toBeVisible()
    evidence.after=await button.evaluate(el=>{const overlay=el.closest('.el-overlay'),dialog=el.closest('.el-message-box');return {overlay:overlay?{position:getComputedStyle(overlay).position,zIndex:getComputedStyle(overlay).zIndex}:null,dialog:{position:getComputedStyle(dialog).position,display:getComputedStyle(dialog).display},styles:[...document.styleSheets].map(x=>x.href).filter(Boolean)}})
    await page.screenshot({path:path.join(dir,'delete-confirm-after-component-navigation.png'),fullPage:false})
    try {await button.click({timeout:5000});await page.waitForURL(/\/expenses(?:\?|$)/);status(await user.request('GET','/api/expenses/'+expenseId),404);evidence.afterComponentNavigationClick='succeeded';expenseId=null}catch(error){evidence.afterComponentNavigationClick='blocked';evidence.afterError=h.sanitize(error.message)}
  }
  console.log(JSON.stringify({freshClick:evidence.freshClick,beforeOverlay:evidence.before?.overlay,afterComponentNavigationClick:evidence.afterComponentNavigationClick,afterOverlay:evidence.after?.overlay,hit:evidence.before?.hit}))
} finally {
  if(browser)await browser.close()
  if(expenseId){try{status(await admin.request('DELETE','/api/expenses/'+expenseId),200);cleanup.push('diagnostic expense and attachment removed')}catch(error){cleanup.push('expense cleanup failed: '+h.sanitize(error.message))}}
  if(target){try{status(await admin.request('PATCH',`/api/users/${target.id}/active`,{is_active:false,operator_password:credential.PASSWORD}),200);cleanup.push('test user disabled')}catch(error){cleanup.push('user cleanup failed: '+h.sanitize(error.message))}}
  if(shop){try{status(await admin.request('PATCH',`/api/shops/${shop.id}/active`,{is_active:false}),200);cleanup.push('test shop disabled')}catch(error){cleanup.push('shop cleanup failed: '+h.sanitize(error.message))}}
  if(category){try{status(await admin.request('PATCH',`/api/categories/${category.id}/active`,{is_active:false}),200);cleanup.push('test category disabled')}catch(error){cleanup.push('category cleanup failed: '+h.sanitize(error.message))}}
  try{status(await admin.request('POST','/api/auth/logout'),200)}catch{}
  evidence.cleanup=cleanup
  fs.writeFileSync(path.join(dir,'confirm-diagnosis.json'),JSON.stringify(evidence,null,2))
}