/**
 * Database Module Public API
 *
 * Exports all public components of the database module
 */

// Main module
export { TitanDatabaseModule } from './database.module.js';

// Module alias for consistent naming (preferred)
import { TitanDatabaseModule } from './database.module.js';

/**
 * Alias for TitanDatabaseModule for consistent naming convention.
 * Recommended: Use `DatabaseModule` for consistency with other modules.
 */
export { TitanDatabaseModule as DatabaseModule };

// Core services
export { DatabaseManager } from './database.manager.js';
export { DatabaseService } from './database.service.js';
export { DatabaseHealthIndicator } from './database.health.js';

// Types
export type {
  // Configuration
  DatabaseDialect,
  ConnectionConfig,
  PoolConfig,
  DatabaseConnection,
  DatabaseModuleOptions,
  DatabaseModuleAsyncOptions,
  DatabaseOptionsFactory,

  // Kysera integration
  KyseraCoreOptions,
  KyseraRepositoryOptions,
  KyseraPluginConfig,

  // Repository
  RepositoryConfig,
  IRepository,

  // Migration
  MigrationOptions,

  // Health
  DatabaseHealthCheckResult,
  ConnectionHealthStatus,
  MigrationHealthStatus,
  DatabaseMetrics,

  // Pagination
  PaginationOptions,
  PaginatedResult,

  // Events
  DatabaseEvent,
  QueryContext,
} from './database.types.js';

// Export Manager interface separately for runtime compatibility
export type { IDatabaseManager } from './database.types.js';

// Re-export event type enum
export { DatabaseEventType } from './database.types.js';

// Constants
export {
  DATABASE_SERVICE,
  DATABASE_HEALTH_INDICATOR,
  DATABASE_DEFAULT_CONNECTION,
  DATABASE_MANAGER,
  DATABASE_MODULE_OPTIONS,
  DATABASE_CONNECTION,
  DATABASE_PLUGIN_MANAGER,
  DATABASE_TRANSACTION_MANAGER,
  DATABASE_TRANSACTION_SCOPE_FACTORY,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_MIGRATION_RUNNER,
  DATABASE_MIGRATION_LOCK,
  DATABASE_REPOSITORY_FACTORY,
  DATABASE_TESTING_SERVICE,
  DATABASE_RLS_PLUGIN,
  DATABASE_RLS_CONTEXT,
  getDatabaseConnectionToken,
  getRepositoryToken,
  DEFAULT_POOL_CONFIG,
  DEFAULT_PAGINATION,
  DEFAULT_TIMEOUTS,
  BUILT_IN_PLUGINS,
  MIGRATIONS_TABLE,
  MIGRATIONS_LOCK_TABLE,
  AUDIT_TABLE,
  DATABASE_EVENTS,
  ERROR_MESSAGES,
} from './database.constants.js';

// Decorators
export {
  InjectConnection,
  InjectDatabaseManager,
  InjectRepository,
  Repository,
  Migration,
  Transactional,
  Paginated,
  UseConnection,
  Query,
  // Plugin decorators
  SoftDelete,
  Timestamps,
  Audit,
  // Plugin decorator metadata helpers
  hasSoftDelete,
  getSoftDeleteConfig,
  hasTimestamps,
  getTimestampsConfig,
  hasAudit,
  getAuditConfig,
  getDecoratorPlugins,
  // Repository metadata helpers
  getRepositoryMetadata,
  isRepository,
  getMigrationMetadata,
  isMigration,
  // RLS decorators
  Policy,
  Allow,
  Deny,
  Filter,
  BypassRLS,
  getRLSPolicyMetadata,
  getRLSAllowRules,
  getRLSDenyRules,
  getRLSFilters,
  getRLSBypassedMethods,
  isRLSEnabled,
} from './database.decorators.js';

// Plugin decorator config types
export type {
  SoftDeleteConfig,
  TimestampsConfig,
  AuditConfig,
} from './database.decorators.js';

