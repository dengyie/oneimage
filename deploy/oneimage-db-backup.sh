#!/bin/bash
# OneImage SQLite snapshot.
#
# Uses SQLite's online backup API, so it is consistent even while the server
# keeps the database open and writing. Every snapshot is integrity-checked
# before it is kept, and only the newest N are retained.
set -uo pipefail
umask 077

DB=${ONEIMAGE_DB_PATH:-/personal/pxed/oneimage/data/oneimage.db}
DEST=${ONEIMAGE_BACKUP_DIR:-/personal/pxed/backups/oneimage}
KEEP=${ONEIMAGE_BACKUP_KEEP:-7}

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ ! -f "$DB" ]; then
  log "skip: $DB not found"
  exit 0
fi

mkdir -p "$DEST"

stamp=$(date +%Y%m%d-%H%M%S)
tmp="$DEST/.oneimage-$stamp.db.part"
final="$DEST/oneimage-$stamp.db.gz"

if ! sqlite3 "$DB" ".backup '$tmp'"; then
  log "fail: backup command error"
  rm -f "$tmp"
  exit 1
fi

check=$(sqlite3 "$tmp" "PRAGMA integrity_check;" 2>&1 | head -n1)
if [ "$check" != "ok" ]; then
  log "fail: integrity_check=$check"
  rm -f "$tmp"
  exit 1
fi

counts=$(sqlite3 "$tmp" "SELECT (SELECT count(*) FROM users) || ' users, ' || (SELECT count(*) FROM cloud_projects) || ' projects';" 2>/dev/null || echo "? users")

if ! gzip -9 -c "$tmp" > "$final"; then
  log "fail: gzip"
  rm -f "$tmp" "$final"
  exit 1
fi
rm -f "$tmp"

if ! sha256sum "$final" > "$final.sha256"; then
  log "fail: sha256"
  rm -f "$final" "$final.sha256"
  exit 1
fi

log "ok $(basename "$final") $(stat -c%s "$final") bytes ($counts)"

# Retention: newest KEEP snapshots win.
find "$DEST" -maxdepth 1 -name 'oneimage-*.db.gz' -printf '%T@ %p\n' \
  | sort -nr | tail -n +$((KEEP + 1)) | cut -d' ' -f2- \
  | while IFS= read -r old; do
      rm -f "$old" "$old.sha256"
      log "pruned $(basename "$old")"
    done

# Drop partial files left behind by an interrupted run.
find "$DEST" -maxdepth 1 -name '.oneimage-*.part' -mtime +1 -delete
