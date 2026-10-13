# Decisions

## 2026-10-14 - Keep the provenance gateway as a submodule and the default runtime same-origin

- Decision: Keep `providers/content-provenance-gateway/` as a git submodule and keep OneImage's default provider on its own Fastify route.
- Rationale: The gateway has an independent release and operational boundary; using the maintainer's anonymous public endpoint by default would silently upload images to a third-party host for downstream deployers.
- Impact: OneImage CI recursively checks the gateway, while runtime configuration remains local-first.
- Rollback trigger: A future explicit operator-controlled endpoint must include a visible recipient/retention policy and an opt-in configuration.
- Related files: `providers/content-provenance-gateway`, `server/provenance-route.ts`, `01.项目/OneImage/OneImage 开发文档.md`.

## 2026-10-14 - Use restricted stdin streams for pxed release uploads

- Decision: The forced deployment key accepts only `upload <40-hex-sha> archive|checksum` commands; the receiver writes the stream to the matching `/tmp/oneimage-<sha>` path and then performs checksum, archive, install, restart, and health checks.
- Rationale: OpenSSH scp/SFTP negotiation is incompatible with a forced-command-only key. The stdin protocol preserves least privilege and avoids shell, arbitrary path, and SFTP access.
- Impact: GitHub Actions can deploy automatically without exposing a general-purpose SSH key.
- Rollback trigger: Any receiver validation bypass or failed atomic rollback requires disabling the deployment key and restoring the previous release symlink.
- Related files: `.github/workflows/ci.yml`, `deploy/oneimage-deploy-receiver.sh`.
