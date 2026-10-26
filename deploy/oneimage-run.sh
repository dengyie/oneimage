#!/usr/bin/env bash
set -euo pipefail

root=/personal/pxed/oneimage
current="$root/current"
release=''
for _ in {1..30}; do
  release=$(readlink -f "$current" 2>/dev/null || true)
  if [ -n "$release" ] && [ -f "$release/index.cjs" ]; then
    break
  fi
  release=''
  sleep 0.2
done
if [ -z "$release" ]; then
  echo "oneimage release link unavailable: $current" >&2
  exit 1
fi

cd "$release"
set -a
. "$root/.env"
set +a

mkdir -p "$root/data"
export ONEIMAGE_DB_PATH="${ONEIMAGE_DB_PATH:-$root/data/oneimage.db}"

node_bin="/usr/local/bin/node"
if [ -x "/opt/node24/bin/node" ]; then
  node_bin="/opt/node24/bin/node"
elif [ -x "/opt/node-v24.22.1-linux-x64/bin/node" ]; then
  node_bin="/opt/node-v24.22.1-linux-x64/bin/node"
elif [ -x "/opt/node-v22.21.1-linux-x64/bin/node" ]; then
  node_bin="/opt/node-v22.21.1-linux-x64/bin/node"
fi

exec "$node_bin" "$release/index.cjs"
