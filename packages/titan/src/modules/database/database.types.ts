/**
 * Database Module Type Definitions
 *
 * Comprehensive type system for Titan Database Module with Kysera ORM integration
 */

import type { Kysely, Transaction } from 'kysely';
import type { Plugin as KyseraPlugin } from '@kysera/repository';
import type { z } from 'zod';
import type { Pool } from 'pg';
import type * as mysql from 'mysql2';
import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;

/**
 * Database dialect types supported by the module
 */
export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite';

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
  /**
   * Optional name for the connection (defaults to 'default')
   */
  name?: string;

  /**
   * Database dialect
   */
  dialect: DatabaseDialect;

  /**
   * Connection string or configuration object
   */
  connection: string | ConnectionConfig;

  /**
   * Connection pool configuration
   */
  pool?: PoolConfig;

  /**
   * Enable debug mode for SQL logging
   */
  debug?: boolean;

  /**
   * Plugins to apply to this connection
   */
  plugins?: string[];

  /**
   * Migration directory for this connection
   */
  migrationsPath?: string;

  /**
   * Seeds directory for this connection
   */
  seedsPath?: string;
}

/**
 * Kysera Core configuration options
 */
export interface KyseraCoreOptions {
  /**
   * Enable debug mode
   */
  debug?: boolean;

  /**
   * Health check configuration
   */
  healthCheck?: {
    enabled?: boolean;
    interval?: number;
    timeout?: number;
  };

  /**
   * Pagination defaults
   */
  pagination?: {
    defaultLimit?: number;
    maxLimit?: number;
  };

  /**
   * Error handling configuration
   */
  errorHandling?: {
    parseDbErrors?: boolean;
    throwOnNotFound?: boolean;
  };
}

/**
 * Kysera Repository configuration options
 */
export interface KyseraRepositoryOptions {
  /**
   * Enable validation of database results
   */
  validateDbResults?: boolean;

  /**
   * Validation strategy
   */
  validationStrategy?: 'none' | 'strict';

  /**
   * Default batch size for bulk operations
   */
  batchSize?: number;
}

/**
 * Kysera plugin configuration
 */
export interface KyseraPluginConfig {
  /**
   * Plugin name or instance
   */
  plugin: string | KyseraPlugin;

  /**
   * Plugin options
   */
  options?: Record<string, any>;
}

/**
 * Plugin configuration
 */
export interface PluginsConfiguration {
  /**
   * Plugin manager options
   */
  manager?: {
    validatePlugins?: boolean;
    autoDiscover?: boolean;
    pluginDirectories?: string[];
    pluginPattern?: string;
    enableMetrics?: boolean;
    loadTimeout?: number;
    initTimeout?: number;
  };

  /**
   * Built-in plugins configuration
   */
  builtIn?: {
    softDelete?: boolean | Record<string, any>;
    timestamps?: boolean | Record<string, any>;
    audit?: boolean | Record<string, any>;
  };

