# content-provenance

A tiny, dependency-light HTTP service that exposes OpenAI's
`POST /v1/content_provenance_checks` (C2PA / SynthID content-provenance detection)
as an **anonymous** endpoint: callers send no API key, and the upstream OpenAI key
stays on the server.

This exists because the content-provenance check is useful to browser apps that
must not hold a provider secret. The gateway keeps the key server-side and adds
the abuse guards a public endpoint needs (per-IP rate limiting, a global daily
cost cap, a concurrency limit, a body-size cap).

- Runtime: Node **>= 20.18**. One dependency: `undici` (only loaded when an
  upstream proxy is configured, to route the global `fetch` through it).
- Reference deployment: `https://provenance.mangoqwq.com` (see *Deploy* below).

## API

### `POST /verify`
`multipart/form-data` with a single `file` field (image or audio).

```bash
curl -X POST https://provenance.mangoqwq.com/verify \
  -F "file=@example.png;type=image/png"
```

The upstream `content_provenance_check` JSON is returned unchanged:

```json
{
  "object": "content_provenance_check",
  "created_at": 1791656294,
  "results": [
    {"type":"c2pa","outcome":"not_detected","validation_state":"not_present","issuer":null,"model":null,"generated_at":null},
    {"type":"synthid","outcome":"not_detected","model":null,"generated_at":null}
  ]
}
```

Image input yields `c2pa` + `synthid`; audio input yields `synthid`.
`not_detected` means no supported signal was found — it is **not** proof of human
origin, and this is not a general AI-image detector.

CORS is on by default (`Access-Control-Allow-Origin: *`) so browsers can call it
directly; `OPTIONS /verify` returns `204`. Set `CORS_ORIGIN` to a specific origin,
or empty to disable.

### `GET /healthz`
```json
{"ok":true,"upstream_configured":true,"anonymous":true,"day_count":0,"inflight":0,"uploads":0,"cost_guard_healthy":true}
```

Returns `503` with `ok:false` when the persisted daily cost guard is unavailable.
A transient state-write failure self-heals: `/healthz` re-probes the state file and
flips back to `200` once it is writable again.

### Errors
| Status | `error` | Meaning |
|---|---|---|
| 400 | `file_required` | empty body |
| 400 | upstream `invalid_file` / other | bad or unsupported file |
| 408 | `upload_timeout` | request body exceeded `UPLOAD_TIMEOUT_MS` |
| 401 | `unauthorized` | `ACCESS_TOKEN` set and caller token missing/wrong |
| 413 | `file_too_large` | over `MAX_BYTES`, declared or streamed |
| 415 | `unsupported_media_type` | not `multipart/form-data` |
| 429 | `rate_limited` | per-IP rate limit (with `Retry-After`) |
| 429 | `daily_cap_reached` | global daily budget exhausted |
| 502 | `upstream_unavailable` / `upstream_error` | upstream unreachable or 5xx |
| 503 | `not_enabled` | upstream account lacks access (upstream 404) |
| 503 | `busy` | upload or upstream-call limit hit (with `Retry-After: 5`) |
| 503 | `service_unavailable` | `OPENAI_API_KEY` not configured |
| 503 | `cost_guard_unavailable` | persisted daily budget state is unavailable |

## Configuration

All via environment variables (a `.env` file is read by `run.sh`). **Numeric values
are validated at startup** — a non-integer (e.g. `DAILY_CAP=3,000`) is fatal rather
than silently disabling that guard:

| Var | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | required; server-side only |
| `ACCESS_TOKEN` | empty | empty = fully anonymous. Set to require `Authorization: Bearer <t>` |
| `PORT` / `HOST` | 8842 / 127.0.0.1 | bind loopback; put a TLS reverse proxy / tunnel in front |
| `MAX_BYTES` | 20971520 | 20 MB; enforced for declared and chunked bodies |
| `UPSTREAM_URL` | OpenAI endpoint | override only for testing |
| `UPSTREAM_TIMEOUT_MS` | 60000 | upstream call deadline (→ `502` on abort) |
| `UPLOAD_TIMEOUT_MS` | 30000 | total time allowed to upload the request body |
| `HEADERS_TIMEOUT_MS` | 15000 | time allowed to send request headers |
| `RATE_LIMIT` / `RATE_WINDOW_MS` | 30 / 60000 | per client IP (honours `CF-Connecting-IP`) |
| `DAILY_CAP` | 3000 | global per UTC day (cost guard); persisted across restarts |
| `MAX_CONCURRENCY` | 4 | in-flight upstream calls |
| `MAX_UPLOADS` | 8 | request bodies read at once (memory / slow-upload guard) |
| `CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin`; empty disables CORS |
| `STATE_FILE` | `./.state.json` | daily-budget persistence file (written atomically) |
| `ALLOW_ANONYMOUS_PUBLIC_BIND` | unset | set `1` to allow an anonymous non-loopback bind (see Security) |
| `HTTPS_PROXY` / `HTTP_PROXY` | — | if set, `fetch` is routed through it via `undici` `ProxyAgent` |

`NO_PROXY` is not consulted by Node's global dispatcher, so don't rely on it.

## Run & test

```bash
npm ci --omit=dev      # installs undici
npm start              # node server.mjs

npm test               # node:test integration suite (spawns the server + a stub upstream)
```

The suite covers routing / 415 / CORS, declared and chunked oversize → 413, the
concurrency cap (never breached; `inflight` returns to 0), per-IP rate limiting,
the daily cap (counts only upstream calls, persists across restart, refunds
requests that never reached upstream), upstream error mapping
(400/404/429/500/network), slow-upload timeout, upstream timeout → 502,
fail-closed cost state with self-heal, startup config validation, and
`ACCESS_TOKEN` enforcement.

## Deploy

The service is a plain Node process, so any supervisor works. Example with
supervisord (`deploy/supervisord.example.conf`):

```ini
[program:content-provenance]
command=/opt/content-provenance/run.sh
directory=/opt/content-provenance
autostart=true
autorestart=true
stopsignal=TERM
stdout_logfile=/opt/content-provenance/out.log
stderr_logfile=/opt/content-provenance/err.log
```

`run.sh` loads `.env` and execs Node:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
exec node server.mjs
```

Then put a TLS terminator in front (nginx, Caddy, or a Cloudflare Tunnel ingress
mapping `your.host -> http://localhost:8842`). To rotate the key, edit `.env` and
restart.

## Security notes

- The upstream key is a billing credential. Anyone who can reach `/verify` spends
  it. Keep `RATE_LIMIT` / `DAILY_CAP` conservative, or set `ACCESS_TOKEN`.
- `.env`, `.state.json`, and logs are git-ignored — never commit the key.
- The daily cost guard fails closed: unreadable, malformed, or unwritable state
  returns `503 cost_guard_unavailable` before an upstream request is made. A
  corrupt state file is **not** auto-reset (that would wipe the budget); fix or
  remove the file and restart.
- The per-IP rate limiter trusts `CF-Connecting-IP` / `X-Forwarded-For`, which a
  caller can set. That is only safe because the origin is bound to loopback and
  reachable only through a trusted proxy — so an anonymous service on a
  non-loopback host refuses to start (override with `ALLOW_ANONYMOUS_PUBLIC_BIND=1`
  only if a trusted proxy already rewrites those headers).
- Numeric config is validated at startup; an invalid value is fatal instead of
  silently disabling a guard.
- The `?token=` query form is intentionally **not** supported (query strings leak
  into logs and referrers); use the `Authorization` header.

## License

MIT
