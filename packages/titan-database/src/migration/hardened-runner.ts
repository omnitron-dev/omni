/**
 * HardenedMigrationRunner — production-safe migration execution on top of
 * `@kysera/migrations`.
 *
 * The vanilla kysera runner has three gaps that bit us in production:
 *
 *   1. `useTransactions` defaulted to false. A migration that fails halfway
 *      through left the schema partially applied, and the bookkeeping row
 *      never got written, so the next run started from the beginning and
 *      blew up on `CREATE TABLE … already exists`.
 *
 *   2. The migration body and the bookkeeping write are NOT in the same
 *      transaction. If the DB connection drops between `executeMigration`
 *      and `markAsExecuted`, the migration is applied but unrecorded — the
 *      next run re-applies it.
 *
 *   3. There is no integrity check. A migration that has been applied in
 *      prod can be edited in source, and nothing surfaces the drift.
 *      Anyone reading the migrations directory thinks the on-disk file is
 *      the source of truth, but production is running a different version.
 *
 * Hardening:
 *
 *   - **One transaction per migration**: schema changes + bookkeeping +
 *     checksum write are atomic. If any step fails, the row never appears
 *     in `migrations`, so the next run will re-apply cleanly.
 *
 *   - **Postgres advisory lock** (`pg_try_advisory_lock`) gates every
 *     up/down. Two concurrent deploys racing on the same database refuse
 *     instead of corrupting bookkeeping.
 *
 *   - **Content checksums** stored in a sidecar table
 *     (`migration_checksums`). On startup we recompute every applied
 *     migration's checksum and compare it to the recorded value. Any drift
 *     halts the runner with a clear error pointing at the offending file.
 *
 *   - **Trust-on-first-use backfill**: on first run against an existing
 *     DB we backfill missing checksums (so legacy environments don't
 *     immediately error). The backfill is logged and the operator can
 *     run `verify` to see the recorded values.
 */

import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import { setupMigrations as kyseraSetupMigrations, type Migration } from '@kysera/migrations';

export type HardenedMigration<DB = unknown> = Migration<DB>;

export interface HardenedLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface HardenedRunnerOptions {
  /**
   * Postgres advisory-lock key. When the dialect is `'postgres'` this key
   * is acquired via `pg_try_advisory_lock` and held for the duration of
   * the run. Pass `null` to disable locking entirely (e.g. for SQLite).
   * Default: 0xDA05_DA05.
   */
  advisoryLockKey?: bigint | number | null;
  /** Wrap each migration + bookkeeping in one transaction. Default true. */
  useTransactions?: boolean;
  /**
   * Refuse to run if a recorded migration's checksum no longer matches
   * the source. Default true. Set false to bypass the check (e.g. when
   * recovering from a known-safe edit).
   */
  enforceChecksums?: boolean;
  /**
   * If `true`, backfill missing checksums on startup for migrations that
   * are already recorded as applied. This avoids hard-failing the first
   * run after upgrading a long-lived environment. Default true.
   */
  backfillMissingChecksums?: boolean;
  /** `'postgres'` enables advisory lock. Default `'postgres'`. */
  dialect?: 'postgres' | 'other';
  logger?: HardenedLogger;
  /**
   * Override the advisory-lock acquire/release pair. Tests inject fakes
   * here; production callers leave it unset (the runner falls back to
   * `pg_try_advisory_lock` over the live connection).
   */
  lockProvider?: AdvisoryLockProvider;
}

/**
 * The acquire/release pair used to gate concurrent runners. Both calls
 * receive the configured key (a positive bigint). `acquire` returns true
 * if the lock was obtained, false otherwise. `release` is best-effort.
 */
export interface AdvisoryLockProvider {
  acquire: (key: bigint) => Promise<boolean>;
  release: (key: bigint) => Promise<void>;
}

export interface HardenedUpResult {
  executed: string[];
  skipped: string[];
  failed: string[];
}

export interface HardenedDownResult {
  rolledBack: string[];
  failed: string[];
}

