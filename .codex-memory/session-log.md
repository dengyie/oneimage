# Session Log

## 2026-10-14 01:20
- Task: Continue OneImage production repair and documentation closure.
- Actions: Pulled remote `main` through `d7ca720`; confirmed submodule `f6b4a23`; inspected Actions run `38291298626`; checked pxed revision, Supervisor, Nginx, health, capabilities, and proxy environment; removed stale hardening/deployment TODO wording from canonical Obsidian docs; added repo project memory.
- Results: The three CI jobs succeeded; pxed runs the expected revision; current P0 deployment milestone has no blocker. `scan-stale-docs --strict-status` returned `RESULT=OK` with only pre-existing unrelated TLDR warnings.
- Next: Choose and contract-test the first AI image generation provider.
- Blockers: Dedicated OpenAI test key must be rotated before formal production use; owner explicitly requested it remain for testing now.

## 2026-10-14 06:30
- Task: Merge the provenance gateway into the OneImage main repository.
- Actions: Archived the v3 submodule contents into `providers/content-provenance-gateway/`, removed `.gitmodules` and recursive checkout settings, updated package metadata/README/CI, and synchronized canonical Obsidian docs and MOCs.
- Results: OneImage tests 34/34, gateway tests 25/25, TypeScript, frontend build, server build, clean package install, and diff checks passed.
- Next: Commit and push the monorepo conversion; let the normal CI deploy the unchanged runtime artifact.
- Blockers: The legacy public `dengyie/content-provenance` repository is intentionally not deleted because deletion is irreversible; it is no longer the main source of truth.

## 2026-10-14 06:35
- Task: Close the old standalone gateway repository after the monorepo merge.
- Actions: Archived `dengyie/content-provenance` through GitHub API without deleting it; marked the old repository as historical in canonical docs.
- Results: OneImage main repository is the only active source of truth; the old repository remains recoverable and traceable.
- Next: No further deployment work for this milestone.
- Blockers: None.

## 2026-10-15 03:15
- Task: Land two post-review commits (dead-code cleanup and shared input-format policy) and close the documentation loop.
- Actions: Removed the `browser-image-processor` re-export shim, the unused `PublicCapabilities`/`getPublicCapabilities`, `ToolInput`, and `ToolDefinition.fallback`, plus the duplicate `tests/browser-image-processor.test.ts` (unique assertions migrated first) as `69d4572`. Introduced `src/domain/image-input.ts` as the single source of truth for accepted input MIME and the 25 MB ceiling and wired it through browser validation, the tool registry, the server multipart limits, the route, the provider adapter, and the dropzone UI; dropped AVIF from the accepted input set while keeping it a canvas export target. Added a table-driven route test for every advertised MIME plus an explicit AVIF rejection. Updated canonical Obsidian docs and repo project memory; ran `scan-stale-docs --vault .`.
- Results: tsc clean, 46 local tests pass, frontend and server builds pass, gateway 25/25. CI run `38621428349` verify/package/deploy-pxed all green. Live `image.mangoqwq.com` confirmed: `/healthz` 200, PNG upload passes the MIME gate and reaches the provider, AVIF returns `400 invalid-input`. `scan-stale-docs` returned `RESULT=OK` (`stale_hits=0`, only pre-existing unrelated TLDR warnings).
- Next: Owner decisions on the rate-limiter IP source and the unused tool-contract fields; otherwise P1 AI provider selection.
- Blockers: None.