// RLS decorator types
export type {
  RLSPolicyConfig,
  RLSRuleConfig,
  RLSFilterConfig,
} from './database.decorators.js';

// Repository
export { BaseRepository } from './repository/base.repository.js';
export { RepositoryFactory, createMultiRepositoryFactory } from './repository/repository.factory.js';
export type {
  IBaseRepository,
  Repository as IRepositoryInterface,
  RepositoryConfig as RepositoryConfiguration,
  FindOptions,
  RepositoryMetadata,
  RepositoryTransactionScope,
  RepositoryFactoryConfig,
} from './repository/repository.types.js';

// Migration
export { MigrationService } from './migration/migration.service.js';
export { MigrationRunner } from './migration/migration.runner.js';
export { MigrationProvider } from './migration/migration.provider.js';
export { MigrationLock } from './migration/migration.lock.js';

// Export IMigration separately for runtime compatibility
export type { IMigration } from './migration/migration.types.js';

export type {
  MigrationMetadata,
  AppliedMigration,
  MigrationStatus,
  MigrationRunOptions,
  MigrationDownOptions,
  MigrationResult,
  MigrationConfig,
  IMigrationProvider,
  IMigrationLock,
  MigrationEvent,
} from './migration/migration.types.js';
export { MigrationEventType } from './migration/migration.types.js';

// Transaction
export { TransactionManager } from './transaction/transaction.manager.js';
export { TransactionScope, TransactionScopeFactory } from './transaction/transaction.scope.js';
export { InjectTransactionScope, RequiresTransactionScope } from './transaction/transaction.scope.js';
export type {
  ITransactionManager,
  TransactionOptions,
  TransactionContext,
  TransactionStatistics,
  ITransactionScope,
  TransactionEvent as TransactionEventData,
} from './transaction/transaction.types.js';
export {
  TransactionIsolationLevel,
  TransactionPropagation,
  TransactionState,
  TransactionEventType,
} from './transaction/transaction.types.js';

// Plugin system
export { PluginManager } from './plugins/plugin.manager.js';
export { PluginLoader } from './plugins/plugin.loader.js';
export type {
  ITitanPlugin,
  IPluginManager,
  IPluginLoader,
  IPluginLifecycle,
  PluginConfig,
  PluginManagerOptions,
  PluginMetadata,
  PluginRegistryEntry,
  PluginState,
  PluginMetrics,
  PluginEventType,
  PluginEvent,
  BuiltInPlugin,
  PluginFactory,
  ICache,
} from './plugins/plugin.types.js';

// Export example plugins
export { optimisticLockingPlugin } from './plugins/examples/optimistic-locking.plugin.js';
export { validationPlugin, createValidationPlugin, CommonSchemas } from './plugins/examples/validation.plugin.js';
export { cachingPlugin, MemoryCache, createRedisCache } from './plugins/examples/caching.plugin.js';

// Testing
export { DatabaseTestingModule, DatabaseTestingService } from './testing/database-testing.module.js';
export type { DatabaseTestingOptions } from './testing/database-testing.module.js';
export {
  isDockerAvailable,
  createTestDatabase,
  withTestDatabase,
  createTestDatabaseConfigs,
  cleanupTestDatabaseConfigs,
  getRecommendedTestDatabase,
} from './testing/test-utilities.js';
export type { DatabaseTestOptions, DatabaseTestContext } from './testing/test-utilities.js';

// Utilities
export {
  parseConnectionUrl,
  buildConnectionUrl,
  getDefaultPort,
  tableExists,
  getTableColumns,
  escapeIdentifier,
  getCurrentTimestamp,
  formatDate,
  isUniqueConstraintError,
  isForeignKeyError,
  isNotNullError,
  getDatabaseSize,
  truncateAllTables,
} from './database.utils.js';

// Re-export Kysely types for convenience
export type { Kysely, Transaction, Selectable, Insertable, Updateable, sql } from 'kysely';

