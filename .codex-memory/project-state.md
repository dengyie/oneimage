# Project State

## Objective

Maintain OneImage as a browser-first image workbench and keep its provenance path deployable through GitHub Actions to pxed.

## Current Phase

P0 production deployment and provenance 502 repair complete.

## Current Branch

`main` at `22b19a8` (remote `dengyie/oneimage`).

## Last Verified

2026-10-15 Asia/Shanghai: Actions run `38621428349` verify/package/deploy all succeeded for two post-review commits (`69d4572` dead-code removal, `22b19a8` shared input-format policy). tsc, frontend build, server build, and 46 local tests pass. Live `image.mangoqwq.com`: `/healthz` 200, PNG upload passes the MIME gate to the provider, AVIF upload returns `400 invalid-input`.

## Active Risks

- OpenAI key is intentionally retained as a dedicated test key per owner instruction; rotate before production use.
- AI image generation provider, pricing, quota, and policy selection remain P1 product work.
- Rate limiting keys on `request.ip` with Fastify's default `trustProxy: false`, and the Nginx example sets `X-Real-IP` but not `X-Forwarded-For`; under multi-client reverse proxying this degrades to one global bucket. Fix spans server config plus the host Nginx example, so it is deferred to an owner decision.
- `maxPixels` and `warningCodes` in the tool contract have no consumers (`lossy-output` is always emitted for compress); open contract-convergence item.

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
