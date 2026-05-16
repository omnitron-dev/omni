/**
 * `runMigrationCli` — turnkey migration CLI for backends.
 *
 * Each app's `migrate.ts` reduces to:
 *
 *   import { runMigrationCli } from '@omnitron-dev/titan-database/migration';
 *   await runMigrationCli({
 *     migrationsDir: new URL('./migrations', import.meta.url),
 *     envPrefix: 'PAYSYS__DATABASE',
 *     defaultDatabase: 'paysys',
 *   });
 *
 * Subcommands (process.argv slice):
 *   <none>          — run all pending migrations (up)
 *   --down [N]      — roll back the last N (default 1)
 *   --status        — print pending / executed / drift
 *   --redo          — down 1 then up (useful in dev)
 *   --verify        — alias of --status (no exit code on drift)
 *   --no-checksums  — skip checksum enforcement (recovery escape hatch)
 *
 * Exit codes:
 *   0 — success
 *   1 — migration failure (schema error, dropped connection, …)
 *   2 — refused to proceed (lock held / checksum drift)
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import {
  HardenedMigrationRunner,
  MigrationLockError,
  MigrationChecksumError,
  type HardenedLogger,
  type HardenedMigration,
} from './hardened-runner.js';

export interface MigrationCliOptions {
  /**
   * Directory containing migration files. Pass
   * `new URL('./migrations', import.meta.url)` from the calling script.
   * String paths are resolved relative to cwd.
   */
  migrationsDir: URL | string;
  /** Env-var prefix for connection config. e.g. 'PAYSYS__DATABASE'. */
  envPrefix: string;
  /** Database name when env var unset. Also used as the lock-key seed. */
  defaultDatabase: string;
  /** Default host. Default 'localhost'. */
  defaultHost?: string;
  /** Default port. Default 5432. */
  defaultPort?: number;
  /** Default user. Default 'postgres'. */
  defaultUser?: string;
  /** Default password. Default 'postgres'. */
  defaultPassword?: string;
  /** Override the advisory lock key. By default we hash `defaultDatabase`. */
  advisoryLockKey?: bigint | number | null;
  /** Custom logger. Defaults to console.{log,warn,error}. */
  logger?: HardenedLogger;
}

