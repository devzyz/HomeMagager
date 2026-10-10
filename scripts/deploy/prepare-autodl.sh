#!/usr/bin/env bash
set -euo pipefail
umask 077
BASE=/root/autodl-tmp/homemanager
NODE_VERSION=v24.18.1
mkdir -p "$BASE/runtime/downloads" "$BASE/config" "$BASE/data/database" "$BASE/data/uploads" "$BASE/data/backups" "$BASE/logs" "$BASE/run" "$BASE/secrets" "$BASE/releases"
cd "$BASE/runtime/downloads"
if [ ! -x "$BASE/runtime/node/bin/node" ]; then
  curl --fail --location --retry 3 --connect-timeout 15 --max-time 300 --silent --show-error "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" -o "node-$NODE_VERSION-linux-x64.tar.xz"
  curl --fail --location --retry 3 --connect-timeout 15 --max-time 60 --silent --show-error "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o SHASUMS256.txt
  grep " node-$NODE_VERSION-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum --check -
  mkdir -p "$BASE/runtime/node"
  tar -xJf "node-$NODE_VERSION-linux-x64.tar.xz" -C "$BASE/runtime/node" --strip-components=1
fi
export PATH="$BASE/runtime/node/bin:$BASE/runtime/pnpm/bin:$PATH"
node --version
if [ ! -x "$BASE/runtime/pnpm/bin/pnpm" ]; then
  npm install --global --prefix "$BASE/runtime/pnpm" pnpm@11.7.0 --no-audit --no-fund
fi
pnpm --version