/**
 * Base Repository Implementation
 *
 * Provides common database operations for all repositories.
 * Supports both raw Kysely instances and plugin-aware KyseraExecutors
 * for seamless integration with @kysera/executor plugin system.
 */

import { Kysely, Transaction, sql } from 'kysely';
import { z } from 'zod';
import { paginate, paginateCursor, parseDatabaseError } from '@kysera/core';
import {
  isKyseraExecutor,
  getRawDb,
  getPlugins,
  wrapTransaction,
  type KyseraExecutor,
  type KyseraTransaction,
  type Plugin,
} from '@kysera/executor';
import { Errors } from '../../../errors/index.js';
import type { IBaseRepository, RepositoryConfig, FindOptions } from './repository.types.js';
import type { PaginatedResult, PaginationOptions } from '../database.types.js';

/**
 * Database type that can be either raw Kysely or plugin-aware executor
 */
type ExecutorOrKysely<DB> = Kysely<DB> | KyseraExecutor<DB>;
type TransactionOrKyseraTransaction<DB> = Transaction<DB> | KyseraTransaction<DB>;

/**
 * Base repository class implementing common database operations.
 *
 * Supports both raw Kysely instances and KyseraExecutors, enabling
 * automatic plugin interception when using executors.
 *
 * @example
 * ```typescript
 * // With raw Kysely (no plugin interception)
 * const repo = new BaseRepository(db, { tableName: 'users' });
 *
 * // With KyseraExecutor (automatic plugin interception)
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 * const repo = new BaseRepository(executor, { tableName: 'users' });
 * // All queries now have soft-delete filter applied automatically
 * ```
 */
export class BaseRepository<
  DB = Record<string, unknown>,
  TableName extends string = string,
  Entity = Record<string, unknown>,
  CreateInput = Partial<Entity>,
  UpdateInput = Partial<Entity>,
