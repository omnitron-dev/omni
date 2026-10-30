/** The daemon and CLI share one registry, history adapter and Kysera execution engine. */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { createMigrationRunner, createMigrationHistory, type MigrationRecord } from '../migration/index.js';
import { createOmnitronDb } from './connection.js';
import { OMNITRON_MIGRATIONS } from './migrations/index.js';

export interface MigrationRunOutcome { applied: string[] }

async function legacyHistory(db: Kysely<unknown>): Promise<MigrationRecord[]> {
  const exists = await sql<{ exists: boolean }>`select to_regclass('public.kysely_migration') is not null as exists`.execute(db);
  if (!exists.rows[0]?.exists) return [];
  const result = await sql<{ name: string; timestamp: string }>`select name, timestamp from kysely_migration order by timestamp, name`.execute(db);
  return result.rows.map(row => {
    const executedAt = new Date(row.timestamp);
    if (Number.isNaN(executedAt.getTime())) throw new Error(`Invalid legacy migration timestamp: ${row.name}`);
    return { name: row.name, executedAt, checksum: null };
  });
}

export function createOmnitronMigrationRunner(db: Kysely<unknown>, logger?: ILogger, options: { dryRun?: boolean } = {}) {
  const history = createMigrationHistory();
  const known = new Set(OMNITRON_MIGRATIONS.map(m => m.name));
  return createMigrationRunner(db, OMNITRON_MIGRATIONS, {
    dryRun: options.dryRun ?? false,
    // Preserve the deployed journal and lock identity. New applications use
    // the modern history defaults through the public migration entry point.
    history: {
      ...history,
      async read(connection) {
        const current = await history.read(connection);
        const recorded = new Set(current.map(row => row.name));
        // status/verify can show legacy history without adopting or creating tables.
        const legacy = await legacyHistory(connection as Kysely<unknown>);
        return [...current, ...legacy.filter(row => known.has(row.name) && !recorded.has(row.name))]
          .sort((a, b) => new Date(a.executedAt!).getTime() - new Date(b.executedAt!).getTime() || a.name.localeCompare(b.name));
      },
      async remove(connection, name) {
        await history.remove(connection, name);
        // A rolled-back legacy row must not be adopted again on the next boot.
        // This runs in the same transaction as the down body and current journal.
        const legacy = await legacyHistory(connection as Kysely<unknown>);
        if (legacy.some(row => row.name === name)) {
          await sql`delete from kysely_migration where name = ${name}`.execute(connection);
        }
      },
      async setup(connection) {
        // Called only while the runner holds its advisory lock. Adoption is
        // atomic and also repairs partially adopted history from older builds.
        const adopt = async (tx: typeof connection) => {
          await history.setup(tx);
          const recorded = new Set((await history.read(tx)).map(row => row.name));
          const legacy = await legacyHistory(tx as Kysely<unknown>);
          const unknown = legacy.filter(row => !known.has(row.name)).map(row => row.name);
          if (unknown.length) logger?.warn({ unknown }, 'Legacy migration history contains names this build does not know — left unadopted');
          let adopted = 0;
          for (const row of legacy) {
            if (!known.has(row.name) || recorded.has(row.name)) continue;
            const date = new Date(row.executedAt!);
            if (Number.isNaN(date.getTime())) throw new Error(`Invalid legacy migration timestamp: ${row.name}`);
            await history.insert(tx, { ...row, executedAt: date });
            adopted++;
          }
          if (adopted) logger?.info({ adopted }, 'Adopted legacy migration history');
        };
        if (connection.isTransaction) await adopt(connection);
        else await connection.transaction().execute(adopt);
      },
    },
    verbose: false,
    ...(logger ? { logger: {
      debug: (msg: string, meta?: unknown) => logger.debug({ meta }, msg),
      info: (msg: string, meta?: unknown) => logger.info({ meta }, msg),
      warn: (msg: string, meta?: unknown) => logger.warn({ meta }, msg),
      error: (msg: string, meta?: unknown) => logger.error({ meta }, msg),
      trace: (msg: string, meta?: unknown) => logger.trace({ meta }, msg),
      fatal: (msg: string, meta?: unknown) => logger.fatal({ meta }, msg),
    } } : {}),
  });
}

export async function migrateOmnitronDb(db: Kysely<unknown>, logger?: ILogger): Promise<MigrationRunOutcome> {
  return { applied: (await createOmnitronMigrationRunner(db, logger).up()).executed };
}

/** Read-only replacement readiness. Schema changes need a separate reviewed transition. */
export async function assertOmnitronMigrationsCurrent(connection?: Kysely<unknown>): Promise<void> {
  const db = connection ?? await createOmnitronDb<unknown>({ max: 1 });
  try {
    const report = await createOmnitronMigrationRunner(db).inspect();
    const issues = [
      ...(report.pending.length ? [`pending: ${report.pending.join(', ')}`] : []),
      ...(report.drift.length ? [`changed: ${report.drift.map(row => row.name).join(', ')}`] : []),
      ...(report.missingFiles.length ? [`unknown: ${report.missingFiles.join(', ')}`] : []),
    ];
    if (issues.length) throw new Error(`Backend schema is not ready (${issues.join('; ')}). Inspect omnitron migrate status --daemon and verify --daemon; prepare the schema separately before replacing the backend.`);
  } finally { if (!connection) await db.destroy(); }
}

export async function runOmnitronMigrations(logger?: ILogger): Promise<MigrationRunOutcome> {
  const db = await createOmnitronDb<unknown>({ max: 1 });
  try {
    const outcome = await migrateOmnitronDb(db, logger);
    if (outcome.applied.length) logger?.info({ migrations: outcome.applied }, `Applied ${outcome.applied.length} Omnitron migration(s)`);
    else logger?.debug('Omnitron database schema is up to date');
    return outcome;
  } finally { await db.destroy(); }
}
