/**
 * Database Module Type Definitions
 *
 * Comprehensive type system for Titan Database Module with Kysera ORM integration.
 */

import type { Kysely, Transaction } from 'kysely';
import type { Plugin as KyseraPlugin } from '@kysera/executor';
import type { Dialect } from '@kysera/dialects';
import type {
  PaginationOptions as KyseraPaginationOptions,
  PaginatedResult as KyseraPaginatedResult,
  CursorOptions as KyseraCursorOptions,
} from '@kysera/core';
import type { z } from 'zod';
import type { Pool } from 'pg';
import type * as mysql from 'mysql2';
import type BetterSqlite3 from 'better-sqlite3';
import type { Constructor, DynamicModule, InjectionToken, IModule } from '@omnitron-dev/titan/nexus';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
type Database = BetterSqlite3.Database;

/**
 * Database dialect types supported by the module.
 */
export type DatabaseDialect = Dialect;

/**
 * Connection configuration for databases
 */
export interface ConnectionConfig {
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  ssl?:
    | boolean
    | {
        rejectUnauthorized?: boolean;
        ca?: string;
        cert?: string;
        key?: string;
      };
}

/**
 * Pool configuration for connection pooling
 */
export interface PoolConfig {
  min?: number;
  max?: number;
  idleTimeoutMillis?: number;
  acquireTimeoutMillis?: number;
  /**
   * NOT IMPLEMENTED — the four below are `tarn`/`knex` pool option names, and
   * the pools here are node-postgres and mysql2, which have no equivalent.
   * The whole pool config is spread into the driver's constructor, so they are
   * passed and ignored rather than rejected: setting `reapIntervalMillis`
   * looks accepted and reaps nothing.
   *
   * What the drivers do read from this object: `max`, `idleTimeoutMillis`,
   * and `acquireTimeoutMillis` (mapped to node-postgres's
   * `connectionTimeoutMillis`, which bounds both the TCP connect and the wait
   * for a free client).
   */
  createTimeoutMillis?: number;
  destroyTimeoutMillis?: number;
  reapIntervalMillis?: number;
  createRetryIntervalMillis?: number;
}

/**
 * Individual database connection configuration
 */
export interface DatabaseConnection {
  name?: string;
  dialect: DatabaseDialect;
  connection: string | ConnectionConfig;
  pool?: PoolConfig;
  debug?: boolean;
  plugins?: string[];
  migrationsPath?: string;
  seedsPath?: string;
  /**
   * Postgres only. When true (default), `BIGINT` columns (PostgreSQL OID 20)
   * are parsed as JS numbers if they fit losslessly in `Number.MAX_SAFE_INTEGER`,
   * otherwise as `BigInt`. When false, leaves the pg default behavior of
   * returning bigints as strings (which is a frequent source of subtle bugs:
   * `Number.isFinite("5") === false`). Has no effect on other dialects.
   */
  coerceBigint?: boolean;
}

/**
 * Kysera Core configuration options
 */
export interface KyseraCoreOptions {
  debug?: boolean;
  healthCheck?: { enabled?: boolean; interval?: number; timeout?: number };
  pagination?: { defaultLimit?: number; maxLimit?: number };
  errorHandling?: { parseDbErrors?: boolean; throwOnNotFound?: boolean };
}

/**
 * Kysera Repository configuration options
 *
 * NOT IMPLEMENTED — the whole interface. It is exported from the package index
 * and read by nothing: no repository validates its database results, chooses a
 * validation strategy, or batches by this size.
 */
export interface KyseraRepositoryOptions {
  validateDbResults?: boolean;
  validationStrategy?: 'none' | 'strict';
  batchSize?: number;
}

/**
 * Kysera plugin configuration
 */
export interface KyseraPluginConfig {
  plugin: string | KyseraPlugin;
  options?: Record<string, unknown>;
}

/**
 * Plugin configuration (kept for backward compatibility)
 */
