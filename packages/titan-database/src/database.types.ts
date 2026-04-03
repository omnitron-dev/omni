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
  rls?: { enabled: boolean };
  circuitBreaker?: {
    enabled?: boolean;
    threshold?: number;
    resetTimeMs?: number;
  };
  defaultSchema?: string;
  camelCase?: boolean;
  isGlobal?: boolean;
  autoMigrate?: boolean;
  failOnMigrationError?: boolean;
  healthCheck?: boolean;
  shutdownTimeout?: number;
  defaultIsolationLevel?: TransactionIsolationLevel;
  queryTimeout?: number;
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
  schema?: z.ZodType;
  createSchema?: z.ZodType<unknown>;
  updateSchema?: z.ZodType<unknown>;
  validate?: boolean;
  plugins?: string[];
  mapRow?: (row: Record<string, unknown>) => Entity;
  softDelete?: boolean | { column?: string; includeDeleted?: boolean };
  timestamps?: boolean | { createdAt?: string; updatedAt?: string };
  audit?: boolean | { table?: string; captureOldValues?: boolean; captureNewValues?: boolean };
}

export interface MigrationStatus {
  executed: string[];
  pending: string[];
  lastExecuted?: { name: string; executedAt: Date };
}

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

export enum DatabaseEventType {
  CONNECTED = 'database.connected',
  DISCONNECTED = 'database.disconnected',
  ERROR = 'database.error',
  MIGRATION_STARTED = 'database.migration.started',
  MIGRATION_COMPLETED = 'database.migration.completed',
  MIGRATION_FAILED = 'database.migration.failed',
  QUERY_EXECUTED = 'database.query.executed',
  SLOW_QUERY = 'database.query.slow',
  TRANSACTION_STARTED = 'database.transaction.started',
  TRANSACTION_COMMITTED = 'database.transaction.committed',
  TRANSACTION_ROLLED_BACK = 'database.transaction.rolledback',
}

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
