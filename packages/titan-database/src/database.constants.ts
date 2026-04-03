/**
 * Database Module Constants
 *
 * Minimal DI injection tokens for the database module.
 */

export const DATABASE_DEFAULT_CONNECTION = 'default';

// ============================================================================
// DI Injection Tokens
// ============================================================================

export const DATABASE_MANAGER = Symbol.for('titan:DATABASE_MANAGER');
export const DATABASE_MODULE_OPTIONS = Symbol.for('titan:DATABASE_MODULE_OPTIONS');
export const DATABASE_CONNECTION = Symbol.for('titan:DATABASE_CONNECTION');
export const DATABASE_HEALTH_INDICATOR = Symbol.for('titan:DATABASE_HEALTH_INDICATOR');

/**
 * Get injection token for a named database connection
 */
export function getDatabaseConnectionToken(name: string = DATABASE_DEFAULT_CONNECTION): string | symbol {
  return name === DATABASE_DEFAULT_CONNECTION ? DATABASE_CONNECTION : `DATABASE_CONNECTION:${name}`;
}

/**
 * Get injection token for a repository
 */
export function getRepositoryToken(target: any): string {
  const name = typeof target === 'string' ? target : target.name;
  return `REPOSITORY:${name}`;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_POOL_CONFIG = {
  min: 2,
  max: 20,
  idleTimeoutMillis: 30000,
  acquireTimeoutMillis: 60000,
};

export const DEFAULT_TIMEOUTS = {
  query: 30000,
  transaction: 60000,
  shutdown: 10000,
  health: 5000,
};

// ============================================================================
// Metadata Keys (for decorators)
// ============================================================================

export const METADATA_KEYS = {
  REPOSITORY: 'database:repository',
  MIGRATION: 'database:migration',
  SOFT_DELETE: 'database:plugin:soft-delete',
  TIMESTAMPS: 'database:plugin:timestamps',
  AUDIT: 'database:plugin:audit',
  RLS_POLICY: 'database:rls:policy',
  RLS_ALLOW: 'database:rls:allow',
  RLS_DENY: 'database:rls:deny',
  RLS_FILTER: 'database:rls:filter',
  RLS_BYPASS: 'database:rls:bypass',
} as const;
