/**
 * Base Repository Implementation
 *
 * Provides common database operations for all repositories
 */

import {
  Kysely,
  Transaction,
  Selectable,
  Insertable,
  Updateable,
  sql,
} from 'kysely';
import { z } from 'zod';
import {
  paginate,
  paginateCursor,
  parseDatabaseError,
} from '@kysera/core';
import type {
  IBaseRepository,
  RepositoryConfig,
  FindOptions,
} from './repository.types.js';
import type {
  PaginatedResult,
  PaginationOptions,
} from '../database.types.js';

/**
 * Base repository class implementing common database operations
 */
export class BaseRepository<
  DB = any,
  TableName extends string = string,
  Entity = any,
  CreateInput = any,
  UpdateInput = any
> implements IBaseRepository<Entity, CreateInput, UpdateInput> {
  public readonly tableName: TableName;
  public readonly connectionName: string;

  protected db: Kysely<any>;
  protected trx?: Transaction<any>;
  protected config: RepositoryConfig<any, any, any>;

  constructor(
    db: Kysely<any> | Transaction<any>,
    config: RepositoryConfig<any, any, any>
  ) {
    this.tableName = config.tableName;
    this.connectionName = config.connectionName || 'default';
    this.config = config;

    // Check if it's a transaction or regular connection
    if ('isTransaction' in db && db.isTransaction) {
      this.trx = db as Transaction<any>;
      this.db = db as any; // Transaction is also a Kysely instance
    } else {
      this.db = db as Kysely<any>;
    }
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
  protected mapRow(row: any): Entity {
    if (this.config.mapRow) {
      return this.config.mapRow(row);
    }
    return row as Entity;
  }

  /**
   * Map entity to database row
   */
  protected mapEntity(entity: Entity | CreateInput | UpdateInput): any {
    if (this.config.mapEntity) {
      return this.config.mapEntity(entity as Entity);
    }
    return entity;
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
        throw new Error(`Validation failed: ${error.message}`);
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
      return this.config.schemas.entity.parse(result) as T;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Database result validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Find all records
   */
  async findAll(options: FindOptions<Entity> = {}): Promise<Entity[]> {
    let query = this.qb.selectFrom(this.tableName).selectAll();

    // Apply where conditions
    if (options.where) {
      for (const [key, value] of Object.entries(options.where)) {
        query = (query as any).where(key, '=', value);
      }
    }

    // Apply ordering
    if (options.orderBy) {
      for (const { column, direction } of options.orderBy) {
        query = (query as any).orderBy(column, direction);
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
      query = (this.qb
        .selectFrom(this.tableName) as any)
        .select(options.select);

      // Re-apply conditions after changing select
      if (options.where) {
        for (const [key, value] of Object.entries(options.where)) {
          query = (query as any).where(key, '=', value);
        }
      }
    }

    const rows = await query.execute();
    const entities = rows.map(row => this.mapRow(row));

    if (this.config.validateDbResults) {
      return entities.map(entity => this.validateResult(entity));
    }

    return entities;
  }

  /**
   * Find record by ID
   */
  async findById(id: number | string): Promise<Entity | null> {
    const row = await (this.qb
      .selectFrom(this.tableName)
      .selectAll() as any)
      .where('id', '=', id)
      .executeTakeFirst();

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
    let query = this.qb.selectFrom(this.tableName).selectAll();

    for (const [key, value] of Object.entries(conditions)) {
      query = (query as any).where(key, '=', value);
    }

    const row = await query.executeTakeFirst();

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
      const result = await this.qb
        .insertInto(this.tableName)
        .values(dbData)
        .returningAll()
        .executeTakeFirstOrThrow();

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

    const validatedData = data.map(item =>
      this.validateInput(item, this.config.schemas?.create)
    );
    const dbData = validatedData.map(item => this.mapEntity(item));

    try {
      const results = await this.qb
        .insertInto(this.tableName)
        .values(dbData)
        .returningAll()
        .execute();

      const entities = results.map(row => this.mapRow(row));

      if (this.config.validateDbResults) {
        return entities.map(entity => this.validateResult(entity));
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
    }, {} as any);

    try {
      const result = await (this.qb
        .updateTable(this.tableName)
        .set(cleanData) as any)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

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
    }, {} as any);

    try {
      let query = this.qb.updateTable(this.tableName).set(cleanData);

      for (const [key, value] of Object.entries(conditions)) {
        query = (query as any).where(key, '=', value);
      }

      const result = await query.execute();
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
      await (this.qb
        .deleteFrom(this.tableName) as any)
        .where('id', '=', id)
        .execute();
    } catch (error) {
      throw parseDatabaseError(error);
    }
  }

  /**
   * Delete many records by conditions
   */
  async deleteMany(conditions: Partial<Entity>): Promise<number> {
    try {
      let query = this.qb.deleteFrom(this.tableName);

      for (const [key, value] of Object.entries(conditions)) {
        query = (query as any).where(key, '=', value);
      }

      const result = await query.execute();
      return Number(result[0]?.numDeletedRows || 0);
    } catch (error) {
      throw parseDatabaseError(error);
    }
  }

  /**
   * Count records
   */
  async count(conditions?: Partial<Entity>): Promise<number> {
    let query = (this.qb
      .selectFrom(this.tableName) as any)
      .select(sql<number>`count(*)`.as('count'));

    if (conditions) {
      for (const [key, value] of Object.entries(conditions)) {
        query = (query as any).where(key, '=', value);
      }
    }

    const result = await query.executeTakeFirstOrThrow();
    return Number((result as any).count);
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
    const query = this.qb.selectFrom(this.tableName).selectAll();

    if (options.cursor) {
      // Cursor-based pagination
      const result = await paginateCursor(query as any, {
        limit: options.limit || 20,
        cursor: options.cursor,
        orderBy: (options.orderBy?.map(o => ({
          column: o.column,
          direction: o.direction,
        })) || [{ column: 'id', direction: 'asc' }]) as any,
      }) as any;

      const entities = result.data.map((row: any) => this.mapRow(row));

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
      const result = await paginate(query as any, {
        page: options.page || 1,
        limit: options.limit || 20,
      }) as any;

      const entities = result.data.map((row: any) => this.mapRow(row));

      return {
        data: entities,
        pagination: {
          page: result.page || options.page || 1,
          limit: result.limit || options.limit || 20,
          total: result.total,
          totalPages: result.totalPages,
          hasMore: result.page < result.totalPages,
        },
      };
    }
  }

  /**
   * Get query builder for custom queries
   */
  query(): any {
    return this.qb.selectFrom(this.tableName);
  }

  /**
   * Create a new instance with transaction
   */
  withTransaction(trx: Transaction<any>): IBaseRepository<Entity, CreateInput, UpdateInput> {
    return new BaseRepository(trx, this.config);
  }
}