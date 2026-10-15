# TODO

## In Progress

- [ ] None for the completed P0 deployment milestone.

## Next

- [ ] Select the first AI image generation provider and document retention, training, pricing, quota, timeout, and error policy.
- [ ] Add a provider contract test using a sandbox or deterministic fixture before enabling production traffic.

## Manual-required

(host/infra side, outside the repo-only change scope)

- [ ] Raise nginx `client_max_body_size` slightly above the 25 MiB app cap (e.g. `26m`) so an
      over-limit upload reaches the app and gets the JSON `413 payload-too-large`, not nginx's HTML page.
- [ ] Investigate the Cloudflare-tunnel upload throughput to pxed (~60-90 KB/s); uploads above a few
      hundred KB currently `502`. App and nginx are fast locally, so the tunnel/host egress is the limit.
- [ ] Restore app log capture on pxed (Supervisor `stdout_logfile` is configured but `fd 1` is a pipe
      and `out.log` stopped growing); without it the origin has no request log.
- [ ] Confirm the pxed NFS release-parent quota: the `d3dad4c` deploy failed writing `run.sh.new`
      (`Disk quota exceeded`), now avoided by the receiver's atomic symlink. Verify the host
      receiver `/usr/local/sbin/oneimage-deploy` stays in sync with `deploy/oneimage-deploy-receiver.sh`
      (it had drifted; repo was synced back on 2026-10-15).
- [ ] Rotate the dedicated OpenAI test key before any formal production release.

## Done

- [x] Sync `deploy/oneimage-deploy-receiver.sh` to the hand-patched host receiver (atomic `run.sh`
      symlink + rollback restore), closing the drift behind the `d3dad4c` `Disk quota exceeded` deploy failure.
- [x] Run an online smoke test of the production gateway (health, capabilities, validation, happy
      path, per-client rate limit) and attribute the large-upload `502`s to the tunnel leg, not the app.
- [x] Rate-limit per real client IP, trusting forwarded headers only from a loopback peer (`3a31e16`), with a live 429 check.
- [x] Make `warningCodes` authoritative via `resolveToolWarnings` and delete the unenforced `maxPixels` (`70ea40e`).

- [x] Perform a 9-dimension production code review and land the resulting cleanups: dead shims/unused exports removed (`69d4572`), shared MIME/size policy (`22b19a8`); CI run `38621428349` green and live-verified.
- [x] Drop the redundant `tests/browser-image-processor.test.ts` after migrating its unique assertions into `tests/image-ops.test.ts`.

- [x] Route OpenAI provenance through `undici.ProxyAgent` and pxed `HTTPS_PROXY`.
- [x] Repair GitHub Actions production secrets/variables and forced-command deployment receiver.
- [x] Replace SFTP/scp deployment upload with restricted SHA-scoped stdin streams.
- [x] Deploy `d7ca720` to pxed and verify health, capabilities, and public provenance PNG response.
- [x] Repin content-provenance submodule to v3 `f6b4a23`.
- [x] Convert content-provenance from submodule to a normal package in the OneImage monorepo.
- [x] Upgrade CI actions to Node 24 runtime.
