# Project State

## Objective

Maintain OneImage as a browser-first image workbench and keep its provenance path deployable through GitHub Actions to pxed.

## Current Phase

P0 production deployment and provenance 502 repair complete.

## Current Branch

`main` at `6960e56` (remote `dengyie/oneimage`). `6960e56` is a docs/memory commit directly on
top of the owner's `d3dad4c` ("fix: normalize provenance failures and capability gating"), which
itself sits on the `70ea40e` work. `6960e56` is the release running in production, so it already
carries `d3dad4c`'s code. The owner's `d3dad4c` CI run `38648879582` *failed* at `deploy-pxed`
(`install: failed to close '/personal/pxed/oneimage/run.sh.new': Disk quota exceeded`); the host
receiver `/usr/local/sbin/oneimage-deploy` was hand-patched to manage the entrypoint with an atomic
symlink instead of writing a second file, and `d3dad4c` was brought live without a green CI run.

## Last Verified

2026-10-15 Asia/Shanghai: Online smoke test of production `image.mangoqwq.com` (release `d3dad4c`).
Passed: `/healthz` 200; `/api/v1/capabilities` 200 (`provenance.enabled=true`, provider `openai`,
`maxInputBytes=26214400`); JSON error envelope for non-multipart, signature/MIME mismatch, and AVIF
input (all `400 invalid-input`); happy path JPEG/PNG/WebP return `200` with real C2PA and SynthID
evidence; the per-client limiter returns `429` after 30 requests in a window (verified on the origin
and through nginx). Failed: uploads above roughly 200 KB over Cloudflare are throttled to ~60-90 KB/s
and end in a Cloudflare `502` or a client timeout. The app itself is fast (12 MB in ~5 s on loopback)
and nginx locally is fast (5 MB in ~2 s), so the constraint is the Cloudflare->origin tunnel leg.

Earlier: Actions run `38632226498` verify/package/deploy all succeeded for the rate-limiter and tool-contract fixes (`3a31e16`, `70ea40e`). 56 local tests pass, gateway 25/25.

Earlier the same day: Actions run `38621428349` verify/package/deploy all succeeded for two post-review commits (`69d4572` dead-code removal, `22b19a8` shared input-format policy). tsc, frontend build, server build, and 46 local tests pass. Live `image.mangoqwq.com`: `/healthz` 200, PNG upload passes the MIME gate to the provider, AVIF upload returns `400 invalid-input`.

## Active Risks

- OpenAI key is intentionally retained as a dedicated test key per owner instruction; rotate before production use.
- AI image generation provider, pricing, quota, and policy selection remain P1 product work.
- Large uploads through the Cloudflare tunnel to pxed are throttled (~60-90 KB/s) and fail with `502`
  above a few hundred KB. App and nginx are both fast locally, so this is host/tunnel-side and outside
  the repo-only change scope.
- nginx `client_max_body_size 25m` equals the 25 MiB app cap (`26214400`), so multipart framing overhead
  makes the top of the advertised range fail at nginx with its HTML `413` instead of the JSON contract.
- The OneImage app's stdout is not captured on pxed: `fd 1` is a pipe and `out.log` has been frozen
  since 2026-10-15 08:53 +0800, so request logs are unavailable (host-side observability gap; the pipe
  could eventually fill and block the process).
- The pxed release parent (`/personal/pxed/oneimage`) is on NFS with a quota that can fail at `close(2)`
  when a second file is written into it, which is what broke the `d3dad4c` deploy. The receiver must
  keep the Supervisor entrypoint (`$root/run.sh`) as an atomic symlink to the active release; the repo
  copy of `deploy/oneimage-deploy-receiver.sh` had drifted behind the host and has been synced back.

## Active Blockers

None for the current P0 deployment milestone.

## Current Focus

Keep the CI release path and canonical Obsidian deployment facts synchronized.

## Next Milestone

Select and contract-test the first AI image generation provider with explicit cost and quota controls.

## Key Artifacts

- Production: `https://image.mangoqwq.com`
- Server: `/personal/pxed/oneimage`, Supervisor program `oneimage`
- Gateway package: `providers/content-provenance-gateway/` at v3 baseline `f6b4a23`
- Canonical docs: `01.项目/OneImage/OneImage 文档索引.md`, `01.项目/OneImage/OneImage 开发文档.md`
