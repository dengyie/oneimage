#!/usr/bin/env node
// content-provenance microservice
// Wraps OpenAI POST /v1/content_provenance_checks so callers need no API key.
// Runtime: Node >= 20.18. One external dependency: undici (only used when a
// proxy is configured, to route global fetch through it).

import http from "node:http";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";

// Every numeric knob is validated at startup. A typo (e.g. DAILY_CAP=3,000 or
// MAX_BYTES=20mb) would otherwise yield NaN, and every `x >= NaN` comparison is
// false — silently disabling that guard. Invalid values are fatal (fail closed)
// rather than quietly running without a limit.
function numEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`[config] invalid ${name}=${JSON.stringify(raw)} (expected integer in [${min}, ${max}])`);
    process.exit(1);
  }
  return value;
}

const PORT = numEnv("PORT", 8842, { max: 65535 });
const HOST = process.env.HOST || "127.0.0.1";
const UPSTREAM = process.env.UPSTREAM_URL || "https://api.openai.com/v1/content_provenance_checks";
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();

const MAX_BYTES = numEnv("MAX_BYTES", 20 * 1024 * 1024); // 20 MB
const MAX_MB = Math.floor(MAX_BYTES / 1024 / 1024);
const UPSTREAM_TIMEOUT_MS = numEnv("UPSTREAM_TIMEOUT_MS", 60000);
const UPLOAD_TIMEOUT_MS = numEnv("UPLOAD_TIMEOUT_MS", 30000);
const HEADERS_TIMEOUT_MS = numEnv("HEADERS_TIMEOUT_MS", 15000);

// Access control: empty ACCESS_TOKEN => anonymous (no key required from caller).
const ACCESS_TOKEN = (process.env.ACCESS_TOKEN || "").trim();

// CORS: empty CORS_ORIGIN => emit no CORS headers. "*" (default) allows any
// browser origin, which is consistent with anonymous access.
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "*").trim();

// Abuse guards.
const RATE_LIMIT = numEnv("RATE_LIMIT", 30); // requests per window per IP
const RATE_WINDOW_MS = numEnv("RATE_WINDOW_MS", 60000);
const DAILY_CAP = numEnv("DAILY_CAP", 3000); // upstream calls per UTC day
const MAX_CONCURRENCY = numEnv("MAX_CONCURRENCY", 4); // in-flight upstream calls
const MAX_UPLOADS = numEnv("MAX_UPLOADS", 8); // request bodies being read at once

// Daily counter is persisted so a crash/restart cannot reset the cost guard.
const STATE_FILE = (process.env.STATE_FILE || "./.state.json").trim();

const KEY_STATE = OPENAI_API_KEY ? "set" : "unset";

// The per-IP rate limiter trusts CF-Connecting-IP / X-Forwarded-For, which any
// caller can set. That is only safe while the origin is unreachable except
// through a trusted front proxy, i.e. it is bound to loopback. Refuse to start
// anonymous on a non-loopback bind so this assumption cannot be silently broken.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
if (!ACCESS_TOKEN && !LOOPBACK_HOSTS.has(HOST)) {
  if (process.env.ALLOW_ANONYMOUS_PUBLIC_BIND === "1") {
    console.warn(`[config] anonymous service bound to non-loopback ${HOST}; forwarded-IP headers are spoofable`);
  } else {
    console.error(
      `[config] refusing to start: anonymous service bound to ${HOST}. Bind 127.0.0.1 behind a trusted proxy, ` +
        `set ACCESS_TOKEN, or set ALLOW_ANONYMOUS_PUBLIC_BIND=1 to override.`
    );
    process.exit(1);
  }
}

// Node's fetch ignores HTTP(S)_PROXY by default; route through the local proxy
// when one is configured (this host has no direct route to api.openai.com).
const PROXY =
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (PROXY) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(PROXY));
  } catch (e) {
    console.error(`[startup] proxy is configured but undici is unavailable: ${e.message}`);
    console.error("[startup] install dependencies (npm ci --omit=dev) or unset HTTPS_PROXY");
    process.exit(1);
  }
}

