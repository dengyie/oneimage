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