export async function runMigrationCli(opts: MigrationCliOptions): Promise<void> {
  const dir =
    typeof opts.migrationsDir === 'string'
      ? path.resolve(opts.migrationsDir)
      : fileURLToPath(opts.migrationsDir);
  const logger = opts.logger ?? defaultLogger();
  const argv = process.argv.slice(2);
  const cmd = parseArgs(argv);

  const config = {
    host: process.env[`${opts.envPrefix}__HOST`] ?? opts.defaultHost ?? 'localhost',
    port: parseInt(
      process.env[`${opts.envPrefix}__PORT`] ?? String(opts.defaultPort ?? 5432),
      10,
    ),
    database: process.env[`${opts.envPrefix}__DATABASE`] ?? opts.defaultDatabase,
    user: process.env[`${opts.envPrefix}__USER`] ?? opts.defaultUser ?? 'postgres',
    password:
      process.env[`${opts.envPrefix}__PASSWORD`] ?? opts.defaultPassword ?? 'postgres',
  };

  logger.info(`Connecting to PostgreSQL at ${config.host}:${config.port}/${config.database}`);

  // pg is a peer-dep on titan-database; we import it lazily so SQLite-only
  // consumers don't need the package installed.
  const pgMod = (await import('pg')) as unknown as { default: { Pool: new (cfg: unknown) => unknown }; Pool?: new (cfg: unknown) => unknown };
  const Pool = pgMod.Pool ?? pgMod.default?.Pool;
  if (!Pool) {
    throw new Error('pg package not found — install pg as a dependency to use runMigrationCli.');
  }

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool(config) as never }),
  });

  let exitCode = 0;
  try {
    const migrations = await discoverMigrations(dir);
    logger.info(
      `Discovered ${migrations.length} migration(s): ${migrations.map((m) => m.name).join(', ') || '—'}`,
    );

    const runner = new HardenedMigrationRunner(db, migrations, {
      logger,
      enforceChecksums: cmd.enforceChecksums,
      advisoryLockKey:
        opts.advisoryLockKey ?? deterministicLockKey(opts.defaultDatabase),
    });

    switch (cmd.kind) {
      case 'up': {
        const r = await runner.up();
        logger.info(
          `${r.executed.length} migration(s) applied. ${r.skipped.length} already applied.`,
        );
        break;
      }
      case 'down': {
        const r = await runner.down(cmd.steps);
        logger.info(`${r.rolledBack.length} migration(s) rolled back.`);
        break;
      }
      case 'status':
      case 'verify': {
        const s = await runner.status();
        logger.info(`Pending (${s.pending.length}): ${s.pending.join(', ') || '—'}`);
        logger.info(
          `Executed (${s.executed.length}): ${s.executed.map((e) => e.name).join(', ') || '—'}`,
        );
        if (s.missingFiles.length > 0) {
          logger.warn(
            `Applied migrations missing from source: ${s.missingFiles.join(', ')}`,
          );
        }
        if (s.drift.length > 0) {
          logger.warn(`Checksum drift on: ${s.drift.map((d) => d.name).join(', ')}`);
          if (cmd.kind === 'verify') exitCode = 2;
        }
        break;
      }
      case 'redo': {
        const down = await runner.down(1);
        if (down.rolledBack.length === 0) {
          logger.info('No migrations to redo.');
          break;
        }
        const up = await runner.up();
        logger.info(
          `Redid ${down.rolledBack.join(', ')} → applied ${up.executed.join(', ') || '—'}`,
        );
        break;
      }
    }
  } catch (err) {
    if (err instanceof MigrationLockError || err instanceof MigrationChecksumError) {
      logger.error(err.message);
      exitCode = 2;
    } else {
      logger.error(`Migration failed: ${(err as Error).message}`);
      if ((err as Error).stack) logger.error((err as Error).stack!);
      exitCode = 1;
    }
  } finally {
    await db.destroy();
  }
  if (exitCode === 0) logger.info('Done');
  if (exitCode !== 0) process.exit(exitCode);
}

interface ParsedArgs {
  kind: 'up' | 'down' | 'status' | 'verify' | 'redo';
  steps: number;
  enforceChecksums: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { kind: 'up', steps: 1, enforceChecksums: true };
  if (argv.includes('--no-checksums')) out.enforceChecksums = false;
  if (argv.includes('--down') || argv[0] === 'down') {
    out.kind = 'down';
    const i = argv.indexOf('--down');
    const next = i >= 0 ? argv[i + 1] : argv[1];
    if (next && /^\d+$/.test(next)) out.steps = parseInt(next, 10);
    return out;
  }
  if (argv.includes('--status') || argv[0] === 'status') return { ...out, kind: 'status' };
  if (argv.includes('--verify') || argv[0] === 'verify') return { ...out, kind: 'verify' };
  if (argv.includes('--redo') || argv[0] === 'redo') return { ...out, kind: 'redo' };
  return out;
}

async function discoverMigrations(dir: string): Promise<HardenedMigration[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.(migration\.)?(ts|js)$/.test(f))
    .filter((f) => !/\.(d|spec|test)\.(ts|js)$/.test(f))
    .sort();
  return Promise.all(
    files.map(async (f) => {
      const name = f.replace(/\.(migration\.)?(ts|js)$/, '');
      const url = pathToFileURL(path.join(dir, f)).href;
      const mod = (await import(url)) as { up?: unknown; down?: unknown };
      if (typeof mod.up !== 'function' || typeof mod.down !== 'function') {
        throw new Error(`Migration ${f} must export 'up' and 'down' functions`);
      }
      return {
        name,
        up: mod.up as HardenedMigration['up'],
        down: mod.down as HardenedMigration['down'],
      };
    }),
  );
}

/** Deterministic 6-byte lock key seeded from the database name. */
function deterministicLockKey(seed: string): bigint {
  const hash = createHash('sha256').update(seed).digest();
  let n = 0n;
  for (let i = 0; i < 6; i++) n = (n << 8n) | BigInt(hash[i]!);
  return n;
}

function defaultLogger(): HardenedLogger {
  return {
    info: (s) => console.log(s),
    warn: (s) => console.warn(s),
    error: (s) => console.error(s),
  };
}
