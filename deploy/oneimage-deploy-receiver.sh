#!/usr/bin/env bash
set -euo pipefail

root=/personal/pxed/oneimage
release_root="$root/releases"
incoming="$root/incoming"
current="$root/current"
supervisor_ctl="supervisorctl -c /personal/pxed/supervisord.conf"
health_url="http://127.0.0.1:8877/healthz"
capabilities_url="http://127.0.0.1:8877/api/v1/capabilities"

sha=''
archive=''
checksum=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha) sha=${2:?missing --sha value}; shift 2 ;;
    --archive) archive=${2:?missing --archive value}; shift 2 ;;
    --checksum) checksum=${2:?missing --checksum value}; shift 2 ;;
    *) echo "unknown argument" >&2; exit 2 ;;
  esac
done
case "$sha" in
  ''|*[!0-9a-f]*) echo "invalid release sha" >&2; exit 2 ;;
esac
test "${#sha}" -eq 40
case "$archive" in /tmp/oneimage-*.tar.gz) ;; *) echo "archive must be a CI /tmp release" >&2; exit 2 ;; esac
case "$checksum" in /tmp/oneimage-*.tar.gz.sha256) ;; *) echo "checksum must be a CI /tmp release" >&2; exit 2 ;; esac
test "$(basename "$archive" .tar.gz).sha256" = "$(basename "$checksum")"
test -f "$archive"
test -f "$checksum"
grep -F "  $(basename "$archive")" "$checksum" >/dev/null
(cd /tmp && sha256sum -c "$(basename "$checksum")")

mkdir -p "$release_root" "$incoming"
stage=$(mktemp -d "$incoming/${sha}.XXXXXX")
rollback=''
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
while IFS= read -r entry; do
  case "$entry" in
    ''|\./) ;;
    /*|../*|*/../*|*/..|*\\*) echo "unsafe archive entry: $entry" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$archive")
tar -xzf "$archive" -C "$stage"
test "$(cat "$stage/REVISION")" = "$sha"
test -s "$stage/dist/index.html"
test -s "$stage/index.cjs"
test -s "$stage/package.json"
test -s "$stage/package-lock.json"
chmod +x "$stage/run.sh"
cd "$stage"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
cd - >/dev/null

release="$release_root/$sha"
if [ -e "$release" ]; then
  rm -rf "$stage"
else
  mv "$stage" "$release"
fi
if [ -L "$current" ]; then rollback=$(readlink "$current"); fi
ln -s "$release" "$current.new"
mv -Tf "$current.new" "$current"

rollback_current() {
  if [ -n "$rollback" ]; then
    ln -s "$rollback" "$current.new"
    mv -Tf "$current.new" "$current"
  else
    rm -f "$current"
  fi
  $supervisor_ctl restart oneimage || true
}

if ! $supervisor_ctl restart oneimage; then
  rollback_current
  exit 1
fi
health_code=$(curl --silent --show-error --max-time 5 -o /tmp/oneimage-health.json -w '%{http_code}' "$health_url") || {
  rollback_current
  exit 1
}
case "$health_code" in 200|503) ;; *) rollback_current; exit 1 ;; esac
grep -Eq '"status":"(ok|degraded)"' /tmp/oneimage-health.json || { rollback_current; exit 1; }
curl --fail --silent --show-error --max-time 5 "$capabilities_url" >/tmp/oneimage-capabilities.json || {
  rollback_current
  exit 1
}
grep -q '"maxInputBytes"' /tmp/oneimage-capabilities.json || { rollback_current; exit 1; }
rm -f "$archive" "$checksum"
find "$release_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | tail -n +4 | cut -d' ' -f2- | xargs -r rm -rf
printf 'deployed %s\n' "$sha"
