/**
 * Omnitron Internal Database — Connection Resolution
 *
 * Single source of truth for how anything in this process reaches
 * omnitron-pg (the daemon's own PostgreSQL, port 5480 by default).
 *
 * Before this module five call sites built their own `pg.Pool`:
 *   - `daemon.module.ts`   (DI token, hard-coded literals)
 *   - `daemon.ts`          (boot migrations, hard-coded literals)
 *   - `infrastructure.service.ts` (provisioning + migrations, module consts)
 *   - `database/migrate.ts` (CLI, OMNITRON_DATABASE_URL)
 *   - `workers/health-monitor.service.ts` (connectionString passed in)
 *
 * Three of them ignored `OMNITRON_DATABASE_URL` entirely, so pointing the
 * daemon at a non-default Postgres moved *some* connections and silently
 * left the rest on `localhost:5480`. The container spec used yet another
 * copy of the same literals, so credentials could drift from the clients
 * that were supposed to use them.
 *
 * Everything now derives from `resolveOmnitronPgConfig()`, which the
 * container spec also consumes — client and container cannot disagree.
 */

import type { Pool, PoolConfig } from 'pg';
import type { Kysely } from 'kysely';

import { getEnv } from '../shared/env-config.js';
import type { OmnitronDatabase } from './schema.js';

// ---------------------------------------------------------------------------
// Defaults — also used to provision the omnitron-pg container itself.
// ---------------------------------------------------------------------------

/** Host port the omnitron-pg container publishes. */
export const OMNITRON_PG_PORT = 5480;
export const OMNITRON_PG_USER = 'omnitron';
export const OMNITRON_PG_PASSWORD = 'omnitron';
export const OMNITRON_PG_DATABASE = 'omnitron';
export const OMNITRON_PG_HOST = 'localhost';

export interface OmnitronPgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Resolve the omnitron-pg connection parameters.
 *
 * `OMNITRON_DATABASE_URL` wins when set; otherwise the local-container
 * defaults apply. Parsing is total: a malformed URL falls back to the
 * defaults rather than throwing at module-load time in the daemon.
 */
export function resolveOmnitronPgConfig(): OmnitronPgConfig {
  const url = getEnv().OMNITRON_DATABASE_URL;
  if (!url) return defaultOmnitronPgConfig();

  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || OMNITRON_PG_HOST,
      port: parsed.port ? Number(parsed.port) : OMNITRON_PG_PORT,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || OMNITRON_PG_DATABASE,
      user: decodeURIComponent(parsed.username) || OMNITRON_PG_USER,
      password: decodeURIComponent(parsed.password) || OMNITRON_PG_PASSWORD,
    };
  } catch {
    return defaultOmnitronPgConfig();
  }
}

function defaultOmnitronPgConfig(): OmnitronPgConfig {
  return {
    host: OMNITRON_PG_HOST,
    port: OMNITRON_PG_PORT,
    database: OMNITRON_PG_DATABASE,
    user: OMNITRON_PG_USER,
    password: OMNITRON_PG_PASSWORD,
  };
}

/** Render the resolved config back as a `postgresql://` URL (for workers spawned with a connection string). */
export function omnitronPgConnectionString(config: OmnitronPgConfig = resolveOmnitronPgConfig()): string {
  const user = encodeURIComponent(config.user);
  const password = encodeURIComponent(config.password);
  const database = encodeURIComponent(config.database);
  return `postgresql://${user}:${password}@${config.host}:${config.port}/${database}`;
}

// ---------------------------------------------------------------------------
// Pool / Kysely factories
// ---------------------------------------------------------------------------

/**
 * Create a pg Pool for omnitron-pg.
 *
 * `pg` and `@omnitron-dev/titan-database` are imported dynamically so CLI
 * commands that never touch the database keep their fast start-up path.
 *
 * Every client is a `ResilientPgClient`: it attaches its `'error'` listener
 * at construction instead of after `connect()` resolves, closing the
 * mid-handshake window where a connection error escapes to
 * `uncaughtException`. A pool-level listener catches the re-emitted rest.
 */
export async function createOmnitronPool(
  overrides: Partial<PoolConfig> = {},
  onPoolError?: (err: Error) => void
): Promise<Pool> {
  const config = resolveOmnitronPgConfig();
  const pg = await import('pg');
  const { ResilientPgClient } = await import('@omnitron-dev/titan-database');

  const pool = new pg.default.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    Client: ResilientPgClient,
    ...overrides,
  });

  pool.on('error', (err) => {
    if (onPoolError) onPoolError(err as Error);
    // eslint-disable-next-line no-console
    else console.error('[omnitron-pg pool error]', (err as { code?: string }).code, err.message);
  });

  return pool;
}

/**
 * Create a Kysely instance bound to omnitron-pg. Caller owns `destroy()`.
 *
 * Defaults to the typed `OmnitronDatabase` schema. Migration code asks for
 * `createOmnitronDb<unknown>()` instead: migrations run raw SQL and schema
 * builders against tables that do not exist yet, and `Kysely<DB>` is
 * invariant in `DB`, so a typed handle cannot be passed to a runner that
 * expects `Kysely<unknown>`.
 */
export async function createOmnitronDb<DB = OmnitronDatabase>(
  overrides: Partial<PoolConfig> = {},
  onPoolError?: (err: Error) => void
): Promise<Kysely<DB>> {
  const { Kysely, PostgresDialect } = await import('kysely');
  const pool = await createOmnitronPool(overrides, onPoolError);
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
