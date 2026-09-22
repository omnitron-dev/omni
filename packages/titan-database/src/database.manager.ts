/**
 * Database Manager
 *
 * Central service for managing database connections and lifecycle.
 * Supports plugin-aware executors via @kysera/executor for unified
 * plugin interception across Repository and DAL patterns.
 */

import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect, CamelCasePlugin, sql } from 'kysely';
import { describeError } from './utils/describe-error.js';

/**
 * The three drivers, loaded when a connection actually asks for one.
 *
 * All three are declared `peerDependenciesMeta: { optional: true }` — the
 * package's own statement that you install the one your database needs. All
 * three were then imported at the top of this module, so importing
 * `@omnitron-dev/titan-database` at all required every one of them present.
 * The optionality was a declaration nothing honoured.
 *
 * Found where it had to hurt: a Postgres-only application, installed cleanly
 * on a node for the first time, with `npm install --omit=dev` resolving
 * exactly what the manifests declare rather than whatever a shared pnpm store
 * happened to have lying around:
 *
 *     Cannot find package 'mysql2' imported from
 *     .../node_modules/@omnitron-dev/titan-database/dist/database.manager.js
 *
 * Two of six apps died on it, and `better-sqlite3` — a native module that
 * compiles on install — was one resolution away from being the next.
 *
 * `import type` above is erased at compile time, so the types still describe
 * the pools exactly; only the loading moved. Each loader names the package to
 * install, because `ERR_MODULE_NOT_FOUND` deep inside a dependency is a
 * sentence about a file path and not about what the reader should do.
 */
import type { Pool, PoolConfig } from 'pg';
import type * as mysql from 'mysql2';
import type BetterSqlite3Types from 'better-sqlite3';

type Database = BetterSqlite3Types.Database;

type PgModule = typeof import('pg');
type MysqlModule = typeof import('mysql2');
type SqliteModule = { default: typeof BetterSqlite3Types };

async function loadDriver<T>(name: string, dialect: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    throw new Error(
      `The '${dialect}' dialect needs the '${name}' package, which is not installed. ` +
        `It is an optional peer dependency of @omnitron-dev/titan-database: install the driver ` +
        `for the database this application uses. (${(err as Error).message})`,
    );
  }
}

/** A pg Pool, by the counters this reads off it rather than by identity. */
function isPgPool(pool: unknown): pool is Pool {
  const p = pool as Partial<Pool> | null;
  return (
    !!p && typeof p.totalCount === 'number' && typeof p.idleCount === 'number' && typeof p.waitingCount === 'number'
  );
}

let pgModule: Promise<PgModule> | null = null;
function loadPg(): Promise<PgModule> {
  pgModule ??= loadDriver('pg', 'postgres', () => import('pg'));
  return pgModule;
}

let mysqlModule: Promise<MysqlModule> | null = null;
function loadMysql(): Promise<MysqlModule> {
  mysqlModule ??= loadDriver('mysql2', 'mysql', () => import('mysql2'));
  return mysqlModule;
}

let sqliteModule: Promise<SqliteModule> | null = null;
function loadSqlite(): Promise<SqliteModule> {
  sqliteModule ??= loadDriver('better-sqlite3', 'sqlite', () => import('better-sqlite3') as Promise<SqliteModule>);
  return sqliteModule;
}

/**
 * Drop-in pg.Client subclass that attaches a defensive `'error'` listener
 * at construction time. The default pg.Pool only attaches its own error
 * listener AFTER `client.connect()` resolves, leaving a race window where
 * errors during the connect handshake (server admin_shutdown, network
 * reset during TLS, peer reject) have no subscriber and escape to
 * `uncaughtException` — historically taking the daemon down with them.
 *
 * The listener here is intentionally a no-op: once the Pool finishes
 * `_connectClient` it attaches its own listener that re-emits errors via
 * `pool.on('error', …)` for the normal logging / metrics path. Our only
 * job is to guarantee the client always has *some* subscriber, closing
 * the race entirely. This is the most fundamental possible fix — every
 * Pool client is wrapped before any I/O.
 *
 * A function rather than a `class` declaration, because `extends PgClient`
 * needs `pg` at module load and that is exactly what this file no longer
 * does. Built once and remembered.
 */
let resilientClient: PgModule['Client'] | null = null;
export async function resilientPgClient(): Promise<PgModule['Client']> {
  if (resilientClient) return resilientClient;
  const { Client: PgClient } = await loadPg();
  resilientClient = class ResilientPgClient extends PgClient {
    constructor(config?: ConstructorParameters<typeof PgClient>[0]) {
      super(config as ConstructorParameters<typeof PgClient>[0]);
      this.on('error', () => { /* re-emitted via pool.on('error') once Pool attaches its own listener */ });
    }
  };
  return resilientClient;
}
import { sqliteDateSerializerPlugin } from './plugins/sqlite-date-serializer.plugin.js';
import {
  createExecutor,
  createExecutorSync,
  destroyExecutor,
  isKyseraExecutor,
  getPlugins,
  getRawDb,
  type Plugin,
  type KyseraExecutor,
} from '@kysera/executor';
import { CircuitBreaker, withRetry, isTransientError } from '@kysera/infra';
import { createLiveConnectionRef } from './connection-ref.js';
import { Injectable } from '@omnitron-dev/titan/decorators';
import { Errors, TitanError, ErrorCode } from '@omnitron-dev/titan/errors';
import type {
  DatabaseConnection,
  DatabaseDialect,
  DatabaseModuleOptions,
  IDatabaseManager,
  DatabaseEvent,
  DatabaseEventType,
} from './database.types.js';
import type { ParsedConnectionConfig } from './database.internal-types.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import {
  DATABASE_DEFAULT_CONNECTION,
  DEFAULT_POOL_CONFIG,
} from './database.constants.js';

// Inlined constants (removed from database.constants.ts during cleanup)
const ERROR_MESSAGES = {
  CONNECTION_FAILED: (name: string, error: string) => `Failed to connect to database "${name}": ${error}`,
  INVALID_DIALECT: (dialect: string) => `Invalid database dialect: ${dialect}`,
} as const;

const DIALECT_SETTINGS: Record<string, { defaultPort: number | null }> = {
  postgres: { defaultPort: 5432 },
  mysql: { defaultPort: 3306 },
  sqlite: { defaultPort: null },
  mssql: { defaultPort: 1433 },
};

const DATABASE_EVENTS = {
  CONNECTED: 'database.connected',
  DISCONNECTED: 'database.disconnected',
  ERROR: 'database.error',
} as const;
import { EventEmitter } from '@omnitron-dev/eventemitter';

/**
 * Pool metrics for monitoring connection pool health and performance
 */
export interface PoolMetrics {
  /** Total number of connections in the pool */
  totalConnections: number;
  /** Number of idle connections */
  idleConnections: number;
  /** Number of active/in-use connections */
  activeConnections: number;
  /** Number of clients waiting for a connection */
  waitingClients: number;
  /** Total number of connection acquires */
  acquireCount: number;
  /** Total number of connection releases */
  releaseCount: number;
  /** Number of pool errors */
  errorCount: number;
  /** Last pool error */
  lastError?: Error;
  /** Timestamp of last acquire (epoch ms) */
  lastAcquireAt?: number;
  /** Average acquire time in milliseconds */
  averageAcquireTimeMs: number;
  /** Total acquire time (for average calculation) */
  totalAcquireTimeMs: number;
  /** Pool size configuration */
  poolSize: { min: number; max: number };
}

interface ConnectionInfo {
  name: string;
  config: DatabaseConnection;
  instance: Kysely<unknown>;
  /** Plugin-aware executor (if plugins are configured) */
  executor?: KyseraExecutor<unknown>;
  /** Plugins applied to this connection */
  plugins?: readonly Plugin[];
  pool?: Pool | mysql.Pool | Database;
  connected: boolean;
  connecting: boolean;
  lastError?: Error;
  /**
   * Set when the last attempt failed for a reason retrying cannot change — a
   * dialect that does not exist, a sqlite path whose directory does not. The
   * verdict was already computed by `createConnection` and only ever reported;
   * storing it is what lets the health-check loop tell "down" from "wrong".
   */
  permanent?: boolean;
  metrics: {
    queryCount: number;
    errorCount: number;
    totalQueryTime: number;
  };
  /** Pool-specific metrics for monitoring */
  poolMetrics: PoolMetrics;
}

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

