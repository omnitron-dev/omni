/**
 * Database Module Decorators
 *
 * Decorators for database operations and configuration
 */

import { Inject } from '@omnitron-dev/titan/decorators';
import {
  getDatabaseConnectionToken,
  getRepositoryToken,
  DATABASE_MANAGER,
  METADATA_KEYS,
} from './database.constants.js';
import type { RepositoryConfig } from './database.types.js';
import type { Constructor } from '@omnitron-dev/titan/nexus';
import type { RepositoryConstructor } from './database.internal-types.js';

/**
 * Inject database connection
 */
export function InjectConnection(name?: string): ParameterDecorator {
  return Inject(getDatabaseConnectionToken(name));
}

/**
 * Inject database manager
 */
export function InjectDatabaseManager(): ParameterDecorator {
  return Inject(DATABASE_MANAGER);
}

/**
 * Inject repository
 */
export function InjectRepository<T = unknown>(target: RepositoryConstructor<T>): ParameterDecorator {
  return Inject(getRepositoryToken(target));
}

/**
 * Repository decorator - GOLDEN PATH
 *
 * Supports two syntaxes:
 * 1. Simple: @Repository('users') - just table name
 * 2. Full: @Repository({ table: 'users', connection: 'secondary', ... })
 *
 * @example
 * ```typescript
 * // Simple syntax
 * @Repository('users')
 * class UserRepository extends TransactionAwareRepository<Database, 'users'> {}
 *
 * // Full syntax with options
 * @Repository({ table: 'users', connection: 'secondary', softDelete: true })
 * class UserRepository extends TransactionAwareRepository<Database, 'users'> {}
 * ```
 */
export function Repository<Entity = unknown>(configOrTableName: RepositoryConfig<Entity> | string): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    // Normalize config - support string shorthand
    const config: RepositoryConfig<Entity> =
      typeof configOrTableName === 'string' ? { table: configOrTableName } : configOrTableName;

    // Store repository metadata
    Reflect.defineMetadata(METADATA_KEYS.REPOSITORY, config, target);

    // Add repository marker
    Reflect.defineMetadata('database:is-repository', true, target);

    // Store table name for easy access
    Reflect.defineMetadata('database:table-name', config.table, target);

    // Store connection name
    if (config.connection) {
      Reflect.defineMetadata('database:connection-name', config.connection, target);
    }

    // Set plugin detection metadata from config options
    // This allows PluginManager to detect plugins via hasTimestamps/hasSoftDelete/hasAudit
    if (config.softDelete) {
      Reflect.defineMetadata('database:has-soft-delete', true, target);
      const softDeleteConfig = typeof config.softDelete === 'object' ? config.softDelete : { column: 'deletedAt' };
      Reflect.defineMetadata(METADATA_KEYS.SOFT_DELETE, softDeleteConfig, target);
    }

    if (config.timestamps) {
      Reflect.defineMetadata('database:has-timestamps', true, target);
      const timestampsConfig =
        typeof config.timestamps === 'object' ? config.timestamps : { createdAt: 'createdAt', updatedAt: 'updatedAt' };
      Reflect.defineMetadata(METADATA_KEYS.TIMESTAMPS, timestampsConfig, target);
    }

    if (config.audit) {
      Reflect.defineMetadata('database:has-audit', true, target);
      const auditConfig = typeof config.audit === 'object' ? config.audit : { table: 'audit_logs' };
      Reflect.defineMetadata(METADATA_KEYS.AUDIT, auditConfig, target);
    }

    // Register in global metadata for auto-discovery
    const globalRepos = Reflect.getMetadata('database:repositories', global) || [];
    globalRepos.push({
      target,
      metadata: {
        table: config.table,
        connection: config.connection,
        schema: config.schema,
        createSchema: config.createSchema,
        updateSchema: config.updateSchema,
        plugins: config.plugins,
        softDelete: config.softDelete,
        timestamps: config.timestamps,
        audit: config.audit,
      },
    });
    Reflect.defineMetadata('database:repositories', globalRepos, global);

    return target;
  };
}