// ---- daily cap (persisted, counts only actual upstream calls) ----
let day = new Date().toISOString().slice(0, 10);
let dayCount = 0;
let stateHealthy = true;
// Whether an unhealthy guard may heal on its own: true when the in-memory
// counter is still trustworthy (only a write failed), false when the on-disk
// counter is unknown (corrupt/unreadable) — rewriting there would reset budget.
let stateRecoverable = true;

function isCanonicalUtcDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

(function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!s || !isCanonicalUtcDay(s.day) || s.day > day || !Number.isInteger(s.count) || s.count < 0) {
      throw new Error("invalid state schema");
    }
    if (s.day === day) dayCount = s.count;
    if (!persistState(day, dayCount)) stateHealthy = false;
  } catch (e) {
    if (e.code === "ENOENT") {
      // No file yet: the counter is known (0), so a later write failure can heal.
      if (!persistState(day, dayCount)) stateHealthy = false;
      return;
    }
    // Unreadable or corrupt: the true count is unknown. Stay fail-closed and do
    // not auto-recover, because rewriting would reset the budget to a lower value.
    stateHealthy = false;
    stateRecoverable = false;
    console.error(`[state] load failed: ${e.message}`);
  }
})();

function persistState(nextDay, nextCount) {
  const tmp = `${STATE_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ day: nextDay, count: nextCount }), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE); // atomic replace
    return true;
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* preserve the original persistence error */
    }
    console.error(`[state] persist failed: ${e.message}`);
    return false;
  }
}

// Heal a transient write failure once the state file is writable again, instead
// of staying unavailable until an operator restarts the process.
function tryRecoverState() {
  if (stateHealthy || !stateRecoverable) return stateHealthy;
  if (persistState(day, dayCount)) {
    stateHealthy = true;
    console.log("[state] recovered");
  }
  return stateHealthy;
}

// Persist before committing the in-memory counter. State failures must stop
// upstream billing rather than silently resetting the guard after a restart.
function chargeDaily() {
  if (!tryRecoverState()) return "unavailable";
  const today = new Date().toISOString().slice(0, 10);
  const currentCount = today === day ? dayCount : 0;
  if (currentCount >= DAILY_CAP) return "cap";
  const nextCount = currentCount + 1;
  if (!persistState(today, nextCount)) {
    stateHealthy = false;
    return "unavailable";
  }
  day = today;
  dayCount = nextCount;
  return "charged";
}

// Give a charge back when the request provably never reached upstream: a thrown
// fetch means no HTTP response was received, so nothing was billed. Aborts are
// excluded — the upstream may already have processed the request.
function refundDaily() {
  if (!stateHealthy) return;
  const today = new Date().toISOString().slice(0, 10);
  const currentCount = today === day ? dayCount : 0;
  if (currentCount <= 0) return;
  const nextCount = currentCount - 1;
  if (!persistState(today, nextCount)) {
    stateHealthy = false;
    return;
  }
  day = today;
  dayCount = nextCount;
}

// ---- rate limiting (in-memory sliding window, per client IP) ----
const hits = new Map(); // ip -> number[] (timestamps within window)
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) {
    hits.set(ip, arr);
    return Math.ceil((arr[0] + RATE_WINDOW_MS - now) / 1000);
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 20000) evictExpired(now);
  return 0;
}

// Drop only fully-expired entries; never reset an active window.
function evictExpired(now) {
  for (const [ip, arr] of hits) {
    const live = arr.filter((t) => now - t < RATE_WINDOW_MS);
    if (live.length === 0) hits.delete(ip);
    else if (live.length !== arr.length) hits.set(ip, live);
  }
}

let inflight = 0; // in-flight upstream calls
let uploads = 0; // request bodies currently being read

function corsHeaders() {
  if (!CORS_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...corsHeaders(),
    ...extra,
  });
  res.end(body);
}

// Reply, then close the request side once the response is flushed. Needed when
// the request body is deliberately not consumed (oversize), otherwise the peer
// may see a reset instead of the response.
function replyAndClose(req, res, status, obj, extra = {}) {
  res.on("finish", () => req.destroy());
  return json(res, status, obj, extra);
}

function clientIp(req) {
  return (
    req.headers["cf-connecting-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function tokenOk(req) {
  if (!ACCESS_TOKEN) return true; // anonymous mode
  const hdr = req.headers["authorization"] || "";
  const provided = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(ACCESS_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Reads the whole body up to `limit`. On overflow it pauses (does not destroy)
// so the caller can still deliver a clean 413 response.
function readBody(req, limit, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onData = (c) => {
      size += c.length;
      if (size > limit) {
        req.pause();
        settle(() => reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" })));
        return;
      }
      chunks.push(c);
    };
    const onEnd = () => settle(() => resolve(Buffer.concat(chunks)));
    const onError = (error) => settle(() => reject(error));
    const onAborted = () => settle(() => reject(Object.assign(new Error("request aborted"), { code: "ABORTED" })));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    timer = setTimeout(() => {
      req.pause();
      settle(() => reject(Object.assign(new Error("upload timed out"), { code: "UPLOAD_TIMEOUT" })));
    }, timeoutMs);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const ip = clientIp(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
    tryRecoverState();
    return json(res, stateHealthy ? 200 : 503, {
      ok: stateHealthy,
      upstream_configured: Boolean(OPENAI_API_KEY),
      anonymous: !ACCESS_TOKEN,
      day_count: dayCount,
      inflight,
      uploads,
      cost_guard_healthy: stateHealthy,
    });
  }

  if (req.method === "GET" && url.pathname === "/") {
    return json(res, 200, {
      service: "content-provenance",
      usage: "POST /verify  multipart/form-data field 'file' (image/* or audio/*)",
      anonymous: !ACCESS_TOKEN,
    });
  }

  if (req.method !== "POST" || url.pathname !== "/verify") {
    return json(res, 404, { error: "not_found" });
  }

  if (!tokenOk(req)) return json(res, 401, { error: "unauthorized" });

  if (!OPENAI_API_KEY) {
    return json(res, 503, { error: "service_unavailable", message: "upstream key not configured" });
  }

  const ctype = req.headers["content-type"] || "";
  if (!ctype.toLowerCase().startsWith("multipart/form-data")) {
    return json(res, 415, {
      error: "unsupported_media_type",
      message: "send multipart/form-data with a 'file' field",
    });
  }

  const declared = Number(req.headers["content-length"] || 0);
  if (declared && declared > MAX_BYTES + 1024 * 1024) {
    return replyAndClose(req, res, 413, { error: "file_too_large", message: `max ${MAX_MB} MB` });
  }

  const wait = rateLimited(ip);
  if (wait) return json(res, 429, { error: "rate_limited", message: "too many requests" }, { "Retry-After": String(wait) });

  // Bound the number of request bodies being read at once (memory / slow-upload
  // guard), separately from the upstream-call cap below, so a slow upload cannot
  // occupy an upstream slot. Reserved synchronously, before any await.
  if (uploads >= MAX_UPLOADS) {
    return json(res, 503, { error: "busy", message: "try again shortly" }, { "Retry-After": "5" });
  }
  uploads++;
  let slotHeld = false; // upstream-call slot
  let done = false;
  const releaseAll = () => {
    if (done) return;
    done = true;
    uploads--;
    if (slotHeld) {
      slotHeld = false;
      inflight--;
    }
  };

  try {
    let body;
    try {
      body = await readBody(req, MAX_BYTES, UPLOAD_TIMEOUT_MS);
    } catch (e) {
      if (e.code === "TOO_LARGE") {
        return replyAndClose(req, res, 413, { error: "file_too_large", message: `max ${MAX_MB} MB` });
      }
      if (e.code === "UPLOAD_TIMEOUT") {
        return replyAndClose(req, res, 408, { error: "upload_timeout", message: "request body took too long" });
      }
      return json(res, 400, { error: "bad_request" });
    }
    if (!body.length) return json(res, 400, { error: "file_required" });

    // Reserve an upstream-call slot synchronously (no await between the check and
    // the increment) so simultaneous requests cannot all pass the check.
    if (inflight >= MAX_CONCURRENCY) {
      return json(res, 503, { error: "busy", message: "try again shortly" }, { "Retry-After": "5" });
    }
    inflight++;
    slotHeld = true;

    // Charge the budget only for requests that actually reach upstream.
    const charge = chargeDaily();
    if (charge === "unavailable") {
      return json(res, 503, { error: "cost_guard_unavailable", message: "daily cost guard is unavailable" });
    }
    if (charge === "cap") {
      return json(res, 429, { error: "daily_cap_reached" }, { "Retry-After": "3600" });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    const started = Date.now();
    try {
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": ctype,
          Accept: "application/json",
        },
        body,
        signal: ctrl.signal,
      });
      const text = await upstream.text();
      const ms = Date.now() - started;
      console.log(`[verify] ip=${ip} upstream=${upstream.status} bytes=${body.length} ms=${ms}`);

      if (upstream.status === 200) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...corsHeaders(),
        });
        return res.end(text);
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: "upstream_error", raw: text.slice(0, 500) };
      }
      if (upstream.status === 400) return json(res, 400, payload);
      if (upstream.status === 404)
        return json(res, 503, { error: "not_enabled", message: "content provenance not enabled for this account" });
      if (upstream.status === 429)
        return json(res, 429, payload, { "Retry-After": upstream.headers.get("retry-after") || "30" });
      return json(res, 502, { error: "upstream_error", status: upstream.status, detail: payload });
    } catch (e) {
      const ms = Date.now() - started;
      console.error(`[verify] ip=${ip} upstream_failed ms=${ms} ${e.name}: ${e.message}`);
      if (e.name !== "AbortError") refundDaily();
      const msg = e.name === "AbortError" ? "upstream timeout" : "upstream unavailable";
      return json(res, 502, { error: "upstream_unavailable", message: msg });
    } finally {
      clearTimeout(timer);
    }
  } finally {
    releaseAll();
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(`[handler] uncaught: ${(e && e.stack) || e}`);
    if (res.headersSent) res.destroy();
    else json(res, 500, { error: "internal_error" });
  });
});

server.on("error", (e) => {
  console.error(`[startup] listen failed: ${e.message}`);
  process.exit(1);
});

// A stray rejection must not silently kill the process mid-request.
process.on("unhandledRejection", (e) => {
  console.error(`[fatal] unhandledRejection: ${(e && e.stack) || e}`);
  process.exit(1);
});

// Cap how long a client may take to send request headers (slow-header guard).
server.headersTimeout = HEADERS_TIMEOUT_MS;

server.listen(PORT, HOST, () => {
  console.log(
    `content-provenance listening on http://${HOST}:${PORT} | anonymous=${!ACCESS_TOKEN} | key=${KEY_STATE} | ` +
      `max=${MAX_BYTES}B | rate=${RATE_LIMIT}/${RATE_WINDOW_MS}ms | daily=${DAILY_CAP} | conc=${MAX_CONCURRENCY} | ` +
      `uploads=${MAX_UPLOADS} | upload_timeout=${UPLOAD_TIMEOUT_MS}ms | state=${stateHealthy ? "healthy" : "unhealthy"} | ` +
      `cors=${CORS_ORIGIN || "(off)"} | proxy=${PROXY ? "on" : "off"}`
  );
});