  /**
   * Custom plugins
   */
  custom?: Array<{
    name?: string;
    plugin: string | any;
    options?: Record<string, any>;
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
  /**
   * Default connection configuration
   */
  connection?: DatabaseConnection;

  /**
   * Multiple named connections
   */
  connections?: Record<string, DatabaseConnection>;

  /**
   * Kysera integration configuration
   */
  kysera?: {
    core?: KyseraCoreOptions;
    repository?: KyseraRepositoryOptions;
    plugins?: Array<string | KyseraPlugin | KyseraPluginConfig>;
  };

  /**
   * Plugin system configuration
   */
  plugins?: PluginsConfiguration;

  /**
   * Transaction configuration
   */
  transactionOptions?: {
    /**
     * Default isolation level
     */
    defaultIsolationLevel?: TransactionIsolationLevel;
    /**
     * Default timeout for transactions
     */
    defaultTimeout?: number;
    /**
     * Number of retry attempts for deadlocks
     */
    retryAttempts?: number;
    /**
     * Retry delay strategy
     */
    retryDelay?: 'exponential' | 'linear' | number;
    /**
     * Initial retry delay in ms
     */
    initialRetryDelay?: number;
    /**
     * Maximum retry delay in ms
     */
    maxRetryDelay?: number;
    /**
     * Use savepoints for nested transactions
     */
    useSavepoints?: boolean;
    /**
     * Enable transaction logging
     */
    logging?: boolean;
  };

  /**
   * Migration configuration
   */
  migrations?: {
    /**
     * Migration table name
     */
    tableName?: string;
    /**
     * Lock table name
     */
    lockTableName?: string;
    /**
     * Directory containing migration files
     */
    directory?: string;
    /**
     * File pattern for migrations
     */
    pattern?: string;
    /**
     * Use timestamps in version
     */
    useTimestamp?: boolean;
    /**
     * Default timeout for migrations (ms)
     */
    defaultTimeout?: number;
    /**
     * Validate checksums
     */
    validateChecksums?: boolean;
    /**
     * Use transactions by default
     */
    transactional?: boolean;
  };

  /**
   * Make module globally available
   */
  isGlobal?: boolean;

  /**
   * Auto-run migrations on startup
   */
  autoMigrate?: boolean;

  /**
   * Enable health checks
   */
  healthCheck?: boolean;

  /**
   * Graceful shutdown timeout in milliseconds
   */
  shutdownTimeout?: number;

  /**
   * Default transaction isolation level
   */
  defaultIsolationLevel?: TransactionIsolationLevel;

  /**
   * Query timeout in milliseconds
   */
  queryTimeout?: number;

  /**
   * Statement timeout in milliseconds (database-specific)
   */
  statementTimeout?: number;
}

/**
 * Async options for module initialization
 */
export interface DatabaseModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory?: (...args: any[]) => Promise<DatabaseModuleOptions> | DatabaseModuleOptions;
  useExisting?: new () => DatabaseOptionsFactory;
  useClass?: new () => DatabaseOptionsFactory;
  isGlobal?: boolean;
}

/**
 * Factory interface for creating database options
 */
export interface DatabaseOptionsFactory {
  createDatabaseOptions(): Promise<DatabaseModuleOptions> | DatabaseModuleOptions;
}

/**
 * Transaction isolation levels
 */
export type TransactionIsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

/**
 * Transaction options
 */
export interface TransactionOptions {
  /**
   * Isolation level for the transaction
   */
  isolationLevel?: TransactionIsolationLevel;

  /**
   * Connection name to use for transaction
   */
  connection?: string;

  /**
   * Transaction timeout in milliseconds
   */
  timeout?: number;

  /**
   * Retry configuration for deadlocks
   */
  retry?: {
    attempts?: number;
    delay?: number;
    backoff?: 'linear' | 'exponential';
  };

  /**
   * Whether to use savepoints for nested transactions
   */
  useSavepoints?: boolean;
}

/**
 * Repository configuration
 */
export interface RepositoryConfig<Entity = any> {
  /**
   * Table name in database
   */
  table: string;

  /**
   * Connection name (defaults to 'default')
   */
  connection?: string;

  /**
   * Entity schema for validation
   */
  schema?: z.ZodType<Entity>;

  /**
   * Create schema for validation
   */
  createSchema?: z.ZodType;

  /**
   * Update schema for validation
   */
  updateSchema?: z.ZodType;

  /**
   * Enable validation
   */
  validate?: boolean;

  /**
   * Plugins to apply to this repository
   */
  plugins?: string[];

  /**
   * Custom row mapper
   */
  mapRow?: (row: any) => Entity;

  /**
   * Soft delete configuration
   */
  softDelete?:
    | boolean
    | {
        column?: string;
        includeDeleted?: boolean;
      };

  /**
   * Timestamps configuration
   */
  timestamps?:
    | boolean
    | {
        createdAt?: string;
        updatedAt?: string;
      };

