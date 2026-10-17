# Decisions

## 2026-10-18 - Use a parameterized local editor state with bounded preview rendering

- Decision: Keep the original image immutable, store crop/transform/adjustment/local-region parameters in `EditorState`, render a max-1600px preview with `requestAnimationFrame`, and re-render the same state at source resolution for export.
- Rationale: This supports continuous pointer/touch editing, reliable undo/redo, and local privacy without repeatedly decoding or permanently mutating pixels.
- Alternatives considered: Re-encode after every operation was rejected because it accumulates quality loss and makes history expensive; a server editor was rejected because the product is local-first.
- Impact: New editor logic is split into domain state, application renderer, infrastructure decoder, and React interaction component; no runtime dependency was added.
- Rollback trigger: Browser memory limits or unsupported Canvas filter behavior require reducing preview size or disabling a filter while preserving the state contract.
- Related files: `src/domain/editor-state.ts`, `src/application/editor-renderer.ts`, `src/infrastructure/editor-canvas.ts`, `src/components/ImageEditor.tsx`, `docs/superpowers/specs/2026-10-17-realtime-image-editor-design.md`.

## 2026-10-16 - Bind provider work to request lifetime and make deployment cleanup crash-safe

- Decision: drain rejected multipart files, propagate request aborts to the provider fetch, trust the same forwarded client key in the Nginx template, and exclude active release symlinks from receiver retention cleanup.
- Rationale: unconsumed multipart streams can hold request resources; disconnected clients should not keep billable provider calls alive; a template mismatch collapses rate limiting behind Nginx; and crash leftovers or active-release deletion can break the next deploy or rollback.
- Impact: the route now has explicit request cancellation semantics, and the deploy path is recoverable after interrupted symlink swaps.
- Related files: `server/provenance-route.ts`, `src/infrastructure/openai-provenance-adapter.ts`, `deploy/nginx-image.example.conf`, `deploy/oneimage-deploy-receiver.sh`.

## 2026-10-17 - Treat response close as client cancellation after upload completion

- Decision: Keep the request `aborted` listener for incomplete uploads and also listen to the response `close` event; abort provider work only when `reply.raw.writableEnded` is false.
- Rationale: Once the request body is fully consumed, `IncomingMessage.aborted` no longer reports that a client stopped waiting. A response close before normal completion is the lifecycle signal that reaches the provider AbortSignal.
- Impact: Completed uploads no longer leave billable upstream calls running after the browser disconnects; normal response completion does not self-cancel.
- Related files: `server/provenance-route.ts`, `tests/provenance-route.test.ts`.

## 2026-10-14 - Keep the provenance gateway in the monorepo and the default runtime same-origin

- Decision: Keep `providers/content-provenance-gateway/` as a normal package in the OneImage monorepo, while keeping OneImage's default provider on its own Fastify route.
- Rationale: The user requested one source repository. The gateway still has an independent process, package lock, tests, and deployment boundary; using the maintainer's anonymous public endpoint by default would silently upload images to a third-party host for downstream deployers.
- Impact: A normal clone contains the gateway; CI tests it directly without submodule initialization. Runtime configuration remains local-first.
- Rollback trigger: A future explicit operator-controlled endpoint must include a visible recipient/retention policy and an opt-in configuration.
- Related files: `providers/content-provenance-gateway`, `server/provenance-route.ts`, `01.项目/OneImage/OneImage 开发文档.md`.

## 2026-10-14 - Use restricted stdin streams for pxed release uploads

- Decision: The forced deployment key accepts only `upload <40-hex-sha> archive|checksum` commands; the receiver writes the stream to the matching `/tmp/oneimage-<sha>` path and then performs checksum, archive, install, restart, and health checks.
- Rationale: OpenSSH scp/SFTP negotiation is incompatible with a forced-command-only key. The stdin protocol preserves least privilege and avoids shell, arbitrary path, and SFTP access.
- Impact: GitHub Actions can deploy automatically without exposing a general-purpose SSH key.
- Rollback trigger: Any receiver validation bypass or failed atomic rollback requires disabling the deployment key and restoring the previous release symlink.
- Related files: `.github/workflows/ci.yml`, `deploy/oneimage-deploy-receiver.sh`.

## 2026-10-15 - Make the accepted input formats and size ceiling a single source of truth

- Decision: Define `SUPPORTED_IMAGE_MIME` (JPEG, PNG, WebP) and `MAX_INPUT_BYTES` (25 MB) once in `src/domain/image-input.ts`, and read them from browser validation, the tool registry, the server multipart limits, the provenance route, and the provider adapter. AVIF is removed from the accepted *input* set but remains a valid canvas *export* target for the convert tool.
- Rationale: The client dropzone advertised AVIF while the server route and the OpenAI provenance endpoint only accept JPEG/PNG/WebP, so a user could select a file the API immediately rejected. The 25 MB ceiling was also restated in four places and could drift from the multipart limit.
- Impact: Format changes are now a one-line edit; a table-driven route test pins every advertised MIME to a 200 and asserts AVIF is rejected with `400 invalid-input`.
- Rollback trigger: If the provenance provider starts accepting AVIF, add it back to the shared list in one place and extend the table-driven test.
- Related files: `src/domain/image-input.ts`, `src/application/file-policy.ts`, `src/domain/tool-registry.ts`, `server/provenance-route.ts`, `server/index.ts`, `src/infrastructure/openai-provenance-adapter.ts`, `src/App.tsx`.

## 2026-10-15 - Trust forwarded client addresses only from a loopback peer

- Decision: `server/client-ip.ts` reads `cf-connecting-ip` then the first `X-Forwarded-For` hop as the rate-limit key, but only when the immediate socket peer is loopback; otherwise the peer's own socket address is used.
- Rationale: Keying on `request.ip` alone collapsed every caller behind Nginx to `127.0.0.1`, sharing one 30/minute budget. Trusting forwarded headers unconditionally would let any client mint its own bucket. Loopback binding is the precondition that makes the header trustworthy, matching the bundled gateway's documented model.
- Impact: A live check on the built server showed one forwarded client denied at request 31 (429) while 32 distinct forwarded clients all passed.
- Rollback trigger: If the server is ever bound to a non-loopback interface, the forwarded-header trust assumption is void and `client-ip.ts` must change before that deploy.
- Related files: `server/client-ip.ts`, `server/rate-limit.ts`, `server/index.ts`, `tests/client-ip.test.ts`, `tests/rate-limit.test.ts`.

## 2026-10-15 - Delete maxPixels rather than implement it; read warningCodes from the registry

- Decision: Remove `maxPixels` from `ToolDefinition` and its three declarations. Make `warningCodes` authoritative by adding `resolveToolWarnings`; the worker returns only the artifact and the caller attaches warnings.
- Rationale: `maxPixels` was declared 40 MP on resize/crop/rotate with no reader, and a declared limit that nothing enforces is a guarantee the app does not make. `warningCodes` was duplicated as a hardcoded `toolId === 'compress'` ternary in two files.
- Impact: Adding a warning is a registry edit. Keeping the registry out of the worker bundle avoided growing it from 2.33 kB to 4.22 kB.
- Rollback trigger: If a CPU-plane path is added that must reject large images up front, reintroduce a pixel cap together with the enforcement, not as a declaration alone.
- Related files: `src/domain/tool.ts`, `src/domain/tool-registry.ts`, `src/infrastructure/browser-image-processor.ts`, `src/infrastructure/image-worker.ts`, `tests/tool-registry.test.ts`.

