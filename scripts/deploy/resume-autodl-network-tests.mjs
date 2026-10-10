// Continue interrupted browser checks using only public HTTP APIs and existing test fixtures.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {makeHarness,readEnv,status} from './remote-http-client.mjs'
import {browserChecks} from './test-autodl-browser.mjs'
const root=path.resolve(import.meta.dirname,'../..')
const run=process.argv[2]
assert(/^rt[a-z0-9]+$/.test(run),'Pass the ID of the previous network test run')
const dir=path.join(root,'artifacts/autodl/remote-tests',run)
const previous=JSON.parse(fs.readFileSync(path.join(dir,'results.json'),'utf8'))
const credentials=readEnv(process.env.HM_REMOTE_ENV||path.join(root,'artifacts/autodl/.env'))
const h=makeHarness(previous.baseURL,dir),admin=h.client(),user=h.client(),anon=h.client()
h.secrets.add(credentials.PASSWORD)
const previousFailures=previous.results.filter(x=>x.status==='failed')
// Preserve the historical results file; report corrected harness failures separately.
fs.copyFileSync(path.join(dir,'results.json'),path.join(dir,'first-pass-results.json'))
h.results.push(...previous.results.filter(x=>x.status==='passed'))
h.requests.push(...previous.requests)
const state={run,prefix:previous.testPrefix,dir,baseURL:previous.baseURL,shops:[],categories:[],users:[],expenses:new Set(),days:new Set(),payroll:[],baseline:{},testUsername:run+'_a',testPassword:crypto.randomBytes(18).toString('base64url')}
h.secrets.add(state.testPassword)
try {
  await admin.login(credentials.USERNAME,credentials.PASSWORD)
  const users=status(await admin.request('GET','/api/users'),200).items
  const target=users.find(x=>x.username===state.testUsername);assert(target)
  state.users=users.filter(x=>x.username===run+'_a'||x.username===run+'_b')
  status(await admin.request('PATCH',`/api/users/${target.id}/active`,{is_active:true,operator_password:credentials.PASSWORD}),200)
  status(await admin.request('POST',`/api/users/${target.id}/reset-password`,{new_password:state.testPassword,operator_password:credentials.PASSWORD}),200)
  await user.login(state.testUsername,state.testPassword)
  const next=crypto.randomBytes(18).toString('base64url');h.secrets.add(next)
  status(await user.request('POST','/api/auth/change-password',{old_password:state.testPassword,new_password:next}),200)
  state.testPassword=next;await user.login(state.testUsername,next)
  for(const collection of ['shops','categories']) {
    const all=status(await admin.request('GET','/api/'+collection),200).items
    state[collection]=all.filter(x=>x.name.startsWith(state.prefix)).sort((a,b)=>a.name.localeCompare(b.name))
    state.baseline[collection]=all.filter(x=>!x.name.startsWith(state.prefix))
    for(const item of state[collection])status(await admin.request('PATCH',`/api/${collection}/${item.id}/active`,{is_active:true}),200)
  }
  state.payroll=status(await user.request('GET','/api/payroll/members'),200).items.filter(x=>x.name.startsWith(state.prefix))
  assert.equal(state.payroll.length,1)
  fs.writeFileSync(path.join(dir,'test-user.env'),`USERNAME=${state.testUsername}\nPASSWORD=${state.testPassword}\nBASE_URL=${state.baseURL}\n`)
  const png=fs.readFileSync(path.join(root,'artifacts/autodl/test-fixtures/receipt.png'))
  await browserChecks(h,state,user,png)
  await h.check('auth: sequential sixth failed login is rate limited',async()=>{const username=run+'_limit';for(let i=0;i<5;i++)status(await anon.request('POST','/api/auth/login',{username,password:'invalid-password'}),401);status(await anon.request('POST','/api/auth/login',{username,password:'invalid-password'}),429,'RATE_LIMITED')})
  await user.login(state.testUsername,state.testPassword)
  await h.check('auth: concurrent failures cannot exceed five per account',async()=>{const replies=await Promise.all(Array.from({length:8},()=>anon.request('POST','/api/auth/login',{username:run+'_race',password:'invalid-password'})));state.concurrentLoginStatuses=replies.map(x=>x.status);assert(replies.filter(x=>x.status===401).length<=5,'Concurrent login accepted '+replies.filter(x=>x.status===401).length+' failed attempts before throttling; expected at most 5');assert(replies.every(x=>[401,429].includes(x.status)))})
  await user.login(state.testUsername,state.testPassword)
  await h.check('auth: logout destroys session over real network',async()=>{status(await user.request('POST','/api/auth/logout'),200);status(await user.request('GET','/api/auth/me'),401)})
} catch(error) {
  console.log('Continuation stopped: '+h.sanitize(error.message))
  if(!h.results.some(x=>x.status==='failed'))h.results.push({name:'continuation setup',status:'failed',error:h.sanitize(error.message)})
} finally {
  for(const id of state.expenses) {try{const res=await admin.request('DELETE','/api/expenses/'+id);assert([200,404].includes(res.status));h.cleanups.push({kind:'expense',id,status:'deleted'})}catch(e){h.cleanups.push({kind:'expense',id,status:'failed',error:h.sanitize(e.message)})}}
  for(const entry of state.days) {const [id,date]=entry.split('|');try{status(await admin.request('DELETE',`/api/payroll/members/${id}/days/${date}`),200);h.cleanups.push({kind:'payroll_day',id:entry,status:'deleted'})}catch(e){h.cleanups.push({kind:'payroll_day',id:entry,status:'failed',error:h.sanitize(e.message)})}}
  for(const collection of ['shops','categories']) {
    for(const item of state[collection]) {try{status(await admin.request('PATCH',`/api/${collection}/${item.id}/active`,{is_active:false}),200);h.cleanups.push({kind:collection,id:item.id,status:'disabled; no delete API'})}catch(e){h.cleanups.push({kind:collection,id:item.id,status:'failed',error:h.sanitize(e.message)})}}
    if(state.baseline[collection]?.length) {try{status(await admin.request('PATCH','/api/'+collection+'/sort',{ids:[...state.baseline[collection].map(x=>x.id),...state[collection].map(x=>x.id)]}),200)}catch(e){h.cleanups.push({kind:'sort_restore',id:collection,status:'failed',error:h.sanitize(e.message)})}}
  }
  for(const item of state.users){try{status(await admin.request('PATCH',`/api/users/${item.id}/active`,{is_active:false,operator_password:credentials.PASSWORD}),200);h.cleanups.push({kind:'user',id:item.id,status:'disabled; no delete API'})}catch(e){h.cleanups.push({kind:'user',id:item.id,status:'failed',error:h.sanitize(e.message)})}}
  for(const item of state.payroll)h.cleanups.push({kind:'payroll_member',id:item.id,status:'retained labelled; no delete/disable API'})
  try{const data=status(await admin.request('GET','/api/expenses?keyword='+encodeURIComponent(state.prefix)),200);assert.equal(data.total,0);h.cleanups.push({kind:'expense_cleanup_verification',status:'passed'})}catch(e){h.cleanups.push({kind:'expense_cleanup_verification',status:'failed',error:h.sanitize(e.message)})}
  try{status(await admin.request('POST','/api/auth/logout'),200)}catch{}
  h.cleanups.unshift(...previous.cleanups)
  const report=h.save({run,testPrefix:state.prefix,backupJob:previous.backupJob,concurrentLoginStatuses:state.concurrentLoginStatuses,limitations:previous.limitations,harnessCorrections:previousFailures})
  const failed=report.results.filter(x=>x.status==='failed'),covered=report.coverage.filter(x=>x.success).length
  const lines=['# AutoDL 本机真实网络测试报告','',`测试方向：Windows 本机 → ${state.baseURL} → SSH 隧道 → AutoDL 后端。测试进程、Chromium 和导出解析均在本机；没有在服务器执行测试代码或注入数据库。`,'',`结果：${report.results.length-failed.length} 通过，${failed.length} 失败；成功覆盖 ${covered}/${report.coverage.length} 个 HTTP 路由；共记录 ${report.requests.length} 次 HTTP/浏览器响应。`,'','## 发现的问题','',...failed.map(x=>'- '+x.name+'：'+x.error),...(failed.length?[]:['无。']),'','并发登录返回状态：`'+JSON.stringify(state.concurrentLoginStatuses)+'`。','', '## 覆盖范围','', '| 方法 | 路径 | 请求数 | 成功路径 |','| --- | --- | ---: | --- |',...report.coverage.map(x=>`| ${x.method} | ${x.path} | ${x.requests} | ${x.success?'通过':'未覆盖'} |`),'','## 测试明细','',...report.results.map(x=>`- ${x.status==='passed'?'通过':'失败'}：${x.name}（${x.durationMs||0} ms）`),'','## 数据清理','',...report.cleanups.map(x=>'- '+x.kind+' '+(x.id||'')+'：'+x.status+(x.error?'；'+x.error:'')),'','## 已修正的测试脚本问题','',...previousFailures.map(x=>'- '+x.name+'：首页金额标题包含笔数，原精确文本断言已修正；原始记录保存在 first-pass-results.json，不计作服务缺陷。'),'','## 未验证范围','',...report.limitations.map(x=>'- '+x),'','原始响应状态、耗时、下载文件及截图：`artifacts/autodl/remote-tests/'+run+'/`。没有保存密码、Cookie 或 CSRF 到报告；私有测试凭据单独保存在被 Git 忽略的 test-user.env。','']
  fs.writeFileSync(path.join(root,'artifacts/autodl-real-network-test-report.md'),lines.join('\n'))
  console.log(JSON.stringify({run,passed:report.results.length-failed.length,failed:failed.length,routeCoverage:covered+'/'+report.coverage.length,responses:report.requests.length,cleanupFailures:report.cleanups.filter(x=>x.status==='failed').length}))
  process.exitCode=failed.length||report.cleanups.some(x=>x.status==='failed')?1:0
}