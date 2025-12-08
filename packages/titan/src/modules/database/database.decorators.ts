/**
 * Database Module Decorators
 *
 * Decorators for database operations and configuration
 */

import { Inject } from '../../decorators/index.js';
import {
  getDatabaseConnectionToken,
  getRepositoryToken,
  DATABASE_MANAGER,
  METADATA_KEYS,
} from './database.constants.js';
import { Errors } from '../../errors/index.js';
import type { RepositoryConfig, PaginationOptions } from './database.types.js';
import type { TransactionOptions, DatabaseTransaction } from './transaction/transaction.types.js';
import type { Constructor } from '../../nexus/types.js';
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
 * Repository decorator
 * Marks a class as a repository and configures it
 */
export function Repository<Entity = unknown>(config: RepositoryConfig<Entity>): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
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

/**
 * Interface for objects that have transaction management capabilities
 */
interface TransactionCapable {
  transactionManager?: {
    executeInTransaction<T>(fn: (trx: DatabaseTransaction) => Promise<T>, options?: TransactionOptions): Promise<T>;
    getCurrentTransaction(): unknown;
  };
  databaseService?: {
    transaction<T>(fn: (trx: DatabaseTransaction) => Promise<T>, options?: TransactionOptions): Promise<T>;
  };
  __transactionContext?: unknown;
}

/**
 * Transactional decorator
 * Wraps method in a database transaction with advanced options
 */
export function Transactional(options?: TransactionOptions): MethodDecorator {
  return (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (this: TransactionCapable, ...args: unknown[]): Promise<unknown> {
      // Try to get transaction manager first (preferred)
      const transactionManager = this.transactionManager;

      // Fallback to database service for backward compatibility
      if (!transactionManager) {
        const databaseService = this.databaseService;

        if (!databaseService) {
          throw Errors.internal(
            `@Transactional decorator requires TransactionManager or DatabaseService to be injected in ${this.constructor.name}`
          );
        }

        // Use database service's transaction method
        return databaseService.transaction(async (trx: DatabaseTransaction) => {
          // Store transaction in context for nested operations
          const context = { transaction: trx };
          Object.defineProperty(this, '__transactionContext', {
            value: context,
            writable: false,
            configurable: true,
          });

          try {
            // Call original method
            return await originalMethod.apply(this, args);
          } finally {
            // Clean up transaction context
            delete this.__transactionContext;
          }
        }, options);
      }

      // Use transaction manager with advanced features
      return transactionManager.executeInTransaction(async (trx: DatabaseTransaction) => {
        // Store transaction in context for nested operations
        const context = {
          transaction: trx,
          transactionManager,
          transactionContext: transactionManager.getCurrentTransaction(),
        };

        Object.defineProperty(this, '__transactionContext', {
          value: context,
          writable: false,
          configurable: true,
        });

        try {
          // Call original method
          return await originalMethod.apply(this, args);
        } finally {
          // Clean up transaction context
          delete this.__transactionContext;
        }
      }, options);
    };

    // Store metadata
    Reflect.defineMetadata(METADATA_KEYS.TRANSACTIONAL, options || {}, _target, propertyKey);

    return descriptor;
  };
}

/**
 * Interface for objects that have database service capabilities
 */
interface PaginationCapable {
  databaseService?: {
    paginate<T>(query: unknown, options?: PaginationOptions): Promise<T>;
    paginateCursor<T>(query: unknown, options?: PaginationOptions): Promise<T>;
  };
}

/**
 * Paginated decorator
 * Automatically paginates query results
 */
export function Paginated(defaults?: Partial<PaginationOptions>): MethodDecorator {
  return (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (this: PaginationCapable, ...args: unknown[]): Promise<unknown> {
      // Extract pagination options from arguments
      const lastArg = args[args.length - 1];
      const isPaginationOptions =
        lastArg && typeof lastArg === 'object' && ('page' in lastArg || 'limit' in lastArg || 'cursor' in lastArg);

      const paginationOptions: PaginationOptions = isPaginationOptions ? { ...defaults, ...lastArg as Partial<PaginationOptions> } : defaults || {};

      // Get database service
      const databaseService = this.databaseService;

      if (!databaseService) {
        throw Errors.internal(
          `@Paginated decorator requires DatabaseService to be injected in ${this.constructor.name}`
        );
      }

      // Call original method to get query
      const query = await originalMethod.apply(this, isPaginationOptions ? args.slice(0, -1) : args);

      // Apply pagination
      if (paginationOptions.cursor) {
        return databaseService.paginateCursor(query, paginationOptions);
      } else {
        return databaseService.paginate(query, paginationOptions);
      }
    };

    // Store metadata
    Reflect.defineMetadata(METADATA_KEYS.PAGINATED, defaults || {}, _target, propertyKey);

    return descriptor;
  };
}

/**
 * Connection decorator
 * Specifies which database connection to use for a method
 */
export function UseConnection(connectionName: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // Store connection metadata
    Reflect.defineMetadata(METADATA_KEYS.CONNECTION, connectionName, target, propertyKey);

    return descriptor;
  };
}

/**
 * Interface for objects that have database connection capabilities
 */
interface DatabaseCapable {
  db?: {
    raw(sql: string): {
      execute(): Promise<unknown>;
    };
  };
}

/**
 * Query decorator
 * Marks a method as a custom query method
 */
export function Query(sql: string): MethodDecorator {
  return (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    descriptor.value = async function (this: DatabaseCapable, ...args: unknown[]): Promise<unknown> {
      const db = this.db;

      if (!db) {
        throw Errors.internal(`@Query decorator requires database connection in ${this.constructor.name}`);
      }

      // Replace placeholders in SQL with actual values
      let processedSql = sql;
      args.forEach((arg, index) => {
        processedSql = processedSql.replace(new RegExp(`\\$${index + 1}`, 'g'), String(arg));
      });

      return db.raw(processedSql).execute();
    };

    return descriptor;
  };
}

/**
 * SoftDelete decorator
 * Marks a repository to use soft delete
 */
export function SoftDelete(config?: { column?: string; includeDeleted?: boolean }): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    const existingConfig = Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target) || {};

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
 * Marks a repository to use automatic timestamps
 */
export function Timestamps(config?: { createdAt?: string; updatedAt?: string }): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    const existingConfig = Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target) || {};

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
 * Marks a repository to use audit logging
 */
export function Audit(config?: {
  table?: string;
  captureOldValues?: boolean;
  captureNewValues?: boolean;
}): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return <TFunction extends Function>(target: TFunction): TFunction => {
    const existingConfig = Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target) || {};

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

/**
 * Helper function to get repository metadata
 */
export function getRepositoryMetadata<Entity = unknown>(target: Constructor | RepositoryConstructor<Entity>): RepositoryConfig<Entity> | undefined {
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
export function isMigration(target: Constructor): boolean {
  return Reflect.getMetadata('database:is-migration', target) === true;
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
