#!/usr/bin/env bash
set -euo pipefail
umask 077
export HOMEMANAGER_DEPLOY_BASE="${HOMEMANAGER_DEPLOY_BASE:-$HOME/homemanager}"
BASE="$HOMEMANAGER_DEPLOY_BASE"
cd "$BASE/staging"
sha256sum --check SHA256SUMS
RELEASE="$BASE/releases/$(sha256sum app-linux.tar.gz | cut -c1-12)"
mkdir -p "$RELEASE"
tar --no-same-owner -xzf app-linux.tar.gz -C "$RELEASE"
tar --no-same-owner -xzf runtime-linux.tar.gz -C "$BASE/runtime"
chmod 0755 "$BASE/runtime/node/bin/node" "$BASE/runtime/rclone" "$BASE/runtime/cloudflared"
ln -s "$BASE/config/app.env" "$RELEASE/.env"
ln -s "$RELEASE" "$BASE/app"
cat > "$BASE/runtime/rclone-low-memory" <<'SH'
#!/usr/bin/env sh
WRAPPER_BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$WRAPPER_BASE/runtime/rclone" "$@" --cache-dir="$WRAPPER_BASE/data/rclone-cache" --transfers=1 --checkers=2 --buffer-size=1M --max-buffer-memory=16M --drive-chunk-size=8M
SH
chmod 0700 "$BASE/runtime/rclone-low-memory"
"$BASE/runtime/node/bin/node" --version
"$BASE/runtime/rclone" version | head -n1
"$BASE/runtime/cloudflared" --version
cd "$BASE/app"
"$BASE/runtime/node/bin/node" --input-type=module - <<'JS'
import Database from './apps/server/node_modules/better-sqlite3/lib/index.js'
const db=new Database(':memory:')
if(db.prepare('SELECT 1 AS ok').get().ok!==1)throw new Error('SQLite native dependency check failed')
db.close()
console.log('Linux native SQLite dependency: OK')
JS
python3 - <<'PY'
from pathlib import Path
import subprocess,os,pwd,grp,re
units={
'homemanager.service':'''[Unit]
Description=HomeManager application
After=network.target
[Service]
Type=simple
User=__HM_USER__
Group=__HM_GROUP__
WorkingDirectory=__HM_DEPLOY_BASE__/app
ExecStart=__HM_DEPLOY_BASE__/runtime/node/bin/node --max-old-space-size=192 apps/server/dist/server.js
Environment=TZ=Asia/Shanghai
Restart=on-failure
RestartSec=5
TimeoutStopSec=90
KillSignal=SIGTERM
MemoryAccounting=true
MemoryHigh=240M
MemoryMax=320M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=__HM_DEPLOY_BASE__/data __HM_DEPLOY_BASE__/config/google-drive __HM_DEPLOY_BASE__/logs
UMask=0077
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
''',
'homemanager-tunnel.service':'''[Unit]
Description=HomeManager Cloudflare connector
After=network-online.target homemanager.service
Wants=network-online.target
Requires=homemanager.service
[Service]
Type=simple
User=__HM_USER__
Group=__HM_GROUP__
WorkingDirectory=__HM_DEPLOY_BASE__
ExecStart=__HM_DEPLOY_BASE__/runtime/cloudflared tunnel --no-autoupdate --protocol http2 run --token-file __HM_DEPLOY_BASE__/secrets/cloudflare-tunnel.token
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
MemoryAccounting=true
MemoryMax=96M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
UMask=0077
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
'''}
base=os.environ['HOMEMANAGER_DEPLOY_BASE']
if not re.fullmatch(r'/[A-Za-z0-9_./-]+',base): raise ValueError('Deployment base must be an absolute path without spaces or control characters')
user=pwd.getpwuid(os.getuid()).pw_name
group=grp.getgrgid(os.getgid()).gr_name
for name,text in units.items():
 text=text.replace('__HM_DEPLOY_BASE__',base).replace('__HM_USER__',user).replace('__HM_GROUP__',group)
 dest=Path('/etc/systemd/system')/name
 if dest.exists(): raise RuntimeError('Refusing to overwrite an existing unit: '+name)
 temporary=Path(base)/'staging'/name
 temporary.write_text(text)
 subprocess.run(['sudo','install','-m','0644',str(temporary),str(dest)],check=True)
print('Created only HomeManager application and connector units; neither started yet.')
PY
sudo systemctl daemon-reload
