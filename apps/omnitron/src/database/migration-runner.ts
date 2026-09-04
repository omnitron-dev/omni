/**
 * Omnitron Migration Runner — the one way schema gets applied.
 *
 * ## Why this module exists
 *
 * Two of the three previous runners destructured `Migrator` from `'kysely'`:
 *
 *     const { Kysely, PostgresDialect, Migrator } = await import('kysely');
 *
 * Kysely ≥0.28 does not export `Migrator` from the package root (the type is
 * a `KyseraTypeError<"import from 'kysely/migration' instead">` marker), so
 * `Migrator` was `undefined` at runtime and `new Migrator(...)` threw
 * `TypeError: Migrator is not a constructor`. Both call sites wrapped that in
 * a `catch` that logged a *warning* and continued, so the daemon booted
 * cleanly onto a completely empty database — the failure only surfaced far
 * downstream as an endless `relation "alert_rules" does not exist` /
 * `relation "omnitron_sessions" does not exist` log storm.
 *
 * The fix is structural, not a corrected import: schema application now goes
 * through `@kysera/migrations` — the stack this repo standardised on, already
 * used by the `migrate` CLI — from ONE place, over ONE registry, with the
 * failure reported instead of downgraded to a warning.
 *
 * `@kysera/migrations` also brings two properties the ad-hoc runners lacked:
 * a PostgreSQL advisory lock (two daemons booting at once cannot both run the
 * same pending migration) and per-migration transactions.
 */

import type { Kysely } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

import { createOmnitronDb } from './connection.js';
import { OMNITRON_MIGRATIONS } from './migrations/index.js';

export interface MigrationRunOutcome {
  /** Names of migrations applied by THIS run (empty when already up to date). */
  applied: string[];
}

/**
 * Apply all pending migrations against an existing Kysely instance.
 * The caller owns the connection lifecycle.
 *
 * @throws whatever `@kysera/migrations` throws — callers decide the policy.
 */
export async function migrateOmnitronDb(db: Kysely<unknown>, logger?: ILogger): Promise<MigrationRunOutcome> {
  const { runMigrations } = await import('@kysera/migrations');

  await adoptLegacyKyselyHistory(db, logger);

  const result = await runMigrations(db, OMNITRON_MIGRATIONS, {
    useTransactions: true,
    stopOnError: true,
    advisoryLock: true,
    verbose: false,
    ...(logger
      ? {
          logger: {
            debug: (msg: string, meta?: unknown) => logger.debug({ meta }, msg),
            info: (msg: string, meta?: unknown) => logger.info({ meta }, msg),
            warn: (msg: string, meta?: unknown) => logger.warn({ meta }, msg),
            error: (msg: string, meta?: unknown) => logger.error({ meta }, msg),
            trace: (msg: string, meta?: unknown) => logger.trace({ meta }, msg),
            fatal: (msg: string, meta?: unknown) => logger.fatal({ meta }, msg),
          },
        }
      : {}),
  });

  return { applied: result.executed };
}

/**
 * Carry a pre-existing Kysely `Migrator` history over to the `@kysera`
 * bookkeeping table, once.
 *
 * Installations created before this repo standardised on `@kysera/migrations`
 * recorded their applied migrations in `kysely_migration` — the live dev
 * database has all five stamped 2026-03-22. `@kysera` keeps its own
 * `migrations` table, so without this step it sees an empty history against
 * a fully-populated schema and fails on the first migration with
 * `relation "nodes" already exists`, which is exactly what the daemon
 * reported on the first boot after the switch.
 *
 * Runs only when the new table is empty AND the legacy one exists with
 * rows, so it is a no-op on fresh databases and on every subsequent boot.
 * Only names present in the current registry are adopted: an unrecognised
 * legacy row means the two lists genuinely disagree, and inventing history
 * for a migration this build doesn't have would hide that.
 *
 * Deletable once no installation predating the switch remains.
 */
async function adoptLegacyKyselyHistory(db: Kysely<unknown>, logger?: ILogger): Promise<void> {
  const { sql } = await import('kysely');
  const { setupMigrations } = await import('@kysera/migrations');

  await setupMigrations(db);

  const alreadyTracked = await sql<{ count: string }>`SELECT count(*)::text AS count FROM migrations`.execute(db);
  if (Number(alreadyTracked.rows[0]?.count ?? '0') > 0) return;

  const legacyExists = await sql<{ exists: boolean }>`
    SELECT to_regclass('public.kysely_migration') IS NOT NULL AS exists
  `.execute(db);
  if (!legacyExists.rows[0]?.exists) return;

  const legacyRows = await sql<{ name: string; timestamp: string }>`
    SELECT name, timestamp FROM kysely_migration
  `.execute(db);
  if (legacyRows.rows.length === 0) return;

  const known = new Set(OMNITRON_MIGRATIONS.map((m) => m.name));
  const adopted: string[] = [];
  const unknown: string[] = [];

  for (const row of legacyRows.rows) {
    if (!known.has(row.name)) {
      unknown.push(row.name);
      continue;
    }
    const executedAt = new Date(row.timestamp);
    const timestamp = Number.isNaN(executedAt.getTime()) ? new Date() : executedAt;
    await sql`
      INSERT INTO migrations (name, executed_at) VALUES (${row.name}, ${timestamp})
      ON CONFLICT (name) DO NOTHING
    `.execute(db);
    adopted.push(row.name);
  }

  if (unknown.length > 0) {
    logger?.warn(
      { unknown },
      'Legacy migration history contains names this build does not know — left unadopted'
    );
  }
  if (adopted.length > 0) {
    logger?.info(
      { adopted: adopted.length },
      'Adopted legacy Kysely migration history into the @kysera bookkeeping table'
    );
  }
}

/**
 * Connect to omnitron-pg, apply pending migrations, disconnect.
 *
 * Used by the two boot paths (daemon start-up and infrastructure
 * provisioning). Errors propagate: a daemon running against an unmigrated
 * database is broken in ways that only show up much later, so the caller
 * must surface it rather than continue silently.
 */
export async function runOmnitronMigrations(logger?: ILogger): Promise<MigrationRunOutcome> {
  const db = await createOmnitronDb<unknown>({ max: 2 });

  try {
    const outcome = await migrateOmnitronDb(db, logger);

    if (outcome.applied.length > 0) {
      logger?.info(
        { migrations: outcome.applied },
        `Applied ${outcome.applied.length} Omnitron migration(s)`
      );
    } else {
      logger?.debug('Omnitron database schema is up to date');
    }

    return outcome;
  } finally {
    await db.destroy();
  }
}
