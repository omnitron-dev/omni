# Database Stack Normalization Plan (2026-08-01 audit)

Consolidated audit of `app → @daos/titan-kit → titan-database → @kysera/* → kysely`
across titan-database internals and 7 backends (portal, portal-seed, geo,
messaging, storage, paysys, priceverse). Goal: each concern lives at exactly
one layer; everything below is verified with file:line evidence (see the
audit session reports).

## 0. Prerequisite: publish kysera 0.9

omni consumes **published npm `@kysera/*@0.8.8`** (kysely 0.28.17), NOT the
workspace source. The kysera repo now contains 0.9 (kysely 0.29.4, security
hardening). Order of operations:

1. Publish kysera as **0.9.0** (never republish 0.8.8 — same version string,
   different peer contract `kysely >=0.29.0`, would break installs).
2. Bump omni: all `@kysera/*` → `^0.9.0`, `kysely` → `^0.29.4` (one spec
   style: caret). Fix titan-health + titan-scheduler exact pins `0.28.12`
   (below kysera's floor; sole cause of duplicate kysely in the store).
3. 0.9 behavior changes that matter here: RLS enforces UPDATE/DELETE on the
   executor path; soft-delete narrows UPDATE/DELETE (`deleted_at IS NULL`);
   `withPluginMetadata(executor, {includeDeleted: true})` is the scoped
   opt-out (never `getRawDb`); migrations runner has a built-in advisory
   lock; `createORM(executor, [])` inherits executor plugins; `{col: null}`
   → `IS NULL`; malformed operator values throw.

## 1. titan-database: the root defect

**`TransactionAwareRepository` (TAR) never runs the kysera plugin chain.**
Plugins hook via `Plugin.extendRepository()`/`interceptQuery`, but TAR is
instantiated with `new RepoClass(db, table)` — `extendRepository` only fires
on the `createORM` path nobody uses. titan-kit enables `timestamps` by
default, yet the plugin is architecturally inert for every app. This single
gap explains most app-level duplication (~90 manual `updatedAt` sites, ~550
LOC manual soft-delete in messaging+storage, ~90 `.where('deletedAt','is',
null)` sites in paysys, and one real bug: paysys `asset.repository.ts:192-214`
reads balances of soft-deleted assets).

**Fix**: TAR's executor must be the plugin-aware kysera executor and its
construction must run `extendRepository` (or TAR queries must go through the
intercepted methods). Wire `hasSoftDelete` into ALL read paths, not just
`list()/exists()` — or delete the flag in favor of the plugin.

## 2. titan-database: delegate down (duplication of @kysera/infra et al.)

`database.manager.ts` (1671 LOC) reimplements what its own re-exports provide:
- hand-rolled 5-attempt retry loop → `withRetry` (+`isTransientError`)
- setInterval health checks + 3-strike counter → `HealthMonitor` / `checkDatabaseHealth`
- own PoolMetrics collection → `createMetricsPool`
- second event bus (`@omnitron-dev/eventemitter`) → titan lifecycle/events
- `HardenedMigrationRunner` advisory lock → built into kysera 0.9 runner
  (keep ONLY the checksum/drift sidecar as an additive kysera migration
  plugin or titan extension)
- `transaction.context.ts` global plugin registry → one registry (DI), not
  a second global store

**Keep in titan-database** (legitimately absent from kysera): pool/driver
creation + Kysely `Dialect` factory from config, `ResilientPgClient`, BIGINT
type-parser, multi-schema switching, `uuid_v7()` SQL helpers, transaction
timeout, sqlite-date-serializer, DI module/decorators, `@AutoTransactional`.

Dead weight to remove: unused `@kysera/dal` dependency (or actually adopt
DAL); never-injected `DATABASE_MODULE_LOGGER` provider; stale `src/README.md`
(1107 lines of nonexistent APIs); ~50 sqlite `file:*?mode=memory` artifacts
(fix test teardown + gitignore). Unused titan facilities to adopt:
`./module/config` + `./validation` for `DatabaseModuleOptions` (large,
currently unvalidated); reconcile `@kysera/rls` re-export vs. titan core's
`./module/rls`. TAR ergonomics: add a row→domain mapper hook (swap renamed
every CRUD method to avoid collisions) and implement the declared-but-missing
`listCursor()` via `paginateCursor`.

## 3. kysera enhancement backlog (gaps proven by real usage)

1. `atomicStatusTransition`: accept `fromStatus: S | S[]` / arbitrary guard.
2. `UpsertOptions.conflictWhere` (partial unique index, e.g. `WHERE
   deleted_at IS NULL`) — storage hand-rolls this.
3. Bounded batch-delete helper (dialect-portable `DELETE … LIMIT` via CTE) —
   geo hand-rolls twice.
4. Bigint/numeric aggregate coercion (`SUM()` returns string) — storage ×3.
5. Idempotency helper (`unique index + catch 23505 + refetch`) — paysys ×5.
6. Atomic guarded column arithmetic (`SET col = col ± x WHERE col ± x >= 0
   RETURNING`) — paysys money paths.
7. Transactional outbox primitive (`FOR UPDATE SKIP LOCKED` claim, backoff,
   GC) — paysys ×3 (~1130 LOC), storage ×1, same shape.
8. RLS `filter()`: subquery/joined-table predicates (documented limitation
   drove ~150 LOC of ad hoc visibility filtering in paysys).
9. `JsonColumn<T>` ColumnType convention (priceverse has a live type/runtime
   drift bug); runtime table-family routing helper (priceverse backfill).

## 4. App-level fixes (after 1–3 land)

- **messaging** (worst offender, ~900 LOC): adopt ALS transactions
  (`runInTransaction` — 0 uses today, only 3 hand-threaded trx blocks guard
  anything); delete soft-delete/timestamps boilerplate once TAR fires
  plugins; replace 3 hand-rolled paginations with `paginate`/`paginateCursor`;
  use `UUID_V7_DEFAULT` instead of ~20 inline `sql\`uuid_v7()\`` + delete the
  byte-copied `CREATE FUNCTION` from migrations; centralize Selectable/
  Insertable/Updateable aliases in schema.ts (storage's pattern); unify
  `Insert*`/`New*` naming across apps.
- **storage** (~500 LOC): same soft-delete/timestamp deletion; keep outbox
  until the shared primitive exists, then migrate; keep FOR UPDATE usage.
- **paysys** (~600–750 LOC of free wins): switch CAS methods to
  `atomicStatusTransition` (after enhancement); adopt `parseDatabaseError`
  (0 uses in a payment system!), `withRetry` (0 uses; swap hand-rolls
  serialization-failure retry), `paginate`+`applyWhereClause` for the 8
  admin list methods; fix `asset.repository` soft-delete bug immediately;
  wrap `platform-revenue.creditTreasury` in a transaction; consolidate dual
  caching layers; type `runtime_settings` once (two independent
  declarations today).
- **portal-seed**: rebuild on titan-database manager + typed repos
  (`upsertMany`); today it's 100% raw `pg`, zero transactions, untyped
  column-name strings against main/messaging schemas (runtime-only drift
  detection). Extract a shared seed-kit — same batch-insert reinvented in 9
  files across 4 apps (~1300 LOC).
- **geo**: drop direct `kysely@0.28.17` pin (use titan-database re-exports);
  merge the two purge implementations; stop reaching into `repo['db']`.
- **priceverse**: delete `createMany` reinvention + duplicate
  `deleteOlderThan`; wrap the USD/RUB two-write site in a transaction; fix
  the `sources` JSON drift. Upstream its `COUNT(*) OVER()` single-query
  pagination trick into TAR's `list()`.
- **titan-kit**: the proven push-down vehicle — add the error-taxonomy
  scaffold (`defineErrorTaxonomy()`; paysys+priceverse have identical
  shapes), Zod→TitanError validator, batch-processor.
- **CLI parity**: `kysera` CLI's own migrate runner has no advisory lock and
  a different table (`kysera_migrations` vs `migrations`) — unify on the
  library runner.

## 5. Sequencing

1. kysera 0.9.0 publish → omni version bump (mechanical, unblocks all).
2. titan-database core refactor: TAR plugin wiring (§1), manager delegation
   (§2) — behavior-compatible, covered by its 9k LOC of tests.
3. kysera backlog items needed by step 4 (at minimum: atomicStatusTransition
   enhancement, conflictWhere, outbox primitive decision).
4. App sweeps in order: messaging (correctness), paysys (money paths),
   storage, geo/priceverse, portal-seed rebuild.
5. Each step: full gates per repo (build/test/typecheck/lint) + the apps'
   integration suites; titan tests must stop mocking `@kysera/*` (today the
   mocks hide integration breakage — only titan-database tests run real
   kysera).

## 6. Addendum — verified-on-live-Postgres criticals (final audit delta)

**P0, before any other work:**

1. **[CRITICAL/SECURITY] RLS decorators are silent no-ops.**
   `database.decorators.ts:506-652` — `@Policy/@Allow/@Deny/@Filter/@BypassRLS`
   write Reflect metadata that NOTHING reads; `forFeature` builds plugins
   only from soft-delete/timestamps/audit (module.ts:92-140), rlsPlugin is
   never constructed. An app annotating a repository gets ZERO filtering,
   silently. Fix: compile decorator metadata into `defineRLSSchema` +
   register `rlsPlugin` in forFeature; until then, decorators must THROW at
   registration instead of no-op.
2. **[CRITICAL] HardenedMigrationRunner's advisory lock is broken** —
   `hardened-runner.ts:276-291` acquires `pg_try_advisory_lock` through the
   POOL; session-scoped lock lands on an arbitrary connection (reproduced:
   release returns false, lock held until pool death; `--redo` always fails
   with MigrationLockError). Confirms §2: replace with kysera 0.9 runner
   (pins the session via `db.connection().execute()`).
3. **Lifecycle (reproduced):** double `pool.end()` on every PG shutdown
   (manager.ts:1193-1205 — Kysely destroy already ends the pool), so
   `connected` never resets and DISCONNECTED never emits; `reconnect()`
   leaks the old pool (auto-triggered by 3 failed health checks — flapping
   DB leaks a pool per cycle); `acquireTimeoutMillis` is NOT a pg-pool
   option (pool exhaustion hangs forever; need `connectionTimeoutMillis`).
4. **setSchema/withSchema via pool** — `SET search_path` lands on ONE
   arbitrary pooled connection; schema-per-tenant isolation breaks
   nondeterministically. Pin via `db.connection().execute()` or delete
   (zero usage, zero tests).
5. `runInTransaction` nested call joins WITHOUT a savepoint (context.ts:
   120-124) — inner failure rolls back the outer transaction invisibly →
   delegate to `@kysera/dal` withTransaction.
6. `withPluginMetadata` is NOT exported by titan-database while `getRawDb`
   is first-class — the model inversion; export the scoped opt-out.
7. TAR double-filters `deleted_at` when the soft-delete plugin is active
   via forFeature; `list()` has no limit clamp (unbounded scan; kysera
   `paginate` clamps at 10k); 9 config blocks are dead (users configure
   isolationLevel/queryTimeout → typechecker-approved nothing).

**Consolidated adoption numbers (all 8 apps):** ~4700 LOC removable. Top:
copy-paste offset pagination 1400 (43 repos declare their own `list`, ZERO
call the inherited one; `hasMore: offset + data.length < total` ×108),
runtime-settings repo+service ×3 (~700), outbox ×3+1 (~600), manual counts
×113 (`executeCount` unused, ~340), manual soft-delete ×254 (~300).
Root theme: **non-adoption, not missing features** — zero usage across all
apps of softDeletePlugin, timestampsPlugin, auditPlugin, executeCount,
upsertMany, UUID_V7, and the entire DAL. `main` needs its own sweep (128k
LOC, 85 repos; its 223-line `query-types.ts` shim exists only because TAR's
`dynamicExecutor` returns `unknown` — type it in titan-database).
TAR redesign must support table families (priceverse OhlcvRepository serves
3 identical candle tables via runtime dispatch and has to ignore all
inherited CRUD). paysys carries two mutually contradictory soft-delete
comments (plugins.ts:9 vs base.repository.ts:37) — both false; fix docs
with the code.