export interface PluginsConfiguration {
  manager?: {
    validatePlugins?: boolean;
    autoDiscover?: boolean;
    pluginDirectories?: string[];
    pluginPattern?: string;
    enableMetrics?: boolean;
    loadTimeout?: number;
    initTimeout?: number;
  };
  builtIn?: {
    softDelete?: boolean | Record<string, unknown>;
    timestamps?: boolean | Record<string, unknown>;
    audit?: boolean | Record<string, unknown>;
  };
  custom?: Array<{
    name?: string;
    plugin: string | KyseraPlugin;
    options?: Record<string, unknown>;
    enabled?: boolean;
    priority?: number;
    connections?: string[];
    tables?: string[];
  }>;
}

/**
 * Main database module configuration options
 */
export interface DatabaseModuleOptions {
  connection?: DatabaseConnection;
  connections?: Record<string, DatabaseConnection>;
  kysera?: {
    core?: KyseraCoreOptions;
    repository?: KyseraRepositoryOptions;
    plugins?: Array<string | KyseraPlugin | KyseraPluginConfig>;
  };
  plugins?: PluginsConfiguration;
  /**
   * NOT IMPLEMENTED — nothing reads this group.
   *
   * Transactions are started by `runInTransaction(db, fn, options)`, whose own
   * option type accepts `name`, `connectionName` and `retry` and nothing else.
   * So a caller who sets `defaultIsolationLevel: 'serializable'` here gets the
   * database's default level, and `useSavepoints` and the retry settings are
   * equally inert. This matters more than the other dead options in this file:
   * an isolation level that is configured and not applied is a correctness
   * promise that silently is not kept.
   *
   * Kept so existing configurations still type-check.
   */
  transactionOptions?: {
    defaultIsolationLevel?: TransactionIsolationLevel;
    defaultTimeout?: number;
    retryAttempts?: number;
    retryDelay?: 'exponential' | 'linear' | number;
    initialRetryDelay?: number;
    maxRetryDelay?: number;
    useSavepoints?: boolean;
    logging?: boolean;
  };
  /**
   * NOT IMPLEMENTED — nothing reads this group.
   *
   * Migrations run through @kysera/migrations and the kysera CLI; the module
   * stopped applying them in DI. `createMigrationRunner()` takes its own
   * arguments and does not consult these.
   */
  migrations?: {
    tableName?: string;
    lockTableName?: string;
    directory?: string;
    pattern?: string;
    useTimestamp?: boolean;
    defaultTimeout?: number;
    validateChecksums?: boolean;
    transactional?: boolean;
  };
  rls?: {
    enabled: boolean;
    /**
     * Conditional policy activation inputs, passed to rlsPlugin (kysera
     * 0.10+): environment for whenEnvironment gates (default NODE_ENV),
     * feature flags for whenFeature, static activation metadata.
     */
    activation?: {
      environment?: string;
      features?: string[] | Record<string, unknown>;
      meta?: Record<string, unknown>;
    };
    /**
     * Upper bound for per-row value-policy checks on bulk mutations
     * (kysera 0.10+ enforces value policies on bulkUpdate/bulkDelete).
     * @default 1000
     */
    maxBulkRowChecks?: number;
  };
  circuitBreaker?: {
    enabled?: boolean;
    threshold?: number;
    resetTimeMs?: number;
  };
  defaultSchema?: string;
  camelCase?: boolean;
  isGlobal?: boolean;
  /** NOT IMPLEMENTED — nothing reads this; the module never auto-migrates. */
  autoMigrate?: boolean;
  /** NOT IMPLEMENTED — nothing reads this; see `autoMigrate`. */
  failOnMigrationError?: boolean;
  healthCheck?: boolean;
  /** Bounds closeAll(): after this many ms it stops waiting on connections
   *  whose destroy() has not settled and logs which ones they were. */
  shutdownTimeout?: number;
  /**
   * NOT IMPLEMENTED — nothing reads this. There is no entry point to apply it
   * to: `runInTransaction` takes `RunInTransactionOptions`, which has no
   * isolation level (see the note on `TransactionOptions`).
   */
  defaultIsolationLevel?: TransactionIsolationLevel;
  /** NOT IMPLEMENTED — nothing reads this. Kysely has no dialect-independent
   *  query timeout; per-dialect it is a server setting (PostgreSQL
   *  `statement_timeout`, MySQL `MAX_EXECUTION_TIME`), so it would have to be
   *  applied at pool-connection level, not here. */
  queryTimeout?: number;
  /** NOT IMPLEMENTED — nothing reads this; see `queryTimeout`. */
  statementTimeout?: number;
  logger?: import('./database.internal-types.js').Logger;
}

