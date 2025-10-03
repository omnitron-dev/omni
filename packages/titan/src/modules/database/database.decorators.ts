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
import type {
  RepositoryConfig,
  PaginationOptions,
} from './database.types.js';
import type { TransactionOptions } from './transaction/transaction.types.js';

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
export function InjectRepository(target: any): ParameterDecorator {
  return Inject(getRepositoryToken(target));
}

/**
 * Repository decorator
 * Marks a class as a repository and configures it
 */
export function Repository<Entity = any>(config: RepositoryConfig<Entity>): ClassDecorator {
  return (target: any) => {
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
  return (target: any) => {
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
 * Transactional decorator
 * Wraps method in a database transaction with advanced options
 */
export function Transactional(options?: TransactionOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // Try to get transaction manager first (preferred)
      let transactionManager = (this as any).transactionManager;

      // Fallback to database service for backward compatibility
      if (!transactionManager) {
        const databaseService = (this as any).databaseService;

        if (!databaseService) {
          throw new Error(
            `@Transactional decorator requires TransactionManager or DatabaseService to be injected in ${target.constructor.name}`
          );
        }

        // Use database service's transaction method
        return databaseService.transaction(
          async (trx: any) => {
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
              delete (this as any).__transactionContext;
            }
          },
          options
        );
      }

      // Use transaction manager with advanced features
      return transactionManager.executeInTransaction(
        async (trx: any) => {
          // Store transaction in context for nested operations
          const context = {
            transaction: trx,
            transactionManager: transactionManager,
            transactionContext: transactionManager.getCurrentTransaction()
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
            delete (this as any).__transactionContext;
          }
        },
        options
      );
    };

    // Store metadata
    Reflect.defineMetadata(METADATA_KEYS.TRANSACTIONAL, options || {}, target, propertyKey);

    return descriptor;
  };
}

/**
 * Paginated decorator
 * Automatically paginates query results
 */
export function Paginated(defaults?: Partial<PaginationOptions>): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // Extract pagination options from arguments
      const lastArg = args[args.length - 1];
      const isPaginationOptions =
        lastArg &&
        typeof lastArg === 'object' &&
        ('page' in lastArg || 'limit' in lastArg || 'cursor' in lastArg);

      const paginationOptions: PaginationOptions = isPaginationOptions
        ? { ...defaults, ...lastArg }
        : defaults || {};

      // Get database service
      const databaseService = (this as any).databaseService;

      if (!databaseService) {
        throw new Error(
          `@Paginated decorator requires DatabaseService to be injected in ${target.constructor.name}`
        );
      }

      // Call original method to get query
      const query = await originalMethod.apply(
        this,
        isPaginationOptions ? args.slice(0, -1) : args
      );

      // Apply pagination
      if (paginationOptions.cursor) {
        return databaseService.paginateCursor(query, paginationOptions);
      } else {
        return databaseService.paginate(query, paginationOptions);
      }
    };

    // Store metadata
    Reflect.defineMetadata(METADATA_KEYS.PAGINATED, defaults || {}, target, propertyKey);

    return descriptor;
  };
}

/**
 * Connection decorator
 * Specifies which database connection to use for a method
 */
export function UseConnection(connectionName: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // Store connection metadata
    Reflect.defineMetadata(METADATA_KEYS.CONNECTION, connectionName, target, propertyKey);

    return descriptor;
  };
}

/**
 * Query decorator
 * Marks a method as a custom query method
 */
export function Query(sql: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    descriptor.value = async function (...args: any[]) {
      const db = (this as any).db;

      if (!db) {
        throw new Error(
          `@Query decorator requires database connection in ${target.constructor.name}`
        );
      }

      // Replace placeholders in SQL with actual values
      let processedSql = sql;
      args.forEach((arg, index) => {
        processedSql = processedSql.replace(new RegExp(`\\$${index + 1}`, 'g'), arg);
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
export function SoftDelete(config?: {
  column?: string;
  includeDeleted?: boolean;
}): ClassDecorator {
  return (target: any) => {
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
export function Timestamps(config?: {
  createdAt?: string;
  updatedAt?: string;
}): ClassDecorator {
  return (target: any) => {
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
  return (target: any) => {
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
export function getRepositoryMetadata(target: any): RepositoryConfig | undefined {
  return Reflect.getMetadata(METADATA_KEYS.REPOSITORY, target);
}

/**
 * Helper function to check if class is a repository
 */
export function isRepository(target: any): boolean {
  return Reflect.getMetadata('database:is-repository', target) === true;
}

/**
 * Helper function to get migration metadata
 */
export function getMigrationMetadata(target: any): { version: string; description?: string } | undefined {
  return Reflect.getMetadata(METADATA_KEYS.MIGRATION, target);
}

/**
 * Helper function to check if class is a migration
 */
export function isMigration(target: any): boolean {
  return Reflect.getMetadata('database:is-migration', target) === true;
}