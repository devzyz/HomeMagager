import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadConfig } from '../../apps/server/dist/config.js'
import { openDatabase } from '../../apps/server/dist/database/connection.js'
import { hashPassword,verifyPassword,validatePassword,normalizeUsername,validateDisplayName } from '../../apps/server/dist/security/password.js'
const file=process.argv[2]
if(!file)throw new Error('Provide a private provisioning JSON path')
const input=JSON.parse(fs.readFileSync(file,'utf8'))
const username=normalizeUsername(input.username)
if(username.length>254||!/^\S+@\S+\.\S+$/.test(username))throw new Error('A valid explicitly requested email account is required')
const password=validatePassword(input.password)
const displayName=validateDisplayName(input.display_name)
if(typeof password!=='string'||typeof displayName!=='string')throw new Error('Invalid account provisioning input')
const config=loadConfig()
const db=openDatabase(config.databasePath)
try{
 const existing=db.prepare('SELECT * FROM users WHERE username=?').get(username)
 if(existing){
  if(existing.is_active!==1||!(await verifyPassword(existing.password_hash,password)))throw new Error('Existing account differs; no credentials were changed')
  console.log(JSON.stringify({account_already_exists:true,password_matches:true,must_change_password:existing.must_change_password===1}))
 }else{
  const directory=path.join(path.dirname(config.backupDir),'private-recovery','before-member-add-')+new Date().toISOString().replace(/[:.]/g,'-')
  fs.mkdirSync(directory,{recursive:true,mode:0o700})
  await db.backup(directory+'/database.db')
  fs.chmodSync(directory+'/database.db',0o600)
  const hashed=await hashPassword(password)
  const now=new Date().toISOString()
  db.prepare('INSERT INTO users(id,username,display_name,password_hash,is_active,must_change_password,created_at,updated_at) VALUES(?,?,?,?,1,1,?,?)').run(crypto.randomUUID(),username,displayName,hashed,now,now)
  console.log(JSON.stringify({account_created:true,active:true,must_change_password:true,user_count:db.prepare('SELECT COUNT(*) AS n FROM users').get().n}))
 }
 if(db.pragma('foreign_key_check').length)throw new Error('Database foreign key validation failed')
 // Verify the running server accepts the exact requested email, then discard this test session.
 const origin=config.baseUrl??'http://127.0.0.1:'+config.port
 const login=await fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({username,password})})
 if(login.status!==200)throw new Error('Requested account did not pass real server login verification')
 const body=await login.json()
 const cookie=login.headers.get('set-cookie')?.split(';')[0]
 if(!cookie||body.user.username!==username)throw new Error('Login session response mismatch')
 const me=await fetch('http://127.0.0.1:3000/api/auth/me',{headers:{Cookie:cookie}})
 if(me.status!==200)throw new Error('Authenticated profile verification failed')
 const logout=await fetch('http://127.0.0.1:3000/api/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':body.csrf_token}})
 if(logout.status!==200)throw new Error('Verification session cleanup failed')
 console.log(JSON.stringify({login_verified:true,profile_verified:true,verification_session_removed:true}))
}finally{db.close();fs.rmSync(file,{force:true})}
