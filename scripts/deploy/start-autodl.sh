#!/usr/bin/env bash
set -euo pipefail
BASE=/root/autodl-tmp/homemanager
CONF="$BASE/config/supervisor.ini"
SUPERVISORCTL=/root/miniconda3/bin/supervisorctl
if ! "$SUPERVISORCTL" -c "$CONF" pid >/dev/null 2>&1; then
  /root/miniconda3/bin/supervisord -c "$CONF"
  sleep 4
fi
"$SUPERVISORCTL" -c "$CONF" status
curl --fail --silent http://127.0.0.1:3000/api/health
printf '\n'