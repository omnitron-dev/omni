# Dependency patches

These patches are applied through [pnpm-workspace.yaml](../pnpm-workspace.yaml). Keep the patch, dependency declarations, and lockfile aligned when upgrading a dependency.

- [`@ts-morph/common`](ts-morph-common@0.29.0.patch) updates its declared minimatch dependency to the version used by the knowledge-base extractor. Packed consumers must replay the resulting dependency graph through ordinary `npm ci`.
- [Vitest](vitest@5.0.5.patch) scopes temporary compiler copies to their owner process and cleans abandoned copies only after that owner is gone. It also applies `VITEST_MAX_WORKERS` before normal runner configuration, while preserving single-worker behavior for `fileParallelism: false` and inspector constraints.

The worker-budget regression is [vitest-worker-budget.test.ts](../apps/omnitron/test/unit/vitest-worker-budget.test.ts). Temporary-directory lifecycle is checked by [a-temp-dir-the-test-runner-never-removed.mjs](../scripts/a-temp-dir-the-test-runner-never-removed.mjs).

Remove a patch when the installed upstream version passes the corresponding checks and the package-consumer gate.
