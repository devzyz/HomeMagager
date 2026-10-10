#!/usr/bin/env bash
set -euo pipefail
umask 077
BASE=/root/autodl-tmp/homemanager
cd "$BASE/runtime"
sha256sum --check rclone.sha256
chmod 0755 rclone
./rclone version
mkdir -p "$BASE/config/google-drive"
chmod 0700 "$BASE/config/google-drive"
python - <<'PY'
from pathlib import Path
base = Path('/root/autodl-tmp/homemanager')
file = base / 'config/app.env'
text = file.read_text()
keys = {line.partition('=')[0] for line in text.splitlines()}
defaults = {
    'GOOGLE_DRIVE_ENABLED': 'false',
    'GOOGLE_DRIVE_CONFIG': str(base / 'config/google-drive/rclone.conf'),
    'GOOGLE_DRIVE_REMOTE': 'homemanager',
    'GOOGLE_DRIVE_KEEP': '5',
    'RCLONE_BIN': str(base / 'runtime/rclone'),
}
with file.open('a') as f:
    f.write('\n' + '\n'.join(k + '=' + v for k,v in defaults.items() if k not in keys) + '\n')
file.chmod(0o600)
print('Google Drive defaults prepared; no authorization file created and automatic uploads remain disabled.')
PY
printf 'Google OAuth endpoint status: '
curl --silent --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}\n' https://oauth2.googleapis.com/token || true
