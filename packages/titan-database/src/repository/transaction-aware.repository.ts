/**
 * Transaction-Aware Repository (GOLDEN PATH)
 *
 * A repository base class that automatically uses the current transaction
 * from AsyncLocalStorage context. Provides standard CRUD operations.
 *
 * @module
 */

import type { Kysely, Transaction, Selectable, Insertable, Updateable } from 'kysely';
import { getExecutor, isInTransactionContext, getCurrentTransaction } from '../transaction/transaction.context.js';
import { applyWhereClause, type WhereClause } from '@kysera/repository';
import { upsert as kyseraUpsert, upsertMany as kyseraUpsertMany, type UpsertOptions } from '@kysera/repository';
import { parseDatabaseError, type DatabaseError as KyseraDatabaseError } from '@kysera/core';

/**
 * Executor type — either Kysely instance or Transaction
 */
export type Executor<DB> = Kysely<DB> | Transaction<DB>;

export interface FindManyOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  direction?: 'asc' | 'desc';
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  direction?: 'asc' | 'desc';
  includeSoftDeleted?: boolean;
}

export interface OffsetPaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CursorOptions {
  limit?: number;
  cursor?: string;
  orderBy: Array<{ column: string; direction: 'asc' | 'desc' }>;
}

export interface CursorResult<T> {
  data: T[];
  pagination: { hasNext: boolean; nextCursor?: string; limit: number };
}

interface CountResult {
  count: string | number | bigint;
}

type DynamicQueryBuilder = {
  selectFrom(table: string): unknown;
  insertInto(table: string): unknown;
  updateTable(table: string): unknown;
  deleteFrom(table: string): unknown;
};

/**
 * Abstract repository that automatically uses transaction context.
 */
export abstract class TransactionAwareRepository<DB, Table extends string> {
  protected readonly hasSoftDelete: boolean = false;
  protected readonly softDeleteColumn: string = 'deletedAt';

  constructor(
    protected readonly db: Kysely<DB>,
    public readonly tableName: Table
  ) {}

  protected get executor(): Executor<DB> {
    return getExecutor(this.db);
  }

  protected get inTransaction(): boolean {
    return isInTransactionContext();
  }

  protected get transaction(): Transaction<DB> | undefined {
    return getCurrentTransaction<DB>();
  }

  protected get dynamicExecutor(): DynamicQueryBuilder {
    return this.executor as unknown as DynamicQueryBuilder;
  }

  // ===========================================================================
  // QUERY HELPERS
  // ===========================================================================