> implements IBaseRepository<Entity, CreateInput, UpdateInput>
{
  public readonly tableName: TableName;
  public readonly connectionName: string;

  /**
   * Executor for plugin-aware queries.
   * If constructed with KyseraExecutor, plugins are applied automatically.
   * For @kysera plugin compatibility.
   */
  public readonly executor: ExecutorOrKysely<DB>;

  /**
   * Plugins applied to this repository's executor (if any)
   */
  public readonly plugins: readonly Plugin[];

  protected db: ExecutorOrKysely<DB>;
  protected trx?: TransactionOrKyseraTransaction<DB>;
  protected config: RepositoryConfig<DB, TableName, Entity>;

  constructor(
    db: ExecutorOrKysely<DB> | TransactionOrKyseraTransaction<DB>,
    config: RepositoryConfig<DB, TableName, Entity>
  ) {
    this.tableName = config.tableName;
    this.connectionName = config.connectionName || 'default';
    this.config = config;

    // Check if it's a transaction or regular connection
    if ('isTransaction' in db && db.isTransaction) {
      this.trx = db as TransactionOrKyseraTransaction<DB>;
      this.db = db as ExecutorOrKysely<DB>;
    } else {
      this.db = db as ExecutorOrKysely<DB>;
    }

    // Expose executor for @kysera plugin compatibility
    this.executor = this.db;

    // Extract plugins if executor is a KyseraExecutor
    this.plugins = isKyseraExecutor(this.db)
      ? getPlugins(this.db as KyseraExecutor<DB>)
      : [];
  }

  /**
   * Check if this repository uses a plugin-aware executor
   */
  get hasExecutor(): boolean {
    return isKyseraExecutor(this.db);
  }

  /**
   * Get raw Kysely instance bypassing plugin interceptors.
   * Use for internal queries that shouldn't trigger plugin logic.
   */
  protected getRawDb(): Kysely<DB> {
    return getRawDb(this.db) as Kysely<DB>;
  }

  /**
   * Get the query builder (with transaction if available)
   */
  protected get qb() {
    return this.trx || this.db;
  }

  /**
   * Map database row to entity
   */
  protected mapRow(row: Record<string, unknown>): Entity {
    if (this.config.mapRow) {
      return this.config.mapRow(row);
    }
    return row as Entity;
  }

  /**
   * Map entity to database row
   */
  protected mapEntity(entity: Entity | CreateInput | UpdateInput): Record<string, unknown> {
    if (this.config.mapEntity) {
      return this.config.mapEntity(entity as Entity);
    }
    return entity as Record<string, unknown>;
  }

  /**
   * Validate input data
   */
  protected validateInput<T>(data: T, schema?: z.ZodType): T {
    if (!schema || !this.config.schemas) {
      return data;
    }

    try {
      return schema.parse(data) as T;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
          code: e.code,
        }));
        throw Errors.validation(fieldErrors);
      }
      throw error;
    }
  }

  /**
   * Validate database result
   */
  protected validateResult<T>(result: T): T {
    if (!this.config.validateDbResults || !this.config.schemas?.entity) {
      return result;
    }

    try {
      return this.config.schemas.entity.parse(result) as unknown as T;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
          code: e.code,
        }));
        throw Errors.validation(fieldErrors);
      }
      throw error;
    }
  }

  /**
   * Find all records
   */
  async findAll(options: FindOptions<Entity> = {}): Promise<Entity[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = this.qb.selectFrom(this.tableName as any).selectAll() as any;

    // Apply where conditions
    if (options.where) {
      for (const [key, value] of Object.entries(options.where)) {
        query = query.where(key, '=', value);
      }
    }

    // Apply ordering
    if (options.orderBy) {
      for (const { column, direction } of options.orderBy) {
        query = query.orderBy(column as string, direction);
      }
    }

    // Apply limit
    if (options.limit) {
      query = query.limit(options.limit);
    }

    // Apply offset
    if (options.offset) {
      query = query.offset(options.offset);
    }

    // Select specific columns
    if (options.select && options.select.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = (this.qb.selectFrom(this.tableName as any) as any).select(options.select as string[]);

      // Re-apply conditions after changing select
      if (options.where) {
        for (const [key, value] of Object.entries(options.where)) {
          query = query.where(key, '=', value);
        }
      }
    }

    const rows = await query.execute() as Record<string, unknown>[];
    const entities = rows.map((row) => this.mapRow(row));

    if (this.config.validateDbResults) {
      return entities.map((entity) => this.validateResult(entity));
    }

    return entities;
  }

  /**
   * Find record by ID
   */
  async findById(id: number | string): Promise<Entity | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.qb.selectFrom(this.tableName as any).selectAll() as any)
      .where('id', '=', id)
      .executeTakeFirst() as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const entity = this.mapRow(row);
    return this.config.validateDbResults ? this.validateResult(entity) : entity;
  }

  /**
   * Find one record by conditions
   */
  async findOne(conditions: Partial<Entity>): Promise<Entity | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = this.qb.selectFrom(this.tableName as any).selectAll() as any;

    for (const [key, value] of Object.entries(conditions)) {
      query = query.where(key, '=', value);
    }

    const row = await query.executeTakeFirst() as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const entity = this.mapRow(row);
    return this.config.validateDbResults ? this.validateResult(entity) : entity;
  }

  /**
   * Find many records by conditions
   */
  async findMany(conditions: Partial<Entity>): Promise<Entity[]> {
    return this.findAll({ where: conditions });
  }

  /**
   * Create a new record
   */
  async create(data: CreateInput): Promise<Entity> {
    const validatedData = this.validateInput(data, this.config.schemas?.create);
    const dbData = this.mapEntity(validatedData);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.qb.insertInto(this.tableName as any).values(dbData as any).returningAll() as any)
        .executeTakeFirstOrThrow() as Record<string, unknown>;

      const entity = this.mapRow(result);
      return this.config.validateDbResults ? this.validateResult(entity) : entity;
    } catch (error) {
      throw parseDatabaseError(error);
    }
  }

  /**
   * Create many records
   */
  async createMany(data: CreateInput[]): Promise<Entity[]> {
    if (data.length === 0) {
      return [];
    }

    const validatedData = data.map((item) => this.validateInput(item, this.config.schemas?.create));
    const dbData = validatedData.map((item) => this.mapEntity(item));

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = await (this.qb.insertInto(this.tableName as any).values(dbData as any).returningAll() as any)
        .execute() as Array<Record<string, unknown>>;

      const entities = results.map((row) => this.mapRow(row));

      if (this.config.validateDbResults) {
        return entities.map((entity) => this.validateResult(entity));
      }

      return entities;
    } catch (error) {
      throw parseDatabaseError(error);
    }
  }

  /**
   * Update a record by ID
   */
  async update(id: number | string, data: UpdateInput): Promise<Entity> {
    const validatedData = this.validateInput(data, this.config.schemas?.update);
    const dbData = this.mapEntity(validatedData);

    // Remove undefined values
    const cleanData = Object.entries(dbData).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, unknown>);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateQuery = this.qb.updateTable(this.tableName as any) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await updateQuery
        .set(cleanData)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow() as Record<string, unknown>;

      const entity = this.mapRow(result);
      return this.config.validateDbResults ? this.validateResult(entity) : entity;
    } catch (error) {
      throw parseDatabaseError(error);
    }
  }

  /**
   * Update many records by conditions
   */
  async updateMany(conditions: Partial<Entity>, data: UpdateInput): Promise<number> {
    const validatedData = this.validateInput(data, this.config.schemas?.update);
    const dbData = this.mapEntity(validatedData);

    // Remove undefined values
    const cleanData = Object.entries(dbData).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, unknown>);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateQuery = this.qb.updateTable(this.tableName as any) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = updateQuery.set(cleanData);

      for (const [key, value] of Object.entries(conditions)) {
        query = query.where(key, '=', value);
      }

      const result = await query.execute() as Array<{ numUpdatedRows?: bigint | number }>;
      return Number(result[0]?.numUpdatedRows || 0);
    } catch (error) {
      throw parseDatabaseError(error);
    }
  }

  /**
   * Delete a record by ID
   */
  async delete(id: number | string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.qb.deleteFrom(this.tableName as any) as any).where('id', '=', id).execute();
    } catch (error) {
      throw parseDatabaseError(error);
    }
  }

  /**
   * Delete many records by conditions
   */
  async deleteMany(conditions: Partial<Entity>): Promise<number> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = this.qb.deleteFrom(this.tableName as any) as any;

      for (const [key, value] of Object.entries(conditions)) {
        query = query.where(key, '=', value);
      }

      const result = await query.execute() as Array<{ numDeletedRows?: bigint | number }>;
      return Number(result[0]?.numDeletedRows || 0);
    } catch (error) {
      throw parseDatabaseError(error);
    }
  }

  /**
   * Count records
   */
  async count(conditions?: Partial<Entity>): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.qb.selectFrom(this.tableName as any) as any).select(sql<number>`count(*)`.as('count'));

    if (conditions) {
      for (const [key, value] of Object.entries(conditions)) {
        query = query.where(key, '=', value);
      }
    }

    const result = await query.executeTakeFirstOrThrow() as { count: number | bigint };
    return Number(result.count);
  }

  /**
   * Check if record exists
   */
  async exists(conditions: Partial<Entity>): Promise<boolean> {
    const count = await this.count(conditions);
    return count > 0;
  }

  /**
   * Paginate results
   */
  async paginate(options: PaginationOptions = {}): Promise<PaginatedResult<Entity>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = this.qb.selectFrom(this.tableName as any).selectAll();

    if (options.cursor) {
      // Cursor-based pagination
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paginationResult = await paginateCursor(query as any, {
        limit: options.limit || 20,
        cursor: options.cursor,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        orderBy: (options.orderBy?.map((o) => ({
          column: o.column,
          direction: o.direction,
        })) || [{ column: 'id', direction: 'asc' }]) as any,
      });

      const result = paginationResult as unknown as {
        data: Record<string, unknown>[];
        limit: number;
        hasMore: boolean;
        nextCursor?: string;
        prevCursor?: string;
      };

      const entities = result.data.map((row) => this.mapRow(row));

      return {
        data: entities,
        pagination: {
          limit: result.limit,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          prevCursor: result.prevCursor,
        },
      };
    } else {
      // Offset-based pagination
      const page = options.page || 1;
      const limit = options.limit || 20;

      // Manual implementation since kysera/core might have issues
      // Get total count first
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalResult = await (this.qb.selectFrom(this.tableName as any) as any)
        .select(sql<number>`count(*)`.as('count'))
        .executeTakeFirst() as { count: number | bigint } | undefined;
      const total = Number(totalResult?.count || 0);
      const totalPages = Math.ceil(total / limit);

      // Get paginated data
      const offset = (page - 1) * limit;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (query as any).limit(limit).offset(offset).execute() as Record<string, unknown>[];
      const entities = rows.map((row) => this.mapRow(row));

      return {
        data: entities,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
      };
    }
  }

  /**
   * Get query builder for custom queries
   */
  query(): ReturnType<typeof this.qb.selectFrom> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.qb.selectFrom(this.tableName as any);
  }

  /**
   * Create a new instance with transaction.
   * Supports both raw Kysely transactions and KyseraTransactions (plugin-aware).
   *
   * **IMPORTANT**: If the original repository has plugins, they are automatically
   * wrapped around the transaction to preserve plugin behavior.
   *
   * @example
   * ```typescript
   * // With raw transaction
   * await db.transaction().execute(async (trx) => {
   *   const txRepo = repo.withTransaction(trx);
   *   await txRepo.create({ name: 'Alice' });
   * });
   *
   * // With KyseraExecutor (plugins propagate to transaction)
   * await executor.transaction().execute(async (trx) => {
   *   const txRepo = repo.withTransaction(trx);
   *   // Plugins still applied in transaction
   *   await txRepo.create({ name: 'Bob' });
   * });
   * ```
   */
  withTransaction(
    trx: Transaction<unknown> | KyseraTransaction<unknown>
  ): IBaseRepository<Entity, CreateInput, UpdateInput> {
    // If the original repository has plugins, wrap the transaction to preserve them
    // This ensures soft-delete, timestamps, audit, and other plugins work in transactions
    if (this.plugins.length > 0) {
      // Check if transaction is already wrapped (KyseraTransaction)
      const isAlreadyWrapped = '__kysera' in trx;

      if (!isAlreadyWrapped) {
        // Wrap raw transaction with plugins
        const wrappedTrx = wrapTransaction(
          trx as Transaction<DB>,
          this.plugins
        );
        return new BaseRepository(wrappedTrx as TransactionOrKyseraTransaction<DB>, this.config);
      }
    }

    return new BaseRepository(trx as TransactionOrKyseraTransaction<DB>, this.config);
  }
}
