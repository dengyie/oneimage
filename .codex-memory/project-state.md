# Project State

## Objective

Maintain OneImage as a browser-first image workbench and keep its provenance path deployable through GitHub Actions to pxed.

## Current Phase

P0 production deployment and provenance 502 repair complete.

## Current Branch

`main` at `d7ca720` (remote `dengyie/oneimage`).

## Last Verified

2026-10-14 Asia/Shanghai: Actions run `38291298626` verify/package/deploy all succeeded; pxed revision matches; Supervisor and Nginx running; `/healthz` and capabilities return 200; public provenance PNG smoke returned 200.

## Active Risks

- OpenAI key is intentionally retained as a dedicated test key per owner instruction; rotate before production use.
- AI image generation provider, pricing, quota, and policy selection remain P1 product work.

## Active Blockers

None for the current P0 deployment milestone.

## Current Focus

Keep the CI release path and canonical Obsidian deployment facts synchronized.

## Next Milestone

Select and contract-test the first AI image generation provider with explicit cost and quota controls.

## Key Artifacts

- Production: `https://image.mangoqwq.com`
- Server: `/personal/pxed/oneimage`, Supervisor program `oneimage`
- Gateway submodule: `providers/content-provenance-gateway/` at `f6b4a23`
- Canonical docs: `01.项目/OneImage/OneImage 文档索引.md`, `01.项目/OneImage/OneImage 开发文档.md`
