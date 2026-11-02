# Dependency inputs

Install with `pnpm install --frozen-lockfile`. The workspace pins a single registry release of Xec and Kysera for every consumer. The lockfile records the SHA-512 integrity of each npm archive.

When updating Xec, download the exact Core release with `npm pack @xec-sh/core@<version> --ignore-scripts`. Run Xec's `scripts/check-ssh-security.mjs --archive <archive>` against the downloaded bytes with both its npm and pnpm consumers. The Core package ships the SSH transport and its license. Applications use the public Xec API.

Kysera plugins and Titan's database adapter share one executor. Update their workspace pins and lockfile together, compare the registry digests with the publisher's release receipts, and run the database and migration tests against the installed packages.
