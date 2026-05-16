# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.2.0] - 2026-05-16

### ✨ Features

- feat(prism/theme): add missing component overrides (AlertTitle, List, ListItemText, CircularProgress)
- feat(prism/tabs): action slot mirroring breadcrumbs
- feat(titan-cache,titan-pm): getOrSet + bounded maps + pool listener safety + PID liveness sweep
- feat(titan): shared computeBackoff + isProcessAlive helpers; suppress pool health-check spam
- feat(titan): FailureTracker primitive + wire into titan-lock to kill log spam
- feat(prism): CountrySelect + FlagIcon — asset-free country picker
- feat(prism): canonical BTC/XMR amount formatter
- feat(prism/FilterToolbar): i18n-able reset + results count
- feat(prism): platform toast-dedup wrapper + date-picker i18n hooks
- feat(prism/nav-card): NavCardGrid — canonical nav-tile container
- feat(prism/nav-card): orientation prop for narrow grids
- feat(prism): NavCard horizontal nav tile for admin dashboards
- feat(prism): FormAlert primitive for in-dialog form errors
- feat(titan-auth): cnf.fp confirmation claim in shared-session preset
- feat(titan-auth): kid-based JWT key rotation in JWTService
- feat(titan-auth): preset/shared-session — JWT+session-registry factory
- feat(prism): TagCloud — generic discovery visualisation
- feat(prism): controlled selection on AdminDataTable
- feat(titan): expose ./netron/service-descriptor as a leaf-level subpath
- feat(titan,titan-database,titan-events): observability + medium hardening
- feat(titan-pm,omnitron): supervisor + container self-healing
- feat(titan/netron): in-flight RPC resilience + auto-heal pool
- feat(titan,omnitron): unify operational-error policy across the stack
- feat(omnitron,titan): module health, offline UX, pipeline conditions
- feat(titan,omnitron): C11 — DI dependency graph CLI (omnitron inspect <app> --graph)
- feat(omnitron): C12 — production bundle portability (strip dev-machine paths)
- feat(omnitron): C10 — Prometheus /metrics endpoint with operational signals
- feat(titan-database): B7 — hardened migration runner with advisory lock + checksums
- feat(omnitron): B8 — esbuild watch self-heals on stale metafile
- feat(titan,omnitron): B6 — ServiceDescriptor + janitor grace period
- feat(titan): B5 — ResilientHandle<T> for cached external resources
- feat(omnitron): A4 — strict infra healthchecks (PONG-required, SELECT-1)
- feat(omnitron): A3 — unify stack vs. non-stack app naming model
- feat(omnitron): A2 — orphan-process janitor reaps leaked fork-workers
- feat(titan,titan-pm): A1 — LifecycleController with hard exit guarantee
- feat(prism): TipTapRenderer — admonitions, tabs, kbd/internalLink marks, code-block enhancements
- feat(prism): CommandPalette — keyboard-driven action launcher
- feat(prism): VirtualList primitive for windowed lists
- feat(prism): CountdownRing for time-limited UI artifacts + hasKeys fix
- feat(netron-browser): opt-in WebSocket service discovery via query_interface
- feat(titan/nexus): wire up decorator-driven DI features end to end
- feat(omnitron): tor preset for hidden-service-only operation
- feat(omnitron,titan): industrial-grade reliability and DX improvements
- feat(titan-database): deep audit — security, performance, and full kysera integration

### 🐛 Bug Fixes

