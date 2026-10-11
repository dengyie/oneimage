#!/usr/bin/env bash
set -euo pipefail
cd /personal/pxed/oneimage/current
set -a
. /personal/pxed/oneimage/.env
set +a
exec /usr/local/bin/node /personal/pxed/oneimage/current/index.cjs
