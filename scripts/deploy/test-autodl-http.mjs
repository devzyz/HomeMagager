// Comprehensive black-box tests: execute on Windows; only HTTP goes to AutoDL.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { makeHarness,readEnv,status,multipart,delay } from './remote-http-client.mjs'
import { browserChecks } from './test-autodl-browser.mjs'

const root=path.resolve(import.meta.dirname,'../..')
const credentials=readEnv(process.env.HM_REMOTE_ENV || path.join(root,'artifacts/autodl/.env'))
const baseURL=credentials.BASE_URL || 'http://127.0.0.1:13000'
const run='rt'+Date.now().toString(36)+crypto.randomBytes(2).toString('hex')
const prefix='真实测试-'+run
const dir=path.join(root,'artifacts/autodl/remote-tests',run)
fs.mkdirSync(dir,{recursive:true})
const h=makeHarness(baseURL,dir)
h.secrets.add(credentials.PASSWORD)
const {check}=h, anon=h.client(), admin=h.client(), user=h.client(), other=h.client()
const state={run,prefix,dir,baseURL,shops:[],categories:[],users:[],expenses:new Set(),days:new Set(),payroll:[],baseline:{},testUsername:run+'_a',testPassword:crypto.randomBytes(18).toString('base64url'),otherUsername:run+'_b',otherPassword:crypto.randomBytes(18).toString('base64url')}
h.secrets.add(state.testPassword);h.secrets.add(state.otherPassword)
const missing=crypto.randomUUID()
const fixtureDir=path.join(root,'artifacts/autodl/test-fixtures')
const png=fs.readFileSync(path.join(fixtureDir,'receipt.png'))
const pdf=fs.readFileSync(path.join(fixtureDir,'receipt.pdf'))
const req=createRequire(new URL('../../apps/server/package.json',import.meta.url))
const ExcelJS=req('exceljs')
async function expense(over={}) {
  const id=over.id||crypto.randomUUID()
  const payload={id,shop_id:state.shops[0].id,category_id:state.categories[0].id,amount:'128.50',bill_month:'2026-08',paid_date:'2026-08-20',remark:prefix,...over}
  const res=await user.request('POST','/api/expenses',payload)
  status(res,201);state.expenses.add(id);return {item:res.data.item,payload}
}
const filter=(extra={})=>'?'+new URLSearchParams({shop_id:state.shops[0].id,...extra})
async function cleanup() {
  // Only remove records this run created; do not query/mutate the remote database.
  for(const id of state.expenses) {
    try {const res=await admin.request('DELETE','/api/expenses/'+id);assert([200,404].includes(res.status));h.cleanups.push({kind:'expense',id,status:'deleted'})}
    catch(e){h.cleanups.push({kind:'expense',id,status:'failed',error:h.sanitize(e.message)})}
  }
  for(const entry of state.days) {
    const [member,date]=entry.split('|')
    try {status(await admin.request('DELETE',`/api/payroll/members/${member}/days/${date}`),200);h.cleanups.push({kind:'payroll_day',id:entry,status:'deleted'})}
    catch(e){h.cleanups.push({kind:'payroll_day',id:entry,status:'failed',error:h.sanitize(e.message)})}
  }
  for(const [collection,items] of [['shops',state.shops],['categories',state.categories]]) {
    for(const item of items) {
      try {status(await admin.request('PATCH',`/api/${collection}/${item.id}/active`,{is_active:false}),200);h.cleanups.push({kind:collection,id:item.id,status:'disabled; API has no delete'})}
      catch(e){h.cleanups.push({kind:collection,id:item.id,status:'failed',error:h.sanitize(e.message)})}
    }
    if(state.baseline[collection]?.length) {
      try {status(await admin.request('PATCH',`/api/${collection}/sort`,{ids:[...state.baseline[collection].map(x=>x.id),...items.map(x=>x.id)]}),200)}
      catch(e){h.cleanups.push({kind:'sort_restore',id:collection,status:'failed',error:h.sanitize(e.message)})}
    }
  }
  for(const item of state.users) {
    try {status(await admin.request('PATCH',`/api/users/${item.id}/active`,{is_active:false,operator_password:credentials.PASSWORD}),200);h.cleanups.push({kind:'user',id:item.id,status:'disabled; API has no delete'})}
    catch(e){h.cleanups.push({kind:'user',id:item.id,status:'failed',error:h.sanitize(e.message)})}
  }
  for(const item of state.payroll) h.cleanups.push({kind:'payroll_member',id:item.id,status:'retained with test prefix; API has no delete or disable'})
  try {const listed=status(await admin.request('GET','/api/expenses?keyword='+encodeURIComponent(prefix)),200);assert.equal(listed.total,0);h.cleanups.push({kind:'expense_cleanup_verification',status:'passed'})}
  catch(e){h.cleanups.push({kind:'expense_cleanup_verification',status:'failed',error:h.sanitize(e.message)})}
  try {status(await admin.request('POST','/api/auth/logout'),200)}catch{}
}
try {
  await check('health: deployed service and database',async()=>assert.deepEqual(status(await anon.request('GET','/api/health'),200),{status:'ok',database:'ok'}),true)
  await check('auth: administrator login from local machine',async()=>{state.admin=await admin.login(credentials.USERNAME,credentials.PASSWORD);assert.equal(state.admin.must_change_password,false)},true)
  state.baseline.shops=status(await admin.request('GET','/api/shops'),200).items
  state.baseline.categories=status(await admin.request('GET','/api/categories'),200).items
  await check('users: list does not leak hashes or passwords',async()=>{const data=status(await admin.request('GET','/api/users'),200);assert(!JSON.stringify(data).includes('password_hash'));assert(!JSON.stringify(data).includes(credentials.PASSWORD))})
  const createBody=()=>({username:state.testUsername.toUpperCase(),display_name:' '+prefix+' ',password:state.testPassword,operator_password:credentials.PASSWORD})
  await check('users: create and normalize independent test account',async()=>{const res=status(await admin.request('POST','/api/users',createBody()),201);state.users.push(res.user);state.primary=res.user;assert.equal(res.user.username,state.testUsername);assert.equal(res.user.display_name,prefix);assert.equal(res.user.must_change_password,true)},true)
  await check('users: duplicate username rejected',async()=>status(await admin.request('POST','/api/users',createBody()),400,'USERNAME_TAKEN'))
  for(const [name,over] of [['invalid username',{username:'ab'}],['empty display name',{display_name:' '}],['short password',{username:run+'_bad',password:'short'}],['long password',{username:run+'_bad',password:'x'.repeat(129)}],['incorrect operator password',{operator_password:'wrong-operator-password'}]]) await check('users: '+name,async()=>status(await admin.request('POST','/api/users',{...createBody(),...over}),name==='incorrect operator password'?403:400,name==='incorrect operator password'?'OPERATOR_PASSWORD_WRONG':undefined))
  await check('auth: first login is restricted',async()=>{const me=await user.login(state.testUsername,state.testPassword);assert.equal(me.must_change_password,true);status(await user.request('GET','/api/shops'),403,'MUST_CHANGE_PASSWORD')},true)
  await check('auth: first-login me remains readable',async()=>assert.equal(status(await user.request('GET','/api/auth/me'),200).user.id,state.primary.id))
  for(const [name,body] of [['wrong current password',{old_password:'incorrect-password',new_password:'valid-new-password'}],['short new password',{old_password:state.testPassword,new_password:'short'}],['overlong new password',{old_password:state.testPassword,new_password:'x'.repeat(129)}]]) await check('auth: change-password rejects '+name,async()=>status(await user.request('POST','/api/auth/change-password',body),400))
  await check('auth: change password invalidates old session',async()=>{const old=state.testPassword;state.testPassword=crypto.randomBytes(18).toString('base64url');h.secrets.add(state.testPassword);status(await user.request('POST','/api/auth/change-password',{old_password:old,new_password:state.testPassword}),200);status(await user.request('GET','/api/auth/me'),401);await user.login(state.testUsername,state.testPassword)},true)
  await check('auth: password-change gate lifted',async()=>assert.equal(status(await user.request('GET','/api/auth/me'),200).user.must_change_password,false))
  await check('users: second independent account',async()=>{const res=status(await admin.request('POST','/api/users',{username:state.otherUsername,display_name:prefix+'-B',password:state.otherPassword,operator_password:credentials.PASSWORD}),201);state.secondary=res.user;state.users.push(res.user);await other.login(state.otherUsername,state.otherPassword);const next=crypto.randomBytes(18).toString('base64url');h.secrets.add(next);status(await other.request('POST','/api/auth/change-password',{old_password:state.otherPassword,new_password:next}),200);state.otherPassword=next;await other.login(state.otherUsername,next)},true)
  await check('users: own display name can change',async()=>{status(await user.request('PATCH',`/api/users/${state.primary.id}/display-name`,{display_name:prefix+'-updated'}),200);assert.equal(status(await user.request('GET','/api/auth/me'),200).user.display_name,prefix+'-updated')})
  await check('users: cannot edit someone else display name',async()=>status(await user.request('PATCH',`/api/users/${state.secondary.id}/display-name`,{display_name:'forbidden'}),403))
  await check('users: cannot disable own account',async()=>status(await user.request('PATCH',`/api/users/${state.primary.id}/active`,{is_active:false,operator_password:state.testPassword}),400,'CANNOT_DISABLE_SELF'))
  await check('users: cannot reset own password',async()=>status(await user.request('POST',`/api/users/${state.primary.id}/reset-password`,{new_password:'valid-password-new',operator_password:state.testPassword}),400,'USE_CHANGE_PASSWORD'))
  await check('users: disable revokes target sessions',async()=>{status(await user.request('PATCH',`/api/users/${state.secondary.id}/active`,{is_active:false,operator_password:state.testPassword}),200);status(await other.request('GET','/api/auth/me'),401);status(await anon.request('POST','/api/auth/login',{username:state.otherUsername,password:state.otherPassword}),401)})
  await check('users: re-enable restores login',async()=>{status(await user.request('PATCH',`/api/users/${state.secondary.id}/active`,{is_active:true,operator_password:state.testPassword}),200);await other.login(state.otherUsername,state.otherPassword)})
  await check('users: reset revokes session and requires new password change',async()=>{const next=crypto.randomBytes(18).toString('base64url');h.secrets.add(next);status(await user.request('POST',`/api/users/${state.secondary.id}/reset-password`,{new_password:next,operator_password:state.testPassword}),200);status(await other.request('GET','/api/auth/me'),401);state.otherPassword=next;assert.equal((await other.login(state.otherUsername,next)).must_change_password,true);status(await other.request('GET','/api/expenses'),403,'MUST_CHANGE_PASSWORD')})
  for(const collection of ['shops','categories']) {
    const target=state[collection]
    for(let n=0;n<2;n++) await check(`${collection}: create item ${n+1}`,async()=>{const item=status(await user.request('POST',`/api/${collection}`,{name:prefix+'-'+collection+'-'+n}),201).item;target.push(item);assert.equal(item.is_active,true)},true)
    await check(`${collection}: duplicate name rejected`,async()=>status(await user.request('POST',`/api/${collection}`,{name:target[0].name}),400,'NAME_TAKEN'))
    for(const name of [' ','x'.repeat(51)]) await check(`${collection}: invalid name length ${name.length}`,async()=>status(await user.request('POST',`/api/${collection}`,{name}),400))
    await check(`${collection}: rename persists`,async()=>{const name=target[0].name+'-edit';status(await user.request('PATCH',`/api/${collection}/${target[0].id}`,{name}),200);target[0].name=name;assert.equal(status(await user.request('GET',`/api/${collection}`),200).items.find(x=>x.id===target[0].id).name,name)})
    await check(`${collection}: rename collision rejected`,async()=>status(await user.request('PATCH',`/api/${collection}/${target[1].id}`,{name:target[0].name}),400,'NAME_TAKEN'))
    await check(`${collection}: missing item returns 404`,async()=>status(await user.request('PATCH',`/api/${collection}/${missing}`,{name:'missing'}),404))
    await check(`${collection}: ordering persists with existing items preserved`,async()=>{const ids=[...state.baseline[collection].map(x=>x.id),target[1].id,target[0].id];const list=status(await user.request('PATCH',`/api/${collection}/sort`,{ids}),200).items;assert.deepEqual(list.map(x=>x.id),ids)})
    await check(`${collection}: disable and re-enable`,async()=>{status(await user.request('PATCH',`/api/${collection}/${target[1].id}/active`,{is_active:false}),200);assert.equal(status(await user.request('GET',`/api/${collection}`),200).items.find(x=>x.id===target[1].id).is_active,false);status(await user.request('PATCH',`/api/${collection}/${target[1].id}/active`,{is_active:true}),200)})
  }
  await check('security: missing CSRF rejected',async()=>status(await user.request('POST','/api/shops',{name:prefix+'-csrf'},{omit:['x-csrf-token']}),403,'CSRF_REJECTED'))
  await check('security: incorrect CSRF rejected',async()=>status(await user.request('POST','/api/shops',{name:prefix+'-csrf'},{headers:{'x-csrf-token':'incorrect'}}),403,'CSRF_REJECTED'))
  await check('security: incorrect Origin rejected',async()=>status(await user.request('POST','/api/shops',{name:prefix+'-origin'},{headers:{Origin:'https://untrusted.example'}}),403,'ORIGIN_REJECTED'))
  await check('security: missing Origin and Referer rejected',async()=>status(await user.request('POST','/api/shops',{name:prefix+'-origin'},{omit:['Origin']}),403,'ORIGIN_REJECTED'))
  await check('security: trusted Referer fallback accepted',async()=>{const item=status(await user.request('POST','/api/categories',{name:prefix+'-referer'},{omit:['Origin'],headers:{Referer:baseURL+'/settings/categories'}}),201).item;state.categories.push(item)})
  // Further business slices follow; all use the same external HTTP client.
  let main
  await check('expenses: create returns exact integer cents',async()=>{main=await expense({remark:prefix+' literal100%_'});assert.equal(main.item.amount_cents,12850);assert.equal(main.item.version,1)},true)
  await check('expenses: detail preserves links and creator',async()=>{const item=status(await user.request('GET','/api/expenses/'+main.item.id),200).item;assert.equal(item.amount_cents,12850);assert.equal(item.created_by,state.primary.id);assert.equal(item.shop_name,state.shops[0].name)})
  for(const amount of [128.5,'128.505','0','0.00','-1','10000000','abc','']) await check('expenses: reject amount '+String(amount),async()=>status(await user.request('POST','/api/expenses',{...main.payload,id:crypto.randomUUID(),amount}),400))
  for(const [key,value] of [['paid_date','2026-02-30'],['paid_date','2026-13-01'],['paid_date','2099-01-01'],['bill_month','2026-13'],['bill_month','1999-12'],['bill_month','2101-01'],['remark','x'.repeat(1001)],['id','../../etc/passwd'],['shop_id',missing],['category_id',missing]]) await check(`expenses: reject invalid ${key} ${String(value).length>60?'length='+value.length:value}`,async()=>status(await user.request('POST','/api/expenses',{...main.payload,id:crypto.randomUUID(),[key]:value}),400))
  await check('expenses: maximum amount and whitespace remark',async()=>{const row=await expense({shop_id:state.shops[1].id,amount:'9999999.99',remark:' '});assert.equal(row.item.amount_cents,999999999);assert.equal(row.item.remark,null)})
  await check('expenses: leap-day payment accepted',async()=>assert.equal((await expense({shop_id:state.shops[1].id,paid_date:'2024-02-29',bill_month:'2024-02'})).item.paid_date,'2024-02-29'))
  await check('expenses: identical retry deduplicated',async()=>{const res=status(await user.request('POST','/api/expenses',main.payload),200);assert.equal(res.deduplicated,true);assert.equal(res.item.id,main.item.id)})
  await check('expenses: conflicting duplicate ID rejected',async()=>status(await user.request('POST','/api/expenses',{...main.payload,amount:'129.00'}),409,'DUPLICATE_ID'))
  await check('expenses: concurrent retries produce exactly one row',async()=>{const id=crypto.randomUUID(),payload={...main.payload,id,shop_id:state.shops[1].id,amount:'1.23'};state.expenses.add(id);const replies=await Promise.all(Array.from({length:5},()=>user.request('POST','/api/expenses',payload)));assert.equal(replies.filter(x=>x.status===201).length,1);assert.equal(replies.filter(x=>x.status===200&&x.data.deduplicated).length,4);assert.equal(status(await user.request('GET','/api/expenses/'+id),200).item.amount_cents,123)})
  await check('expenses: update increments version',async()=>{const res=status(await user.request('PATCH','/api/expenses/'+main.item.id,{...main.payload,version:1,amount:'200.00'}),200);main.item=res.item;assert.equal(res.item.amount_cents,20000);assert.equal(res.item.version,2)})
  await check('expenses: stale version rejected',async()=>status(await user.request('PATCH','/api/expenses/'+main.item.id,{...main.payload,version:1,amount:'300.00'}),409,'VERSION_CONFLICT'))
  await check('expenses: concurrent updates only one succeeds',async()=>{const version=main.item.version;const res=await Promise.all(['210.00','220.00'].map(amount=>user.request('PATCH','/api/expenses/'+main.item.id,{...main.payload,version,amount})));assert.deepEqual(res.map(x=>x.status).sort(),[200,409]);const fresh=status(await user.request('GET','/api/expenses/'+main.item.id),200).item;main.item=status(await user.request('PATCH','/api/expenses/'+main.item.id,{...main.payload,version:fresh.version,amount:'200.00'}),200).item})
  for(const collection of ['shops','categories']) await check(`expenses: inactive ${collection} blocks new records but preserves existing link`,async()=>{const id=state[collection][0].id;status(await user.request('PATCH',`/api/${collection}/${id}/active`,{is_active:false}),200);try {status(await user.request('POST','/api/expenses',{...main.payload,id:crypto.randomUUID()}),400);main.item=status(await user.request('PATCH','/api/expenses/'+main.item.id,{...main.payload,version:main.item.version,amount:'200.00'}),200).item}finally{status(await user.request('PATCH',`/api/${collection}/${id}/active`,{is_active:true}),200)}})
  await check('expenses: fixtures span billing months and natural years',async()=>{await expense({amount:'100.00',bill_month:'2026-07',paid_date:'2026-07-15'});await expense({amount:'50.00',paid_date:'2026-08-15',remark:'=SUM(1,1)'});await expense({amount:'70.00',bill_month:'2026-12',paid_date:'2026-09-14'});await expense({amount:'90.00',bill_month:'2025-12',paid_date:'2025-12-15'})},true)
  await check('expenses: pagination sums all filtered rows',async()=>{const res=status(await user.request('GET','/api/expenses'+filter({page:'1',page_size:'2'})),200);assert.equal(res.items.length,2);assert.equal(res.total,5);assert.equal(res.total_amount_cents,51000);assert.equal(res.page_size,2);assert(res.items[0].paid_date>=res.items[1].paid_date)})
  await check('expenses: billing month boundaries inclusive',async()=>{const data=status(await user.request('GET','/api/expenses'+filter({bill_month_from:'2026-08',bill_month_to:'2026-08'})),200);assert.equal(data.total,2);assert.equal(data.total_amount_cents,25000)})
  await check('expenses: paid date, category and shop filters intersect',async()=>{const data=status(await user.request('GET','/api/expenses'+filter({paid_date_from:'2026-08-20',paid_date_to:'2026-08-20',category_id:state.categories[0].id})),200);assert.equal(data.total,1);assert.equal(data.items[0].id,main.item.id)})
  await check('expenses: wildcard keyword is literal',async()=>assert.equal(status(await user.request('GET','/api/expenses'+filter({keyword:'100%_'})),200).total,1))
  await check('expenses: SQL-like keyword cannot escape filter',async()=>assert.equal(status(await user.request('GET','/api/expenses'+filter({keyword:"' OR 1=1 --"})),200).total,0))
  for(const query of [{bill_month_from:'2026-09',bill_month_to:'2026-08'},{paid_date_from:'2026-08-20',paid_date_to:'2026-08-01'},{page:'0'},{page_size:'201'},{keyword:'x'.repeat(101)}]) await check('expenses: invalid filter '+Object.keys(query).join('+'),async()=>status(await user.request('GET','/api/expenses'+filter(query)),400))
  await check('expenses: missing detail/update/delete return 404',async()=>{status(await user.request('GET','/api/expenses/'+missing),404);status(await user.request('PATCH','/api/expenses/'+missing,{...main.payload,version:1}),404);status(await user.request('DELETE','/api/expenses/'+missing),404)})

  const uploaded=[]
  for(const [name,bytes,mime] of [['receipt.png',png,'image/png'],['receipt.pdf',pdf,'application/pdf'],['receipt.jpg',fs.readFileSync(path.join(fixtureDir,'receipt.jpg')),'image/jpeg'],['receipt.webp',fs.readFileSync(path.join(fixtureDir,'receipt.webp')),'image/webp']]) await check('attachments: upload signature '+mime,async()=>{const item=status(await user.request('POST',`/api/expenses/${main.item.id}/attachments`,multipart(bytes,name,mime)),201).item;uploaded.push({item,bytes});assert.equal(item.mime_type,mime);assert.equal(item.size_bytes,bytes.length);assert(!('stored_name' in item))})
  await check('attachments: preview and download bytes match SHA-256',async()=>{const first=uploaded[0];for(const suffix of ['','?download=1']){const res=await user.request('GET',`/api/attachments/${first.item.id}/file${suffix}`);status(res,200);assert.equal(res.headers.get('x-content-type-options'),'nosniff');assert(res.headers.get('cache-control').includes('no-store'));assert(res.headers.get('content-disposition').includes(suffix?'attachment':'inline'));assert.equal(crypto.createHash('sha256').update(res.bytes).digest('hex'),crypto.createHash('sha256').update(png).digest('hex'))}})
  await check('attachments: PDF is downloaded and byte-exact',async()=>{const res=await user.request('GET',`/api/attachments/${uploaded[1].item.id}/file`);status(res,200);assert(res.headers.get('content-disposition').startsWith('attachment'));assert.deepEqual(res.bytes,pdf)})
  for(const [name,bytes,mime] of [['fake.png',Buffer.from('not an image'),'image/png'],['fake.pdf',png,'application/pdf'],['fake.png',pdf,'image/png'],['fake.png',png,'application/pdf'],['photo.heic',Buffer.from('unsupported'),'image/heic']]) await check('attachments: reject mismatched '+name+' '+mime+' '+bytes.length,async()=>status(await user.request('POST',`/api/expenses/${main.item.id}/attachments`,multipart(bytes,name,mime)),400,'UNSUPPORTED_FORMAT'))
  await check('attachments: fifth allowed and sixth rejected',async()=>{const fifth=status(await user.request('POST',`/api/expenses/${main.item.id}/attachments`,multipart(png,'fifth.png','image/png')),201).item;uploaded.push({item:fifth,bytes:png});status(await user.request('POST',`/api/expenses/${main.item.id}/attachments`,multipart(png,'sixth.png','image/png')),400,'ATTACHMENT_LIMIT');assert.equal(status(await user.request('GET',`/api/expenses/${main.item.id}/attachments`),200).items.length,5)})
  await check('attachments: remove file and repeated removal returns 404',async()=>{const id=uploaded[3].item.id;status(await user.request('DELETE','/api/attachments/'+id),200);status(await user.request('GET',`/api/attachments/${id}/file`),404);status(await user.request('DELETE','/api/attachments/'+id),404)})
  const large=await expense({shop_id:state.shops[1].id,amount:'1.00',bill_month:'2024-01'})
  await check('attachments: exactly 10 MiB accepted and byte-exact',async()=>{const bytes=Buffer.alloc(10*1024*1024);png.copy(bytes);const item=status(await user.request('POST',`/api/expenses/${large.item.id}/attachments`,multipart(bytes,'10MiB.png','image/png'),{timeout:120000}),201).item;const download=await user.request('GET',`/api/attachments/${item.id}/file`,undefined,{timeout:120000});status(download,200);assert.deepEqual(download.bytes,bytes)})
  await check('attachments: over 10 MiB rejected',async()=>{const bytes=Buffer.alloc(10*1024*1024+1);png.copy(bytes);status(await user.request('POST',`/api/expenses/${large.item.id}/attachments`,multipart(bytes,'over.png','image/png'),{timeout:120000}),413,'PAYLOAD_TOO_LARGE')})
  const race=await expense({shop_id:state.shops[1].id,amount:'1.00',bill_month:'2024-01'})
  await check('attachments: parallel uploads enforce five-file maximum',async()=>{const replies=await Promise.all(Array.from({length:8},(_,i)=>user.request('POST',`/api/expenses/${race.item.id}/attachments`,multipart(png,`race${i}.png`,'image/png'))));assert.equal(replies.filter(x=>x.status===201).length,5);assert.equal(replies.filter(x=>x.status===400&&x.data.code==='ATTACHMENT_LIMIT').length,3);assert.equal(status(await user.request('GET',`/api/expenses/${race.item.id}/attachments`),200).items.length,5)})
  await check('attachments: deleting expense revokes attachment URLs',async()=>{const items=status(await user.request('GET',`/api/expenses/${race.item.id}/attachments`),200).items;status(await user.request('DELETE',`/api/expenses/${race.item.id}`),200);state.expenses.delete(race.item.id);for(const item of items)status(await user.request('GET',`/api/attachments/${item.id}/file`),404);status(await user.request('GET',`/api/expenses/${race.item.id}/attachments`),404)})

  await check('dashboard: month, previous month and natural-year amounts',async()=>{const data=status(await user.request('GET','/api/dashboard?'+new URLSearchParams({month:'2026-08',shop_id:state.shops[0].id})),200);assert.equal(data.month_total_cents,25000);assert.equal(data.month_count,2);assert.equal(data.prev_month_total_cents,10000);assert.equal(data.year_total_cents,42000);assert.equal(data.month_over_prev,1.5);assert.equal(data.trend.length,12);assert.equal(data.trend.at(-1).total_cents,25000);assert.equal(data.shops,null)})
  await check('dashboard: future prepayment included in same natural year',async()=>assert.equal(status(await user.request('GET','/api/dashboard?'+new URLSearchParams({month:'2026-07',shop_id:state.shops[0].id})),200).year_total_cents,42000))
  await check('dashboard: invalid month rejected',async()=>status(await user.request('GET','/api/dashboard?month=2026-13'),400))
  const reportFilter=filter({bill_month_from:'2026-08',bill_month_to:'2026-08'})
  await check('reports: filtered summary uses exact amounts',async()=>{const data=status(await user.request('GET','/api/reports'+reportFilter),200);assert.equal(data.total_count,2);assert.equal(data.total_amount_cents,25000);assert.equal(data.categories[0].total_cents,25000);assert(data.stat_basis.includes('账单月份'))})
  await check('reports: print data includes complete matching details',async()=>{const data=status(await user.request('GET','/api/reports/print-data'+reportFilter),200);assert.equal(data.total_count,2);assert.equal(data.total_amount_cents,25000);assert.equal(data.items.length,2);assert.equal(data.items_truncated,false)})
  await check('reports: Excel downloaded and parsed locally',async()=>{const res=await user.request('GET','/api/reports/excel'+reportFilter);status(res,200);assert(res.headers.get('content-type').includes('spreadsheetml'));assert(res.headers.get('content-disposition').includes("filename*=UTF-8''"));fs.writeFileSync(path.join(dir,'report.xlsx'),res.bytes);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(res.bytes);assert.deepEqual(workbook.worksheets.map(x=>x.name),['费用明细','分类汇总','说明']);const sheet=workbook.getWorksheet('费用明细');assert.equal(sheet.rowCount,4);assert.equal(sheet.getRow(4).getCell(4).value,250);const formula=Array.from({length:2},(_,i)=>sheet.getRow(i+2).getCell(6)).find(cell=>cell.value==='=SUM(1,1)');assert(formula);assert.equal(typeof formula.value,'string');assert.equal(workbook.getWorksheet('分类汇总').getRow(3).getCell(3).value,250)})
  await check('reports: empty filter yields empty report and valid Excel',async()=>{const qs=filter({keyword:run+'-absent'});assert.equal(status(await user.request('GET','/api/reports'+qs),200).total_count,0);assert.equal(status(await user.request('GET','/api/reports/print-data'+qs),200).items.length,0);const excel=await user.request('GET','/api/reports/excel'+qs);status(excel,200);const wb=new ExcelJS.Workbook();await wb.xlsx.load(excel.bytes);assert.equal(wb.getWorksheet('费用明细').rowCount,2)})

  const payrollBase=()=>'/api/payroll/members/'+state.payroll[0].id
  async function day(date,body) {state.days.add(state.payroll[0].id+'|'+date);return user.request('PATCH',payrollBase()+'/days/'+date,body)}
  await check('payroll: create independent wage member',async()=>{const item=status(await user.request('POST','/api/payroll/members',{name:' '+prefix+'-工资 ',hourly_rate_cents:2055}),201).item;state.payroll.push(item);assert.equal(item.name,prefix+'-工资');assert.equal(item.hourly_rate_cents,2055)},true)
  await check('payroll: member available from list',async()=>assert(status(await user.request('GET','/api/payroll/members'),200).items.some(x=>x.id===state.payroll[0].id)))
  await check('payroll: save leap day, update work hours and leave',async()=>{status(await day('2024-02-29',{status:'worked',hours_hundredths:125,hourly_rate_cents:2055}),200);status(await day('2024-02-28',{status:'worked',hours_hundredths:800,hourly_rate_cents:2055}),200);status(await day('2024-02-28',{status:'worked',hours_hundredths:750,hourly_rate_cents:2055}),200);status(await day('2024-02-27',{status:'leave',hours_hundredths:0,hourly_rate_cents:2055}),200);status(await day('2024-03-01',{status:'worked',hours_hundredths:100,hourly_rate_cents:2055}),200);const calendar=status(await user.request('GET',payrollBase()+'/calendar?month=2024-02'),200);assert.equal(calendar.days.length,3);assert.deepEqual(calendar.summary,{amount_cents:17982,hours_hundredths:875,worked_days:2,leave_days:1});assert.equal(calendar.days.at(-1).amount_cents,2569)})
  await check('payroll: new default wage preserves historical daily wage',async()=>{status(await user.request('PATCH',payrollBase(),{name:prefix+'-工资',hourly_rate_cents:3000}),200);const calendar=status(await user.request('GET',payrollBase()+'/calendar?month=2024-02'),200);assert.equal(calendar.member.hourly_rate_cents,3000);assert.equal(calendar.summary.amount_cents,17982);assert.equal(calendar.days.at(-1).hourly_rate_cents,2055)})
  await check('payroll: next-day pre-entry excluded from actual summary',async()=>{const calendar=status(await user.request('GET',payrollBase()+'/calendar'),200);state.today=calendar.today;state.month=calendar.month;const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());assert.equal(calendar.today,current);const tomorrow=new Date(calendar.today+'T00:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const future=tomorrow.toISOString().slice(0,10);status(await day(future,{status:'worked',hours_hundredths:800,hourly_rate_cents:2000}),200);const futureCalendar=status(await user.request('GET',payrollBase()+'/calendar?month='+future.slice(0,7)),200);assert.equal(futureCalendar.days.find(x=>x.work_date===future).amount_cents,16000);assert.equal(futureCalendar.summary.amount_cents,0)})
  const dayBody={status:'worked',hours_hundredths:800,hourly_rate_cents:2000}
  for(const date of ['2025-02-29','2024-04-31','2024-13-01','1999-12-31','2024-2-01']) await check('payroll: reject date '+date,async()=>status(await user.request('PATCH',payrollBase()+'/days/'+date,dayBody),400))
  for(const [name,over] of [['zero hours',{hours_hundredths:0}],['negative hours',{hours_hundredths:-1}],['over 24 hours',{hours_hundredths:2401}],['fractional hundredths',{hours_hundredths:1.5}],['zero wage',{hourly_rate_cents:0}],['over wage limit',{hourly_rate_cents:1000000}],['leave with hours',{status:'leave'}],['invalid status',{status:'invalid'}]]) await check('payroll: reject '+name,async()=>status(await user.request('PATCH',payrollBase()+'/days/2024-02-29',{...dayBody,...over}),400))
  for(const body of [{name:' ',hourly_rate_cents:2000},{name:'x'.repeat(51),hourly_rate_cents:2000},{name:'test',hourly_rate_cents:0}]) await check('payroll: reject invalid member '+body.name.length+' '+body.hourly_rate_cents,async()=>status(await user.request('POST','/api/payroll/members',body),400))
  await check('payroll: reject invalid month and missing member',async()=>{status(await user.request('GET',payrollBase()+'/calendar?month=2024-13'),400);status(await user.request('GET','/api/payroll/members/'+missing+'/calendar'),404)})
  await check('payroll: clear one day without touching other days',async()=>{status(await user.request('DELETE',payrollBase()+'/days/2024-02-29'),200);const calendar=status(await user.request('GET',payrollBase()+'/calendar?month=2024-02'),200);assert.equal(calendar.days.length,2);assert.equal(calendar.summary.amount_cents,15413)})

  await check('backup: status honestly reports cloud disabled',async()=>{const data=status(await user.request('GET','/api/backup/status'),200);assert.equal(data.cloud.enabled,false);assert.equal(data.cloud.state,'disabled');assert.equal(data.local.attachments_included,true)})
  await check('backup: cloud request explicitly rejected',async()=>status(await user.request('POST','/api/backup/runs',{provider:'aliyundrive'}),400,'CLOUD_NOT_CONFIGURED'))
  await check('backup: malformed provider rejected',async()=>status(await user.request('POST','/api/backup/runs',{provider:'invalid'}),400))
  await check('backup: manual job completes through HTTP polling',async()=>{const started=await user.request('POST','/api/backup/runs',{provider:'local'});assert([200,202].includes(started.status));const jobId=started.data.job_id;state.backupJob=jobId;let job;const deadline=Date.now()+60000;while(Date.now()<deadline){const listing=status(await user.request('GET','/api/backup/runs?page=1&page_size=100'),200);job=listing.items.find(x=>x.id===jobId);if(job&&job.status!=='running')break;await delay(500)}assert.equal(job?.status,'success',job?.error_message||'Backup did not complete');assert(job.size_bytes>0);assert(job.snapshot_at);assert(job.file_name.endsWith('.sqlite.gz'));const statusBody=status(await user.request('GET','/api/backup/status'),200);assert.equal(statusBody.running,false);assert.equal(statusBody.local.last_file_name,job.file_name)})
  await check('backup: pagination reflects job metadata',async()=>{const data=status(await user.request('GET','/api/backup/runs?page=1&page_size=1'),200);assert.equal(data.page_size,1);assert(data.total>=1);assert.equal(data.items.length,1)})

  for(const [method,route] of (await import('./remote-http-client.mjs')).routes.filter(([,p])=>p!=='/api/health'&&p!=='/api/auth/login')) await check('anonymous: denied '+method+' '+route,async()=>{const pathname=route.replace(/:[a-z_]+/g,missing);status(await anon.request(method,pathname,method==='GET'?undefined:{}),401)})
  await check('security: session cookie flags and random cookie rejection',async()=>{const login=h.client();const response=await login.request('POST','/api/auth/login',{username:state.testUsername,password:state.testPassword});status(response,200);const cookie=response.headers.get('set-cookie');assert(cookie.includes('HttpOnly'));assert(cookie.toLowerCase().includes('samesite=lax'));const session=h.client({cookie:cookie.split(';')[0],csrf:response.data.csrf_token});status(await session.request('POST','/api/auth/logout'),200);status(await anon.request('GET','/api/auth/me',undefined,{headers:{Cookie:'famsid=made-up-session'}}),401)})
  await check('security: oversized JSON rejected without mutation',async()=>status(await user.request('POST','/api/shops',JSON.stringify({name:'x'.repeat(70*1024)}),{headers:{'Content-Type':'application/json'}}),413))
  await check('routing: unknown API returns JSON 404',async()=>{const res=await anon.request('GET','/api/not-a-route');status(res,404,'NOT_FOUND');assert(res.headers.get('content-type').includes('application/json'))})

  fs.writeFileSync(path.join(dir,'test-user.env'),`USERNAME=${state.testUsername}\nPASSWORD=${state.testPassword}\nBASE_URL=${baseURL}\n`)
  await browserChecks(h,state,user,png)
  await check('auth: sequential sixth failed login is rate limited',async()=>{const username=run+'_limit';for(let i=0;i<5;i++)status(await anon.request('POST','/api/auth/login',{username,password:'invalid-password'}),401);status(await anon.request('POST','/api/auth/login',{username,password:'invalid-password'}),429,'RATE_LIMITED')})
  await user.login(state.testUsername,state.testPassword) // Clear only the shared test client's IP failure bucket.
  await check('auth: concurrent failures cannot exceed five per account',async()=>{const username=run+'_race';const replies=await Promise.all(Array.from({length:8},()=>anon.request('POST','/api/auth/login',{username,password:'invalid-password'})));state.concurrentLoginStatuses=replies.map(x=>x.status);assert(replies.filter(x=>x.status===401).length<=5,'Concurrent login accepted '+replies.filter(x=>x.status===401).length+' failed attempts before throttling; expected at most 5');assert(replies.every(x=>[401,429].includes(x.status)))})
  await user.login(state.testUsername,state.testPassword)
  await check('auth: logout destroys session over real network',async()=>{status(await user.request('POST','/api/auth/logout'),200);status(await user.request('GET','/api/auth/me'),401)})
} catch(error) {
  console.log('Dependent scenario stopped: '+h.sanitize(error.message))
} finally {
  await cleanup()
  const report=h.save({run,testPrefix:prefix,concurrentLoginStatuses:state.concurrentLoginStatuses,backupJob:state.backupJob,limitations:[
    'Cloudflare Tunnel/Access and HTTPS production cookies are not configured.',
    '7-day scheduling, process/container restart, disk/network failures and session expiry are not forced.',
    '1000-row print and 10000-row Excel limit boundaries were not populated on the live database.',
    'Backup completion and metadata are observed via HTTP; no backup download/restore endpoint exists, so file-group integrity and restore are not asserted.',
    'API has no delete for users/shops/categories/payroll members; test users and dictionaries are disabled; empty wage member remains labelled.',
    'Valid PNG/JPEG/WEBP/PDF fixtures are transferred; oversized padded PNG is a size-boundary fixture, not a normal photo.'
  ]})
  const failed=report.results.filter(x=>x.status==='failed')
  const covered=report.coverage.filter(x=>x.success).length
  const lines=[ '# AutoDL 本机真实网络测试报告', '', '测试日期：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'full',timeStyle:'long'}).format(new Date()), '', `测试方向：Windows 本机 → http://127.0.0.1:13000 → SSH 隧道 → AutoDL 后端。测试进程、浏览器、Excel/PDF 解析均在本机，未在服务器运行测试代码，也未注入数据库。`, '', `结果：${report.results.length-failed.length} 通过，${failed.length} 失败；成功覆盖 ${covered}/${report.coverage.length} 个 HTTP 路由；发出 ${report.requests.length} 个已完成 HTTP 请求。`, '', '## 失败项', '', ...failed.map(x=>'- '+x.name+'：'+x.error), ...(failed.length?[]:['无。']), '', '## 路由覆盖', '', '| 方法 | 路径 | 请求数 | 成功路径 |','| --- | --- | ---: | --- |',...report.coverage.map(x=>`| ${x.method} | ${x.path} | ${x.requests} | ${x.success?'通过':'未覆盖'} |`),'','## 测试明细','',...report.results.map(x=>`- ${x.status==='passed'?'通过':'失败'}：${x.name}（${x.durationMs} ms）`),'','## 数据清理','',...report.cleanups.map(x=>'- '+x.kind+' '+(x.id||'')+'：'+x.status+(x.error?'；'+x.error:'')),'','## 尚未验证的范围','',...report.limitations.map(x=>'- '+x),'','原始请求耗时、HTTP 状态及测试结果：`artifacts/autodl/remote-tests/'+run+'/results.json`。下载文件和截图在同一私有目录，均已被 Git 忽略。','']
  fs.writeFileSync(path.join(root,'artifacts/autodl-real-network-test-report.md'),lines.join('\n'))
  console.log(JSON.stringify({run,passed:report.results.length-failed.length,failed:failed.length,routeCoverage:covered+'/'+report.coverage.length,requests:report.requests.length,cleanupFailures:report.cleanups.filter(x=>x.status==='failed').length}))
  process.exitCode=failed.length||report.cleanups.some(x=>x.status==='failed')||covered!==report.coverage.length?1:0
}