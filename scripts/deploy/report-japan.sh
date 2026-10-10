#!/usr/bin/env bash
set -euo pipefail
export HOMEMANAGER_DEPLOY_BASE="${HOMEMANAGER_DEPLOY_BASE:-$HOME/homemanager}"
BASE="$HOMEMANAGER_DEPLOY_BASE"
cd "$BASE/app"
"$BASE/runtime/node/bin/node" --input-type=module - <<'JS'
import Database from './apps/server/node_modules/better-sqlite3/lib/index.js'
import { loadConfig } from './apps/server/dist/config.js'
import { BackupService } from './apps/server/dist/modules/backup/service.js'
const config=loadConfig()
const db=new Database(config.databasePath,{readonly:true})
try{
 const backup=new BackupService(db,config)
 const last=backup.latestRun('googledrive','success')
 console.log(JSON.stringify({env:config.env,host:config.host,port:config.port,cloud_enabled:config.googleDriveEnabled,keep:config.googleDriveKeep,next_due:backup.nextDueAt('googledrive'),last_cloud_backup:last?{status:last.status,file_name:last.file_name,sha256:last.sha256}:null,integrity:db.pragma('integrity_check',{simple:true}),foreign_key_errors:db.pragma('foreign_key_check').length,counts:Object.fromEntries(['users','shops','expense_categories','expenses','expense_attachments','payroll_members','payroll_days'].map(t=>[t,db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n]))}))
}finally{db.close()}
JS
python3 - <<'PY'
import json,subprocess,time,os
from pathlib import Path
services={}
for unit in ['homemanager.service','homemanager-tunnel.service']:
 r=subprocess.run(['systemctl','show',unit,'--property=Id','--property=ActiveState','--property=MainPID','--property=MemoryCurrent','--property=ControlGroup','--property=NRestarts'],capture_output=True,text=True,check=True)
 fields=dict(x.split('=',1) for x in r.stdout.splitlines() if '=' in x)
 group=Path('/sys/fs/cgroup')/fields.get('ControlGroup','').lstrip('/')
 for filename in ['memory.current','memory.peak','memory.events']:
  p=group/filename
  if p.exists():fields[filename]=p.read_text().strip()
 pid=fields.get('MainPID','0')
 p=Path('/proc')/pid/'status'
 if p.exists():
  st={line.split(':',1)[0]:line.split(':',1)[1].strip() for line in p.read_text().splitlines() if ':' in line}
  fields['rss']=st.get('VmRSS');fields['rss_peak']=st.get('VmHWM')
 services[unit]=fields
mem={line.split(':')[0]:line.split(':')[1].strip() for line in Path('/proc/meminfo').read_text().splitlines() if ':' in line}
result={'services':services,'available_memory':mem['MemAvailable'],'swap':mem['SwapTotal'],'disk':subprocess.run(['df','-Pk','/'],capture_output=True,text=True,check=True).stdout.strip(),'project_disk_bytes':subprocess.run(['du','-sB1',os.environ['HOMEMANAGER_DEPLOY_BASE']],capture_output=True,text=True,check=True).stdout.split()[0]}
p=Path(os.environ['HOMEMANAGER_DEPLOY_BASE'])/'data/verification/final-deployment.json'
p.write_text(json.dumps(result,indent=2)+'\n');p.chmod(0o600)
print(json.dumps(result))
PY
sudo ss -ltnp | grep -E ':3000\b'
