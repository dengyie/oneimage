#!/bin/bash
# Supervisor-managed wrapper: snapshot the database once a day.
set -uo pipefail
umask 077

HERE=$(cd "$(dirname "$0")" && pwd)
INTERVAL=${ONEIMAGE_BACKUP_INTERVAL:-86400}
LOG=${ONEIMAGE_BACKUP_LOG:-/personal/pxed/backups/oneimage/backup-loop.log}

mkdir -p "$(dirname "$LOG")"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

trap 'log "loop exit pid=$$ (signal)"; exit 0' TERM INT
log "=== oneimage db backup loop start pid=$$ interval=${INTERVAL}s ==="

while true; do
  "$HERE/oneimage-db-backup.sh" >> "$LOG" 2>&1 || log "backup exit non-zero"
  sleep "$INTERVAL" &
  wait $! || true
done