// ============================================================================
// KYSERA RE-EXPORTS
// ============================================================================
// Re-export all useful @kysera/* utilities for tight integration

// @kysera/core - Error handling
export {
  parseDatabaseError,
  DatabaseError as KyseraDatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  NotFoundError as KyseraNotFoundError,
  BadRequestError as KyseraBadRequestError,
  NotNullError,
  CheckConstraintError,
} from '@kysera/core';

// @kysera/core - Error codes (unified error code system)
export {
  ErrorCodes,
  DatabaseErrorCodes,
  ValidationErrorCodes,
  ResourceErrorCodes,
  MigrationErrorCodes,
  PluginErrorCodes,
  AuditErrorCodes,
  ConfigErrorCodes,
  FileSystemErrorCodes,
  NetworkErrorCodes,
  isValidErrorCode,
  getErrorCategory,
  mapLegacyCode,
} from '@kysera/core';

export type {
  ErrorCode,
} from '@kysera/core';

// @kysera/core - Pagination
export {
  paginate,
  paginateCursor,
  paginateCursorSimple,
} from '@kysera/core';

export type {
  PaginationOptions as KyseraPaginationOptions,
  PaginatedResult as KyseraPaginatedResult,
  CursorOptions as KyseraCursorOptions,
} from '@kysera/core';

// @kysera/infra - Retry & Circuit Breaker (moved from @kysera/core in 0.7.0)
export {
  withRetry,
  createRetryWrapper,
  isTransientError,
  CircuitBreaker,
} from '@kysera/infra';

export type {
  RetryOptions,
} from '@kysera/infra';

// @kysera/testing - Testing utilities (moved from @kysera/core in 0.7.0)
export {
  testInTransaction,
  testWithSavepoints,
  testWithIsolation,
  cleanDatabase,
  seedDatabase,
  snapshotTable,
  countRows,
  waitFor,
  createFactory,
  createMany,
  createSequenceFactory,
} from '@kysera/testing';

export type {
  CleanupStrategy,
  IsolationLevel as KyseraIsolationLevel,
  FactoryFunction,
  FactoryDefaults,
  SeedFunction,
} from '@kysera/testing';

// Note: Debug & Profiling moved to @kysera/debug in 0.7.0
// Note: Health Monitoring moved to @kysera/infra in 0.7.0
// Import from those packages directly if needed

// @kysera/core - Type Utilities
export type {
  Executor,
  Timestamps as KyseraTimestamps,
  SoftDelete as KyseraSoftDelete,
  AuditFields as KyseraAuditFields,
} from '@kysera/core';

// @kysera/repository - Repository Factory
export {
  createRepositoryFactory as createKyseraRepositoryFactory,
  createSimpleRepository,
  createRepositoriesFactory,
} from '@kysera/repository';

export type {
  Plugin as KyseraPlugin,
  BaseRepository as KyseraBaseRepository,
  Repository as KyseraRepository,
  RepositoryConfig as KyseraRepositoryConfig,
  TableOperations,
} from '@kysera/repository';

// @kysera/repository - Validation
export {
  getValidationMode,
  shouldValidate,
  safeParse,
  createValidator,
} from '@kysera/repository';

export type {
  ValidationOptions,
} from '@kysera/repository';

// @kysera/repository - Plugin System
export {
  createORM,
  withPlugins,
} from '@kysera/repository';

export type {
  PluginOrm,
  QueryBuilderContext,
} from '@kysera/repository';

// ============================================================================
// @kysera/executor - Unified Execution Layer (NEW in 0.7.0)
// ============================================================================
// The executor provides a plugin-aware Kysely wrapper that enables plugins
// to work seamlessly with both Repository and DAL patterns through a single
// interception point. This is the foundation for unified plugin support.

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
  QueryBuilderContext as ExecutorQueryBuilderContext,
  ExecutorConfig,
  KyseraExecutorMarker,
  PluginValidationDetails,
  PluginValidationErrorType,
} from '@kysera/executor';

