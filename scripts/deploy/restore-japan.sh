#!/usr/bin/env bash
set -euo pipefail
export HOMEMANAGER_DEPLOY_BASE="${HOMEMANAGER_DEPLOY_BASE:-$HOME/homemanager}"
BASE="$HOMEMANAGER_DEPLOY_BASE"
cd "$BASE/app"
"$BASE/runtime/node/bin/node" --input-type=module - <<'JS'
import { restoreFromArchive } from './apps/server/dist/modules/backup/restore.js'
import fs from 'node:fs'
import path from 'node:path'
const base=process.env.HOMEMANAGER_DEPLOY_BASE
const source=process.env.HOMEMANAGER_RESTORE_SOURCE??path.join(base,'staging/backup')
const files=fs.readdirSync(source).filter(x=>/^family-expense-\d{8}-\d{6}-[0-9a-f]{8}\.sqlite\.gz$/.test(x))
if(files.length!==1)throw new Error('Expected exactly one complete migration backup')
const file=files[0]
const result=await restoreFromArchive({archivePath:path.join(source,file),metaPath:path.join(source,file+'.json'),targetDbPath:path.join(base,'data/database/family-expense.db'),targetUploadDir:path.join(base,'data/uploads')})
console.log(JSON.stringify({restore: 'OK', users:result.users,expenses:result.expenses,attachments:result.attachments,sha256:result.sha256}))
JS
