#!/usr/bin/env bash
set -euo pipefail
umask 077
BASE=/root/autodl-tmp/homemanager
export PATH="$BASE/runtime/node/bin:$BASE/runtime/pnpm/bin:$PATH"
cd "$BASE"
sha256sum --check homemanager.tar.gz.sha256
RELEASE="$BASE/releases/$(cut -c 1-12 homemanager.tar.gz.sha256)"
mkdir -p "$RELEASE"
tar -xzf homemanager.tar.gz -C "$RELEASE"
cd "$RELEASE"
CI=true PNPM_DISABLE_SELF_UPDATE_CHECK=true pnpm install --prefer-offline --prod --frozen-lockfile --filter @hm/server... --network-concurrency=4 --child-concurrency=1
python - <<'PY'
import os
import pathlib
import secrets
base = pathlib.Path('/root/autodl-tmp/homemanager')
config = base / 'config' / 'app.env'
if not config.exists():
    config.write_text('\n'.join([
        'NODE_ENV=development', 'HOST=127.0.0.1', 'PORT=3000',
        'BASE_URL=http://127.0.0.1:13000', 'TRUST_PROXY=false', 'TZ=Asia/Shanghai',
        'SESSION_SECRET=' + secrets.token_hex(32),
        'DATABASE_PATH=' + str(base / 'data/database/family-expense.db'),
        'UPLOAD_DIR=' + str(base / 'data/uploads'),
        'BACKUP_DIR=' + str(base / 'data/backups'),
        'BACKUP_INTERVAL_DAYS=7', 'LOCAL_BACKUP_KEEP=2', 'ALIYUN_DRIVE_ENABLED=false', ''
    ]), encoding='utf-8')
    config.chmod(0o600)
link = pathlib.Path.cwd() / '.env'
if not link.exists():
    link.symlink_to(config)
supervisor = f'''[unix_http_server]
file={base}/run/supervisor.sock
chmod=0600

[supervisord]
logfile={base}/logs/supervisord.log
logfile_maxbytes=5MB
logfile_backups=2
pidfile={base}/run/supervisord.pid
childlogdir={base}/logs
user=root

[rpcinterface:supervisor]
supervisor.rpcinterface_factory=supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix://{base}/run/supervisor.sock

[program:homemanager]
directory={base}/app
command={base}/runtime/node/bin/node apps/server/dist/server.js
user=root
autostart=true
autorestart=true
startsecs=3
startretries=5
stopasgroup=true
killasgroup=true
stopsignal=TERM
stopwaitsecs=60
stdout_logfile={base}/logs/app.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
redirect_stderr=true
environment=TZ="Asia/Shanghai",PATH="{base}/runtime/node/bin:/usr/local/bin:/usr/bin:/bin"
'''
supervisor_config = base / 'config/supervisor.ini'
if not supervisor_config.exists():
    supervisor_config.write_text(supervisor, encoding='utf-8')
PY
HOMEMANAGER_BOOTSTRAP_FILE="$BASE/secrets/bootstrap.env" node scripts/deploy/bootstrap-autodl.mjs
node --input-type=module - <<'JS'
import Database from './apps/server/node_modules/better-sqlite3/lib/index.js'
const db = new Database(':memory:')
if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite check failed')
db.close()
console.log('Linux SQLite native module OK')
JS
ln -sfn "$RELEASE" "$BASE/app"
SUPERVISORD=/root/miniconda3/bin/supervisord
SUPERVISORCTL=/root/miniconda3/bin/supervisorctl
CONF="$BASE/config/supervisor.ini"
if "$SUPERVISORCTL" -c "$CONF" pid >/dev/null 2>&1; then
  "$SUPERVISORCTL" -c "$CONF" reread
  "$SUPERVISORCTL" -c "$CONF" update
  "$SUPERVISORCTL" -c "$CONF" restart homemanager
else
  "$SUPERVISORD" -c "$CONF"
fi
for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:3000/api/health; then
    printf '\n'
    "$SUPERVISORCTL" -c "$CONF" status
    exit 0
  fi
  sleep 1
done
"$SUPERVISORCTL" -c "$CONF" status
exit 1