/**
 * Database Module for Titan Framework
 *
 * Minimal DI wrapper around Kysera:
 * - DatabaseManager creates Kysely instances from config
 * - AsyncLocalStorage transaction context (runInTransaction, getExecutor)
 * - TransactionAwareRepository base class
 * - Re-exports from @kysera packages
 *
 * @module @omnitron-dev/titan/module/database
 */

// ============================================================================
// Module
// ============================================================================

export { TitanDatabaseModule, DatabaseModule } from './database.module.js';

// ============================================================================
// Core Services
// ============================================================================

export { DatabaseManager } from './database.manager.js';
export { DatabaseHealthIndicator } from './database.health.js';

// ============================================================================
// Repository (Golden Path)
// ============================================================================

export { TransactionAwareRepository } from './repository/transaction-aware.repository.js';
export type {
  Executor as RepositoryExecutor,
  FindManyOptions,
  ListOptions,
  OffsetPaginatedResult,
  CursorOptions,
  CursorResult,
} from './repository/transaction-aware.repository.js';

// @kysera/repository re-exports
export {
  applyWhereClause,
  applyCondition,
  isOperatorObject,
  isValidOperator,
  validateOperators,
  extractColumns,
  InvalidOperatorError,
} from '@kysera/repository';
export type {
  WhereClause,
  FieldOperators,
  ComparisonOperators,
  ArrayOperators,
  StringOperators,
  NullOperators,
  RangeOperator,
  ConditionValue,
  FindOptions as OperatorFindOptions,
  SortSpec,
} from '@kysera/repository';

export { validateColumnNames, validateConditions, getAllowedColumnsFromPkConfig } from '@kysera/repository';
export type { ColumnValidationOptions } from '@kysera/repository';

// ============================================================================
// Transaction (Golden Path)
// ============================================================================

export {
  AutoTransactional,
  runInTransaction,
  runWithTransaction,
  getTransactionContext,
  getCurrentTransaction,
  isInTransactionContext,
  getExecutor,
  registerTablePlugins,
  getTablePlugins,
  clearPluginRegistry,
} from './transaction/transaction.context.js';
export type { TransactionContextData } from './transaction/transaction.context.js';

// ============================================================================
// Decorators
// ============================================================================

export {
  Repository,
  Migration,
  SoftDelete,
  Timestamps,
  Audit,
  InjectConnection,
  InjectDatabaseManager,
  InjectRepository,
  Policy,
  Allow,
  Deny,
  Filter,
  BypassRLS,
  hasSoftDelete,
  getSoftDeleteConfig,
  hasTimestamps,
  getTimestampsConfig,
  hasAudit,
  getAuditConfig,
  getDecoratorPlugins,
  getRepositoryMetadata,
  isRepository,
  getMigrationMetadata,
  isMigration,
  isRLSEnabled,
  getRLSPolicyMetadata,
  getRLSAllowRules,
  getRLSDenyRules,
  getRLSFilters,
  getRLSBypassedMethods,
} from './database.decorators.js';

export type {
  SoftDeleteConfig,
  TimestampsConfig,
  AuditConfig,
  RLSPolicyConfig,
  RLSRuleConfig,
  RLSFilterConfig,
} from './database.decorators.js';

// ============================================================================
// DI Tokens
// ============================================================================

export {
  DATABASE_HEALTH_INDICATOR,
  DATABASE_DEFAULT_CONNECTION,
  DATABASE_MANAGER,
  DATABASE_MODULE_OPTIONS,
  DATABASE_CONNECTION,
  getDatabaseConnectionToken,
  getRepositoryToken,
} from './database.constants.js';

// ============================================================================
// Constants
// ============================================================================

export {
  DEFAULT_POOL_CONFIG,
  DEFAULT_TIMEOUTS,
} from './database.constants.js';

// ============================================================================
// Types
// ============================================================================

export type {
  DatabaseDialect,
  ConnectionConfig,
  PoolConfig,
  DatabaseConnection,
  DatabaseModuleOptions,
  DatabaseModuleAsyncOptions,
  DatabaseOptionsFactory,
  TransactionOptions,
  MigrationOptions,
  MigrationStatus,
  DatabaseHealthCheckResult,
  ConnectionHealthStatus,
  MigrationHealthStatus,
  TransactionHealthStatus,
  DatabaseMetrics,
  PaginationOptions,
  PaginatedResult,
  CursorOptions as CursorPaginationOptions,
  DatabaseEvent,
  DatabaseEventType,
  QueryContext,
  IDatabaseEventEmitter,
  IDatabaseManager,
  KyseraCoreOptions,
  KyseraRepositoryOptions,
  KyseraPluginConfig,
  PluginsConfiguration,
} from './database.types.js';