## 2026-10-15 04:30
- Task: Close the two remaining review findings that are fixable inside the repository (rate-limiter key, tool contract), and refresh docs.
- Actions: Added `server/client-ip.ts` (`resolveClientKey`) and `server/rate-limit.ts` (limiter with injectable clock); the limiter now keys on the real client address and only trusts `cf-connecting-ip` / `X-Forwarded-For` when the socket peer is loopback. Widened the `allow` port in `server/provenance-route.ts` so the route can pass headers and the raw socket. Added `resolveToolWarnings` and routed both processors through it; the worker now returns only the artifact so the registry stays out of the worker bundle. Removed `maxPixels` from the contract and its three declarations. Updated canonical Obsidian docs, MOCs, and the AI doc router; ran `scan-stale-docs`.
- Results: tsc clean, 56 local tests pass (14 files), gateway 25/25, frontend and server builds pass. Live check against the built bundle: one forwarded client is denied at request 31 (429) while 32 distinct forwarded clients all pass. CI run `38632226498` verify/package/deploy-pxed all green; live `image.mangoqwq.com` `/healthz` 200 and AVIF still `400 invalid-input`. `scan-stale-docs --vault .` returned `RESULT=OK` (`stale_hits=0`).
- Next: P1 AI provider selection; the self-contained-bundle / `node_modules` removal item still needs an owner decision because it spans the host receiver.
- Blockers: None.

## 2026-10-15 10:30
- Task: Run an online smoke test of the production OneImage provenance gateway.
- Actions: Exercised `https://image.mangoqwq.com` end to end with generated fixtures: `/healthz`,
  `/api/v1/capabilities`, non-multipart and signature/MIME-mismatch and AVIF rejections, valid JPEG/PNG/WebP,
  a size sweep from 200 KB to 26 MB, and a 45-way parallel burst for the per-client limiter. Traced the
  request path (Cloudflare -> cloudflared -> nginx `127.0.0.1:3302` -> app `127.0.0.1:8877`), read the
  nginx vhost and error log, Supervisor config, and app log, and re-ran the same payloads on the origin
  itself (app and nginx) to separate the app from the edge. Cleaned up all temporary fixtures locally
  and on the host.
- Results: Validation, happy path (real C2PA + SynthID evidence), the JSON error envelope, and the
  per-client `429` all behave correctly. Two problems are on the edge/host, not in the app: (1) uploads
  above ~200 KB through Cloudflare crawl at ~60-90 KB/s and `502`/time out, while the app does 12 MB in
  ~5 s and nginx does 5 MB in ~2 s on loopback, so the Cloudflare-tunnel leg is the bottleneck;
  (2) the app's stdout is not captured (fd 1 is a pipe, `out.log` frozen since 08:53 +0800). Also noted:
  nginx `client_max_body_size 25m` == the 25 MiB app cap, so the top of the advertised range is rejected
  by nginx with HTML instead of the JSON contract. Production is running the owner's commit `d3dad4c`.
- Next: Owner decision on the three host-side items above; P1 AI provider selection otherwise.
- Blockers: None in the repository; the edge/host items need host changes, which the repo-only scope excludes.

## 2026-10-15 11:30
- Task: Close the smoke-test documentation loop and reconcile a deploy-script drift found while verifying CI.
- Actions: Committed and pushed the smoke-test findings to repo memory (`6960e56`) and updated the
  Obsidian index and dev doc; `scan-stale-docs` returned `RESULT=OK`. While confirming CI, found the
  owner's `d3dad4c` run `38648879582` had **failed** at `deploy-pxed` with
  `install: failed to close '/personal/pxed/oneimage/run.sh.new': Disk quota exceeded` on the NFS
  release parent; production was instead serving `6960e56` (which carries `d3dad4c`'s code) after a
  successful 11:07 deploy. Compared the host receiver `/usr/local/sbin/oneimage-deploy` with the repo
  copy `deploy/oneimage-deploy-receiver.sh`: the host had been hand-patched at 06:44 to keep the
  Supervisor entrypoint `$root/run.sh` as an atomic symlink to the active release and to restore it on
  rollback, and the repo copy had never contained that logic in any commit. Synced the repo receiver
  to match the host exactly (`bash -n` clean, normalized diff empty).
- Results: repo receiver now matches the deployed host script; production healthy on `6960e56`
  (`/healthz` 200, capabilities 200). The `d3dad4c` CI failure is historical and superseded by the
  green `6960e56` run.
- Next: P1 AI provider selection; host-side items (nginx `client_max_body_size`, tunnel throughput,
  app log capture) still need an owner decision.
- Blockers: None in the repository.