  /**
   * Audit configuration
   */
  audit?:
    | boolean
    | {
        table?: string;
        captureOldValues?: boolean;
        captureNewValues?: boolean;
      };
}

/**
 * Migration status
 */
export interface MigrationStatus {
  /**
   * List of executed migration names
   */
  executed: string[];

  /**
   * List of pending migration names
   */
  pending: string[];

  /**
   * Last executed migration
   */
  lastExecuted?: {
    name: string;
    executedAt: Date;
  };
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /**
   * Connection name to use for migrations
   */
  connection?: string;

  /**
   * Enable dry run mode
   */
  dryRun?: boolean;

  /**
   * Migration timeout in milliseconds
   */
  timeout?: number;

  /**
   * Lock timeout for concurrent migration prevention
   */
  lockTimeout?: number;

  /**
   * Transaction mode for migrations
   */
  transactional?: boolean;
}

/**
 * Database health check result
 */
export interface DatabaseHealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  connections: Record<string, ConnectionHealthStatus>;
  migrations?: MigrationHealthStatus;
  metrics?: DatabaseMetrics;
  transactions?: TransactionHealthStatus;
}

/**
 * Individual connection health status
 */
export interface ConnectionHealthStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  latency?: number;
  pool?: {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  };
  error?: string;
}

/**
 * Migration health status
 */
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

/**
 * Transaction health status
 */
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

/**
 * Database performance metrics
 */
export interface DatabaseMetrics {
  queryCount: number;
  slowQueryCount: number;
  errorCount: number;
  averageQueryTime: number;
  connectionCount: number;
  transactionCount: number;
  rollbackCount: number;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  page?: number;
  limit?: number;
  offset?: number;
  cursor?: string;
  orderBy?: Array<{
    column: string;
    direction: 'asc' | 'desc';
  }>;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page?: number;
    limit: number;
    offset?: number;
    total?: number;
    totalPages?: number;
    hasMore?: boolean;
    nextCursor?: string;
    prevCursor?: string;
  };
}

/**
 * Database event types
 */
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

/**
 * Database event payload
 */
export interface DatabaseEvent<T = any> {
  type: DatabaseEventType;
  connection?: string;
  timestamp: Date;
  data?: T;
  error?: Error;
}

/**
 * Query execution context
 */
export interface QueryContext {
  sql: string;
  params?: any[];
  duration?: number;
  connection?: string;
  transaction?: boolean;
}

/**
 * Repository base interface
 */
export interface IRepository<Entity, CreateInput = any, UpdateInput = any> {
  readonly tableName: string;
  readonly connection: string;

  // Basic CRUD operations
  findAll(options?: PaginationOptions): Promise<Entity[]>;
  findById(id: number | string): Promise<Entity | null>;
  findOne(conditions: Partial<Entity>): Promise<Entity | null>;
  create(data: CreateInput): Promise<Entity>;
  update(id: number | string, data: UpdateInput): Promise<Entity>;
  delete(id: number | string): Promise<void>;

  // Bulk operations
  createMany(data: CreateInput[]): Promise<Entity[]>;
  updateMany(conditions: Partial<Entity>, data: UpdateInput): Promise<number>;
  deleteMany(conditions: Partial<Entity>): Promise<number>;

  // Query builder access
  query(): any; // Returns Kysely query builder

  // Transaction support
  withTransaction(trx: Transaction<any>): IRepository<Entity, CreateInput, UpdateInput>;
}

/**
 * Migration interface
 */
export interface IMigration {
  up(db: Kysely<any>): Promise<void>;
  down?(db: Kysely<any>): Promise<void>;
}

/**
 * Database manager interface
 */
export interface IDatabaseManager {
  getConnection(name?: string): Promise<Kysely<any>>;
  getPool(name?: string): Pool | mysql.Pool | Database | undefined;
  close(name?: string): Promise<void>;
  closeAll(): Promise<void>;
  isConnected(name?: string): boolean;
  getConnectionNames(): string[];
  getConnectionConfig(name?: string): DatabaseConnection | undefined;
}
