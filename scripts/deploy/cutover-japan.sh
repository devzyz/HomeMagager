#!/usr/bin/env bash
set -euo pipefail
export HOMEMANAGER_DEPLOY_BASE="${HOMEMANAGER_DEPLOY_BASE:-$HOME/homemanager}"
BASE="$HOMEMANAGER_DEPLOY_BASE"
cd "$BASE/app"
"$BASE/runtime/node/bin/node" --input-type=module - <<'JS'
import fs from 'node:fs'
import Database from './apps/server/node_modules/better-sqlite3/lib/index.js'
const expected=JSON.parse(fs.readFileSync(process.env.HOMEMANAGER_DEPLOY_BASE+'/staging/final-counts.json','utf8'))
const db=new Database(process.env.HOMEMANAGER_DEPLOY_BASE+'/data/database/family-expense.db',{readonly:true})
try{
 for(const [table,count] of Object.entries(expected))if(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n!==count)throw new Error('Migration row count mismatch: '+table)
 if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length)throw new Error('Integrity check failed')
 console.log('All business table counts and database integrity match the source.')
}finally{db.close()}
JS
sudo systemctl enable --now homemanager.service
for attempt in $(seq 1 20); do
 if curl --silent --fail http://127.0.0.1:3000/api/health; then break; fi
 sleep 1
done
curl --silent --fail http://127.0.0.1:3000/api/health >/dev/null
sudo systemctl enable --now homemanager-tunnel.service
sudo systemctl is-active homemanager.service homemanager-tunnel.service