  protected async findOneBy<K extends string>(
    field: K,
    value: unknown
  ): Promise<Selectable<DB[Table & keyof DB]> | null> {
    type QR = {
      selectAll(): QR;
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .selectAll()
      .where(field, '=', value)
      .executeTakeFirst();

    return result ?? null;
  }

  protected async findManyBy<K extends string>(
    field: K,
    value: unknown,
    options?: FindManyOptions
  ): Promise<Selectable<DB[Table & keyof DB]>[]> {
    type QR = {
      selectAll(): QR;
      where(field: string, op: string, value: unknown): QR;
      orderBy(column: string, direction: 'asc' | 'desc'): QR;
      limit(n: number): QR;
      offset(n: number): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    let query = (this.dynamicExecutor.selectFrom(this.tableName) as QR).selectAll().where(field, '=', value);
    if (options?.orderBy) query = query.orderBy(options.orderBy, options.direction ?? 'desc');
    if (options?.limit !== undefined) query = query.limit(options.limit);
    if (options?.offset !== undefined) query = query.offset(options.offset);
    return await query.execute();
  }

  protected async findAll(options?: FindManyOptions): Promise<Selectable<DB[Table & keyof DB]>[]> {
    type QR = {
      selectAll(): QR;
      orderBy(column: string, direction: 'asc' | 'desc'): QR;
      limit(n: number): QR;
      offset(n: number): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    let query = (this.dynamicExecutor.selectFrom(this.tableName) as QR).selectAll();
    if (options?.orderBy) query = query.orderBy(options.orderBy, options.direction ?? 'desc');
    if (options?.limit !== undefined) query = query.limit(options.limit);
    if (options?.offset !== undefined) query = query.offset(options.offset);
    return await query.execute();
  }

  protected async countBy<K extends string>(field: K, value: unknown): Promise<number> {
    type CEB = { fn: { count(column: string): { as(alias: string): unknown } } };
    type QR = {
      select(fn: (eb: CEB) => unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<CountResult | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .select((eb: CEB) => eb.fn.count('id').as('count'))
      .where(field, '=', value)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  protected async existsBy<K extends string>(field: K, value: unknown): Promise<boolean> {
    type LEB = { lit<V>(value: V): { as(alias: string): unknown } };
    type QR = {
      select(fn: (eb: LEB) => unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      limit(n: number): QR;
      executeTakeFirst(): Promise<unknown | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .select((eb: LEB) => eb.lit(1).as('exists'))
      .where(field, '=', value)
      .limit(1)
      .executeTakeFirst();

    return result !== undefined;
  }

  // ===========================================================================
  // STANDARD CRUD
  // ===========================================================================

  async findById(id: string): Promise<Selectable<DB[Table & keyof DB]> | null> {
    return this.findOneBy('id', id);
  }

  async findByIds(ids: string[]): Promise<Selectable<DB[Table & keyof DB]>[]> {
    if (ids.length === 0) return [];

    type QR = {
      selectAll(): QR;
      where(field: string, op: string, values: string[]): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    return (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .selectAll()
      .where('id', 'in', ids)
      .execute();
  }

  async create(data: Insertable<DB[Table & keyof DB]>): Promise<Selectable<DB[Table & keyof DB]>> {
    type QR = {
      values(data: unknown): QR;
      returningAll(): QR;
      executeTakeFirstOrThrow(): Promise<Selectable<DB[Table & keyof DB]>>;
    };

    return (this.dynamicExecutor.insertInto(this.tableName) as QR)
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createMany(data: Insertable<DB[Table & keyof DB]>[]): Promise<Selectable<DB[Table & keyof DB]>[]> {
    if (data.length === 0) return [];

    type QR = {
      values(data: unknown[]): QR;
      returningAll(): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    return (this.dynamicExecutor.insertInto(this.tableName) as QR).values(data).returningAll().execute();
  }

  async update(id: string, data: Updateable<DB[Table & keyof DB]>): Promise<Selectable<DB[Table & keyof DB]> | null> {
    type QR = {
      set(data: unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      returningAll(): QR;
      executeTakeFirst(): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
    };

    const result = await (this.dynamicExecutor.updateTable(this.tableName) as QR)
      .set(data)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async delete(id: string): Promise<boolean> {
    type QR = {
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<{ numDeletedRows: bigint } | undefined>;
    };

    const result = await (this.dynamicExecutor.deleteFrom(this.tableName) as QR)
      .where('id', '=', id)
      .executeTakeFirst();

    return (result?.numDeletedRows ?? 0n) > 0n;
  }

  // ===========================================================================
  // SOFT DELETE
  // ===========================================================================

  async softDelete(id: string): Promise<boolean> {
    if (!this.hasSoftDelete) {
      throw new Error(`softDelete() called on table "${this.tableName}" which does not support soft delete`);
    }

    type QR = {
      set(data: unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<{ numUpdatedRows: bigint } | undefined>;
    };

    const result = await (this.dynamicExecutor.updateTable(this.tableName) as QR)
      .set({ [this.softDeleteColumn]: new Date().toISOString() })
      .where('id', '=', id)
      .executeTakeFirst();

    return (result?.numUpdatedRows ?? 0n) > 0n;
  }

  async restore(id: string): Promise<Selectable<DB[Table & keyof DB]> | null> {
    if (!this.hasSoftDelete) {
      throw new Error(`restore() called on table "${this.tableName}" which does not support soft delete`);
    }

    type QR = {
      set(data: unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      returningAll(): QR;
      executeTakeFirst(): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
    };

    const result = await (this.dynamicExecutor.updateTable(this.tableName) as QR)
      .set({ [this.softDeleteColumn]: null })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  // ===========================================================================
  // LIST WITH PAGINATION
  // ===========================================================================

  async list(options: ListOptions = {}): Promise<OffsetPaginatedResult<Selectable<DB[Table & keyof DB]>>> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const orderBy = options.orderBy ?? 'createdAt';
    const direction = options.direction ?? 'desc';
    const includeSoftDeleted = options.includeSoftDeleted ?? false;

    type CEB = { fn: { count(column: string): { as(alias: string): unknown } } };
    type CountQR = {
      select(fn: (eb: CEB) => unknown): CountQR;
      where(field: string, op: string, value: unknown): CountQR;
      executeTakeFirst(): Promise<{ count: string | number | bigint } | undefined>;
    };

    let countQuery = (this.dynamicExecutor.selectFrom(this.tableName) as CountQR).select(
      (eb: CEB) => eb.fn.count('id').as('count')
    );
    if (this.hasSoftDelete && !includeSoftDeleted) {
      countQuery = countQuery.where(this.softDeleteColumn, 'is', null);
    }
    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.count ?? 0);

    type SelectQR = {
      selectAll(): SelectQR;
      where(field: string, op: string, value: unknown): SelectQR;
      orderBy(column: string, direction: 'asc' | 'desc'): SelectQR;
      limit(n: number): SelectQR;
      offset(n: number): SelectQR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    let dataQuery = (this.dynamicExecutor.selectFrom(this.tableName) as SelectQR).selectAll();
    if (this.hasSoftDelete && !includeSoftDeleted) {
      dataQuery = dataQuery.where(this.softDeleteColumn, 'is', null);
    }
    const data = await dataQuery.orderBy(orderBy, direction).limit(limit).offset(offset).execute();

    return { data, total, limit, offset, hasMore: offset + data.length < total };
  }

  // ===========================================================================
  // EXISTS / COUNT
  // ===========================================================================

  async exists(id: string, includeSoftDeleted = false): Promise<boolean> {
    type LEB = { lit<V>(value: V): { as(alias: string): unknown } };
    type QR = {
      select(fn: (eb: LEB) => unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      limit(n: number): QR;
      executeTakeFirst(): Promise<unknown | undefined>;
    };

    let query = (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .select((eb: LEB) => eb.lit(1).as('exists'))
      .where('id', '=', id);

    if (this.hasSoftDelete && !includeSoftDeleted) {
      query = query.where(this.softDeleteColumn, 'is', null);
    }

    const result = await query.limit(1).executeTakeFirst();
    return result !== undefined;
  }

  async count(includeSoftDeleted = false): Promise<number> {
    type CEB = { fn: { count(column: string): { as(alias: string): unknown } } };
    type QR = {
      select(fn: (eb: CEB) => unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<{ count: string | number | bigint } | undefined>;
    };

    let query = (this.dynamicExecutor.selectFrom(this.tableName) as QR).select((eb: CEB) =>
      eb.fn.count('id').as('count')
    );
    if (this.hasSoftDelete && !includeSoftDeleted) {
      query = query.where(this.softDeleteColumn, 'is', null);
    }
    const result = await query.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  // ===========================================================================
  // WHERE-CLAUSE QUERIES (using @kysera/repository applyWhereClause)
  // ===========================================================================

  async findWhere(
    where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>,
    options?: FindManyOptions
  ): Promise<Selectable<DB[Table & keyof DB]>[]> {
    type QR = {
      selectAll(): QR;
      where(fn: (eb: unknown) => unknown): QR;
      orderBy(column: string, direction: 'asc' | 'desc'): QR;
      limit(n: number): QR;
      offset(n: number): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    let query = (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .selectAll()
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>));

    if (options?.orderBy) query = query.orderBy(options.orderBy, options.direction ?? 'desc');
    if (options?.limit !== undefined) query = query.limit(options.limit);
    if (options?.offset !== undefined) query = query.offset(options.offset);
    return await query.execute();
  }

  async findOneWhere(
    where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>
  ): Promise<Selectable<DB[Table & keyof DB]> | null> {
    type QR = {
      selectAll(): QR;
      where(fn: (eb: unknown) => unknown): QR;
      limit(n: number): QR;
      executeTakeFirst(): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .selectAll()
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>))
      .limit(1)
      .executeTakeFirst();

    return result ?? null;
  }

  async countWhere(where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>): Promise<number> {
    type CEB = { fn: { count(column: string): { as(alias: string): unknown } } };
    type QR = {
      select(fn: (eb: CEB) => unknown): QR;
      where(fn: (eb: unknown) => unknown): QR;
      executeTakeFirst(): Promise<{ count: string | number | bigint } | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .select((eb: CEB) => eb.fn.count('id').as('count'))
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>))
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  async deleteWhere(where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>): Promise<number> {
    type QR = {
      where(fn: (eb: unknown) => unknown): QR;
      executeTakeFirst(): Promise<{ numDeletedRows: bigint } | undefined>;
    };

    const result = await (this.dynamicExecutor.deleteFrom(this.tableName) as QR)
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>))
      .executeTakeFirst();

    return Number(result?.numDeletedRows ?? 0n);
  }

  async updateWhere(
    where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>,
    data: Updateable<DB[Table & keyof DB]>
  ): Promise<number> {
    type QR = {
      set(data: unknown): QR;
      where(fn: (eb: unknown) => unknown): QR;
      executeTakeFirst(): Promise<{ numUpdatedRows: bigint } | undefined>;
    };

    const result = await (this.dynamicExecutor.updateTable(this.tableName) as QR)
      .set(data)
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>))
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }

  // ===========================================================================
  // UPSERT
  // ===========================================================================

  async upsert(
    data: Insertable<DB[Table & keyof DB]>,
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>> & { returning: true }
  ): Promise<Selectable<DB[Table & keyof DB]>>;
  async upsert(
    data: Insertable<DB[Table & keyof DB]>,
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>>
  ): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
  async upsert(
    data: Insertable<DB[Table & keyof DB]>,
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>>
  ): Promise<Selectable<DB[Table & keyof DB]> | undefined> {
    return kyseraUpsert(this.executor as never, this.tableName as never, data as never, options as never) as Promise<
      Selectable<DB[Table & keyof DB]> | undefined
    >;
  }

  async upsertMany(
    data: Insertable<DB[Table & keyof DB]>[],
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>> & { returning: true }
  ): Promise<Selectable<DB[Table & keyof DB]>[]>;
  async upsertMany(
    data: Insertable<DB[Table & keyof DB]>[],
    options: Omit<UpsertOptions<Insertable<DB[Table & keyof DB]>>, 'returning'>
  ): Promise<void>;
  async upsertMany(
    data: Insertable<DB[Table & keyof DB]>[],
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>>
  ): Promise<Selectable<DB[Table & keyof DB]>[] | void> {
    return kyseraUpsertMany(
      this.executor as never,
      this.tableName as never,
      data as never,
      options as never
    ) as Promise<Selectable<DB[Table & keyof DB]>[] | void>;
  }

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  parseError(error: unknown, dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql' = 'postgres'): KyseraDatabaseError {
    return parseDatabaseError(error, dialect);
  }
}