/**
 * Migration decorator
 * Marks a class as a database migration
 */
export function Migration(config: {
  version: string;
  description?: string;
  dependencies?: string[];
  connection?: string;
  transactional?: boolean;
  timeout?: number;
}): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    const metadata = {
      version: config.version,
      description: config.description,
      name: target.name,
      dependencies: config.dependencies,
      connection: config.connection,
      transactional: config.transactional !== false, // Default true
      timeout: config.timeout,
      createdAt: new Date(),
    };

    // Store migration metadata
    Reflect.defineMetadata(METADATA_KEYS.MIGRATION, metadata, target);

    // Add migration marker
    Reflect.defineMetadata('database:is-migration', true, target);

    // Store version for sorting
    Reflect.defineMetadata('database:migration-version', config.version, target);

    // Register in global migrations list
    const migrations = Reflect.getMetadata('database:migrations', global) || [];
    migrations.push({ target, metadata });
    Reflect.defineMetadata('database:migrations', migrations, global);

    return target;
  };
}

// @Paginated, @UseConnection, and @Query decorators have been removed:
// - @Paginated: unused across the codebase, use @kysera/core paginate() directly
// - @UseConnection: unused, connection selection is handled via DI
// - @Query: SQL injection vulnerable (used string interpolation instead of parameterized queries)

// ============================================================================
// Plugin Decorator Configuration Types
// ============================================================================

/**
 * SoftDelete decorator configuration
 */
export interface SoftDeleteConfig {
  /** Column name for soft delete timestamp (default: 'deleted_at') */
  column?: string;
  /** Include soft-deleted records in queries by default (default: false) */
  includeDeleted?: boolean;
  /** List of tables that support soft delete. If not provided, applies to all tables. */
  tables?: string[];
}

/**
 * Timestamps decorator configuration
 */
export interface TimestampsConfig {
  /** Column name for creation timestamp (default: 'created_at') */
  createdAt?: string;
  /** Column name for update timestamp (default: 'updated_at') */
  updatedAt?: string;
}

/**
 * Audit decorator configuration
 */
export interface AuditConfig {
  /** Audit log table name (default: 'audit_logs') */
  table?: string;
  /** Capture old values in audit log (default: true) */
  captureOldValues?: boolean;
  /** Capture new values in audit log (default: true) */
  captureNewValues?: boolean;
}

// ============================================================================
// Plugin Decorators - Zero-Boilerplate Integration
// ============================================================================

/**
 * SoftDelete decorator
 * Marks a repository to use soft delete functionality.
 * When applied, the repository automatically gets:
 * - softDelete(id): Set deleted_at timestamp instead of hard delete
 * - restore(id): Clear deleted_at to restore record
 * - findDeleted(): Find only soft-deleted records
 * - findWithDeleted(): Include soft-deleted in results
 *
 * @example
 * ```typescript
 * @Repository({ table: 'users' })
 * @SoftDelete()
 * class UserRepository extends BaseRepository<User> {
 *   // Automatically gets softDelete(), restore(), etc.
 * }
 *
 * @Repository({ table: 'posts' })
 * @SoftDelete({ column: 'removed_at', includeDeleted: false })
 * class PostRepository extends BaseRepository<Post> {
 *   // Uses custom column name
 * }
 * ```
 */
export function SoftDelete(config?: SoftDeleteConfig): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    const existingConfig = Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target) || {};

    // Store plugin-specific metadata for detection
    Reflect.defineMetadata(METADATA_KEYS.SOFT_DELETE, config || {}, target);

    // Mark as having soft delete enabled
    Reflect.defineMetadata('database:has-soft-delete', true, target);

    // Update repository config with soft delete settings
    Reflect.defineMetadata(
      METADATA_KEYS.REPOSITORY,
      {
        ...existingConfig,
        softDelete: config || true,
      },
      target
    );

    return target;
  };
}