/**
 * Async options for module initialization
 */
export interface DatabaseModuleAsyncOptions {
  imports?: Array<Constructor<unknown> | IModule | DynamicModule>;
  inject?: Array<InjectionToken<unknown>>;
  useFactory?: (...args: unknown[]) => Promise<DatabaseModuleOptions> | DatabaseModuleOptions;
  useExisting?: Constructor<DatabaseOptionsFactory>;
  useClass?: Constructor<DatabaseOptionsFactory>;
  isGlobal?: boolean;
}

/**
 * Factory interface for creating database options
 */
export interface DatabaseOptionsFactory {
  createDatabaseOptions(): Promise<DatabaseModuleOptions> | DatabaseModuleOptions;
}

export type TransactionIsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

/**
 * NOT USED — exported, but no function in this package accepts it.
 *
 * The transaction entry point is `runInTransaction`, which takes
 * `RunInTransactionOptions` (name, connectionName, retry). Nothing consumes
 * the isolation level, timeout or savepoint flag declared here.
 */
export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  connection?: string;
  timeout?: number;
  retry?: { attempts?: number; delay?: number; backoff?: 'linear' | 'exponential' };
  useSavepoints?: boolean;
}

export interface RepositoryConfig<Entity = unknown> {
  table: string;
  connection?: string;
  softDelete?: boolean | { column?: string; includeDeleted?: boolean };
  timestamps?: boolean | { createdAt?: string; updatedAt?: string };
  audit?: boolean | { table?: string; captureOldValues?: boolean; captureNewValues?: boolean };

  /**
   * NOT IMPLEMENTED — the six fields below.
   *
   * `@Repository` stores the whole config under one metadata key, but the only
   * fields read back out of it are `table` and `connection`, in
   * `DatabaseModule.forFeature`, to pick the executor and construct the
   * repository. `softDelete`, `timestamps` and `audit` work because the
   * decorator re-publishes them under their own metadata keys, where the
   * kysera plugin wiring looks for them.
   *
   * Nothing validates against `schema` / `createSchema` / `updateSchema`,
   * nothing branches on `validate`, `getDecoratorPlugins()` derives its list
   * from the decorator flags rather than from `plugins`, and no row is passed
   * through `mapRow` — rows arrive exactly as the driver produced them.
   */
  schema?: z.ZodType;
  createSchema?: z.ZodType<unknown>;
  updateSchema?: z.ZodType<unknown>;
  validate?: boolean;
  plugins?: string[];
  mapRow?: (row: Record<string, unknown>) => Entity;
}

export interface MigrationStatus {
  executed: string[];
  pending: string[];
  lastExecuted?: { name: string; executedAt: Date };
}

/**
 * NOT USED — exported, but no function in this package accepts it.
 *
 * A leftover from when migrations were driven from inside the module. Reading
 * the exports, a caller would reasonably conclude that a migration API takes
 * `dryRun` and `lockTimeout`; there is no such API here.
 */
export interface MigrationOptions {
  connection?: string;
  dryRun?: boolean;
  timeout?: number;
  lockTimeout?: number;
  transactional?: boolean;
}

export interface DatabaseHealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  connections: Record<string, ConnectionHealthStatus>;
  migrations?: MigrationHealthStatus;
  metrics?: DatabaseMetrics;
  transactions?: TransactionHealthStatus;
}

