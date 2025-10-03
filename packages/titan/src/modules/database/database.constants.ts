/**
 * Database Module Constants
 *
 * Injection tokens and constant values for the database module
 */

/**
 * Default connection name
 */
export const DATABASE_DEFAULT_CONNECTION = 'default';

/**
 * Injection tokens
 */
export const DATABASE_SERVICE = Symbol('DATABASE_SERVICE');
export const DATABASE_HEALTH_INDICATOR = Symbol('DATABASE_HEALTH_INDICATOR');
export const DATABASE_MANAGER = Symbol('DATABASE_MANAGER');
export const DATABASE_MODULE_OPTIONS = Symbol('DATABASE_MODULE_OPTIONS');
export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');
export const DATABASE_REPOSITORY_FACTORY = Symbol('DATABASE_REPOSITORY_FACTORY');
export const DATABASE_MIGRATION_SERVICE = Symbol('DATABASE_MIGRATION_SERVICE');
export const DATABASE_MIGRATION_RUNNER = Symbol('DATABASE_MIGRATION_RUNNER');
export const DATABASE_MIGRATION_LOCK = Symbol('DATABASE_MIGRATION_LOCK');
export const DATABASE_TRANSACTION_MANAGER = Symbol('DATABASE_TRANSACTION_MANAGER');
export const DATABASE_PLUGIN_MANAGER = Symbol('DATABASE_PLUGIN_MANAGER');
export const DATABASE_TRANSACTION_SCOPE_FACTORY = Symbol('DATABASE_TRANSACTION_SCOPE_FACTORY');

/**
 * Get injection token for a specific database connection
 */
export function getDatabaseConnectionToken(name: string = DATABASE_DEFAULT_CONNECTION): string | symbol {
  return name === DATABASE_DEFAULT_CONNECTION
    ? DATABASE_CONNECTION
    : `DATABASE_CONNECTION:${name}`;
}

/**
 * Get injection token for a specific repository
 */
export function getRepositoryToken(target: any): string {
  const name = typeof target === 'string' ? target : target.name;
  return `REPOSITORY:${name}`;
}

/**
 * Default pool configuration
 */
export const DEFAULT_POOL_CONFIG = {
  min: 2,
  max: 10,
  idleTimeoutMillis: 30000,
  acquireTimeoutMillis: 60000,
  createTimeoutMillis: 30000,
  destroyTimeoutMillis: 5000,
};

/**
 * Default pagination configuration
 */
export const DEFAULT_PAGINATION = {
  defaultLimit: 20,
  maxLimit: 100,
};

/**
 * Default timeouts
 */
export const DEFAULT_TIMEOUTS = {
  query: 30000, // 30 seconds
  transaction: 60000, // 1 minute
  migration: 300000, // 5 minutes
  shutdown: 10000, // 10 seconds
  health: 5000, // 5 seconds
};

/**
 * Built-in plugin names
 */
export const BUILT_IN_PLUGINS = {
  SOFT_DELETE: 'softDelete',
  TIMESTAMPS: 'timestamps',
  AUDIT: 'audit',
} as const;

/**
 * Migration table name
 */
export const MIGRATIONS_TABLE = 'kysera_migrations';

/**
 * Migration lock table name
 */
export const MIGRATIONS_LOCK_TABLE = 'kysera_migration_lock';

/**
 * Audit table name (default)
 */
export const AUDIT_TABLE = 'kysera_audit_logs';

/**
 * Database event names
 */
export const DATABASE_EVENTS = {
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

/**
 * Metadata keys for decorators
 */
export const METADATA_KEYS = {
  REPOSITORY: 'database:repository',
  MIGRATION: 'database:migration',
  TRANSACTIONAL: 'database:transactional',
  PAGINATED: 'database:paginated',
  CONNECTION: 'database:connection',
} as const;

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  CONNECTION_NOT_FOUND: (name: string) => `Database connection "${name}" not found`,
  CONNECTION_FAILED: (name: string, error: string) => `Failed to connect to database "${name}": ${error}`,
  MIGRATION_FAILED: (name: string, error: string) => `Migration "${name}" failed: ${error}`,
  TRANSACTION_FAILED: (error: string) => `Transaction failed: ${error}`,
  REPOSITORY_NOT_REGISTERED: (name: string) => `Repository "${name}" is not registered`,
  INVALID_DIALECT: (dialect: string) => `Invalid database dialect: ${dialect}`,
  POOL_EXHAUSTED: 'Database connection pool is exhausted',
  TIMEOUT: (operation: string) => `Database operation "${operation}" timed out`,
} as const;

/**
 * SQL dialect-specific settings
 */
export const DIALECT_SETTINGS = {
  postgres: {
    defaultPort: 5432,
    supportsReturning: true,
    supportsOnConflict: true,
    supportsJsonb: true,
    transactionIsolationLevels: [
      'read uncommitted',
      'read committed',
      'repeatable read',
      'serializable',
    ],
  },
  mysql: {
    defaultPort: 3306,
    supportsReturning: false,
    supportsOnConflict: true, // ON DUPLICATE KEY UPDATE
    supportsJsonb: true, // JSON type
    transactionIsolationLevels: [
      'read uncommitted',
      'read committed',
      'repeatable read',
      'serializable',
    ],
  },
  sqlite: {
    defaultPort: null,
    supportsReturning: true,
    supportsOnConflict: true, // ON CONFLICT
    supportsJsonb: true, // JSON functions
    transactionIsolationLevels: [
      'deferred',
      'immediate',
      'exclusive',
    ],
  },
} as const;