# Decisions

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