/**
 * Timestamps decorator
 * Marks a repository to use automatic timestamp management.
 * When applied, the repository automatically:
 * - Sets createdAt on insert operations
 * - Updates updatedAt on update operations
 * - Provides findCreatedAfter(date), findUpdatedAfter(date) methods
 * - Provides touch(id) to update timestamp without changing data
 *
 * @example
 * ```typescript
 * @Repository({ table: 'users' })
 * @Timestamps()
 * class UserRepository extends BaseRepository<User> {
 *   // createdAt/updatedAt auto-managed
 * }
 *
 * @Repository({ table: 'posts' })
 * @Timestamps({ createdAt: 'created', updatedAt: 'modified' })
 * class PostRepository extends BaseRepository<Post> {
 *   // Uses custom column names
 * }
 * ```
 */
export function Timestamps(config?: TimestampsConfig): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    const existingConfig = Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target) || {};

    // Store plugin-specific metadata for detection
    Reflect.defineMetadata(METADATA_KEYS.TIMESTAMPS, config || {}, target);

    // Mark as having timestamps enabled
    Reflect.defineMetadata('database:has-timestamps', true, target);

    // Update repository config with timestamps settings
    Reflect.defineMetadata(
      METADATA_KEYS.REPOSITORY,
      {
        ...existingConfig,
        timestamps: config || true,
      },
      target
    );

    return target;
  };
}

/**
 * Audit decorator
 * Marks a repository to use audit logging functionality.
 * When applied, all CRUD operations are automatically logged to an audit table.
 * - Captures who made the change (from context)
 * - Captures when the change was made
 * - Optionally captures old and new values
 * - Provides getAuditHistory(id) method
 *
 * @example
 * ```typescript
 * @Repository({ table: 'users' })
 * @Audit()
 * class UserRepository extends BaseRepository<User> {
 *   // All changes logged to 'audit_logs'
 * }
 *
 * @Repository({ table: 'financial_records' })
 * @Audit({ table: 'financial_audit', captureOldValues: true, captureNewValues: true })
 * class FinancialRepository extends BaseRepository<FinancialRecord> {
 *   // Detailed audit with before/after snapshots
 * }
 * ```
 */
export function Audit(config?: AuditConfig): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    const existingConfig = Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target) || {};

    // Store plugin-specific metadata for detection
    Reflect.defineMetadata(METADATA_KEYS.AUDIT, config || {}, target);

    // Mark as having audit enabled
    Reflect.defineMetadata('database:has-audit', true, target);

    // Update repository config with audit settings
    Reflect.defineMetadata(
      METADATA_KEYS.REPOSITORY,
      {
        ...existingConfig,
        audit: config || true,
      },
      target
    );

    return target;
  };
}

// ============================================================================
// Plugin Metadata Helpers
// ============================================================================

/**
 * Helper function to get repository metadata
 */
export function getRepositoryMetadata<Entity = unknown>(
  target: Constructor | RepositoryConstructor<Entity>
): RepositoryConfig<Entity> | undefined {
  return Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target);
}

/**
 * Helper function to check if class is a repository
 */
export function isRepository(target: Constructor | RepositoryConstructor): boolean {
  return Reflect.getMetadata('database:is-repository', target) === true;
}

/**
 * Helper function to get migration metadata
 */
export function getMigrationMetadata(target: Constructor): { version: string; description?: string } | undefined {
  return Reflect.getMetadata(METADATA_KEYS.MIGRATION, target);
}

/**
 * Helper function to check if class is a migration
 */
export function isMigration(target: unknown): target is Constructor {
  if (typeof target !== 'function') return false;
  return Reflect.getMetadata('database:is-migration', target) === true;
}

/**
 * Check if repository has soft delete enabled via decorator
 */
export function hasSoftDelete(target: Constructor | RepositoryConstructor): boolean {
  return Reflect.getMetadata('database:has-soft-delete', target) === true;
}

/**
 * Get soft delete configuration from decorator
 */
export function getSoftDeleteConfig(target: Constructor | RepositoryConstructor): SoftDeleteConfig | undefined {
  if (!hasSoftDelete(target)) return undefined;
  return Reflect.getMetadata(METADATA_KEYS.SOFT_DELETE, target);
}

/**
 * Check if repository has timestamps enabled via decorator
 */
