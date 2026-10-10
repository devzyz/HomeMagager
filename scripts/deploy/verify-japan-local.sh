#!/usr/bin/env bash
set -euo pipefail
export HOMEMANAGER_DEPLOY_BASE="${HOMEMANAGER_DEPLOY_BASE:-$HOME/homemanager}"
: "${HOMEMANAGER_BASE_URL:?Set the production HTTPS origin}"
export HOMEMANAGER_BASE_URL
sudo systemctl start homemanager.service
python3 - <<'PY'
import json,time,urllib.request,urllib.error,subprocess,os
from pathlib import Path
for attempt in range(20):
 try:
  with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=2) as response:
   data=json.load(response)
  print(json.dumps({'health':data}))
  break
 except Exception:
  time.sleep(1)
else: raise RuntimeError('Application health check failed')
for path,expected in [('/about',200),('/privacy',200),('/api/expenses',401),('/api/backup/status',401)]:
 try:
  with urllib.request.urlopen('http://127.0.0.1:3000'+path,timeout=3) as response: status=response.status
 except urllib.error.HTTPError as error: status=error.code
 if status!=expected: raise RuntimeError('Unexpected response: '+path)
 print(json.dumps({'path':path,'status':status}))
node=os.environ['HOMEMANAGER_DEPLOY_BASE']+'/runtime/node/bin/node'
code="import Database from './apps/server/node_modules/better-sqlite3/lib/index.js'; const db=new Database(process.env.HOMEMANAGER_DEPLOY_BASE+'/data/database/family-expense.db',{readonly:true}); const row=db.prepare('SELECT username FROM users WHERE is_active=1 LIMIT 1').get(); process.stdout.write(row?.username??''); db.close();"
r=subprocess.run([node,'--input-type=module','-e',code],cwd=os.environ['HOMEMANAGER_DEPLOY_BASE']+'/app',capture_output=True,text=True,check=True)
request=urllib.request.Request('http://127.0.0.1:3000/api/auth/login',data=json.dumps({'username':r.stdout,'password':'MigrationSmokeWrongPassword-'+str(time.time())}).encode(),headers={'Content-Type':'application/json','Origin':os.environ['HOMEMANAGER_BASE_URL']},method='POST')
try:
 with urllib.request.urlopen(request,timeout=10) as response: status=response.status
except urllib.error.HTTPError as error: status=error.code
if status!=401: raise RuntimeError('Expected rejected authentication smoke check')
print(json.dumps({'single_password_validation_status':status}))
for unit in ['homemanager.service','homemanager-tunnel.service']:
 r=subprocess.run(['systemctl','show',unit,'--property=Id','--property=ActiveState','--property=MainPID','--property=MemoryCurrent','--property=ControlGroup'],capture_output=True,text=True)
 print(r.stdout.strip())
mem={line.split(':')[0]:line.split(':')[1].strip() for line in Path('/proc/meminfo').read_text().splitlines() if ':' in line}
print(json.dumps({'available_memory':mem['MemAvailable'],'swap':mem['SwapTotal']}))
PY