export { DatabaseEventType as DatabaseEvents } from './database.types.js';

// ============================================================================
// Kysely Re-exports (Essential)
// ============================================================================

export type { Kysely, Transaction, Selectable, Insertable, Updateable } from 'kysely';
export { sql } from 'kysely';

// ============================================================================
// @kysera/core - Error Handling and Pagination
// ============================================================================

export {
  parseDatabaseError,
  DatabaseError as KyseraDatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  NotFoundError as KyseraNotFoundError,
  BadRequestError as KyseraBadRequestError,
  NotNullError,
  ErrorCodes,
  paginate,
  paginateCursor,
  applyOffset,
  applyDateRange,
  executeCount,
} from '@kysera/core';

// ============================================================================
// @kysera/infra - Resilience
// ============================================================================

export { withRetry, CircuitBreaker, isTransientError } from '@kysera/infra';
export { HealthMonitor, checkDatabaseHealth, performHealthCheck } from '@kysera/infra';
export type {
  RetryOptions,
  CircuitBreakerOptions,
  CircuitBreakerState,
  CircuitState,
  HealthMonitorOptions,
  HealthCheckOptions,
  HealthCheckResult,
  HealthStatus,
  HealthCheckCallback,
} from '@kysera/infra';

// ============================================================================
// @kysera/repository - Utilities
// ============================================================================

export {
  upsert,
  upsertMany,
  atomicStatusTransition,
  ContextAwareRepository,
  ContextAwareRepository as BaseRepository,
} from '@kysera/repository';
export type { UpsertOptions, StatusTransitionOptions, Plugin as KyseraPlugin } from '@kysera/repository';

// ============================================================================
// @kysera/executor - Plugin System
// ============================================================================

export {
  createExecutor,
  createExecutorSync,
  isKyseraExecutor,
  getPlugins as getExecutorPlugins,
  getRawDb,
  wrapTransaction,
  applyPlugins,
  validatePlugins as validateExecutorPlugins,
  resolvePluginOrder,
  PluginValidationError,
} from '@kysera/executor';

export type {
  Plugin as ExecutorPlugin,
  KyseraExecutor,
  KyseraTransaction,
  ExecutorConfig,
  BaseRepositoryLike,
} from '@kysera/executor';

// ============================================================================
// @kysera Plugins
// ============================================================================

export { softDeletePlugin } from '@kysera/soft-delete';
export type { SoftDeleteOptions } from '@kysera/soft-delete';

export { timestampsPlugin } from '@kysera/timestamps';
export type { TimestampsOptions } from '@kysera/timestamps';

export { auditPlugin } from '@kysera/audit';
export type { AuditOptions } from '@kysera/audit';

// ============================================================================
// @kysera/rls - Row-Level Security
// ============================================================================

export { defineRLSSchema, allow, deny, filter, rlsPlugin } from '@kysera/rls';
export type { RLSPluginOptions, RLSSchema, TableRLSConfig } from '@kysera/rls';

// ============================================================================
// Sub-module Re-exports
// ============================================================================

// Plugins
export * from './exports/plugins.js';

// Migration — use @kysera/migrations directly + kysera CLI
// Re-export kept for backward compatibility only
export * from './exports/migration.js';

// Dialects
export {
  getAdapter,
  createDialectAdapter,
  PostgresAdapter,
  MySQLAdapter,
  SQLiteAdapter,
  postgresAdapter,
  mysqlAdapter,
  sqliteAdapter,
  parseConnectionUrl,
  buildConnectionUrl,
  getDefaultPort,
  tableExists,
  getTableColumns,
  getTables,
  escapeIdentifier,
  formatDate,
} from '@kysera/dialects';

export type { DialectAdapter } from '@kysera/dialects';

// ============================================================================
// UUIDv7
// ============================================================================

export { UUID_V7_DEFAULT, createUuidV7Function, dropUuidV7Function } from './uuid-v7.js';