- fix(prism/content): make ordered-list markers actually render
- fix(prism/toggle-button-group): selected state propagates to left edge
- fix(prism/toggle-button-group): match sibling-border colour to divider
- fix(prism/textfield): pin multiline inner padding via ownerState
- fix(prism/tabs): drop bottom divider from action-slot wrapper
- fix(titan-cache,titan-scheduler): close L2-adapter leak, drop `as any` casts, surface swallowed onError handler failures
- fix(titan-pm): wire WorkerHandle exit events into the supervisor crash chain
- fix(prism/textfield): multiline outlined input opens flush with top border
- fix(netron-browser): preserve upstream HTTP status as error code
- fix(prism/nav-card): elevated bg + text-derived border on dark themes
- fix(prism/nav-card): elevated bg so cards pop against dark page
- fix(prism/nav-card): suppress theme box-shadow on outlined cards
- fix(omnitron): align JWT secret across AuthService + TitanAuthModule
- fix(omnitron,titan-pm): report pool-managed topology as online in list/getInfo
- fix(prism/empty-content): vertically center against the main content area
- fix(omnitron/orchestrator): self-heal on missing bundle at restart
- fix(netron-react): two TS errors in middleware + registry
- fix(prism/navigation-progress): complete bar on search-param changes
- fix(omnitron/dev): break self-perpetuating restart loop
- fix(titan-metrics): unified recordTyped — registry/storage dedup (T#74)
- fix(omnitron/infrastructure): dedupe app container declarations (T#76)
- fix(omnitron/infrastructure): periodic phantom-endpoint janitor (T#75)
- fix(titan-telemetry-relay): async WAL writes + streaming replay (T#69)
- fix(titan-metrics): bounded retry buffer on flush failure (T#68)
- fix(titan/logger): wrap multistream destinations in async forwarders (T#67)
- fix(titan/logger): async stdout destination + flush hook (T#66)
- fix(omnitron/observability): metrics endpoint auth + secure bind (T#65)
- fix(titan-metrics): honour multi-value name/app filters in PG/SQLite (T#64)
- fix(titan-metrics): normalise daemon-scope samples (T#63)
- fix(titan-metrics): lock histogram bucket normalisation + cumulative semantics (T#62)
- fix(titan-pm): per-child shutdown deadline on supervisor (T#61)
- fix(omnitron/infrastructure): don't race Docker's restart cycle (T#58)
- fix(omnitron/orchestrator): per-name lock on startApp (T#57)
- fix(omnitron/daemon): detect PID reuse via argv signature (T#56)
- fix(omnitron/daemon): atomic write for state-store (T#55)
- fix(titan-pm): guard WorkerHandle.send on IPC channel state (T#54)
- fix(titan-pm): honour configured backoff between restart attempts (T#53)
- fix(titan-pm): register supervisor crash handler before child startup (T#52)
- fix(titan/netron): gate nested-service exposure in ServiceStub (T#49)
- fix(titan/netron): tighten base-transport text/binary disambiguation (T#48)
- fix(titan/netron): forced backend must respect route allowlist (T#47)
- fix(titan/netron): keep slowloris guard when requestTimeout=0 (T#46)
- fix(titan/netron): detach old-socket listeners on WS reconnect (T#45)
- fix(titan/netron): clean up responseHandlers on send-failure (T#44)
- fix(titan/netron): honour socket backpressure for stream chunks (T#43)
- fix(titan/netron): per-peer subscription cap + dedup idempotency (T#42)
- fix(titan/netron): semver-correct @latest resolution (T#41)
- fix(titan/netron): absolute size cap on decodePacket (T#40)
- fix(titan/netron): per-peer inbound rate limit on WS/TCP/Unix (T#39)
- fix(titan/netron): omit error stack traces on the wire by default (T#38)
- fix(titan/netron): add token-cache invalidation API for revocation (T#37)
- fix(titan/netron): lock down expose/unexpose core tasks (T#36)
- fix(titan/netron): close HTTP fast-path authz bypass (T#35)
- fix(titan/netron): enforce method-level authz on the wire path (T#34)
- fix(titan/nexus,application): expose iterateRegistrations API; drop private-field cast (T#32 partial)
- fix(titan/application,lifecycle,nexus): six T2 hardening fixes (T#26..T#31)
- fix(titan/application): reset shutdown latch on completion (T#25)
- fix(titan/nexus): scope __resolvingModule via AsyncLocalStorage (T#24)
- fix(titan/nexus): two fundamental DI defects — global state contamination + pending-promise double-storage
- fix(omnitron): managed-network architecture — banish bridge phantom-endpoint failures
- fix(omnitron): kill the dev-mode rebuild storm — 4 stacked guards
- fix(titan-metrics,omnitron): banish ghost apps from snapshots
- fix(titan): keep daemon alive on operational errors
- fix(omnitron): stamp app cwd from config file location, escalate watch errors
- fix(omnitron): D14 — defer daemon-level infrastructure provisioning when project mode is active
- fix(omnitron,titan-pm): kill zombie-fork-worker leak + esbuild self-heal
- fix(omnitron): use /json_rpc path for jsonrpc healthcheck

### 📝 Other Changes

- refactor(prism/theme): modularize index.ts — extract 5 component groups
- refactor(prism/theme): adopt paletteVar across component overrides (57 sites)
- refactor(prism/theme): remove !important hacks, add paletteVar helper
- refactor(prism/textfield): MUI v6 variants API + split style/variants
- chore(prism): TypeScript 6.0 + x-data-grid spec correction
- chore(prism): upgrade to MUI v9 + Vite 8 + Vitest 4.1.6
- ux(prism/breadcrumbs): distinguish linked vs current item by colour + weight
- security(titan/netron/http): T#100 — enforce @Public auth wired via configureAuth
- build(omni): bump turbo 2.9.9 → 2.9.12 + matching schema reference
- T#60 — titan-pm polish bundle: 12 medium-severity defects
- T#50 — Netron polish bundle: 8 security & cleanup fixes
- T#71 — observability T3 bundle: 12 medium-severity defect fixes
- T#59 — supervisor T2 bundle: 9 high-severity defect fixes
- T#70 — observability T2 bundle: 8 high-severity defect fixes
- T#77 — aggressive deprecation cycle: delete 22 dead exports + 588-line dead infrastructure file
- T#72 — collapse 3 event systems onto canonical IEventBus contract
- T#33 — decompose Application god class into 9 focused collaborators
- T#73 — distributed tracing foundation (W3C traceparent + ALS)
- refactor(titan/netron): split IPeer into IRpcPeer / IStatefulPeer (T#51)
- test(omnitron): seed adversarial test suite + fault-injection kit (T#78)
- refactor(titan): D13 — Application.executeShutdown delegates to LifecycleController
- build(prism): ship components/{index,editor} as separate entry points
- chore(deps): update workspace dependencies to latest
- test: eliminate all skipped tests and fix latent bugs in decorators/validation
- refactor(netron): strip dead version/timestamp from HTTP envelope
- docs(omnitron): use generic project names in infra examples
- test(omnitron,titan-pm): cover reliability fixes + extend JSON mode
- Add Projects page and updateProject backend support


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