export interface HardenedStatus {
  executed: { name: string; checksum: string | null }[];
  pending: string[];
  drift: { name: string; recorded: string; current: string }[];
  missingFiles: string[];
}

export class MigrationLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationLockError';
  }
}

export class MigrationChecksumError extends Error {
  readonly drift: ReadonlyArray<{ name: string; recorded: string; current: string }>;
  constructor(message: string, drift: ReadonlyArray<{ name: string; recorded: string; current: string }>) {
    super(message);
    this.name = 'MigrationChecksumError';
    this.drift = drift;
  }
}

const DEFAULT_LOCK_KEY = 0xda05_da05;
const CHECKSUMS_TABLE = 'migration_checksums';
const NOOP_LOGGER: HardenedLogger = { info: () => {}, warn: () => {}, error: () => {} };

interface NormalizedOptions {
  useTransactions: boolean;
  enforceChecksums: boolean;
  backfillMissingChecksums: boolean;
  dialect: 'postgres' | 'other';
  logger: HardenedLogger;
  advisoryLockKey: bigint | null;
  lockProvider: AdvisoryLockProvider | null;
}

export class HardenedMigrationRunner<DB = unknown> {
  private readonly db: Kysely<DB>;
  private readonly migrations: HardenedMigration<DB>[];
  private readonly opts: NormalizedOptions;
  private setupDone = false;

  constructor(
    db: Kysely<DB>,
    migrations: HardenedMigration<DB>[],
    options: HardenedRunnerOptions = {},
  ) {
    this.db = db;
    this.migrations = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
    const lockKey = options.advisoryLockKey;
    this.opts = {
      useTransactions: options.useTransactions ?? true,
      enforceChecksums: options.enforceChecksums ?? true,
      backfillMissingChecksums: options.backfillMissingChecksums ?? true,
      dialect: options.dialect ?? 'postgres',
      logger: options.logger ?? NOOP_LOGGER,
      advisoryLockKey:
        lockKey === null
          ? null
          : lockKey === undefined
            ? BigInt(DEFAULT_LOCK_KEY)
            : typeof lockKey === 'number'
              ? BigInt(lockKey)
              : lockKey,
      lockProvider: options.lockProvider ?? null,
    };
  }

  /** Compute sha256 of `up.toString() + (down?.toString() ?? '')`. */
  static computeChecksum<D = unknown>(m: HardenedMigration<D>): string {
    const body = m.up.toString() + (m.down ? m.down.toString() : '');
    return createHash('sha256').update(body).digest('hex');
  }

