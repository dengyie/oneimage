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
exec /usr/local/bin/node "$release/index.cjs"
