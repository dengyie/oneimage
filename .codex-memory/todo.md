# TODO

## In Progress

- [ ] None for the completed P0 deployment milestone.

## Next

- [ ] Select the first AI image generation provider and document retention, training, pricing, quota, timeout, and error policy.
- [ ] Add a provider contract test using a sandbox or deterministic fixture before enabling production traffic.

## Manual-required

- [ ] Rotate the dedicated OpenAI test key before any formal production release.

## Done

- [x] Route OpenAI provenance through `undici.ProxyAgent` and pxed `HTTPS_PROXY`.
- [x] Repair GitHub Actions production secrets/variables and forced-command deployment receiver.
- [x] Replace SFTP/scp deployment upload with restricted SHA-scoped stdin streams.
- [x] Deploy `d7ca720` to pxed and verify health, capabilities, and public provenance PNG response.
- [x] Repin content-provenance submodule to v3 `f6b4a23`.
- [x] Convert content-provenance from submodule to a normal package in the OneImage monorepo.
- [x] Upgrade CI actions to Node 24 runtime.
