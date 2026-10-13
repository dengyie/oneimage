// Integration tests. Each case spawns the real server.mjs as a child process
// against a stub upstream, so what is exercised is exactly what runs on the box.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoDir = path.dirname(fileURLToPath(new URL("../server.mjs", import.meta.url)));
const silent = (s) => s;

// --- stub upstream ---------------------------------------------------------
const OK_BODY = JSON.stringify({
  object: "content_provenance_check",
  created_at: 1791656294,
  results: [{ type: "c2pa", outcome: "not_detected" }, { type: "synthid", outcome: "not_detected" }],
});

let upstream;
let upstreamPort;
let upstreamCalls = 0;

function upstreamBehavior(buf) {
  const s = buf.toString("latin1");
  if (s.includes("MOCK:400")) return { status: 400, body: JSON.stringify({ error: { message: "invalid file", code: "invalid_file" } }) };
  if (s.includes("MOCK:404")) return { status: 404, body: JSON.stringify({ error: { message: "model not found" } }) };
  if (s.includes("MOCK:429")) return { status: 429, headers: { "retry-after": "7" }, body: JSON.stringify({ error: { message: "slow down" } }) };
  if (s.includes("MOCK:500")) return { status: 500, body: "<html>oops</html>" };
  if (s.includes("MOCK:SLOW")) return { status: 200, body: OK_BODY, delay: 300 };
  return { status: 200, body: OK_BODY };
}

before(async () => {
  upstream = http.createServer((req, res) => {
    upstreamCalls++;
    // The gateway may abort an in-flight request (timeout test); a late write to
    // the dropped socket must not crash the stub.
    res.on("error", () => {});
    req.on("error", () => {});
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const b = upstreamBehavior(Buffer.concat(chunks));
      const send = () => {
        res.writeHead(b.status, { "Content-Type": "application/json", ...(b.headers || {}) });
        res.end(b.body);
      };
      if (b.delay) setTimeout(send, b.delay);
      else send();
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = upstream.address().port;
});

after(() => {
  if (!upstream) return;
  upstream.closeAllConnections?.(); // drop keep-alive sockets so close() can finish
  upstream.close();
});

// --- helpers ---------------------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const baseEnv = { ...process.env, HTTPS_PROXY: "", HTTP_PROXY: "", https_proxy: "", http_proxy: "", NO_PROXY: "*" };

async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoDir,
    env: {
      ...baseEnv,
      PORT: String(port),
      HOST: "127.0.0.1",
      UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}/v1/content_provenance_checks`,
      OPENAI_API_KEY: "sk-test-dummy",
      STATE_FILE: path.join(os.tmpdir(), `cp-state-${port}-${Date.now()}.json`),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => silent(`[srv:${port}] ${d}`));
  child.stderr.on("data", (d) => silent(`[srv:${port}!] ${d}`));
  await waitForServer(port);
  return {
    port,
    child,
    stop: () =>
      new Promise((r) => {
        const done = setTimeout(r, 2000); // never let teardown hang the run
        child.once("exit", () => {
          clearTimeout(done);
          r();
        });
        child.kill("SIGKILL");
      }),
  };
}

// Waits until the server answers anything on /healthz. It does not require 200:
// cases that start in a deliberately unhealthy state must still be reachable.
async function waitForServer(port) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      await rawReq(port, { method: "GET", path: "/healthz" });
      return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server on ${port} did not start`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Spawns the server expecting it to exit on its own (e.g. invalid config) and
// returns its exit code plus combined output.
function startExpectingExit(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: repoDir,
      env: { ...baseEnv, HOST: "127.0.0.1", OPENAI_API_KEY: "sk-test-dummy", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const done = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("server did not exit as expected"));
    }, 5000);
    child.once("exit", (code) => {
      clearTimeout(done);
      resolve({ code, out });
    });
    child.once("error", (e) => {
      clearTimeout(done);
      reject(e);
    });
  });
}

// Resolves as soon as a response arrives; a later socket reset (which the server
// may cause after replying to an unconsumed body) does not turn a delivered
// response into a test error.
function rawReq(port, { method = "POST", path = "/verify", headers = {}, body = null, chunks = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
      res.on("error", () => resolve({ status: res.statusCode, headers: res.headers, text: data, truncated: true }));
    });
    req.setTimeout(8000, () => req.destroy(new Error(`request timeout: ${method} ${path}`)));
    req.on("error", (e) => reject(e));
    if (chunks) {
      for (const c of chunks) req.write(c);
      req.end();
    } else {
      if (body) req.write(body);
      req.end();
    }
  });
}

