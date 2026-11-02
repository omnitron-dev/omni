# Dependency inputs

Install the workspace with `pnpm install --frozen-lockfile`. Kysera packages,
including the migration runner, come from the registry. Keep them on one tested
release: Titan's database adapters and their plugins share the same executor.

Until the reviewed Xec changes are published together, the workspace overrides
point to content-addressed archives. `xec-manifest.json` records their source
revisions and digests. For Core, prepare the package with Xec's
`scripts/ssh-transport.mjs prepare`, pack that directory, and run
`scripts/check-ssh-security.mjs --archive <archive>` with both the npm and pnpm
consumers. A pack of the unprepared workspace or a registry copy with the same
version is not a substitute: Core bundles the reviewed SSH transport.

Update the archive, manifest, override and lockfile together. A frozen install
and a test of the actual packed consumer are independent checks. Once a new
registry release contains those bytes, remove the corresponding override in
the same change that updates the lockfile. Never republish an existing version.
