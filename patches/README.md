# Dependency patches

These patches are applied through [pnpm-workspace.yaml](../pnpm-workspace.yaml). Keep the patch, dependency declarations, and lockfile aligned when upgrading a dependency.

- [`@ts-morph/common`](ts-morph-common@0.29.0.patch) updates its declared minimatch dependency to the version used by the knowledge-base extractor. Packed consumers must replay the resulting dependency graph through ordinary `npm ci`.
- [Vitest](vitest@5.0.5.patch) scopes temporary compiler copies to their owner process and cleans abandoned copies only after that owner is gone. It also applies `VITEST_MAX_WORKERS` before normal runner configuration, while preserving single-worker behavior for `fileParallelism: false` and inspector constraints.

The worker-budget regression is [vitest-worker-budget.test.ts](../apps/omnitron/test/unit/vitest-worker-budget.test.ts). Temporary-directory lifecycle is checked by [a-temp-dir-the-test-runner-never-removed.mjs](../scripts/a-temp-dir-the-test-runner-never-removed.mjs).

Remove a patch when the installed upstream version passes the corresponding checks and the package-consumer gate.

## Why does npm audit report picomatch in the SDK?

The registry identifies picomatch by version. The workspace applies a reviewed parser backport to 4.0.7 for GHSA-fc5q-39xc-vjpf. KB ships this distribution with ts-morph, and Lumen ships it with Vite. npm installs Vite's native build dependencies for the consumer's operating system. A separate Vite installation added by the consuming application needs its own dependency review. [Registry advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) · [Parser backport](picomatch@4.0.7.patch) · [Vite dependency manifest](vite@8.3.5.patch)

The backport restricts repeated extglob syntax affected by the advisory. Package acceptance exercises normal globstar, brace alternatives, dotfile handling, a Vite build and KB source extraction. The workspace and archive audit gates check the advisory origin, its resolved paths and the full contents of every installed matcher. An unexpected advisory or copy fails qualification.