export function hasTimestamps(target: Constructor | RepositoryConstructor): boolean {
  return Reflect.getMetadata('database:has-timestamps', target) === true;
}

/**
 * Get timestamps configuration from decorator
 */
export function getTimestampsConfig(target: Constructor | RepositoryConstructor): TimestampsConfig | undefined {
  if (!hasTimestamps(target)) return undefined;
  return Reflect.getMetadata(METADATA_KEYS.TIMESTAMPS, target);
}

/**
 * Check if repository has audit enabled via decorator
 */
export function hasAudit(target: Constructor | RepositoryConstructor): boolean {
  return Reflect.getMetadata('database:has-audit', target) === true;
}

/**
 * Get audit configuration from decorator
 */
export function getAuditConfig(target: Constructor | RepositoryConstructor): AuditConfig | undefined {
  if (!hasAudit(target)) return undefined;
  return Reflect.getMetadata(METADATA_KEYS.AUDIT, target);
}

/**
 * Get all enabled plugin names for a repository based on decorators
 */
export function getDecoratorPlugins(target: Constructor | RepositoryConstructor): string[] {
  const plugins: string[] = [];

  if (hasSoftDelete(target)) {
    plugins.push('soft-delete');
  }
  if (hasTimestamps(target)) {
    plugins.push('timestamps');
  }
  if (hasAudit(target)) {
    plugins.push('audit');
  }

  return plugins;
}

// ============================================================================
// RLS (Row-Level Security) Decorators
// ============================================================================

/**
 * RLS policy configuration for a repository
 */
export interface RLSPolicyConfig {
  /** Table name (defaults to repository table) */
  table?: string;
  /** Skip RLS for specific roles */
  skipFor?: string[];
  /** Default policy to apply */
  defaultPolicy?: 'allow' | 'deny';
}

/**
 * RLS allow/deny rule configuration
 */
export interface RLSRuleConfig {
  /** Operations this rule applies to */
  operations: Array<'select' | 'insert' | 'update' | 'delete'>;
  /** Rule priority (higher = evaluated first) */
  priority?: number;
  /** Rule name for debugging */
  name?: string;
}

/**
 * RLS filter configuration
 */
export interface RLSFilterConfig {
  /** Operations this filter applies to (default: ['select']) */
  operations?: Array<'select' | 'insert' | 'update' | 'delete'>;
  /** Filter name for debugging */
  name?: string;
}

/**
 * Policy decorator
 * Configures RLS policy for a repository
 *
 * @example
 * ```typescript
 * @Repository({ table: 'posts' })
 * @Policy({ skipFor: ['admin'] })
 * class PostRepository extends BaseRepository<Post> {}
 * ```
 */
export function Policy(config?: RLSPolicyConfig): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    const existingConfig = Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target) || {};

    Reflect.defineMetadata(
      METADATA_KEYS.REPOSITORY,
      {
        ...existingConfig,
        rls: config || {},
      },
      target
    );

    // Store RLS policy metadata separately for discovery
    Reflect.defineMetadata(METADATA_KEYS.RLS_POLICY, config || {}, target);

    // Mark as RLS-enabled
    Reflect.defineMetadata('database:rls-enabled', true, target);

    return target;
  };
}

/**
 * Allow decorator
 * Defines an allow rule for RLS policy
 *
 * @example
 * ```typescript
 * @Repository({ table: 'posts' })
 * @Policy()
 * class PostRepository extends BaseRepository<Post> {
 *   @Allow({ operations: ['select', 'update', 'delete'] })
 *   canAccessOwnPosts(ctx: PolicyContext, row: Post) {
 *     return row.authorId === ctx.auth.userId;
 *   }
 * }
 * ```
 */
export function Allow(config: RLSRuleConfig): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const rules = Reflect.getMetadata(METADATA_KEYS.RLS_ALLOW, target.constructor) || [];

    rules.push({
      name: config.name || String(propertyKey),
      method: propertyKey,
      operations: config.operations,
      priority: config.priority ?? 0,
    });

    Reflect.defineMetadata(METADATA_KEYS.RLS_ALLOW, rules, target.constructor);

    return descriptor;
  };
}

