/**
 * Database Module Public API
 *
 * Exports all public components of the database module
 */

// Main module
export { TitanDatabaseModule } from './database.module.js';

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

  // Manager
  IDatabaseManager,
} from './database.types.js';

// Re-export event type enum
export { DatabaseEventType } from './database.types.js';

// Constants
export {
  DATABASE_SERVICE,
  DATABASE_HEALTH_INDICATOR,
  DATABASE_DEFAULT_CONNECTION,
  DATABASE_MANAGER,
  DATABASE_MODULE_OPTIONS,
  DATABASE_PLUGIN_MANAGER,
  DATABASE_TRANSACTION_MANAGER,
  DATABASE_TRANSACTION_SCOPE_FACTORY,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_MIGRATION_RUNNER,
  DATABASE_MIGRATION_LOCK,
  DATABASE_REPOSITORY_FACTORY,
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
  SoftDelete,
  Timestamps,
  Audit,
  getRepositoryMetadata,
  isRepository,
  getMigrationMetadata,
  isMigration,
} from './database.decorators.js';

// Repository
export { BaseRepository } from './repository/base.repository.js';
export { RepositoryFactory } from './repository/repository.factory.js';
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
export type {
  IMigration,
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
export {
  InjectTransactionScope,
  RequiresTransactionScope,
} from './transaction/transaction.scope.js';
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
  TransactionTimeoutError,
  TransactionDeadlockError,
  TransactionPropagationError,
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
export type {
  Kysely,
  Transaction,
  Selectable,
  Insertable,
  Updateable,
  sql,
} from 'kysely';

// Re-export Kysera utilities
export {
  parseDatabaseError,
  paginate,
  paginateCursor,
} from '@kysera/core';