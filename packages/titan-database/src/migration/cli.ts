/**
 * `runMigrationCli` — turnkey migration CLI for backends.
 *
 * Each app's `migrate.ts` reduces to:
 *
 *   import { runMigrationCli } from '@omnitron-dev/titan-database/migration';
 *   await runMigrationCli({
 *     migrationsDir: new URL('./migrations', import.meta.url),
 *     envPrefix: 'PAYMENTS__DATABASE',
 *     defaultDatabase: 'payments',
 *   });
 *
 * Subcommands (process.argv slice):
 *   <none>          — run all pending migrations (up)
 *   --down [N]      — roll back the last N (default 1)
 *   --status        — print pending / executed / drift
 *   --redo          — down 1 then up (useful in dev)
 *   --verify        — read-only integrity check (exit 2 when integrity is not established)
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
import { describeError } from '@omnitron-dev/titan/diagnostics';
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
  /** Env-var prefix for connection config. e.g. 'PAYMENTS__DATABASE'. */
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
  lockTimeoutMs?: number;
}

export async function runMigrationCli(opts: MigrationCliOptions): Promise<void> {
  const dir =
    typeof opts.migrationsDir === 'string'
      ? path.resolve(opts.migrationsDir)
      : fileURLToPath(opts.migrationsDir);
  const logger = opts.logger ?? defaultLogger();
  const argv = process.argv.slice(2);
  const cmd = parseMigrationCliArgs(argv);

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
  const pgMod = await import('pg');
  const Pool = pgMod.Pool ?? pgMod.default?.Pool;
  if (!Pool) {
    throw new Error('pg package not found — install pg as a dependency to use runMigrationCli.');
  }

  let exitCode = 0;
  const pool = new Pool({ ...config, connectionTimeoutMillis: 5_000 });
  pool.on('error', error => {
    exitCode = 1;
    logger.error(`Migration pool connection failed: ${describeError(error)}`);
  });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  let failure: unknown;
  let failed = false;
  try {
    const migrations = await loadMigrationFiles(dir);
    logger.info(
      `Discovered ${migrations.length} migration(s): ${migrations.map((m) => m.name).join(', ') || '—'}`,
    );

    const runner = new HardenedMigrationRunner(db, migrations, {
      logger,
      enforceChecksums: cmd.enforceChecksums,
      advisoryLockKey:
        opts.advisoryLockKey === undefined ? migrationLockKey(opts.defaultDatabase) : opts.advisoryLockKey,
      lockTimeoutMs: opts.lockTimeoutMs ?? 60_000,
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
        if (s.unknownChecksums.length) {
          logger.warn(`Integrity is unverified for: ${s.unknownChecksums.join(', ')}. Review the applied definitions before adopting checksums.`);
          if (cmd.kind === 'verify') exitCode = 2;
        }
        logger.info(`Pending (${s.pending.length}): ${s.pending.join(', ') || '—'}`);
        logger.info(
          `Executed (${s.executed.length}): ${s.executed.map((e) => e.name).join(', ') || '—'}`,
        );
        if (s.missingFiles.length > 0) {
          logger.warn(
            `Applied migrations missing from source: ${s.missingFiles.join(', ')}`,
          );
          if (cmd.kind === 'verify') exitCode = 2;
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
      default: {
        // `cmd` is parsed from argv, so an unhandled kind used to exit 0
        // having done nothing — the shape of "the migration ran" from the
        // caller's side.
        // `ParsedArgs` is one interface with a union-typed `kind`, not a
        // discriminated union, so the assert goes on the field.
        const unknownKind: never = cmd.kind;
        throw new Error(`Unknown migration command: ${String(unknownKind)}`);
      }
    }
  } catch (err) {
    failed = true;
    failure = err;
    if (err instanceof MigrationLockError || err instanceof MigrationChecksumError) {
      logger.error(describeError(err));
      exitCode = 2;
    } else {
      logger.error(`Migration failed: ${describeError(err)}`);
      exitCode = 1;
    }
  } finally {
    try { await db.destroy(); }
    catch (error) {
      exitCode = 1;
      logger.error(describeError(failed
        ? new AggregateError([failure, error], 'Migration operation and connection cleanup failed')
        : new Error('Migration operation completed, but connection cleanup failed; inspect history before retrying', { cause: error })));
    }
  }
  if (exitCode === 0) logger.info('Done');
  if (exitCode !== 0) process.exitCode = exitCode;
}

interface ParsedArgs {
  kind: 'up' | 'down' | 'status' | 'verify' | 'redo';
  steps: number;
  enforceChecksums: boolean;
}

export function parseMigrationCliArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { kind: 'up', steps: 1, enforceChecksums: true };
  const args = (argv[0] === '--' ? argv.slice(1) : argv).filter(arg => {
    if (arg === '--no-checksums') { out.enforceChecksums = false; return false; }
    return true;
  });
  const command = args.shift()?.replace(/^--/, '') ?? 'up';
  if (!['up', 'down', 'status', 'verify', 'redo'].includes(command)) {
    throw new Error(`Unknown migration command: ${command}`);
  }
  out.kind = command as ParsedArgs['kind'];
  if (out.kind === 'down' && args.length === 1 && /^\d+$/.test(args[0]!)) {
    out.steps = Number(args.shift());
    if (!Number.isSafeInteger(out.steps)) throw new Error('Rollback count must be a nonnegative safe integer');
  }
  if (args.length) throw new Error(`Unexpected migration arguments: ${args.join(' ')}`);
  return out;
}

/** Node file loader shared by startup hooks and the compatibility CLI. */
export async function loadMigrationFiles(directory: string | URL): Promise<HardenedMigration[]> {
  const dir = typeof directory === 'string' ? path.resolve(directory) : fileURLToPath(directory);
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.(migration\.)?(ts|js)$/.test(f))
    .filter((f) => !/\.(d|spec|test)\.(ts|js)$/.test(f))
    .sort();
  return Promise.all(
    files.map(async (f) => {
      const name = f.replace(/\.(migration\.)?(ts|js)$/, '');
      const url = pathToFileURL(path.join(dir, f)).href;
      const mod = (await import(url)) as { up?: unknown; down?: unknown; checksum?: unknown };
      if (typeof mod.up !== 'function' || typeof mod.down !== 'function') {
        throw new Error(`Migration ${f} must export 'up' and 'down' functions`);
      }
      if (mod.checksum !== undefined && typeof mod.checksum !== 'string') {
        throw new Error(`Migration ${f} must export a string checksum when provided`);
      }
      return {
        name,
        up: mod.up as HardenedMigration['up'],
        down: mod.down as HardenedMigration['down'],
        ...(mod.checksum === undefined ? {} : { checksum: mod.checksum }),
      };
    }),
  );
}

/** Deterministic 6-byte lock key seeded from the database name. */
export function migrationLockKey(seed: string): bigint {
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
