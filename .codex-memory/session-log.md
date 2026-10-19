# Session Log

## 2026-10-19 11:10 Asia/Shanghai
- Task: Root-cause fix all editor review findings and deploy to production with real testing.
- Actions: Routed tool execution through the current editor export and filtered options by tool; composited local regions over the globally adjusted canvas; added explicit global/region selection; reset the editor on every accepted selection and cleared the file input; added a renderer regression test.
- Results: 82 tests, TypeScript, frontend/server builds passed. Playwright verified local/global pixel composition, control targeting, same-file reset, selected-tool processing with unchanged `200x120` dimensions, and 390px mobile fit with no page errors. Production deployment is the remaining step.
- Next: Commit/push, wait for GitHub Actions deploy-pxed, verify revision/services and repeat public browser smoke.
- Blockers: None observed; remote CI/deploy results not yet available.

## 2026-10-18 13:30 Asia/Shanghai
- Task: Continue the confirmed realtime original-image editor implementation.
- Actions: Added pure EditorState/history/geometry modules, Canvas preview/export renderer, browser bitmap decoder, interactive ImageEditor with pointer crop handles, fixed ratios, arbitrary rotation, mirror, global/local adjustments, undo/redo/reset, and export. Connected it to App while preserving provenance and existing tools. Added focused state, renderer, and interaction tests. Fixed real regressions for rotated bounding boxes, fixed-ratio resizing, and gesture history commit timing.
- Results: 81/81 local tests pass; TypeScript, frontend build, and server build pass. Playwright loaded a valid PNG in desktop and 390px mobile viewports, exercised sharpness, local region, rotation, fixed ratio and export; canvas was nonblank and mobile had no horizontal overflow. Temporary browser dependency was not added to product manifests.
- Next: Final code review, commit/push, CI deploy, then online smoke check.
- Blockers: No code blocker. Production release is intentionally pending final review of the editor change.

## 2026-10-18 14:05 Asia/Shanghai
- Task: Release and online-verify the realtime editor.
- Actions: Pushed `71a6662`, waited for Actions run `39071231196`, and checked pxed revision, Supervisor/Nginx status, public health/capabilities, and the served static bundle.
- Results: verify/package/deploy-pxed all succeeded; pxed runs `71a6662`, both services are RUNNING, health/capabilities are 200, and the public HTML references the new bundle.
- Next: AI image generation provider selection and contract test.
- Blockers: Existing host backlog only: Cloudflare large-upload throughput, app log capture, and formal key rotation before production release.

## 2026-10-18 19:10 Asia/Shanghai
- Task: Deploy the editor and run a production browser smoke test.
- Actions: Checked the release, health/capabilities, uploaded a generated valid PNG through Playwright on the public site, exercised ratio selection, sharpen, local region, rotate, mirror and export, then checked 390px mobile layout. Found a crop overlay aspect-ratio distortion caused by the preview surface max-height, fixed it, ran all local gates, and redeployed `5137eb7`.
- Results: Actions run `39121790162` verify/package/deploy-pxed all green. pxed revision matches; both services RUNNING; health/capabilities 200. Public crop overlay ratio now measures exactly 1.0 for 1:1, WebP export works, mobile has no horizontal overflow, and browser page errors are zero.
- Next: Continue product work from the next active milestone.
- Blockers: None for the editor release.

## 2026-10-17 08:40 Asia/Shanghai
- Task: Continue production hardening and finish the pxed/public verification for provenance cancellation.
- Actions: Reproduced the post-upload disconnect gap with a real HTTP test (signal stayed false), then listened to response `close` while guarding against normally completed replies. Added regression coverage, ran tests/typecheck/builds/gateway suite/audit, pushed `ad1b3bb`, and followed CI deployment. Verified the pxed revision, Supervisor/Nginx state, public health/capabilities, a valid PNG provenance response, malformed image rejection, and temporary upload cleanup.
- Results: CI run `38986421928` verify/package/deploy-pxed all succeeded. OneImage 68/68, gateway 25/25, typecheck/builds/audit passed. Live valid PNG returned 200 with C2PA and SynthID evidence; invalid signature returned 400. An initial smoke fixture was malformed and OpenAI correctly returned `invalid_file`; the fixture was replaced with a CRC-valid PNG before final acceptance.
- Next: Current P0 milestone closed. Continue with the separately scoped AI image generation provider selection milestone.
- Blockers: None for P0. Existing host backlog remains: Cloudflare large-upload throughput and formal key rotation before production release.

## 2026-10-16
- Task: Root-fix all findings from the production code review.
- Actions: rejected MIME multipart streams are drained; provider checks accept a request-scoped AbortSignal and classify client disconnects as non-retryable `request-aborted`; Nginx example forwards the trusted Cloudflare client IP; receiver removes stale temporary symlinks and protects the active release and entrypoint during retention cleanup.
- Validation: OneImage 67 tests, TypeScript, frontend/server builds, gateway 25 tests, gateway audit, and receiver syntax checks pass. Provider-error-after-consumed-request and caller-abort regressions are covered.
- Next: commit/push, wait for CI deployment, then repeat online health/capabilities/provenance checks.

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