/**
 * Deny decorator
 * Defines a deny rule for RLS policy (evaluated before allow rules)
 *
 * @example
 * ```typescript
 * @Repository({ table: 'posts' })
 * @Policy()
 * class PostRepository extends BaseRepository<Post> {
 *   @Deny({ operations: ['delete'] })
 *   cannotDeletePublished(ctx: PolicyContext, row: Post) {
 *     return row.status === 'published';
 *   }
 * }
 * ```
 */
export function Deny(config: RLSRuleConfig): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const rules = Reflect.getMetadata(METADATA_KEYS.RLS_DENY, target.constructor) || [];

    rules.push({
      name: config.name || String(propertyKey),
      method: propertyKey,
      operations: config.operations,
      priority: config.priority ?? 0,
    });

    Reflect.defineMetadata(METADATA_KEYS.RLS_DENY, rules, target.constructor);

    return descriptor;
  };
}

/**
 * Filter decorator
 * Defines a filter that modifies SELECT queries to only return allowed rows
 *
 * @example
 * ```typescript
 * @Repository({ table: 'posts' })
 * @Policy()
 * class PostRepository extends BaseRepository<Post> {
 *   @Filter()
 *   filterByTenant(ctx: PolicyContext) {
 *     return { tenantId: ctx.auth.tenantId };
 *   }
 * }
 * ```
 */
export function Filter(config?: RLSFilterConfig): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const filters = Reflect.getMetadata(METADATA_KEYS.RLS_FILTER, target.constructor) || [];

    filters.push({
      name: config?.name || String(propertyKey),
      method: propertyKey,
      operations: config?.operations || ['select'],
    });

    Reflect.defineMetadata(METADATA_KEYS.RLS_FILTER, filters, target.constructor);

    return descriptor;
  };
}

/**
 * BypassRLS decorator
 * Marks a method to bypass RLS checks (requires system context or admin role)
 *
 * @example
 * ```typescript
 * @Repository({ table: 'posts' })
 * @Policy()
 * class PostRepository extends BaseRepository<Post> {
 *   @BypassRLS()
 *   async adminGetAll() {
 *     return this.findAll();
 *   }
 * }
 * ```
 */
export function BypassRLS(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const bypassed = Reflect.getMetadata(METADATA_KEYS.RLS_BYPASS, target.constructor) || [];
    bypassed.push(propertyKey);
    Reflect.defineMetadata(METADATA_KEYS.RLS_BYPASS, bypassed, target.constructor);

    return descriptor;
  };
}

/**
 * Helper function to get RLS policy metadata
 */
export function getRLSPolicyMetadata(target: Constructor): RLSPolicyConfig | undefined {
  return Reflect.getMetadata(METADATA_KEYS.RLS_POLICY, target);
}

/**
 * Helper function to get RLS allow rules
 */
export function getRLSAllowRules(target: Constructor): Array<{
  name: string;
  method: string | symbol;
  operations: string[];
  priority: number;
}> {
  return Reflect.getMetadata(METADATA_KEYS.RLS_ALLOW, target) || [];
}

/**
 * Helper function to get RLS deny rules
 */
export function getRLSDenyRules(target: Constructor): Array<{
  name: string;
  method: string | symbol;
  operations: string[];
  priority: number;
}> {
  return Reflect.getMetadata(METADATA_KEYS.RLS_DENY, target) || [];
}

/**
 * Helper function to get RLS filters
 */
export function getRLSFilters(target: Constructor): Array<{
  name: string;
  method: string | symbol;
  operations: string[];
}> {
  return Reflect.getMetadata(METADATA_KEYS.RLS_FILTER, target) || [];
}

/**
 * Helper function to get bypassed methods
 */
export function getRLSBypassedMethods(target: Constructor): Array<string | symbol> {
  return Reflect.getMetadata(METADATA_KEYS.RLS_BYPASS, target) || [];
}

/**
 * Helper function to check if repository has RLS enabled
 */
export function isRLSEnabled(target: Constructor): boolean {
  return Reflect.getMetadata('database:rls-enabled', target) === true;
}