function slowPartialUpload(port, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    let response = "";
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      callback();
    };
    const deadline = setTimeout(
      () => finish(() => reject(new Error("slow upload did not receive a response"))),
      timeoutMs,
    );
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(
        "POST /verify HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Content-Type: multipart/form-data; boundary=slow\r\n" +
          "Content-Length: 1000\r\n" +
          "Connection: close\r\n\r\n" +
          "--slow\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\n",
      );
    });
    socket.on("data", (chunk) => {
      response += chunk;
      const match = response.match(/^HTTP\/1\.1 (\d{3})/);
      if (match) finish(() => resolve(Number(match[1])));
    });
    socket.on("error", (error) => finish(() => reject(error)));
    socket.on("end", () => {
      const match = response.match(/^HTTP\/1\.1 (\d{3})/);
      if (match) finish(() => resolve(Number(match[1])));
      else finish(() => reject(new Error("slow upload connection ended without an HTTP response")));
    });
  });
}

function multipart(field, { filename = "a.png", type = "image/png" } = {}) {
  const b = "----cp" + Math.random().toString(36).slice(2);
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`;
  const tail = `\r\n--${b}--\r\n`;
  return {
    body: Buffer.concat([Buffer.from(head), Buffer.from(field), Buffer.from(tail)]),
    contentType: `multipart/form-data; boundary=${b}`,
    head: Buffer.from(head),
    tail: Buffer.from(tail),
  };
}

const getHealth = async (port) => JSON.parse((await rawReq(port, { method: "GET", path: "/healthz" })).text);

// --- tests -----------------------------------------------------------------
test("routing: 404 on unknown path/method, 415 non-multipart, OPTIONS 204, root usage", async () => {
  const s = await startServer({ MAX_BYTES: "2048", RATE_LIMIT: "1000", DAILY_CAP: "1000" });
  try {
    assert.equal((await rawReq(s.port, { method: "GET", path: "/nope" })).status, 404);
    assert.equal((await rawReq(s.port, { method: "GET", path: "/verify" })).status, 404);
    const m = multipart("hello");
    const bad = await rawReq(s.port, { headers: { "content-type": "application/json" }, body: Buffer.from("{}") });
    assert.equal(bad.status, 415);
    const opt = await rawReq(s.port, { method: "OPTIONS", path: "/verify", headers: { origin: "https://x.test" } });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers["access-control-allow-origin"], "*");
    const root = await rawReq(s.port, { method: "GET", path: "/" });
    assert.equal(root.status, 200);
    assert.equal(JSON.parse(root.text).service, "content-provenance");
    void m;
  } finally {
    await s.stop();
  }
});

test("CORS can be disabled", async () => {
  const s = await startServer({ CORS_ORIGIN: "", MAX_BYTES: "2048" });
  try {
    const opt = await rawReq(s.port, { method: "OPTIONS", path: "/verify" });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers["access-control-allow-origin"], undefined);
  } finally {
    await s.stop();
  }
});

test("valid file passes upstream JSON through untouched", async () => {
  const s = await startServer({ MAX_BYTES: "2048", RATE_LIMIT: "1000" });
  try {
    const m = multipart("just an image");
    const r = await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), JSON.parse(OK_BODY));
  } finally {
    await s.stop();
  }
});

test("empty body with multipart content-type -> 400 file_required", async () => {
  const s = await startServer({ MAX_BYTES: "2048" });
  try {
    const r = await rawReq(s.port, { headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "0" } });
    assert.equal(r.status, 400);
    assert.equal(JSON.parse(r.text).error, "file_required");
  } finally {
    await s.stop();
  }
});

test("declared Content-Length over cap -> 413 without reading the body", async () => {
  const s = await startServer({ MAX_BYTES: "2048" });
  try {
    const big = Buffer.alloc(2 * 1024 * 1024, 0x41); // 2 MB > 2048 + 1 MB
    const r = await rawReq(s.port, {
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(big.length) },
      body: big,
    });
    assert.equal(r.status, 413);
    assert.equal(JSON.parse(r.text).error, "file_too_large");
  } finally {
    await s.stop();
  }
});

// Regression: a chunked (no Content-Length) oversize upload must yield a real
// 413 response, not a connection reset.
test("chunked oversize upload -> 413 (not a reset)", async () => {
  const s = await startServer({ MAX_BYTES: "2048", RATE_LIMIT: "1000" });
  try {
    const m = multipart(Buffer.alloc(16 * 1024, 0x42)); // 16 KB > 2048, sent chunked
    const chunks = [];
    for (let i = 0; i < m.body.length; i += 1024) chunks.push(m.body.subarray(i, i + 1024));
    const r = await rawReq(s.port, { headers: { "content-type": m.contentType }, chunks });
    assert.equal(r.status, 413, "expected a delivered 413, got " + r.status);
    assert.equal(JSON.parse(r.text).error, "file_too_large");
  } finally {
    await s.stop();
  }
});

test("concurrency cap is not breached and inflight returns to zero", async () => {
  const s = await startServer({ MAX_BYTES: "65536", MAX_CONCURRENCY: "2", RATE_LIMIT: "1000", DAILY_CAP: "1000" });
  try {
    const m = multipart("MOCK:SLOW");
    const fire = () => rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    const results = await Promise.all([fire(), fire(), fire(), fire(), fire(), fire()]);
    const ok = results.filter((r) => r.status === 200).length;
    const busy = results.filter((r) => r.status === 503).length;
    assert.ok(ok <= 2, `at most 2 should be served concurrently, got ${ok}`);
    assert.ok(ok >= 1, "at least one request should be served");
    assert.ok(busy >= 1, "excess concurrent requests must be rejected with 503");
    assert.equal(ok + busy, 6);
    const h = await getHealth(s.port);
    assert.equal(h.inflight, 0, "inflight must return to zero");
  } finally {
    await s.stop();
  }
});

test("slow request-body upload -> 408 and releases the upload slot", async () => {
  const s = await startServer({ MAX_BYTES: "65536", MAX_UPLOADS: "1", UPLOAD_TIMEOUT_MS: "50", RATE_LIMIT: "1000" });
  try {
    assert.equal(await slowPartialUpload(s.port), 408);
    assert.equal((await getHealth(s.port)).uploads, 0);
  } finally {
    await s.stop();
  }
});

test("per-IP rate limit returns 429 with Retry-After, buckets are per IP", async () => {
  const s = await startServer({ MAX_BYTES: "65536", RATE_LIMIT: "1", RATE_WINDOW_MS: "60000", DAILY_CAP: "1000" });
  try {
    const m = multipart("payload");
    const ipA = { "content-type": m.contentType, "cf-connecting-ip": "203.0.113.9" };
    const ipB = { "content-type": m.contentType, "cf-connecting-ip": "203.0.113.10" };
    assert.equal((await rawReq(s.port, { headers: ipA, body: m.body })).status, 200);
    const second = await rawReq(s.port, { headers: ipA, body: m.body });
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers["retry-after"]) > 0);
    // distinct IP keeps its own bucket
    assert.equal((await rawReq(s.port, { headers: ipB, body: m.body })).status, 200);
  } finally {
    await s.stop();
  }
});

test("daily cap counts only upstream calls and blocks after the limit", async () => {
  const s = await startServer({ MAX_BYTES: "65536", RATE_LIMIT: "1000", DAILY_CAP: "2" });
  try {
    const m = multipart("payload");
    const send = () => rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 200);
    const third = await send();
    assert.equal(third.status, 429);
    assert.equal(JSON.parse(third.text).error, "daily_cap_reached");
    // a rejected upload must not have consumed budget: still blocked, count stayed put
    assert.equal((await getHealth(s.port)).day_count, 2);
  } finally {
    await s.stop();
  }
});

test("daily cap persists across a restart", async () => {
  const stateFile = path.join(os.tmpdir(), `cp-persist-${Date.now()}.json`);
  const env = { MAX_BYTES: "65536", RATE_LIMIT: "1000", DAILY_CAP: "1", STATE_FILE: stateFile };
  const s1 = await startServer(env);
  const m = multipart("payload");
  assert.equal((await rawReq(s1.port, { headers: { "content-type": m.contentType }, body: m.body })).status, 200);
  await s1.stop();
  const s2 = await startServer(env);
  try {
    const r = await rawReq(s2.port, { headers: { "content-type": m.contentType }, body: m.body });
    assert.equal(r.status, 429, "budget spent before restart must still be spent");
    assert.equal(JSON.parse(r.text).error, "daily_cap_reached");
  } finally {
    await s2.stop();
  }
});

test("unavailable state storage fails closed before calling upstream", async () => {
  const beforeCalls = upstreamCalls;
  const s = await startServer({ STATE_FILE: os.tmpdir(), MAX_BYTES: "65536", RATE_LIMIT: "1000", DAILY_CAP: "1000" });
  try {
    const healthResponse = await rawReq(s.port, { method: "GET", path: "/healthz" });
    assert.equal(healthResponse.status, 503);
    const health = JSON.parse(healthResponse.text);
    assert.equal(health.cost_guard_healthy, false);
    const m = multipart("payload");
    const response = await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.text).error, "cost_guard_unavailable");
    assert.equal(upstreamCalls, beforeCalls);
  } finally {
    await s.stop();
  }
});

test("malformed or future daily state fails closed without resetting the budget", async (t) => {
  const futureDay = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const [name, state] of [
    ["malformed", { day: "not-a-date", count: 999 }],
    ["future", { day: futureDay, count: 999 }],
  ]) {
    await t.test(name, async () => {
      const stateFile = path.join(os.tmpdir(), `cp-invalid-${name}-${Date.now()}-${Math.random()}.json`);
      fs.writeFileSync(stateFile, JSON.stringify(state));
      const beforeCalls = upstreamCalls;
      const s = await startServer({ STATE_FILE: stateFile, MAX_BYTES: "65536", RATE_LIMIT: "1000", DAILY_CAP: "1000" });
      try {
        const health = await rawReq(s.port, { method: "GET", path: "/healthz" });
        assert.equal(health.status, 503);
        const m = multipart("payload");
        const response = await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
        assert.equal(response.status, 503);
        assert.equal(JSON.parse(response.text).error, "cost_guard_unavailable");
        assert.equal(upstreamCalls, beforeCalls);
      } finally {
        await s.stop();
        fs.rmSync(stateFile, { force: true });
      }
    });
  }
});

test("upstream error mapping: 400->400, 404->503, 429->429, 500->502", async () => {
  const s = await startServer({ MAX_BYTES: "65536", RATE_LIMIT: "1000", DAILY_CAP: "1000" });
  try {
    const send = (mark) => {
      const m = multipart(mark);
      return rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    };
    const r400 = await send("MOCK:400");
    assert.equal(r400.status, 400);
    assert.equal(JSON.parse(r400.text).error.code, "invalid_file");

    const r404 = await send("MOCK:404");
    assert.equal(r404.status, 503);
    assert.equal(JSON.parse(r404.text).error, "not_enabled");

    const r429 = await send("MOCK:429");
    assert.equal(r429.status, 429);
    assert.equal(r429.headers["retry-after"], "7");

    const r500 = await send("MOCK:500");
    assert.equal(r500.status, 502);
    assert.equal(JSON.parse(r500.text).error, "upstream_error");
    assert.equal(JSON.parse(r500.text).status, 500);
  } finally {
    await s.stop();
  }
});

test("unreachable upstream -> 502, and the slot is released", async () => {
  const s = await startServer({ UPSTREAM_URL: "http://127.0.0.1:1/v1/content_provenance_checks", MAX_BYTES: "65536" });
  try {
    const m = multipart("payload");
    const r = await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    assert.equal(r.status, 502);
    assert.equal(JSON.parse(r.text).error, "upstream_unavailable");
    assert.equal((await getHealth(s.port)).inflight, 0);
  } finally {
    await s.stop();
  }
});

test("ACCESS_TOKEN: wrong/missing -> 401, correct Bearer -> 200, ?token= no longer accepted", async () => {
  const s = await startServer({ ACCESS_TOKEN: "s3cret", MAX_BYTES: "65536", RATE_LIMIT: "1000" });
  try {
    const m = multipart("payload");
    const noAuth = await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    assert.equal(noAuth.status, 401);

    const wrong = await rawReq(s.port, {
      headers: { "content-type": m.contentType, authorization: "Bearer nope" },
      body: m.body,
    });
    assert.equal(wrong.status, 401);

    const qs = await rawReq(s.port, {
      path: "/verify?token=s3cret",
      headers: { "content-type": m.contentType },
      body: m.body,
    });
    assert.equal(qs.status, 401, "query token must not authenticate");

    const good = await rawReq(s.port, {
      headers: { "content-type": m.contentType, authorization: "Bearer s3cret" },
      body: m.body,
    });
    assert.equal(good.status, 200);
  } finally {
    await s.stop();
  }
});

// --- config validation + trust invariant -----------------------------------

test("invalid numeric config is fatal so a guard cannot be silently disabled", async () => {
  for (const env of [{ DAILY_CAP: "3,000" }, { MAX_BYTES: "20mb" }, { RATE_LIMIT: "abc" }, { MAX_CONCURRENCY: "0" }]) {
    const { code, out } = await startExpectingExit(env);
    assert.notEqual(code, 0, `expected a non-zero exit for ${JSON.stringify(env)}`);
    assert.match(out, /\[config\] invalid/, `expected a config error for ${JSON.stringify(env)}`);
  }
});

test("anonymous service refuses to bind a non-loopback host", async () => {
  const { code, out } = await startExpectingExit({ HOST: "0.0.0.0" });
  assert.notEqual(code, 0);
  assert.match(out, /refusing to start/);
});

// --- state guard: recovery + day rollover ----------------------------------

test("healthz reports the cost guard healthy with the expected shape", async () => {
  const s = await startServer({ MAX_BYTES: "65536" });
  try {
    const h = await getHealth(s.port);
    assert.equal(h.ok, true);
    assert.equal(h.cost_guard_healthy, true);
    assert.equal(h.day_count, 0);
    assert.equal(typeof h.inflight, "number");
    assert.equal(typeof h.uploads, "number");
  } finally {
    await s.stop();
  }
});

test("a past-day state file resets today's count to zero", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-pastday-"));
  const stateFile = path.join(dir, "state.json");
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  fs.writeFileSync(stateFile, JSON.stringify({ day: yesterday, count: 500 }));
  const s = await startServer({ STATE_FILE: stateFile, MAX_BYTES: "65536", RATE_LIMIT: "1000", DAILY_CAP: "1000" });
  try {
    assert.equal((await getHealth(s.port)).day_count, 0, "yesterday's count must not carry over");
    const m = multipart("payload");
    assert.equal((await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body })).status, 200);
  } finally {
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a transient state write failure heals without a restart", async () => {
  const dir = path.join(os.tmpdir(), `cp-recover-${Date.now()}-${Math.random()}`);
  const stateFile = path.join(dir, "state.json"); // parent dir does not exist yet
  const s = await startServer({ STATE_FILE: stateFile, MAX_BYTES: "65536", RATE_LIMIT: "1000", DAILY_CAP: "1000" });
  try {
    assert.equal((await getHealth(s.port)).cost_guard_healthy, false);
    const m = multipart("payload");
    assert.equal((await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body })).status, 503);
    fs.mkdirSync(dir, { recursive: true }); // state file becomes writable again
    assert.equal((await getHealth(s.port)).cost_guard_healthy, true, "healthz must heal");
    assert.equal((await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body })).status, 200);
  } finally {
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- upstream timeout + budget accounting ----------------------------------

test("upstream timeout aborts to 502, releases the slot, and keeps the charge", async () => {
  const s = await startServer({ UPSTREAM_TIMEOUT_MS: "150", MAX_BYTES: "65536", RATE_LIMIT: "1000", DAILY_CAP: "1000" });
  try {
    const m = multipart("MOCK:SLOW"); // stub upstream delays 300ms
    const r = await rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    assert.equal(r.status, 502);
    assert.equal(JSON.parse(r.text).message, "upstream timeout");
    assert.equal((await getHealth(s.port)).inflight, 0);
    // an aborted request may already have been processed upstream: keep the charge
    assert.equal((await getHealth(s.port)).day_count, 1);
  } finally {
    await s.stop();
  }
});

test("a request that never reaches upstream is refunded, not counted", async () => {
  const s = await startServer({
    UPSTREAM_URL: "http://127.0.0.1:1/v1/content_provenance_checks",
    MAX_BYTES: "65536",
    RATE_LIMIT: "1000",
    DAILY_CAP: "1",
  });
  try {
    const m = multipart("payload");
    const send = () => rawReq(s.port, { headers: { "content-type": m.contentType }, body: m.body });
    assert.equal((await send()).status, 502);
    assert.equal((await getHealth(s.port)).day_count, 0, "an unreachable upstream must not consume budget");
    // with the charge refunded, the daily budget is still available
    assert.equal((await send()).status, 502, "still 502, not 429");
  } finally {
    await s.stop();
  }
});