/**
 * Connection failures that will never succeed on a retry.
 *
 * `createConnection` probes a new connection with `SELECT 1` and reduces every
 * probe failure to SERVICE_UNAVAILABLE, which `createConnectionWithRetry`
 * retries. That wrapper exists for the real transient case — the database
 * container is still starting — but it swallowed the distinction it was
 * supposed to preserve. A comment above `shouldRetry` claimed "config mistakes
 * fail on the FIRST attempt"; that only held for mistakes caught while BUILDING
 * the driver (a bad dialect). Everything a human actually gets wrong — the
 * password, the database name, the file path — fails at the PROBE, and so
 * burned the whole 1+2+4+8+16 = 31 second budget before saying so.
 *
 * Measured against the real drivers rather than assumed:
 *
 *     wrong password        code 28P01           permanent
 *     no such database      code 3D000           permanent
 *     sqlite missing dir    TypeError, NO code   permanent
 *     sqlite unwritable     SQLITE_CANTOPEN      permanent
 *     port refused          ECONNREFUSED         transient — container starting
 *     host does not resolve ENOTFOUND            transient — DNS lags a container
 *
 * Deliberately a small allow-list of KNOWN-hopeless conditions: anything not
 * listed keeps today's retrying behaviour, so this can only shorten a wait
 * that was never going to end, never shorten one that would have succeeded.
 * `ENOTFOUND` is left retryable for exactly that reason — a service name can
 * start resolving a second later.
 */
const PERMANENT_DRIVER_CODES = new Set([
  '28P01', // postgres: invalid_password
  '28000', // postgres: invalid_authorization_specification
  '3D000', // postgres: invalid_catalog_name — database does not exist
  'SQLITE_CANTOPEN',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  // A connection string that does not parse as a URL will not start parsing.
  // This is how an unrecognised dialect actually surfaces: the string goes to
  // URL parsing before the dialect switch is reached, so the `badRequest` the
  // switch raises for an unknown dialect is never the error you get. Measured
  // — `{ dialect: 'invalid', connection: ':memory:' }` throws a TypeError with
  // this code, six times, over 31 seconds.
  'ERR_INVALID_URL',
]);

/**
 * better-sqlite3 throws a bare `TypeError` with no `code` when the directory
 * does not exist, so this one has to be recognised by its message. Anchored to
 * the driver's exact wording; a driver that changes it falls back to being
 * treated as transient, which is the safe direction.
 */
const PERMANENT_MESSAGES = [/Cannot open database because the directory does not exist/i];

/** A passing health check slower than this is worth a line in the log. */
const HIGH_LATENCY_MS = 500;

/**
 * The abort deadline a single health-check query races against.
 *
 * Named here because two places need the same number: the check enforces it,
 * and the caller reads it to judge its own measurement. A success that
 * arrives LATER than this deadline cannot be a query that was allowed to run
 * that long — the abort timer would have rejected it — so it is evidence
 * about the process, not about the database.
 */
function healthCheckDeadlineMs(dialect: DatabaseDialect): number {
  return dialect === 'sqlite' ? 10_000 : 5_000;
}

export function isPermanentConnectionError(error: unknown): boolean {
  // A BAD_REQUEST is permanent by definition: the request is wrong, and asking
  // again does not make it right. `createKyselyInstance` raises one for an
  // unrecognised dialect, which used to be retried five times over 31 seconds
  // — a value read from a config literal, asked about six times.
  if (error instanceof TitanError && error.code === ErrorCode.BAD_REQUEST) return true;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && PERMANENT_DRIVER_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : '';
  return PERMANENT_MESSAGES.some((re) => re.test(message));
}

@Injectable()
export class DatabaseManager implements IDatabaseManager {
  /**
   * Tracks how the BIGINT (int8/OID 20) → JS number parser was installed.
   * `pg.types.setTypeParser` is process-global, so the parser shape must
   * be the same across every pool. `null` means uninstalled; `true`/`false`
   * means installed in coerce / no-coerce mode respectively. A second pool
   * requesting a *different* mode triggers a warning instead of silently
   * inheriting the first pool's choice (audit gap #22).
   */
  private static _bigintParserMode: boolean | null = null;

  private connections: Map<string, ConnectionInfo> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private connectionSchemas: Map<string, string> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();
  public logger: ILogger;
  private options: DatabaseModuleOptions;

  /** Module-level RLS defaults (activation inputs, bulk-check bound). */
  getRlsDefaults(): DatabaseModuleOptions['rls'] {
    return this.options.rls;
  }
  private initialized = false;
  /** The in-flight `init()`, so a concurrent caller joins instead of building a second set of pools. */
  private initPromise: Promise<void> | null = null;
  private readonly defaultRetryConfig: RetryConfig = {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    timeoutMs: 30000,
  };

  /**
   * Proactive health check interval timer.
   * Periodically validates connection health to detect issues before queries fail.
   */
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  /**
   * Health check interval in milliseconds.
   * Configurable via options.healthCheck.interval, default 30s.
   */
  private readonly healthCheckIntervalMs: number;

  /**
   * Track consecutive health check failures for circuit breaker pattern.
   */
  private healthCheckFailures: Map<string, number> = new Map();
  /** Connections a background recovery is in flight for; the timer does not await a tick. */
  private readonly recovering = new Set<string>();

  /**
   * Maximum consecutive failures before marking connection as unhealthy.
   */
  private readonly maxHealthCheckFailures: number = 3;

  constructor(options: DatabaseModuleOptions, logger: ILogger) {
    this.options = options || {};
    this.logger = logger.child({ module: 'DatabaseManager' });
    // Allow health check interval override via kysera core options
    this.healthCheckIntervalMs = (this.options.kysera?.core?.healthCheck?.interval) ?? 30000;
  }

  /**
   * Initialize the database manager
   */
  async init(): Promise<void> {
    // Make init idempotent - only initialize once
    if (this.initialized) {
      this.logger.debug('Database manager already initialized, skipping');
      return;
    }

    // ...including concurrently, which the `initialized` flag alone cannot do:
    // it is assigned only after every connection has been built, so two calls
    // that overlap both passed the check above and both created pools. The
    // second `connections.set(name, info)` overwrote the first, and shutdown
    // closes only what the map holds — the loser's database connections stayed
    // open for the life of the process.
    if (this.initPromise) {
      this.logger.debug('Database manager initialization already in progress, joining');
      return this.initPromise;
    }

    this.initPromise = this.doInit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.logger.info('Initializing database manager');

    // Setup connections from configuration
    const connections = this.getConnectionConfigs();

    for (const [name, config] of Object.entries(connections)) {
      await this.createConnectionWithRetry(name, config);
    }

    // Note: Shutdown is managed by Application lifecycle via DatabaseModule.onStop()
    // Do NOT register process signal handlers here - it causes double shutdown

    // Auto-apply Kysera plugins to all connections if configured
    await this.applyGlobalPlugins();

    this.initialized = true;

    // defaultSchema (PostgreSQL) is applied at pool creation as a
    // per-connection startup parameter — see the postgres dialect factory.
    // Setting it here via `SET search_path` configured only one arbitrary
    // pooled client, so most connections silently kept `public`.

    // Start proactive health checks if enabled
    if (this.options.healthCheck !== false) {
      this.startProactiveHealthChecks();
    }

    this.logger.info({ connectionCount: this.connections.size }, 'Database manager initialized');
  }

  // ============================================================================
  // PROACTIVE HEALTH CHECKS
  // ============================================================================