  /** Idempotent: kysera `migrations` table + our `migration_checksums` sidecar. */
  private async ensureSetup(): Promise<void> {
    if (this.setupDone) return;
    await kyseraSetupMigrations(this.db as unknown as Kysely<unknown>);
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.raw(`"${CHECKSUMS_TABLE}"`)} (
        name varchar(255) PRIMARY KEY,
        checksum varchar(64) NOT NULL,
        recorded_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `.execute(this.db as unknown as Kysely<unknown>);
    this.setupDone = true;
  }

  private async getExecutedNames(): Promise<string[]> {
    const rows = (await (this.db as unknown as Kysely<{ migrations: { name: string } }>)
      .selectFrom('migrations')
      .select(['name'])
      .execute()) as { name: string }[];
    return rows.map((r) => r.name);
  }

  private async getRecordedChecksums(): Promise<Map<string, string>> {
    const rows = (await (this.db as unknown as Kysely<{
      [CHECKSUMS_TABLE]: { name: string; checksum: string };
    }>)
      .selectFrom(CHECKSUMS_TABLE as never)
      .select(['name', 'checksum'] as never)
      .execute()) as { name: string; checksum: string }[];
    return new Map(rows.map((r) => [r.name, r.checksum]));
  }

  /**
   * Backfill checksum rows for migrations that are recorded as applied
   * in `migrations` but absent from `migration_checksums`. Called once
   * during ensureSetup-after-up to migrate legacy environments forward
   * without forcing manual intervention.
   */
  private async backfillMissingChecksums(): Promise<string[]> {
    if (!this.opts.backfillMissingChecksums) return [];
    const executed = new Set(await this.getExecutedNames());
    const recorded = await this.getRecordedChecksums();
    const missing = this.migrations.filter((m) => executed.has(m.name) && !recorded.has(m.name));
    for (const m of missing) {
      const checksum = HardenedMigrationRunner.computeChecksum(m);
      await (this.db as unknown as Kysely<{ [k: string]: { name: string; checksum: string } }>)
        .insertInto(CHECKSUMS_TABLE as never)
        .values({ name: m.name, checksum } as never)
        .execute();
    }
    return missing.map((m) => m.name);
  }

  async verifyChecksums(): Promise<HardenedStatus['drift']> {
    if (!this.opts.enforceChecksums) return [];
    const recorded = await this.getRecordedChecksums();
    const drift: HardenedStatus['drift'] = [];
    for (const [name, expected] of recorded) {
      const m = this.migrations.find((x) => x.name === name);
      if (!m) continue; // file missing — different concern, surfaced via status
      const current = HardenedMigrationRunner.computeChecksum(m);
      if (expected !== current) drift.push({ name, recorded: expected, current });
    }
    return drift;
  }

  private async withAdvisoryLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.opts.dialect !== 'postgres' || this.opts.advisoryLockKey === null) {
      return fn();
    }
    const key = this.opts.advisoryLockKey;
    const provider: AdvisoryLockProvider =
      this.opts.lockProvider ?? this.defaultPgLockProvider();
    const ok = await provider.acquire(key);
    if (!ok) {
      throw new MigrationLockError(
        `Could not acquire migration advisory lock (key=${key}). Another runner is in progress; refusing to proceed.`,
      );
    }
    try {
      return await fn();
    } finally {
      try {
        await provider.release(key);
      } catch (e) {
        this.opts.logger.warn(`pg_advisory_unlock failed: ${(e as Error).message}`);
      }
    }
  }

  /** Default provider — issues `pg_try_advisory_lock` on the live db. */
  private defaultPgLockProvider(): AdvisoryLockProvider {
    const db = this.db as unknown as Kysely<unknown>;
    return {
      acquire: async (key) => {
        const res = (await sql<{
          ok: boolean;
        }>`SELECT pg_try_advisory_lock(${key.toString()}::bigint) AS ok`.execute(db)) as {
          rows: { ok: boolean }[];
        };
        return Boolean(res.rows[0]?.ok);
      },
      release: async (key) => {
        await sql`SELECT pg_advisory_unlock(${key.toString()}::bigint)`.execute(db);
      },
    };
  }

  async up(): Promise<HardenedUpResult> {
    return this.withAdvisoryLock(async () => {
      await this.ensureSetup();
      const backfilled = await this.backfillMissingChecksums();
      if (backfilled.length > 0) {
        this.opts.logger.warn(
          `Backfilled ${backfilled.length} missing checksum(s): ${backfilled.join(', ')}. ` +
            `Source files were assumed to match the live DB; run \`migrate verify\` to inspect.`,
        );
      }

      const drift = await this.verifyChecksums();
      if (drift.length > 0) {
        const lines = drift
          .map(
            (d) =>
              `  ${d.name}: recorded=${d.recorded.slice(0, 12)} current=${d.current.slice(0, 12)}`,
          )
          .join('\n');
        throw new MigrationChecksumError(
          `Migration checksum drift detected — refusing to proceed. Add a NEW migration file rather than editing an applied one.\n${lines}`,
          drift,
        );
      }

      const executed = new Set(await this.getExecutedNames());
      const result: HardenedUpResult = { executed: [], skipped: [], failed: [] };

      for (const m of this.migrations) {
        if (executed.has(m.name)) {
          result.skipped.push(m.name);
          continue;
        }
        const checksum = HardenedMigrationRunner.computeChecksum(m);
        try {
          await this.runMigration(m, 'up', checksum);
          result.executed.push(m.name);
          this.opts.logger.info(`✓ ${m.name}`);
        } catch (err) {
          result.failed.push(m.name);
          this.opts.logger.error(`✗ ${m.name}: ${(err as Error).message}`);
          throw err;
        }
      }
      return result;
    });
  }

  async down(steps = 1): Promise<HardenedDownResult> {
    if (steps < 1) return { rolledBack: [], failed: [] };
    return this.withAdvisoryLock(async () => {
      await this.ensureSetup();
      // We surface drift on rollback as a warning rather than a failure,
      // so operators can recover from an emergency edit-then-rollback.
      const drift = await this.verifyChecksums();
      for (const d of drift) {
        this.opts.logger.warn(
          `checksum drift on ${d.name}: recorded=${d.recorded.slice(0, 12)} current=${d.current.slice(0, 12)}`,
        );
      }
      const executed = await this.getExecutedNames();
      const lastN = executed.slice(-steps).reverse();
      const result: HardenedDownResult = { rolledBack: [], failed: [] };

      for (const name of lastN) {
        const m = this.migrations.find((x) => x.name === name);
        if (!m || !m.down) {
          this.opts.logger.warn(
            `Skipping rollback of ${name} (no down() function or migration file missing)`,
          );
          continue;
        }
        try {
          await this.runMigration(m, 'down', null);
          result.rolledBack.push(m.name);
          this.opts.logger.info(`↺ ${m.name}`);
        } catch (err) {
          result.failed.push(m.name);
          this.opts.logger.error(`✗ rollback ${m.name}: ${(err as Error).message}`);
          throw err;
        }
      }
      return result;
    });
  }

  async status(): Promise<HardenedStatus> {
    await this.ensureSetup();
    const executedNames = await this.getExecutedNames();
    const recorded = await this.getRecordedChecksums();
    const exSet = new Set(executedNames);
    const fileSet = new Set(this.migrations.map((m) => m.name));
    return {
      executed: executedNames.map((name) => ({ name, checksum: recorded.get(name) ?? null })),
      pending: this.migrations.filter((m) => !exSet.has(m.name)).map((m) => m.name),
      drift: await this.verifyChecksums(),
      missingFiles: executedNames.filter((n) => !fileSet.has(n)),
    };
  }

  /** All migration logic + bookkeeping in ONE transaction. */
  private async runMigration(
    m: HardenedMigration<DB>,
    op: 'up' | 'down',
    checksum: string | null,
  ): Promise<void> {
    const apply = async (tx: Kysely<DB> | Transaction<DB>) => {
      if (op === 'up') {
        await m.up(tx);
        await (tx as unknown as Kysely<{ migrations: { name: string } }>)
          .insertInto('migrations')
          .values({ name: m.name })
          .execute();
        if (checksum) {
          await (tx as unknown as Kysely<{ [k: string]: { name: string; checksum: string } }>)
            .insertInto(CHECKSUMS_TABLE as never)
            .values({ name: m.name, checksum } as never)
            .execute();
        }
      } else {
        if (!m.down) throw new Error(`Migration ${m.name} has no down()`);
        await m.down(tx);
        await (tx as unknown as Kysely<{ migrations: { name: string } }>)
          .deleteFrom('migrations')
          .where('name', '=', m.name)
          .execute();
        await (tx as unknown as Kysely<{ migration_checksums: { name: string; checksum: string } }>)
          .deleteFrom('migration_checksums')
          .where('name', '=', m.name)
          .execute();
      }
    };
    if (this.opts.useTransactions) {
      await this.db.transaction().execute(async (tx) => apply(tx));
    } else {
      await apply(this.db);
    }
  }
}

/** Convenience constructor mirroring `createMigrationRunner`. */
export function createHardenedRunner<DB = unknown>(
  db: Kysely<DB>,
  migrations: HardenedMigration<DB>[],
  options?: HardenedRunnerOptions,
): HardenedMigrationRunner<DB> {
  return new HardenedMigrationRunner<DB>(db, migrations, options);
}
