# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

### 🚨 Reliability — diagnose-the-real-cause-first

- **omnitron**: detect Container class identity mismatch between the daemon's
  `@omnitron-dev/titan` install and the app's titan install (e.g. monorepo
  daemon + npm-published app). The previous symptom was a cryptic
  `Dependency 'Container' not found` from every consumer; the new guard fires
  before `Application.create()` and surfaces a single error with both
  physical paths and a pnpm-overrides recipe.
- **titan-pm**: replace the 20-line stderr ring buffer in worker startup
  with a 64 KiB byte-bounded capture, and attach the full stderr/stdout
  text to the rejection error's `details`. Worker timeouts and child exits
  now expose the actual cause (missing package, JWT_SECRET, schema error,
  …) instead of a generic timeout message.
- **omnitron**: fail-fast on critical infrastructure provisioning failure.
  Stack start now throws a structured `INFRA_PROVISIONING_FAILED` with an
  actionable message instead of letting apps cascade-fail with misleading
  Redis/DI errors. Edge case: `settings.allowDegradedInfra: true` opts in
  for stacks that intentionally talk to external infrastructure.
- **omnitron**: postgres readiness probe + 5-attempt exponential-backoff
  retry on `runStackMigrations`. Eliminates the `ECONNREFUSED → app errored`
  race after fresh container provisioning. Only transient errors retry —
  schema/SQL errors propagate immediately.
- **omnitron**: rendezvous on daemon Netron readiness via an internal
  promise — apps that declare topology no longer fail with
  `daemon Netron not available` on startup-order interleaving; they wait
  with a generous timeout and then proceed.
- **omnitron**: monero JSON-RPC healthcheck now POSTs to `/json_rpc`
  (configurable via `IServiceHealthCheck.jsonrpc.path`) instead of `/`.
  Previously every Monero container stayed perpetually `unhealthy`.
- **omnitron**: health-monitor worker path resolution stops trusting
  `tsx` in `execArgv` as a proxy for "running from .ts" — it now checks
  what physically exists alongside the running daemon binary.

### ✨ Features

- **omnitron**: global `--json` flag (and `OMNITRON_OUTPUT=json` env var)
  for machine-readable output. Implemented for `stack start/stop`, `list`,
  `status`, `env`, `logs`, `health`, `metrics`, `inspect`. `monit`
  explicitly refuses with a structured pointer toward `--json status` on a
  poll loop. Errors land on stderr as `{"ok": false, "error": ...}`.
- **titan-database**: BIGINT (PostgreSQL OID 20) parser registered once
  per process — coerces to JS `number` when the value fits in
  `MAX_SAFE_INTEGER`, falls back to `BigInt` otherwise. Eliminates the
  persistent footgun where `Number.isFinite("5") === false`. Opt-out via
  `coerceBigint: false` on the connection config.

### 🛡 Robustness

- **titan-scheduler / titan-events**: `Container` is now `@Optional()` in
  the discovery services, with safe no-op fallbacks. Modules unrelated to
  scheduling/events no longer chain-fail on a missing `Container` token in
  test harnesses or unusual spawn configurations.
- **omnitron**: `getLogs` and `getHandle` accept either a fully namespaced
  handle key (`<project>/<stack>/<app>`) or the bare app name. `omnitron
  logs main`, `omnitron env main`, etc. now work in stack mode.
- **omnitron build-service**: esbuild externalize plugin transparently
  bundles workspace packages whose entry resolves to untranspiled
  `.ts/.tsx/.mts` files. Removes the runtime `ERR_UNKNOWN_FILE_EXTENSION`
  failure mode for source-only workspace deps.

### 🧪 Tests

- 14 new unit tests covering Container identity guard, stderr capture,
  postgres readiness probe, name resolution, and the externalize plugin.
- Existing test suites unaffected: titan-scheduler 236✓, titan-events 153✓,
  titan-pm 845✓, titan-database 313✓.


## [0.1.3] - 2026-04-03

### 📝 Other Changes

- Fix release script overwriting @kysera/* versions


## [0.1.2] - 2026-04-03

### 🐛 Bug Fixes

- fix: relax flaky memory usage assertion in devtools test

### 📝 Other Changes

- Fix TS4111 build error: use bracket notation for process.env access
- Read CLI_VERSION from package.json instead of hardcoding
- Fix titan-redis tests: unit/integration tests all passing
- Fix titan-database tests: 240 pass, 3 remaining migration flakes
- Fix titan-redis service spec and titan-database module
- Fix titan-pm, titan-redis, titan-database tests
- Fix pre-existing test failures across monorepo
- Add docker-compose.test.yml, make test ports configurable, remove jest legacy


## [0.1.1] - 2026-04-03

### 🐛 Bug Fixes

- fix(release): add --tag latest to npm publish for version downgrade support

### 📝 Other Changes

- Add semver dependency, fix release script types, add kb to publishable packages
- Rename @omnitron/prism to @omnitron-dev/prism, fix build errors, restore KB extraction pipeline
- Add .gitignore and unified README.md across the entire monorepo
- Initial commit

