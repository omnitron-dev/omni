/**
 * Repository Type Definitions
 *
 * Types for the repository pattern implementation
 */

import type { Transaction, Selectable, Insertable } from 'kysely';
import type { z } from 'zod';
import type { Plugin as KyseraPlugin } from '@kysera/repository';
import type { PaginatedResult, PaginationOptions } from '../database.types.js';

/**
 * Base repository interface
 */
export interface IBaseRepository<Entity, CreateInput = Partial<Entity>, UpdateInput = Partial<Entity>> {
  // Table information
  readonly tableName: string;
  readonly connectionName: string;

  // Basic CRUD operations
  findAll(options?: FindOptions<Entity>): Promise<Entity[]>;
  findById(id: number | string): Promise<Entity | null>;
  findOne(conditions: Partial<Entity>): Promise<Entity | null>;
  findMany(conditions: Partial<Entity>): Promise<Entity[]>;

  create(data: CreateInput): Promise<Entity>;
  createMany(data: CreateInput[]): Promise<Entity[]>;

  update(id: number | string, data: UpdateInput): Promise<Entity>;
  updateMany(conditions: Partial<Entity>, data: UpdateInput): Promise<number>;

  delete(id: number | string): Promise<void>;
  deleteMany(conditions: Partial<Entity>): Promise<number>;

  // Advanced operations
  count(conditions?: Partial<Entity>): Promise<number>;
  exists(conditions: Partial<Entity>): Promise<boolean>;
  paginate(options?: PaginationOptions): Promise<PaginatedResult<Entity>>;

  // Query builder access
  query(): unknown; // Returns Kysely query builder

  // Transaction support
  withTransaction(trx: Transaction<unknown>): IBaseRepository<Entity, CreateInput, UpdateInput>;
}

/**
 * Repository configuration
 */
export interface RepositoryConfig<DB = Record<string, unknown>, TableName extends string = string, Entity = Record<string, unknown>> {
  /**
   * Table name in the database
   */
  tableName: TableName;

  /**
   * Connection name to use
   */
  connectionName?: string;

  /**
   * Map database row to entity
   */
  mapRow?: (row: Record<string, unknown>) => Entity;

  /**
   * Map entity to database row
   */
  mapEntity?: (entity: Entity) => Record<string, unknown>;

  /**
   * Validation schemas
   */
  schemas?: {
    entity?: z.ZodType;
    create?: z.ZodType;
    update?: z.ZodType;
  };

  /**
   * Validate database results
   */
  validateDbResults?: boolean;

  /**
   * Plugins to apply
   */
  plugins?: Array<string | KyseraPlugin>;

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
 * Find options for queries
 */
export interface FindOptions<T> {
  /**
   * Conditions to filter by
   */
  where?: Partial<T>;

  /**
   * Order by columns
   */
  orderBy?: Array<{
    column: keyof T;
    direction: 'asc' | 'desc';
  }>;

  /**
   * Limit results
   */
  limit?: number;

  /**
   * Offset for pagination
   */
  offset?: number;

  /**
   * Include soft deleted records
   */
  includeDeleted?: boolean;

  /**
   * Select specific columns
   */
  select?: Array<keyof T>;

  /**
   * Relations to include
   */
  include?: string[];

  /**
   * Lock for update
   */
  lock?: boolean | 'nowait' | 'skip_locked';
}

/**
 * Repository factory configuration
 */
export interface RepositoryFactoryConfig {
  /**
   * Database connection manager
   */
  connectionName?: string;

  /**
   * Default validation strategy
   */
  validationStrategy?: 'none' | 'strict';

  /**
   * Global plugins to apply to all repositories
   */
  globalPlugins?: Array<string | KyseraPlugin>;

  /**
   * Default batch size for bulk operations
   */
  batchSize?: number;
}

/**
 * Repository metadata stored via decorators
 */
export interface RepositoryMetadata<Entity = Record<string, unknown>> {
  /**
   * Repository target class
   */
  target: new (...args: unknown[]) => unknown;

  /**
   * Table name
   */
  table: string;

  /**
   * Connection name
   */
  connection?: string;

  /**
   * Entity schema
   */
  schema?: z.ZodType;

  /**
   * Create schema
   */
  createSchema?: z.ZodType;

  /**
   * Update schema
   */
  updateSchema?: z.ZodType;

  /**
   * Plugins to apply
   */
  plugins?: string[];

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
 * Repository instance with full functionality
 */
export interface Repository<Entity, CreateInput = Partial<Entity>, UpdateInput = Partial<Entity>>
  extends IBaseRepository<Entity, CreateInput, UpdateInput> {
  // Soft delete methods (if enabled)
  softDelete?(id: number | string): Promise<Entity>;
  restore?(id: number | string): Promise<Entity>;
  hardDelete?(id: number | string): Promise<void>;
  findWithDeleted?(id: number | string): Promise<Entity | null>;
  findAllWithDeleted?(): Promise<Entity[]>;
  findDeleted?(): Promise<Entity[]>;

  // Audit methods (if enabled)
  getAuditHistory?(entityId: number | string): Promise<Array<Record<string, unknown>>>;
  getAuditSnapshot?(entityId: number | string, timestamp: Date): Promise<Entity | null>;
}

/**
 * Repository factory interface
 */
export interface IRepositoryFactory {
  /**
   * Create a repository instance
   */
  create<Entity, CreateInput = Partial<Entity>, UpdateInput = Partial<Entity>>(
    config: RepositoryConfig
  ): Promise<Repository<Entity, CreateInput, UpdateInput>>;

  /**
   * Register a repository class
   */
  register(target: new (...args: unknown[]) => unknown, metadata: RepositoryMetadata): void;

  /**
   * Get a registered repository
   */
  get<T = Repository<Record<string, unknown>>>(target: new (...args: unknown[]) => unknown): Promise<T>;

  /**
   * Get all registered repositories
   */
  getAll(): Map<new (...args: unknown[]) => unknown, Repository<Record<string, unknown>>>;

  /**
   * Apply plugins to a repository
   */
  applyPlugins(repository: unknown, plugins: Array<string | KyseraPlugin>): unknown;
}

/**
 * Transaction scope for repositories
 */
export interface RepositoryTransactionScope {
  /**
   * Get repository with transaction
   */
  getRepository<T = Repository<Record<string, unknown>>>(target: new (...args: unknown[]) => unknown): T;

  /**
   * Execute function in transaction
   */
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Repository events
 */
export enum RepositoryEventType {
  BEFORE_CREATE = 'repository.before_create',
  AFTER_CREATE = 'repository.after_create',
  BEFORE_UPDATE = 'repository.before_update',
  AFTER_UPDATE = 'repository.after_update',
  BEFORE_DELETE = 'repository.before_delete',
  AFTER_DELETE = 'repository.after_delete',
  BEFORE_SOFT_DELETE = 'repository.before_soft_delete',
  AFTER_SOFT_DELETE = 'repository.after_soft_delete',
  BEFORE_RESTORE = 'repository.before_restore',
  AFTER_RESTORE = 'repository.after_restore',
}

/**
 * Repository event payload
 */
export interface RepositoryEvent<Entity = Record<string, unknown>> {
  type: RepositoryEventType;
  repository: string;
  entity?: Entity;
  data?: unknown;
  timestamp: Date;
}
