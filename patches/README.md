# Dependency patches

`ts-morph-common@0.29.0.patch` aligns the bundled parser's dependency declaration
with the patched minimatch 11.x used by the KB extractor. Upstream declares 10.x,
which is affected by GHSA-g3hv-75wg-m249. npm validates the embedded manifest
when it replays a consumer lockfile. Remove the patch once upstream accepts
a safe version and the packed consumer passes `npm ci` and extraction.

`vitest@5.0.5.patch` keeps temporary compiler copies scoped to the owning process,
cleans them on handled interruption and removes abandoned copies only after their
owner no longer exists. It also applies `VITEST_MAX_WORKERS` before normal runner
configuration: `fileParallelism: false` continues to require one worker, and
inspector safety is checked against the effective worker count. A global worker
budget must not make files that share a database fixture run concurrently.

The installed runner is checked through its public `resolveConfig` API in
`apps/omnitron/test/unit/vitest-worker-budget.test.ts`. The temporary-directory
lifecycle check is `node scripts/a-temp-dir-the-test-runner-never-removed.mjs`.
Preserve both behaviours when upgrading Vitest; drop a patch only after the
ordinary installed upstream version passes the corresponding regressions.
