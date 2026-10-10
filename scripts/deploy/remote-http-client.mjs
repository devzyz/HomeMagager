// Every request uses a real local TCP connection to the deployed AutoDL service.
import fs from 'node:fs'
import os from 'node:os'
import assert from 'node:assert/strict'

export const routes = [
  ['GET','/api/health'],
  ['POST','/api/auth/login'],['GET','/api/auth/me'],['POST','/api/auth/change-password'],['POST','/api/auth/logout'],
  ['GET','/api/users'],['POST','/api/users'],['PATCH','/api/users/:id/display-name'],['PATCH','/api/users/:id/active'],['POST','/api/users/:id/reset-password'],
  ...['shops','categories'].flatMap(name => [['GET',`/api/${name}`],['POST',`/api/${name}`],['PATCH',`/api/${name}/sort`],['PATCH',`/api/${name}/:id`],['PATCH',`/api/${name}/:id/active`]]),
  ['GET','/api/expenses'],['POST','/api/expenses'],['GET','/api/expenses/:id'],['PATCH','/api/expenses/:id'],['DELETE','/api/expenses/:id'],
  ['GET','/api/expenses/:id/attachments'],['POST','/api/expenses/:id/attachments'],['GET','/api/attachments/:id/file'],['DELETE','/api/attachments/:id'],
  ['GET','/api/dashboard'],['GET','/api/reports'],['GET','/api/reports/print-data'],['GET','/api/reports/excel'],
  ['GET','/api/payroll/members'],['POST','/api/payroll/members'],['PATCH','/api/payroll/members/:id'],['GET','/api/payroll/members/:id/calendar'],['PATCH','/api/payroll/members/:id/days/:date'],['DELETE','/api/payroll/members/:id/days/:date'],
  ['GET','/api/backup/status'],['GET','/api/backup/runs'],['POST','/api/backup/runs'],
]
export function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const i=line.indexOf('='); let value=line.slice(i+1)
    if (value.length>1 && value[0]===value.at(-1) && ['\"',"'"].includes(value[0])) value=value.slice(1,-1)
    return [line.slice(0,i).trim(),value]
  }))
}
export function makeHarness(baseURL, dir) {
  const url=new URL(baseURL)
  assert(['127.0.0.1','localhost'].includes(url.hostname),'Use the existing local SSH tunnel')
  const results=[], requests=[], cleanups=[]
  const secrets=new Set()
  let current='setup'
  const sanitize = message => { let text=String(message); for(const secret of secrets) if(secret) text=text.replaceAll(secret,'[REDACTED]'); return text }
  function client(session=null) {
    return {
      session,
      async request(method, pathname, body=undefined, options={}) {
        const headers={}
        if(method!=='GET') headers.Origin=baseURL
        if(this.session) { headers.Cookie=this.session.cookie; if(method!=='GET') headers['x-csrf-token']=this.session.csrf }
        Object.assign(headers,options.headers||{})
        for(const key of options.omit||[]) delete headers[key]
        let payload
        if(body instanceof FormData || typeof body==='string' || Buffer.isBuffer(body)) payload=body
        else if(body!==undefined) {headers['Content-Type']='application/json';payload=JSON.stringify(body)}
        const start=performance.now()
        const response=await fetch(baseURL+pathname,{method,headers,body:payload,redirect:'manual',signal:AbortSignal.timeout(options.timeout||60000)})
        const bytes=Buffer.from(await response.arrayBuffer())
        let data
        if((response.headers.get('content-type')||'').includes('application/json')) data=JSON.parse(bytes.toString('utf8'))
        const path=pathname.split('?')[0]
        const matching=routes.find(([verb,route]) => verb===method && new RegExp('^'+route.replace(/:[a-z_]+/g,'[^/]+')+'$').test(path))
        requests.push({case:current,method,path:pathname,status:response.status,bytes:bytes.length,durationMs:Math.round(performance.now()-start),route:matching?.join(' '),requestId:data?.request_id})
        return {status:response.status,data,bytes,headers:response.headers}
      },
      async login(username,password) {
        secrets.add(password)
        const res=await this.request('POST','/api/auth/login',{username,password})
        status(res,200)
        const cookie=res.headers.get('set-cookie')?.split(';')[0]
        assert(cookie,'Login must set session cookie')
        this.session={cookie,csrf:res.data.csrf_token}
        secrets.add(cookie);secrets.add(res.data.csrf_token)
        return res.data.user
      }
    }
  }
  async function check(name, fn, critical=false) {
    current=name
    const start=performance.now()
    try { const value=await fn(); results.push({name,status:'passed',durationMs:Math.round(performance.now()-start)}); console.log('PASS '+name); return value }
    catch(error) {const message=sanitize(error.message);results.push({name,status:'failed',durationMs:Math.round(performance.now()-start),error:message});console.log('FAIL '+name+': '+message);if(critical)throw error}
  }
  function save(extra={}) {
    const coverage=routes.map(([method,path]) => ({method,path,requests:requests.filter(r=>r.route===method+' '+path).length,success:requests.some(r=>r.route===method+' '+path && r.status>=200 && r.status<300)}))
    const result={testedAt:new Date().toISOString(),executionHost:os.hostname(),platform:process.platform,baseURL,transport:'Windows localhost TCP -> password-authenticated SSH direct-tcpip -> AutoDL loopback HTTP',serverSideTestExecution:false,results,requests,coverage,cleanups,...extra}
    fs.writeFileSync(dir+'/results.json',JSON.stringify(result,null,2))
    return result
  }
  return {client,check,results,requests,cleanups,secrets,save,sanitize}
}
export function status(res,expected,code) {
  assert.equal(res.status,expected,`HTTP status (error code: ${res.data?.code||'none'})`)
  if(code) assert.equal(res.data?.code,code)
  return res.data
}
export function multipart(bytes,name,mime) {
  const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),name);return form
}
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))