export interface ConnectionHealthStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  latency?: number;
  pool?: { total: number; active: number; idle: number; waiting: number };
  error?: string;
}

export interface MigrationHealthStatus {
  upToDate: boolean;
  pendingCount: number;
  appliedCount?: number;
  currentVersion?: string;
  latestVersion?: string;
  lastMigration?: string;
  issues?: string[];
  error?: string;
}

export interface TransactionHealthStatus {
  total: number;
  committed: number;
  rolledBack: number;
  active: number;
  averageDuration: number;
  maxDuration: number;
  deadlockRetries: number;
  errors: number;
  nested: number;
}

export interface DatabaseMetrics {
  queryCount: number;
  slowQueryCount: number;
  errorCount: number;
  averageQueryTime: number;
  connectionCount: number;
  transactionCount: number;
  rollbackCount: number;
  queryLatencyP50?: number;
  queryLatencyP95?: number;
  queryLatencyP99?: number;
}

export interface PaginationOptions extends KyseraPaginationOptions {
  offset?: number;
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
}

export type PaginatedResult<T> = KyseraPaginatedResult<T>;
export type { KyseraCursorOptions as CursorOptions };

export const DatabaseEventType = {
  CONNECTED: 'database.connected',
  DISCONNECTED: 'database.disconnected',
  ERROR: 'database.error',
  MIGRATION_STARTED: 'database.migration.started',
  MIGRATION_COMPLETED: 'database.migration.completed',
  MIGRATION_FAILED: 'database.migration.failed',
  QUERY_EXECUTED: 'database.query.executed',
  SLOW_QUERY: 'database.query.slow',
  TRANSACTION_STARTED: 'database.transaction.started',
  TRANSACTION_COMMITTED: 'database.transaction.committed',
  TRANSACTION_ROLLED_BACK: 'database.transaction.rolledback',
} as const;

export type DatabaseEventType = (typeof DatabaseEventType)[keyof typeof DatabaseEventType];

export interface DatabaseEvent<T = unknown> {
  type: DatabaseEventType;
  connection?: string;
  timestamp: Date;
  data?: T;
  error?: Error;
}

export interface IDatabaseEventEmitter {
  emit(event: string, data?: unknown): Promise<void> | void;
}

export interface QueryContext {
  sql: string;
  params?: unknown[];
  duration?: number;
  connection?: string;
  transaction?: boolean;
}

export interface IRepository<Entity, CreateInput = Partial<Entity>, UpdateInput = Partial<Entity>> {
  readonly tableName: string;
  readonly connection: string;
  findAll(options?: PaginationOptions): Promise<Entity[]>;
  findById(id: number | string): Promise<Entity | null>;
  findOne(conditions: Partial<Entity>): Promise<Entity | null>;
  create(data: CreateInput): Promise<Entity>;
  update(id: number | string, data: UpdateInput): Promise<Entity>;
  delete(id: number | string): Promise<void>;
  createMany(data: CreateInput[]): Promise<Entity[]>;
  updateMany(conditions: Partial<Entity>, data: UpdateInput): Promise<number>;
  deleteMany(conditions: Partial<Entity>): Promise<number>;
  query(): Kysely<unknown>;
  withTransaction(trx: Transaction<unknown>): IRepository<Entity, CreateInput, UpdateInput>;
}

export interface IMigration {
  up(db: Kysely<unknown>): Promise<void>;
  down?(db: Kysely<unknown>): Promise<void>;
}

export interface IDatabaseManager {
  logger?: ILogger;
  getConnection(name?: string): Promise<Kysely<unknown>>;
  getPool(name?: string): Pool | mysql.Pool | Database | undefined;
  close(name?: string): Promise<void>;
  closeAll(): Promise<void>;
  isConnected(name?: string): boolean;
  getConnectionNames(): string[];
  getConnectionConfig(name?: string): DatabaseConnection | undefined;
}