// ============================================================================
// @kysera/dal - Functional Data Access Layer (NEW in 0.7.0)
// ============================================================================
// DAL provides functional approach to database queries with plugin support.
// Works seamlessly with executors for automatic plugin interception.

export {
  createContext,
  withTransaction as dalWithTransaction,
  createQuery,
  createTransactionalQuery,
  compose,
  chain,
  parallel,
  conditional,
  mapResult,
  withContext,
  isInTransaction,
} from '@kysera/dal';

export type {
  DbContext,
  QueryFunction,
  TransactionOptions as DalTransactionOptions,
} from '@kysera/dal';

// ExecutorService - Titan's high-level executor management
export { ExecutorService } from './executor/index.js';
export type { ExecutorPluginConfig, CreateExecutorOptions } from './executor/index.js';

// @kysera/soft-delete
export { softDeletePlugin } from '@kysera/soft-delete';
export type {
  SoftDeleteOptions,
} from '@kysera/soft-delete';

// @kysera/timestamps
export { timestampsPlugin } from '@kysera/timestamps';
export type {
  TimestampsOptions,
} from '@kysera/timestamps';

// @kysera/audit
export { auditPlugin } from '@kysera/audit';
export type {
  AuditOptions,
} from '@kysera/audit';

// @kysera/migrations
export {
  createMigration,
  createMigrationRunner,
  setupMigrations,
  MigrationRunner as KyseraMigrationRunner,
} from '@kysera/migrations';

export type {
  Migration as KyseraMigration,
  MigrationWithMeta,
  MigrationStatus as KyseraMigrationStatus,
  MigrationRunnerOptions,
} from '@kysera/migrations';

// @kysera/rls - Row-Level Security
// ============================================================================
// RLS provides dual-layer security API:
//
// 1. FUNCTION API (for declarative schema definition):
//    Use rlsAllow/rlsDeny/rlsFilter/rlsValidate with defineRLSSchema()
//    Example: defineRLSSchema({ users: { policies: [rlsAllow(...)] } })
//
// 2. DECORATOR API (for repository class decoration):
//    Use @Policy, @Allow, @Deny, @Filter, @BypassRLS decorators
//    Example: @Repository({ table: 'users' }) @Policy() class UserRepository
//
// Note: Function names are prefixed with 'rls' to avoid conflicts with
// generic names (allow, deny, filter) that could clash with other modules.
// See: kysera-rls-spec.md Section 10 for detailed Titan Integration docs
// ============================================================================
export {
  // Schema definition
  defineRLSSchema,
  mergeRLSSchemas,
  // Policy builders
  allow as rlsAllow,
  deny as rlsDeny,
  filter as rlsFilter,
  validate as rlsValidate,
  // Plugin
  rlsPlugin,
  // Registry (for advanced use cases)
  PolicyRegistry,
  // Context management
  rlsContext,
  createRLSContext,
  withRLSContext,
  withRLSContextAsync,
  // Utilities
  createEvaluationContext,
  normalizeOperations,
  isAsyncFunction,
  safeEvaluate,
  deepMerge,
  hashString,
  // Errors
  RLSError,
  RLSContextError,
  RLSPolicyViolation,
  RLSSchemaError,
  RLSContextValidationError,
  RLSErrorCodes,
} from '@kysera/rls';

export type {
  // Plugin options
  RLSPluginOptions,
  PolicyOptions,
  // Core types
  Operation as RLSOperation,
  PolicyType,
  PolicyDefinition,
  PolicyCondition,
  FilterCondition,
  PolicyHints,
  // Schema types
  RLSSchema,
  TableRLSConfig,
  // Context types
  RLSContext,
  RLSAuthContext,
  RLSRequestContext,
  CreateRLSContextOptions,
  // Evaluation types
  PolicyEvaluationContext,
  CompiledPolicy,
  CompiledFilterPolicy,
  // Error types
  RLSErrorCode,
} from '@kysera/rls';