  /**
   * Start proactive health checks for all connections.
   * Runs periodically to detect connection issues before queries fail.
   *
   * Expected benefit: 50-80% reduction in query failures due to stale connections.
   */
  private startProactiveHealthChecks(): void {
    if (this.healthCheckTimer) {
      return; // Already running
    }

    this.logger.info({ intervalMs: this.healthCheckIntervalMs }, 'Starting proactive health checks');

    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks().catch((err) =>
        this.logger.error({ error: err }, 'Unhandled error in periodic health check')
      );
    }, this.healthCheckIntervalMs);

    // Ensure timer doesn't prevent process exit
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }
  }

  /**
   * Stop proactive health checks.
   */
  private stopProactiveHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      this.logger.debug('Proactive health checks stopped');
    }
  }

  /**
   * Run health checks on all connections in parallel.
   */
  private async runHealthChecks(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [name, info] of this.connections) {
      if (info.connected) {
        promises.push(this.runSingleHealthCheck(name, info));
      } else if (!info.connecting && !info.permanent && !this.recovering.has(name)) {
        promises.push(this.recoverConnection(name));
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Bring back a connection that is registered but down.
   *
   * This loop used to visit only entries whose `connected` was true, so it
   * stopped watching a connection at exactly the moment it needed watching:
   * one that failed to establish at boot, and one whose reconnect after a
   * failed check did not take, both stayed down until something else happened
   * to ask for them. An entry that is explicitly closed is DELETED from the
   * map rather than marked, so "present and down" already means "wanted".
   *
   * A failure the driver calls permanent is not retried. `createConnection`
   * has always decided that; this is the first thing to read the verdict
   * rather than only report it in an error nobody catches.
   *
   * The `recovering` guard matters because the timer does not await the tick:
   * `setInterval` fires again whether or not the previous run finished, and
   * `reconnect` tears down a pool and builds another.
   */
  private async recoverConnection(name: string): Promise<void> {
    this.recovering.add(name);
    try {
      await this.reconnect(name);
      this.healthCheckFailures.set(name, 0);
      this.logger.info({ connection: name }, 'Connection recovered by the health check loop');
    } catch (error) {
      this.logger.warn(
        { connection: name, error: describeError(error) },
        'Connection is still down; will try again on the next health check'
      );
    } finally {
      this.recovering.delete(name);
    }
  }

  /**
   * Run health check on a single connection.
   */
  private async runSingleHealthCheck(name: string, info: ConnectionInfo): Promise<void> {
    try {
      // Two clocks, because one value cannot answer three questions. The wall
      // clock advances while the process does NOT run — a sleeping machine, a
      // suspended container, an event loop held by synchronous work — so on
      // its own it reports the sum of "slow database", "blocked process" and
      // "time that passed elsewhere" under the first name. The monotonic
      // clock stops when the process stops; the pair separates them.
      const wallStart = Date.now();
      const monoStart = process.hrtime.bigint();
      const result = await this.validateConnectionHealth(info.instance, info.config.dialect);
      const wallMs = Date.now() - wallStart;
      const monoMs = Math.round(Number(process.hrtime.bigint() - monoStart) / 1e6);

      if (result.healthy) {
        // Reset failure counter on success
        this.healthCheckFailures.set(name, 0);

        const deadlineMs = healthCheckDeadlineMs(info.config.dialect);
        if (monoMs > deadlineMs) {
          // Proof, not inference: `validateConnectionHealth` races the query
          // against an abort timer set to `deadlineMs`. A result that says
          // `healthy` after longer than that means the timer did not fire on
          // time, so the timers phase did not run for at least the
          // difference. The database is not the subject of this report.
          this.logger.warn(
            { connection: name, monoMs, wallMs, deadlineMs, stalledAtLeastMs: monoMs - deadlineMs },
            'Health check returned later than its own abort deadline — the event loop was blocked, not the database'
          );
        } else if (monoMs > HIGH_LATENCY_MS) {
          this.logger.warn({ connection: name, monoMs, wallMs }, 'Connection health check passed but with high latency');
        } else if (wallMs > HIGH_LATENCY_MS) {
          // The process did not run for most of that interval: nothing was
          // slow, and calling it latency is what filled the stand's logs.
          this.logger.debug(
            { connection: name, monoMs, wallMs },
            'Wall clock jumped during a health check — the machine likely slept'
          );
        }
      } else {
        await this.handleHealthCheckFailure(name, info, result.error);
      }
    } catch (error) {
      await this.handleHealthCheckFailure(name, info, error as Error);
    }
  }

  /**
   * Handle a health check failure.
   */
  private async handleHealthCheckFailure(name: string, info: ConnectionInfo, error: Error): Promise<void> {
    const failures = (this.healthCheckFailures.get(name) || 0) + 1;
    this.healthCheckFailures.set(name, failures);

    this.logger.warn(
      { connection: name, failures, maxFailures: this.maxHealthCheckFailures, error: describeError(error) },
      'Connection health check failed'
    );

    // Update pool metrics
    info.poolMetrics.errorCount++;
    info.poolMetrics.lastError = error;

    // Emit error event
    this.emitEvent({
      type: DATABASE_EVENTS.ERROR as DatabaseEventType,
      connection: name,
      timestamp: new Date(),
      error,
    });

    // If too many consecutive failures, attempt reconnection
    if (failures >= this.maxHealthCheckFailures) {
      this.logger.error({ connection: name, failures }, 'Connection failed health checks, attempting reconnection');

      try {
        // Mark as disconnected and attempt reconnection
        info.connected = false;
        await this.reconnect(name);
        this.healthCheckFailures.set(name, 0);
        this.logger.info({ connection: name }, 'Connection recovered after health check failures');
      } catch (reconnectError) {
        this.logger.error(
          { connection: name, error: (reconnectError as Error).message },
          'Failed to recover connection'
        );
      }
    }
  }

  /**
   * Force a health check on a specific connection.
   * Use for manual verification after suspected issues.
   */
  async checkConnectionHealth(name: string = DATABASE_DEFAULT_CONNECTION): Promise<{
    healthy: boolean;
    latency?: number;
    error?: string;
  }> {
    const info = this.connections.get(name);
    if (!info) {
      return { healthy: false, error: `Connection '${name}' not found` };
    }

    if (!info.connected) {
      return { healthy: false, error: 'Connection not established' };
    }

    try {
      const startTime = Date.now();
      const result = await this.validateConnectionHealth(info.instance, info.config.dialect);
      const latency = Date.now() - startTime;

      return result.healthy
        ? { healthy: true, latency }
        : { healthy: false, latency, error: describeError(result.error) };
    } catch (error) {
      return { healthy: false, error: describeError(error) };
    }
  }

  /**
   * Get health check status for all connections.
   */
  getHealthStatus(): Map<
    string,
    {
      connected: boolean;
      consecutiveFailures: number;
      lastError?: string;
      poolMetrics: PoolMetrics;
    }
  > {
    const status = new Map();

    for (const [name, info] of this.connections) {
      status.set(name, {
        connected: info.connected,
        consecutiveFailures: this.healthCheckFailures.get(name) || 0,
        lastError: info.lastError ? describeError(info.lastError) : undefined,
        poolMetrics: this.collectPoolMetrics(info),
      });
    }

    return status;
  }

  /**
   * Get configured connections
   */
  private getConnectionConfigs(): Record<string, DatabaseConnection> {
    const configs: Record<string, DatabaseConnection> = {};

    // Add default connection if specified
    if (this.options.connection) {
      configs[DATABASE_DEFAULT_CONNECTION] = {
        ...this.options.connection,
        name: DATABASE_DEFAULT_CONNECTION,
      };
    }

    // Add named connections
    if (this.options.connections) {
      for (const [name, config] of Object.entries(this.options.connections)) {
        configs[name] = { ...config, name };
      }
    }

    // If no connections specified, create default SQLite in-memory
    if (Object.keys(configs).length === 0) {
      configs[DATABASE_DEFAULT_CONNECTION] = {
        name: DATABASE_DEFAULT_CONNECTION,
        dialect: 'sqlite',
        connection: ':memory:',
      };
    }

    return configs;
  }

  /**
   * Create a database connection with retry logic
   */
  private async createConnectionWithRetry(name: string, config: DatabaseConnection): Promise<ConnectionInfo> {
    const retryConfig = this.defaultRetryConfig;
    let attempts = 0;

    try {
      const info = await withRetry(
        () => {
          attempts += 1;
          this.logger.debug(
            { name, attempt: attempts - 1, maxRetries: retryConfig.maxRetries },
            'Attempting database connection'
          );
          return this.createConnection(name, config);
        },
        {
          maxAttempts: retryConfig.maxRetries + 1,
          delayMs: retryConfig.baseDelayMs,
          maxDelayMs: retryConfig.maxDelayMs,
          backoff: true,
          jitterFactor: 0,
          // Retry transient driver errors AND our own SERVICE_UNAVAILABLE
          // wrapper (createConnection reduces every failed liveness probe to
          // it, e.g. while the database container is still starting) — EXCEPT
          // when the probe already established that no retry can help. See
          // `isPermanentConnectionError`: a wrong password or a missing
          // database used to spend 31 seconds being asked five more times.
          shouldRetry: (error) => {
            if (error instanceof TitanError && error.details?.['permanent'] === true) return false;
            return (
              isTransientError(error) ||
              (error instanceof TitanError && error.code === ErrorCode.SERVICE_UNAVAILABLE)
            );
          },
          onRetry: (attempt, error) => {
            this.logger.warn(
              {
                name,
                attempt: attempt - 1,
                error: error instanceof Error ? error.message : String(error),
              },
              'Database connection failed, retrying'
            );
          },
        }
      );

      if (attempts > 1) {
        this.logger.info(
          { name, totalRetries: attempts - 1 },
          'Database connection established after retries'
        );
      }

      return info;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ name, attempts, error }, 'Database connection failed after all retries');
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: `Database connection ${name} failed after ${retryConfig.maxRetries} retries: ${message}`,
        details: { connection: name, error: message, maxRetries: retryConfig.maxRetries },
      });
    }
  }

  /**
   * Create a database connection
   */
  private async createConnection(name: string, config: DatabaseConnection): Promise<ConnectionInfo> {
    this.logger.debug({ name, dialect: config.dialect }, 'Creating database connection');

    const poolConfig = config.pool || {};
    const info: ConnectionInfo = {
      name,
      config,
      instance: null as unknown as Kysely<unknown>,
      pool: undefined,
      connected: false,
      connecting: true,
      metrics: {
        queryCount: 0,
        errorCount: 0,
        totalQueryTime: 0,
      },
      poolMetrics: {
        totalConnections: 0,
        idleConnections: 0,
        activeConnections: 0,
        waitingClients: 0,
        acquireCount: 0,
        releaseCount: 0,
        errorCount: 0,
        averageAcquireTimeMs: 0,
        totalAcquireTimeMs: 0,
        poolSize: {
          min: poolConfig.min ?? DEFAULT_POOL_CONFIG.min,
          max: poolConfig.max ?? DEFAULT_POOL_CONFIG.max,
        },
      },
    };

    try {
      // Create Kysely instance based on dialect
      const { instance, pool } = await this.createKyselyInstance(config);
      info.instance = instance;
      info.pool = pool;

      // Test connection health (single check — testConnection is redundant)
      const health = await this.validateConnectionHealth(instance, config.dialect);
      if (!health.healthy) {
        // The code stays SERVICE_UNAVAILABLE — callers branch on it — and the
        // verdict travels in `details` so the retry policy can read it without
        // re-deriving it from a message.
        throw new TitanError({
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: `Connection health check failed: ${describeError(health.error)}`,
          details: {
            permanent: isPermanentConnectionError(health.error),
            driverCode: (health.error as { code?: string }).code,
          },
        });
      }

      info.connected = true;
      info.connecting = false;

      this.connections.set(name, info);

      // Create circuit breaker for this connection
      const cbOptions = this.options.circuitBreaker;
      if (cbOptions?.enabled !== false) {
        const breaker = new CircuitBreaker({
          threshold: cbOptions?.threshold ?? 5,
          resetTimeMs: cbOptions?.resetTimeMs ?? 60000,
          onStateChange: (newState, previousState) => {
            this.logger.warn({ connection: name, newState, previousState }, 'Circuit breaker state changed');
          },
        });
        this.circuitBreakers.set(name, breaker);
      }

      // Emit connected event
      this.emitEvent({
        type: DATABASE_EVENTS.CONNECTED as DatabaseEventType,
        connection: name,
        timestamp: new Date(),
      });

      this.logger.info({ name, dialect: config.dialect }, 'Database connection established');

      return info;
    } catch (error) {
      info.connecting = false;
      info.lastError = error as Error;
      this.connections.set(name, info);

      const errorMessage = ERROR_MESSAGES.CONNECTION_FAILED(name, describeError(error));
      this.logger.error({ name, error }, errorMessage);

      // Emit error event
      this.emitEvent({
        type: DATABASE_EVENTS.ERROR as DatabaseEventType,
        connection: name,
        timestamp: new Date(),
        error: error as Error,
      });

      // This catch covers BOTH halves: the driver failing to build (a bad
      // dialect, a sqlite path whose directory does not exist — better-sqlite3
      // throws at construction, not at the first query) and the probe failing.
      // Without the verdict here, the wrapper flattened every one of them into
      // a retryable SERVICE_UNAVAILABLE, which is why the comment above
      // `shouldRetry` — "config mistakes fail on the FIRST attempt" — was not
      // true of any of them.
      const permanent =
        (error instanceof TitanError && error.details?.['permanent'] === true) ||
        isPermanentConnectionError(error);
      info.permanent = permanent;

      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: `Database connection ${name} is unavailable: ${errorMessage}`,
        details: { connection: name, error: errorMessage, permanent },
      });
    }
  }

  /**
   * Create Kysely instance based on dialect
   */
  private async createKyselyInstance(
    config: DatabaseConnection
  ): Promise<{ instance: Kysely<unknown>; pool?: Pool | mysql.Pool | Database }> {
    const connectionConfig = this.parseConnectionConfig(config);

    switch (config.dialect) {
      case 'postgres': {
        const { Pool, types: pgTypes } = await loadPg();
        const ResilientPgClient = await resilientPgClient();

        // Create a clean config object without ssl=false
        const pgConfig = { ...connectionConfig } as Record<string, unknown>;
        if (pgConfig['ssl'] === false) {
          delete pgConfig['ssl'];
        }

        // pg returns int8 (BIGINT, OID 20) as string by default to preserve
        // precision for values > 2^53. For most apps that store sequence
        // numbers, counters, or row IDs in BIGINT this footgun manifests
        // as `Number.isFinite("5") === false` or arithmetic NaN. We make the
        // safer default opt-out: coerce to JS number, but **only** for
        // values that fit losslessly in a double (Number.MAX_SAFE_INTEGER).
        // Out-of-range values fall back to BigInt so precision is preserved.
        // Apps can disable this entirely via config.coerceBigint = false.
        const coerceBigint = (config as { coerceBigint?: boolean }).coerceBigint !== false;
        if (DatabaseManager._bigintParserMode === null) {
          // First pool to start wins — install once per process. pg.types is
          // global, so subsequent pools share this parser.
          if (coerceBigint) {
            pgTypes.setTypeParser(20 /* INT8 / BIGINT */, (val: string) => {
              if (val === null) return null as unknown as number;
              const n = Number(val);
              if (Number.isSafeInteger(n)) return n as unknown as number;
              return BigInt(val) as unknown as number;
            });
          }
          DatabaseManager._bigintParserMode = coerceBigint;
        } else if (DatabaseManager._bigintParserMode !== coerceBigint) {
          // Second pool wants a different mode — pg.types is process-global,
          // we can't honor it without breaking the first pool. Warn loudly
          // so the conflict is visible instead of silently misconfiguring.
          this.logger.warn(
            { connection: config.name, requested: coerceBigint, active: DatabaseManager._bigintParserMode },
            'pg BIGINT parser mode mismatch — pg.types.setTypeParser is process-global; first pool wins'
          );
        }

        const pgPoolConfig = { ...DEFAULT_POOL_CONFIG, ...config.pool } as typeof DEFAULT_POOL_CONFIG & {
          connectionTimeoutMillis?: number;
        };
        const pool = new Pool({
          ...pgConfig,
          ...pgPoolConfig,
          // node-postgres has no acquireTimeoutMillis; connectionTimeoutMillis
          // bounds both TCP connect AND waiting for a free pooled client, so
          // pool exhaustion fails fast instead of hanging forever.
          connectionTimeoutMillis:
            pgPoolConfig.connectionTimeoutMillis ?? pgPoolConfig.acquireTimeoutMillis,
          // defaultSchema must be a per-connection STARTUP parameter — issuing
          // `SET search_path` through the pool configures only the one client
          // the pool happened to hand out.
          ...(this.options.defaultSchema
            ? {
                options: `-c search_path=${this.assertValidSchemaName(this.options.defaultSchema)},public`,
              }
            : {}),
          Client: ResilientPgClient,
        });

        if (this.options.defaultSchema) {
          this.connectionSchemas.set(
            config.name || DATABASE_DEFAULT_CONNECTION,
            this.options.defaultSchema
          );
        }

        // Add comprehensive error handlers with metrics collection
        const connectionName = config.name || DATABASE_DEFAULT_CONNECTION;
        pool.on('error', (err, client) => {
          // Surface the actual SQLSTATE / driver code + connection name so
          // operators can grep / dashboard on it. Without this context the
          // log line was just "PostgreSQL pool error" — useless when more
          // than one pool exists.
          const pgErr = err as Error & { code?: string; severity?: string; routine?: string };
          this.logger.error(
            {
              connection: connectionName,
              code: pgErr.code,
              severity: pgErr.severity,
              routine: pgErr.routine,
              clientPresent: !!client,
              processID: (client as { processID?: number } | undefined)?.processID,
              err,
            },
            'PostgreSQL pool error'
          );

          const connInfo = this.connections.get(connectionName);
          if (connInfo) {
            connInfo.poolMetrics.errorCount++;
            connInfo.poolMetrics.lastError = err;
          }

          this.emitEvent({
            type: DATABASE_EVENTS.ERROR as DatabaseEventType,
            connection: connectionName,
            timestamp: new Date(),
            error: err,
          });
        });

        pool.on('connect', (_client) => {
          this.logger.debug('PostgreSQL pool client connected');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.totalConnections++;
            connInfo.poolMetrics.idleConnections++;
          }
        });

        pool.on('acquire', (_client) => {
          this.logger.debug('PostgreSQL pool client acquired');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.acquireCount++;
            connInfo.poolMetrics.activeConnections++;
            connInfo.poolMetrics.idleConnections = Math.max(0, connInfo.poolMetrics.idleConnections - 1);
            connInfo.poolMetrics.lastAcquireAt = Date.now();
          }
        });

        pool.on('release', (_client) => {
          this.logger.debug('PostgreSQL pool client released');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.releaseCount++;
            connInfo.poolMetrics.activeConnections = Math.max(0, connInfo.poolMetrics.activeConnections - 1);
            connInfo.poolMetrics.idleConnections++;
          }
        });

        pool.on('remove', (_client) => {
          this.logger.debug('PostgreSQL pool client removed');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.totalConnections = Math.max(0, connInfo.poolMetrics.totalConnections - 1);
            connInfo.poolMetrics.idleConnections = Math.max(0, connInfo.poolMetrics.idleConnections - 1);
          }
        });

        const dialect = new PostgresDialect({ pool });
        const kyselyPlugins = this.options.camelCase ? [new CamelCasePlugin()] : [];
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
          plugins: kyselyPlugins,
        });

        return { instance, pool };
      }

      case 'mysql': {
        const mysql = await loadMysql();

        // Create a clean config object without ssl=false
        const mysqlConfig = { ...connectionConfig } as Record<string, unknown>;
        if (mysqlConfig['ssl'] === false) {
          delete mysqlConfig['ssl'];
        }

        // MySQL2 uses different pool parameter names than PostgreSQL.
        // Map PostgreSQL-style pool config to MySQL2 format.
        //
        // Note on acquire-timeout: mysql2 has no direct equivalent to
        // node-postgres' acquireTimeoutMillis (a deadline for "wait for a
        // pool slot"). The closest mitigations are:
        //   - connectTimeout — bounds each TCP+handshake attempt
        //   - queueLimit — bounds the *number* of pending acquires; when
        //     exceeded, new acquires fail fast instead of queueing forever
        // Default queueLimit to 10× connectionLimit so a sustained query
        // backlog produces a clear error instead of an unbounded memory
        // build-up. Callers can override via config.pool.queueLimit.
        const connectionLimit = config.pool?.max || DEFAULT_POOL_CONFIG.max;
        const userPool = (config.pool ?? {}) as { queueLimit?: number };
        const mysqlPoolConfig = {
          connectionLimit,
          waitForConnections: true,
          queueLimit: userPool.queueLimit ?? connectionLimit * 10,
          connectTimeout: DEFAULT_POOL_CONFIG.acquireTimeoutMillis,
        };

        const pool = mysql.createPool({
          ...mysqlConfig,
          ...mysqlPoolConfig,
        } as mysql.PoolOptions);

        // Defensive: attach a no-op error listener to each connection as it
        // joins the pool, mirroring the ResilientPgClient pattern. Without
        // this, an `'error'` event on a connection between query batches
        // (server-side timeout, peer reset) would surface as
        // uncaughtException. The pool's own `'error'` handler below still
        // receives the error for normal logging/metrics.
        pool.on('connection', (conn) => {
          (conn as { on: (ev: string, fn: (err: Error) => void) => void }).on('error', () => {
            /* re-emitted via pool.on('error') */
          });
        });

        // Add error handlers for MySQL pool with metrics collection
        pool.on('error', (err) => {
          this.logger.error({ error: err }, 'MySQL pool error');

          // Update pool metrics
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.errorCount++;
            connInfo.poolMetrics.lastError = err;
          }

          // Emit error event for monitoring
          this.emitEvent({
            type: DATABASE_EVENTS.ERROR as DatabaseEventType,
            connection: config.name || DATABASE_DEFAULT_CONNECTION,
            timestamp: new Date(),
            error: err,
          });
        });

        pool.on('connection', (_connection) => {
          this.logger.debug('MySQL pool connection established');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.totalConnections++;
            connInfo.poolMetrics.idleConnections++;
          }
        });

        pool.on('acquire', (_connection) => {
          this.logger.debug('MySQL pool connection acquired');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.acquireCount++;
            connInfo.poolMetrics.activeConnections++;
            connInfo.poolMetrics.idleConnections = Math.max(0, connInfo.poolMetrics.idleConnections - 1);
            connInfo.poolMetrics.lastAcquireAt = Date.now();
          }
        });

        pool.on('release', (_connection) => {
          this.logger.debug('MySQL pool connection released');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.releaseCount++;
            connInfo.poolMetrics.activeConnections = Math.max(0, connInfo.poolMetrics.activeConnections - 1);
            connInfo.poolMetrics.idleConnections++;
          }
        });

        const dialect = new MysqlDialect({ pool });
        const mysqlPlugins = this.options.camelCase ? [new CamelCasePlugin()] : [];
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
          plugins: mysqlPlugins,
        });

        return { instance, pool };
      }

      case 'sqlite': {
        const { default: BetterSqlite3 } = await loadSqlite();
        const database = new BetterSqlite3(connectionConfig.database || ':memory:', {
          // Enable verbose mode for debugging if requested
          verbose: config.debug ? (msg: unknown) => this.logger.debug({ msg }, 'SQLite verbose') : undefined,
          // Set busy timeout to handle concurrent access (especially for shared in-memory databases)
          // This prevents "database is locked" errors by waiting up to 5 seconds
          timeout: 5000,
        });

        // Configure pragmas for better performance and concurrency
        // Use WAL mode for better concurrency (doesn't work for in-memory databases)
        // For shared in-memory databases, we rely on the busy timeout
        const isInMemory =
          !connectionConfig.database ||
          connectionConfig.database === ':memory:' ||
          connectionConfig.database.includes('mode=memory') ||
          connectionConfig.database.includes(':memory:');

        if (!isInMemory) {
          // WAL mode only works for file-based databases
          database.pragma('journal_mode = WAL');
        }

        // Set busy timeout at SQLite level as well (in milliseconds)
        database.pragma('busy_timeout = 5000');

        const dialect = new SqliteDialect({ database });
        const sqlitePlugins = [sqliteDateSerializerPlugin()];
        if (this.options.camelCase) {
          sqlitePlugins.push(new CamelCasePlugin() as any);
        }
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
          plugins: sqlitePlugins,
        });

        return { instance, pool: database };
      }

      default:
        throw Errors.badRequest(ERROR_MESSAGES.INVALID_DIALECT(config.dialect));
    }
  }

  /**
   * Parse connection configuration
   */
  private parseConnectionConfig(config: DatabaseConnection): ParsedConnectionConfig {
    // Handle undefined or null config
    if (!config) {
      throw Errors.badRequest('Database connection configuration is required');
    }

    if (typeof config.connection === 'string') {
      // Parse connection string
      if (config.dialect === 'sqlite') {
        return { database: config.connection };
      }

      // For PostgreSQL and MySQL, parse the connection string
      const url = new URL(config.connection);
      const sslParam = url.searchParams.get('ssl');
      const result: ParsedConnectionConfig = {
        host: url.hostname,
        port: parseInt(url.port) || DIALECT_SETTINGS[config.dialect]?.defaultPort || undefined,
        database: url.pathname.slice(1),
        user: url.username,
        password: url.password,
      };

      // Only set ssl if explicitly requested
      if (sslParam === 'true') {
        result.ssl = true;
      }

      return result;
    }

    // If connection is not a string, it should be an object
    const connConfig = config.connection as Partial<ParsedConnectionConfig> | undefined;

    // Handle undefined connection object
    if (!connConfig) {
      // For SQLite, return a default memory database
      if (config.dialect === 'sqlite') {
        return { database: ':memory:' };
      }
      // For network databases, require at least a database name
      const configKeys = Object.keys(config).join(', ');
      throw Errors.badRequest(
        `Connection configuration is required for ${config.dialect || 'undefined'}. ` +
          `Received config keys: [${configKeys}]. ` +
          `Common mistake: Using {...context.connection} instead of {connection: context.connection} ` +
          `in TitanDatabaseModule.forRoot()`
      );
    }

    // Dialect-specific keys go only to the dialect they belong to, which is how
    // `IParsedConnectionConfig` already labels them ("Additional PostgreSQL
    // specific" / "Additional MySQL specific") and not how they were passed:
    // every key went to every driver.
    //
    // mysql2 answers `searchPath` with "Ignoring invalid configuration option
    // passed to Connection: searchPath. This is currently a warning, but in
    // future versions of MySQL2, an error will be thrown" — five times per test
    // run in this repo. `charset`/`timezone` went the other way, into pg, which
    // drops unknown keys without saying anything.
    //
    // Note `searchPath` does nothing on the PostgreSQL side either: the schema
    // is set at pool creation from `options.defaultSchema`, as
    // `-c search_path=…`, because a session-scoped `SET search_path` reaches
    // only one pooled client. It is carried here for callers that pass it, not
    // because this is what applies it.
    const base = {
      database: connConfig.database || (config.dialect === 'sqlite' ? ':memory:' : 'postgres'),
      host: connConfig.host,
      port: connConfig.port,
      user: connConfig.user,
      password: connConfig.password,
      ssl: connConfig.ssl,
    };

    if (config.dialect === 'mysql') {
      return { ...base, charset: connConfig.charset, timezone: connConfig.timezone };
    }
    if (config.dialect === 'postgres') {
      return { ...base, searchPath: connConfig.searchPath };
    }
    return base;
  }

  /**
   * Validate connection health with timeout.
   *
   * Returns the failure instead of throwing it, and instead of logging it: this
   * used to swallow the real error behind `logger.error('Connection health
   * check failed')` and hand its caller a bare `false`, which the caller then
   * reported as `new Error('Health check returned false')` under the SAME
   * message. Every incident therefore carried two identical lines — one with
   * the cause and no connection name, one with the connection name and no
   * cause — and neither on its own was enough to diagnose anything.
   */
  private async validateConnectionHealth(
    db: Kysely<unknown>,
    dialect: DatabaseDialect
  ): Promise<{ healthy: true } | { healthy: false; error: Error }> {
    const timeout = healthCheckDeadlineMs(dialect);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);

    try {
      await Promise.race([
        sql`SELECT 1 AS health_check`.execute(db),
        new Promise<never>((_, reject) => {
          ac.signal.addEventListener('abort', () =>
            reject(new Error(`Health check timed out after ${timeout}ms`))
          );
        }),
      ]);
      return { healthy: true };
    } catch (error) {
      return { healthy: false, error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Get a database connection by name.
   *
   * `DB` is the caller's schema. It defaults to `unknown`, which is what this
   * returned before the parameter existed — and `Kysely<unknown>` accepts no
   * table name, so `selectFrom('users')` did not compile and the connection
   * could not be used for the thing it is for. The runtime instance was always
   * schema-agnostic; only the declaration forced a cast at every call site.
   */
  async getConnection<DB = unknown>(name: string = DATABASE_DEFAULT_CONNECTION): Promise<Kysely<DB>> {
    const info = this.connections.get(name);

    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    if (!info.connected && !info.connecting) {
      // A reconnect that fails throws the retry wrapper's OWN error, and that
      // is what reached the caller — three messages nested inside each other,
      // carrying the driver's sentence and the configured connection string:
      //
      //   Database connection default failed after 5 retries: Database
      //   connection default is unavailable: Failed to connect to database
      //   "default": Cannot open database because the directory does not exist
      //
      // The attempt is logged where it fails, by `createConnection`'s catch.
      // What the caller needs is the verdict below, and only that.
      await this.reconnect(name).catch(() => undefined);
    }

    // `reconnect` REPLACES the entry rather than repairing it: `close()` drops
    // the name from the map and `createConnectionWithRetry` stores a brand new
    // `ConnectionInfo`. So `info` above is the object the reconnect discarded,
    // whose `connected` is false by construction and whose `lastError` is
    // whatever broke it in the first place. Reading it meant a SUCCESSFUL
    // recovery was reported as `Errors.unavailable(...)`, with a stale reason,
    // on every call for the life of the process — while each of those calls
    // tore the pool down and built a new one first.
    const live = this.connections.get(name) ?? info;

    if (!live.connected) {
      throw this.unavailable(name);
    }

    // Return executor (with plugins) if available, otherwise raw instance
    // This ensures all consumers get plugin-aware queries by default
    if (live.executor) {
      return live.executor as Kysely<DB>;
    }

    return live.instance as Kysely<DB>;
  }

  /**
   * Get a plugin-aware executor for a connection
   *
   * Returns the cached executor if plugins were configured during connection setup,
   * or creates a new executor with the provided plugins.
   *
   * @example
   * ```typescript
   * // Get executor with connection's default plugins
   * const executor = await manager.getExecutor();
   *
   * // Create executor with specific plugins
   * const executor = await manager.getExecutor('default', [softDeletePlugin()]);
   *
   * // All queries have plugins applied automatically
   * const users = await executor.selectFrom('users').selectAll().execute();
   * ```
   */
  async getExecutor(name: string = DATABASE_DEFAULT_CONNECTION, plugins?: Plugin[]): Promise<KyseraExecutor<unknown>> {
    const info = this.connections.get(name);

    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    if (!info.connected && !info.connecting) {
      // See `getConnection`: a failed reconnect's own error is the operator's.
      await this.reconnect(name).catch(() => undefined);
    }

    // See `getConnection`: `reconnect` replaces the map entry, so the object
    // resolved above is the one it discarded.
    const live = this.connections.get(name) ?? info;

    if (!live.connected) {
      throw this.unavailable(name);
    }

    // If specific plugins provided, create new executor
    if (plugins && plugins.length > 0) {
      this.logger.debug(
        { connection: name, plugins: plugins.map((p) => p.name) },
        'Creating executor with custom plugins'
      );
      return createExecutor(live.instance, plugins);
    }

    // Return cached executor if available
    if (live.executor) {
      return live.executor;
    }

    // Create executor without plugins (still provides executor interface)
    return createExecutor(live.instance, []);
  }

  /**
   * A stable reference to a connection, safe to hold for the process lifetime.
   *
   * `getConnection()` returns the object that is current when it is called,
   * which is the right answer for a caller that uses it and drops it. It is the
   * wrong answer for a Singleton — a repository, or the DATABASE_CONNECTION
   * provider — because reconnection destroys that object and builds another.
   * Holding the old one meant every query failed with `driver has already been
   * destroyed` from then on, with no recovery short of a restart.
   *
   * The reference returned here resolves the current connection on every
   * access, so a reconnect is invisible to whoever holds it.
   */
  getConnectionRef(name: string = DATABASE_DEFAULT_CONNECTION): Kysely<unknown> {
    return createLiveConnectionRef(() => this.requireLiveConnection(name)) as Kysely<unknown>;
  }

  /**
   * The same guarantee for a plugin-specific executor.
   *
   * An executor wraps one Kysely instance, so it has to be rebuilt whenever the
   * instance behind it changes; that is done here rather than by the caller,
   * who has no way to notice.
   */
  getExecutorRef(
    name: string = DATABASE_DEFAULT_CONNECTION,
    plugins: readonly Plugin[] = []
  ): KyseraExecutor<unknown> {
    let builtFrom: Kysely<unknown> | undefined;
    let executor: KyseraExecutor<unknown> | undefined;

    return createLiveConnectionRef(() => {
      const instance = this.requireLiveInstance(name);
      if (builtFrom !== instance || !executor) {
        executor = createExecutorSync(instance, plugins);
        builtFrom = instance;
      }
      return executor as object;
    }) as KyseraExecutor<unknown>;
  }

  /**
   * The connection as consumers should see it — executor when one is
   * configured, raw instance otherwise — or a clear error saying why not.
   *
   * Deliberately synchronous, and therefore deliberately unable to reconnect:
   * a live reference is read in the middle of building a query, where there is
   * nothing to await. During the brief window when `reconnect()` has closed the
   * old connection and not yet registered the new one, callers get this error
   * and can retry — which is what the proactive health check is already doing
   * on their behalf.
   */
  /**
   * What a CALLER is told when a connection is down.
   *
   * Deliberately without a cause. `Errors.unavailable` puts its reason in the
   * message AND in `details`, and both cross the wire — measured on the live
   * stand, a paysys 503 reached the client as
   * `details: { service: 'default', reason: 'Connection health check failed: ' }`.
   * Now that `describeError` fills that in, the same field would carry
   * `connect ECONNREFUSED 127.0.0.1:5432` or a SQLSTATE like `28P01`.
   *
   * None of which a caller can act on, and an anonymous one should not read.
   * The cause is not lost: it is written where it happened, by
   * `createConnection`'s catch and by `handleHealthCheckFailure`, both through
   * `describeError` — which is what that helper was added for. Repeating it to
   * the caller was the redundant half.
   */
  private unavailable(name: string): ReturnType<typeof Errors.unavailable> {
    return Errors.unavailable(name);
  }

  private requireLiveConnection(name: string): object {
    const info = this.connections.get(name);
    if (!info) {
      throw Errors.notFound('Database connection', name);
    }
    if (!info.connected) {
      throw this.unavailable(name);
    }
    return (info.executor ?? info.instance) as object;
  }

  /** The raw instance behind a connection, for building executors on top of. */
  private requireLiveInstance(name: string): Kysely<unknown> {
    const info = this.connections.get(name);
    if (!info) {
      throw Errors.notFound('Database connection', name);
    }
    if (!info.connected) {
      throw this.unavailable(name);
    }
    return info.instance;
  }

  /**
   * Create and cache an executor with plugins for a connection
   *
   * Use this to configure default plugins for a connection that will be
   * used by all subsequent getExecutor() calls.
   *
   * @example
   * ```typescript
   * // Configure default plugins for the connection
   * await manager.setConnectionPlugins('default', [
   *   softDeletePlugin(),
   *   timestampsPlugin(),
   * ]);
   *
   * // Now all getExecutor() calls return executor with these plugins
   * const executor = await manager.getExecutor();
   * ```
   */
  async setConnectionPlugins(
    name: string = DATABASE_DEFAULT_CONNECTION,
    plugins: Plugin[]
  ): Promise<KyseraExecutor<unknown>> {
    const info = this.connections.get(name);

    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    if (!info.connected) {
      throw this.unavailable(name);
    }

    this.logger.info({ connection: name, plugins: plugins.map((p) => p.name) }, 'Setting connection plugins');

    const executor = await createExecutor(info.instance, plugins);
    info.executor = executor;
    info.plugins = getPlugins(executor);

    return executor;
  }

  /**
   * Get plugins configured for a connection
   */
  getConnectionPlugins(name: string = DATABASE_DEFAULT_CONNECTION): readonly Plugin[] {
    const info = this.connections.get(name);
    return info?.plugins || [];
  }

  /**
   * Check if a database instance is a KyseraExecutor
   */
  isExecutor(value: Kysely<unknown>): value is KyseraExecutor<unknown> {
    return isKyseraExecutor(value);
  }

  /**
   * Get raw Kysely instance bypassing plugin interceptors
   */
  getRawDb(executor: Kysely<unknown>): Kysely<unknown> {
    return getRawDb(executor);
  }

  /**
   * Get connection pool
   */
  getPool(name: string = DATABASE_DEFAULT_CONNECTION): Pool | mysql.Pool | Database | undefined {
    const info = this.connections.get(name);
    return info?.pool;
  }

  /**
   * Reconnect to database
   */
  private async reconnect(name: string): Promise<void> {
    const info = this.connections.get(name);
    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    this.logger.info({ name }, 'Attempting to reconnect to database');

    // Tear down the stale instance/pool first: reconnect is auto-triggered
    // by failed health checks, and recreating over a live pool leaked one
    // pool per cycle on a flapping database.
    const config = info.config;
    try {
      await this.close(name);
    } catch (error) {
      this.logger.warn({ name, error }, 'Error disposing stale connection before reconnect');
    }

    // Use retry logic for reconnection
    await this.createConnectionWithRetry(name, config);
  }

  /**
   * Close a specific connection
   */
  async close(name: string = DATABASE_DEFAULT_CONNECTION): Promise<void> {
    const info = this.connections.get(name);
    if (!info) {
      return;
    }

    // Remove from map immediately to prevent double-close
    this.connections.delete(name);
    this.healthCheckFailures.delete(name);
    // The breaker belongs to the connection, not to the name. It was left
    // behind, so `getCircuitBreaker` answered for a connection that no longer
    // existed; a reconnect overwrote it anyway, which is the behaviour this
    // makes explicit rather than accidental.
    this.circuitBreakers.delete(name);

    this.logger.info({ name }, 'Closing database connection');

    try {
      // Destroy executor first to call plugin cleanup hooks
      if (info.executor && isKyseraExecutor(info.executor)) {
        await destroyExecutor(info.executor);
      }

      // Kysely owns the pool through its dialect: destroy() ends the
      // pg/mysql pool and closes the sqlite handle. The manual pool.end()
      // that used to follow was a DOUBLE close — it rejected on every PG
      // shutdown, so `connected` never reset and DISCONNECTED never fired.
      await info.instance.destroy();

      this.logger.info({ name }, 'Database connection closed');
    } catch (error) {
      this.logger.error({ name, error }, 'Error closing database connection');
      throw error;
    } finally {
      // The connection is unusable whether destroy() succeeded or not —
      // always reflect that in state and notify listeners.
      info.connected = false;
      this.emitEvent({
        type: DATABASE_EVENTS.DISCONNECTED as DatabaseEventType,
        connection: name,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    // Stop proactive health checks first
    this.stopProactiveHealthChecks();

    // Reopen has to be possible. `init()` is idempotent on `initialized`, and
    // nothing ever cleared the flag, so after closeAll() a manager was
    // permanently dead: init() returned at once with a debug line reading
    // "already initialized, skipping" while every connection was gone. Any
    // caller that tears down and brings the manager back — a reconnect
    // supervisor, a module restarted through the app lifecycle, a test
    // harness — got a success and an empty manager.
    this.initialized = false;

    // Early return if no connections to close
    if (this.connections.size === 0) {
      return;
    }

    this.logger.info('Closing all database connections');

    // Get keys before iteration since close() removes from map
    const connectionNames = Array.from(this.connections.keys());
    const pending = new Set(connectionNames);
    const closePromises = connectionNames.map((name) =>
      this.close(name)
        .catch((error) => this.logger.error({ name, error }, 'Error closing connection'))
        .finally(() => pending.delete(name))
    );

    // shutdownTimeout bounds the wait. A driver that never settles its
    // destroy() — a pg client stuck mid-query, a socket with no keepalive —
    // otherwise holds the process open forever and shutdown is decided by
    // whatever SIGKILLs it. We stop waiting; we do not cancel, because the
    // driver gives us no way to. Naming the connections still pending is the
    // whole point: without them the operator sees a process that would not
    // exit and nothing that says which database it was waiting on.
    const shutdownTimeout = this.options.shutdownTimeout;
    if (shutdownTimeout !== undefined && shutdownTimeout > 0) {
      let timer: NodeJS.Timeout | undefined;
      const timedOut = await Promise.race([
        Promise.all(closePromises).then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), shutdownTimeout);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);

      if (timedOut) {
        this.logger.error(
          { pending: Array.from(pending), shutdownTimeout },
          'Database connections did not close within shutdownTimeout; abandoning the wait'
        );
        return;
      }
    } else {
      await Promise.all(closePromises);
    }

    this.logger.info('All database connections closed');
  }

  /**
   * Check if connected
   */
  isConnected(name: string = DATABASE_DEFAULT_CONNECTION): boolean {
    const info = this.connections.get(name);
    return info?.connected || false;
  }

  /**
   * Get all connection names
   */
  getConnectionNames(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection metrics
   */
  getMetrics(name?: string): Record<string, unknown> {
    if (name) {
      const info = this.connections.get(name);
      return info?.metrics || {};
    }

    const metrics: Record<string, unknown> = {};
    for (const [connName, info] of this.connections) {
      metrics[connName] = info.metrics;
    }
    return metrics;
  }

  /**
   * Get detailed pool metrics for a connection or all connections.
   * Includes real-time pool statistics from the underlying driver.
   *
   * @example
   * ```typescript
   * // Get pool metrics for default connection
   * const metrics = manager.getPoolMetrics();
   *
   * // Get pool metrics for specific connection
   * const metrics = manager.getPoolMetrics('replica');
   *
   * // Monitor pool health
   * const { activeConnections, waitingClients, poolSize } = metrics;
   * const utilization = activeConnections / poolSize.max;
   * ```
   */
  getPoolMetrics(name?: string): PoolMetrics | Map<string, PoolMetrics> {
    if (name) {
      const info = this.connections.get(name);
      if (!info) {
        throw Errors.notFound('Connection', name);
      }
      return this.collectPoolMetrics(info);
    }

    const metrics = new Map<string, PoolMetrics>();
    for (const [connName, info] of this.connections) {
      metrics.set(connName, this.collectPoolMetrics(info));
    }
    return metrics;
  }

  /**
   * Collect pool metrics from a connection, merging driver-specific stats
   */
  private collectPoolMetrics(info: ConnectionInfo): PoolMetrics {
    const m = info.poolMetrics;

    // Overlay real-time stats from pg Pool if available
    let totalConnections = m.totalConnections;
    let idleConnections = m.idleConnections;
    let activeConnections = m.activeConnections;
    let waitingClients = m.waitingClients;

    // Structural, not `instanceof Pool`. Two reasons, and the second is why
    // it changed: `pg` is loaded lazily now and a value import here would
    // undo that; and `instanceof` is false across two copies of `pg` in one
    // tree, which npm's layout can produce — so the real pool of a real
    // Postgres connection would report no statistics at all, silently. The
    // dialect is already known from the config; the counters are what is
    // being read.
    if (info.pool && info.config.dialect === 'postgres' && isPgPool(info.pool)) {
      const pgPool = info.pool;
      totalConnections = pgPool.totalCount;
      idleConnections = pgPool.idleCount;
      waitingClients = pgPool.waitingCount;
      activeConnections = pgPool.totalCount - pgPool.idleCount;
    }

    const averageAcquireTimeMs =
      m.acquireCount > 0 && m.totalAcquireTimeMs > 0
        ? m.totalAcquireTimeMs / m.acquireCount
        : m.averageAcquireTimeMs;

    return {
      totalConnections,
      idleConnections,
      activeConnections,
      waitingClients,
      acquireCount: m.acquireCount,
      releaseCount: m.releaseCount,
      errorCount: m.errorCount,
      lastError: m.lastError,
      lastAcquireAt: m.lastAcquireAt,
      averageAcquireTimeMs,
      totalAcquireTimeMs: m.totalAcquireTimeMs,
      poolSize: m.poolSize,
    };
  }

  /**
   * Reset pool metrics counters for a connection
   */
  resetPoolMetrics(name?: string): void {
    const resetMetrics = (info: ConnectionInfo) => {
      info.poolMetrics.acquireCount = 0;
      info.poolMetrics.releaseCount = 0;
      info.poolMetrics.errorCount = 0;
      info.poolMetrics.totalAcquireTimeMs = 0;
      info.poolMetrics.averageAcquireTimeMs = 0;
      info.poolMetrics.lastError = undefined;
      info.poolMetrics.lastAcquireAt = undefined;
    };

    if (name) {
      const info = this.connections.get(name);
      if (info) {
        resetMetrics(info);
      }
    } else {
      for (const info of this.connections.values()) {
        resetMetrics(info);
      }
    }
  }

  /**
   * Emit database event
   */
  private emitEvent(event: DatabaseEvent): void {
    this.eventEmitter.emit(event.type, event);
  }

  /**
   * Subscribe to database events
   */
  on(event: DatabaseEventType, listener: (event: DatabaseEvent) => void): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Unsubscribe from database events
   */
  off(event: DatabaseEventType, listener: (event: DatabaseEvent) => void): void {
    this.eventEmitter.off(event, listener);
  }

  /**
   * Get connection configuration
   */
  getConnectionConfig(name?: string): DatabaseConnection | undefined {
    const connectionName = name || DATABASE_DEFAULT_CONNECTION;
    const info = this.connections.get(connectionName);
    return info?.config;
  }

  /**
   * Get the dialect for a specific connection
   */
  getDialect(name: string = DATABASE_DEFAULT_CONNECTION): string | undefined {
    const info = this.connections.get(name);
    return info?.config?.dialect;
  }

  // ============================================================================
  // CIRCUIT BREAKER
  // ============================================================================

  /**
   * Get the circuit breaker for a connection.
   *
   * @example
   * ```typescript
   * const breaker = manager.getCircuitBreaker('default');
   * const state = await breaker?.getState();
   * if (state?.state === 'open') {
   *   console.log('Connection is in circuit breaker open state');
   * }
   * ```
   */
  getCircuitBreaker(name: string = DATABASE_DEFAULT_CONNECTION): CircuitBreaker | undefined {
    return this.circuitBreakers.get(name);
  }

  /**
   * Execute a function with circuit breaker protection for a connection.
   *
   * If the circuit breaker is open, fails fast without attempting the operation.
   * If no circuit breaker is configured, executes directly.
   *
   * @example
   * ```typescript
   * const result = await manager.withCircuitBreaker('default', async (db) => {
   *   return db.selectFrom('users').selectAll().execute();
   * });
   * ```
   */
  async withCircuitBreaker<T>(
    name: string = DATABASE_DEFAULT_CONNECTION,
    fn: (db: Kysely<unknown>) => Promise<T>
  ): Promise<T> {
    const db = await this.getConnection(name);

    // The breaker is read AFTER the connection, not before. `getConnection`
    // reconnects a connection that is down, and `createConnection` installs a
    // NEW `CircuitBreaker` at the same key — so reading it first ran the call
    // on the object the reconnect had just replaced. Every failure counted
    // there was invisible to the breaker everyone else consults, and a breaker
    // that was open refused a call the fresh connection would have served.
    const breaker = this.circuitBreakers.get(name);

    if (breaker) {
      return breaker.execute(() => fn(db));
    }

    return fn(db);
  }

  // ============================================================================
  // SCHEMA MANAGEMENT (Multi-Tenant)
  // ============================================================================

  /**
   * @deprecated Disabled — always throws. A session-scoped `SET search_path`
   * through a connection pool configures one arbitrary pooled client, so
   * schema-per-tenant isolation breaks nondeterministically. Use the
   * `defaultSchema` module option (per-connection startup parameter),
   * Kysely's `.withSchema()` for per-query scoping, or a dedicated
   * connection per tenant.
   */
  async setSchema(schema: string, name: string = DATABASE_DEFAULT_CONNECTION): Promise<void> {
    // DISABLED: `SET search_path` is session-scoped, but this executed
    // through the POOL — it configured whichever single client the pool
    // handed out, while every other pooled connection silently kept the
    // previous schema. Schema-per-tenant isolation then depends on which
    // client serves each query. Refusing loudly beats corrupting tenants.
    throw Errors.badRequest(
      `setSchema('${schema}', '${name}') is disabled: a session-scoped SET search_path over a ` +
        `connection pool lands on ONE arbitrary pooled client and breaks schema isolation ` +
        `nondeterministically. Use the defaultSchema module option (applied as a per-connection ` +
        `startup parameter), Kysely's .withSchema() for per-query scoping, or a dedicated ` +
        `connection per tenant.`
    );
  }

  /**
   * Validate a schema identifier (used for pool startup parameters).
   */
  private assertValidSchemaName(schema: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      throw Errors.badRequest(`Invalid schema name: ${schema}`);
    }
    return schema;
  }

  /**
   * Get the current schema for a connection.
   */
  getSchema(name: string = DATABASE_DEFAULT_CONNECTION): string | undefined {
    return this.connectionSchemas.get(name);
  }

  /**
   * @deprecated Disabled — always throws. Switching `search_path` on a
   * shared pool races between concurrent requests (tenant bleed). Use
   * Kysely's `.withSchema()` or a dedicated connection per tenant.
   */
  async withSchema<T>(
    schema: string,
    _fn: (db: Kysely<unknown>) => Promise<T>,
    name: string = DATABASE_DEFAULT_CONNECTION
  ): Promise<T> {
    // DISABLED for the same reason as setSchema — and worse: interleaved
    // withSchema calls from concurrent requests raced on the shared pool,
    // bleeding one tenant's schema into another's queries.
    throw Errors.badRequest(
      `withSchema('${schema}', '${name}') is disabled: switching search_path over a shared ` +
        `connection pool races between concurrent requests. Use Kysely's .withSchema() for ` +
        `per-query scoping or a dedicated connection per tenant.`
    );
  }

  // ============================================================================
  // PLUGIN AUTO-CONFIGURATION
  // ============================================================================

  /**
   * Resolve plugin specifications from options into actual Plugin instances.
   * Handles string names (built-in lookups), Plugin objects, and KyseraPluginConfig.
   */
  private async resolvePlugins(
    pluginSpecs: Array<string | Plugin | { plugin: string | Plugin; options?: Record<string, unknown> }>
  ): Promise<Plugin[]> {
    const resolved: Plugin[] = [];

    for (const spec of pluginSpecs) {
      if (typeof spec === 'string') {
        // Built-in plugin name — lazily import from @kysera/*
        const plugin = await this.resolveBuiltInPlugin(spec);
        if (plugin) resolved.push(plugin);
      } else if ('interceptQuery' in spec || 'name' in spec) {
        // Already a Plugin instance
        resolved.push(spec as Plugin);
      } else if ('plugin' in spec) {
        // KyseraPluginConfig: { plugin, options }
        if (typeof spec.plugin === 'string') {
          const plugin = await this.resolveBuiltInPlugin(spec.plugin, spec.options);
          if (plugin) resolved.push(plugin);
        } else {
          resolved.push(spec.plugin);
        }
      }
    }

    return resolved;
  }

  /**
   * Resolve a built-in plugin by name.
   */
  private async resolveBuiltInPlugin(name: string, options?: Record<string, unknown>): Promise<Plugin | null> {
    switch (name) {
      case 'soft-delete':
      case 'softDelete': {
        const { softDeletePlugin } = await import('@kysera/soft-delete');
        return softDeletePlugin(options as Parameters<typeof softDeletePlugin>[0]);
      }
      case 'timestamps': {
        const { timestampsPlugin } = await import('@kysera/timestamps');
        return timestampsPlugin(options as Parameters<typeof timestampsPlugin>[0]);
      }
      case 'audit': {
        const { auditPlugin } = await import('@kysera/audit');
        return auditPlugin(options as Parameters<typeof auditPlugin>[0]);
      }
      case 'rls': {
        // Requires a schema — only reachable via the {plugin: 'rls', options}
        // config form; a bare 'rls' string cannot carry one.
        if (!options || typeof options !== 'object' || !('schema' in options)) {
          this.logger.warn(
            { plugin: name },
            "RLS plugin requires options.schema (use { plugin: 'rls', options: { schema } }); skipping"
          );
          return null;
        }
        const { rlsPlugin } = await import('@kysera/rls');
        return rlsPlugin(options as unknown as Parameters<typeof rlsPlugin>[0]);
      }
      default:
        this.logger.warn({ plugin: name }, 'Unknown built-in plugin name, skipping');
        return null;
    }
  }

  /**
   * Apply global plugins from options.kysera.plugins to all connections.
   * Called once during init() after all connections are established.
   */
  /**
   * Attach every configured plugin to every live connection.
   *
   * `kysera.plugins` and the legacy `plugins.builtIn` are MERGED, not
   * either/or. They used to be alternatives — the first `if` returned as soon
   * as `kysera.plugins` was non-empty — which meant that adding one explicit
   * plugin silently dropped `timestamps`, `softDelete` and `audit`. An option
   * that turns another option off without saying so is the kind of thing
   * nobody discovers until rows stop getting a `createdAt`.
   */
  private async applyGlobalPlugins(): Promise<void> {
    const plugins: Plugin[] = [];

    const builtIn = this.options.plugins?.builtIn;
    if (builtIn) {
      const legacyPlugins: Plugin[] = [];
      if (builtIn.softDelete) {
        const opts = typeof builtIn.softDelete === 'object' ? builtIn.softDelete : undefined;
        const plugin = await this.resolveBuiltInPlugin('soft-delete', opts as Record<string, unknown>);
        if (plugin) legacyPlugins.push(plugin);
      }
      if (builtIn.timestamps) {
        const opts = typeof builtIn.timestamps === 'object' ? builtIn.timestamps : undefined;
        const plugin = await this.resolveBuiltInPlugin('timestamps', opts as Record<string, unknown>);
        if (plugin) legacyPlugins.push(plugin);
      }
      if (builtIn.audit) {
        const opts = typeof builtIn.audit === 'object' ? builtIn.audit : undefined;
        const plugin = await this.resolveBuiltInPlugin('audit', opts as Record<string, unknown>);
        if (plugin) legacyPlugins.push(plugin);
      }

      plugins.push(...legacyPlugins);
    }

    const pluginSpecs = this.options.kysera?.plugins;
    if (pluginSpecs && pluginSpecs.length > 0) {
      plugins.push(...(await this.resolvePlugins(pluginSpecs)));
    }

    if (plugins.length === 0) return;

    this.logger.info(
      { plugins: plugins.map((p) => p.name) },
      'Applying global Kysera plugins to all connections'
    );

    for (const [name, info] of this.connections) {
      if (info.connected) {
        await this.setConnectionPlugins(name, plugins);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeAll();
  }
}
