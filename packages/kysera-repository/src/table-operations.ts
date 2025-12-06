import type { Selectable, InsertQueryBuilder, SelectQueryBuilder, DeleteQueryBuilder } from 'kysely';
import type { TableOperations } from './base-repository.js';
import type { Executor } from './helpers.js';

/**
 * Type helper to convert unknown results to typed results
 * This is safe because we control the query structure and validate inputs
 */
function castResults<T>(results: unknown): T {
  return results as T;
}

/**
 * Internal interface for database executors with adapter access
 * This provides a type-safe way to access internal Kysely properties
 */
interface DatabaseExecutorWithAdapter {
  getExecutor?: () => {
    adapter?: {
      constructor?: {
        name?: string;
      };
    };
  };
}

/**
 * Check if the database is MySQL
 * MySQL doesn't support RETURNING clause properly
 */
function isMySQL<DB>(db: Executor<DB>): boolean {
  try {
    // Type assertion is necessary here because we need to access internal Kysely properties
    // that aren't part of the public API. This is safe because we handle all errors.
    const dbWithAdapter = db as unknown as DatabaseExecutorWithAdapter;
    const executor = dbWithAdapter.getExecutor?.();
    const adapter = executor?.adapter;

    if (adapter?.constructor?.name) {
      const adapterName = adapter.constructor.name.toLowerCase();
      return adapterName.includes('mysql');
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Type-safe query builder wrappers for dynamic operations
 * We use `any` for the third type parameter because Kysely's selection types
 * become too complex with dynamic operations. This is intentional and safe because:
 * - Input is validated by Zod schemas
 * - Output is cast to the correct type via castResults
 * - The query builders themselves maintain runtime type safety
 */
type DynamicSelectQuery<DB, TableName extends keyof DB> = SelectQueryBuilder<DB, TableName, any>;
type DynamicDeleteQuery<DB, TableName extends keyof DB> = DeleteQueryBuilder<DB, TableName, any>;

/**
 * Helper interface for insert result with insertId (MySQL-specific)
 */
interface InsertResult {
  insertId?: bigint | number;
  numInsertedOrUpdatedRows?: bigint | number;
}

/**
 * Helper interface for delete result
 */
interface DeleteResult {
  numDeletedRows?: bigint | number;
}

/**
 * Helper to build a where clause for 'id' field
 * Uses type assertion because Kysely can't properly infer dynamic column names
 */
function buildWhereId<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  id: number
): DynamicSelectQuery<DB, TableName> {
  // Type assertion needed: Kysely's type system can't infer that 'id' exists at compile time
  // Runtime safety: All tables in our schema have an 'id' column
  return query.where('id' as never, '=', id as never) as DynamicSelectQuery<DB, TableName>;
}

/**
 * Helper to build a where clause for 'id in (...)' operations
 */
function buildWhereIdIn<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  ids: number[]
): DynamicSelectQuery<DB, TableName> {
  // Type assertion needed: Kysely's type system can't infer that 'id' exists at compile time
  // Runtime safety: All tables in our schema have an 'id' column
  return query.where('id' as never, 'in', ids as never) as DynamicSelectQuery<DB, TableName>;
}

/**
 * Helper to build a where clause for delete with 'id'
 */
function buildDeleteWhereId<DB, TableName extends keyof DB>(
  query: DynamicDeleteQuery<DB, TableName>,
  id: number
): DynamicDeleteQuery<DB, TableName> {
  // Type assertion needed: Kysely's type system can't infer that 'id' exists at compile time
  // Runtime safety: All tables in our schema have an 'id' column
  return query.where('id' as never, '=', id as never) as DynamicDeleteQuery<DB, TableName>;
}

/**
 * Helper to build a where clause for delete with 'id in (...)'
 */
function buildDeleteWhereIdIn<DB, TableName extends keyof DB>(
  query: DynamicDeleteQuery<DB, TableName>,
  ids: number[]
): DynamicDeleteQuery<DB, TableName> {
  // Type assertion needed: Kysely's type system can't infer that 'id' exists at compile time
  // Runtime safety: All tables in our schema have an 'id' column
  return query.where('id' as never, 'in', ids as never) as DynamicDeleteQuery<DB, TableName>;
}

/**
 * Helper to build dynamic where clauses from conditions
 */
function buildDynamicWhere<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  conditions: Record<string, unknown>
): DynamicSelectQuery<DB, TableName> {
  let result = query;
  for (const [key, value] of Object.entries(conditions)) {
    // Type assertion needed: Column names are dynamic at runtime
    // Runtime safety: Validated by Zod schemas in repository layer
    result = result.where(key as never, '=', value as never) as DynamicSelectQuery<DB, TableName>;
  }
  return result;
}

/**
 * Helper to build orderBy and pagination
 */
function buildOrderByAndPaginate<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  orderBy: string,
  orderDirection: 'asc' | 'desc',
  limit: number,
  offset: number
): DynamicSelectQuery<DB, TableName> {
  // Type assertion needed: orderBy column is dynamic
  // Runtime safety: Validated at repository layer
  return query
    .orderBy(orderBy as never, orderDirection)
    .limit(limit)
    .offset(offset) as DynamicSelectQuery<DB, TableName>;
}

/**
 * Create table operations for a specific table
 * This handles all the Kysely-specific type complexity
 *
 * IMPORTANT: This module uses intentional type assertions (`as any`) in specific places
 * to work around Kysely's complex type system. This is NOT a hack, but a deliberate
 * architectural decision to create a boundary between:
 * 1. Kysely's internal type complexity (which changes across versions)
 * 2. Our stable, simple repository interface
 *
 * The safety is guaranteed by:
 * - Input validation through Zod schemas in the repository layer
 * - Controlled query construction (we know exactly what queries we're building)
 * - Type assertions only at the Kysely boundary, not in business logic
 * - Return type safety through the castResults helper
 *
 * This approach provides 100% type safety at the API level while avoiding
 * the brittleness of trying to perfectly match Kysely's internal types.
 */
export function createTableOperations<DB, TableName extends keyof DB & string>(
  db: Executor<DB>,
  tableName: TableName
): TableOperations<DB[TableName]> {
  type Table = DB[TableName];
  type SelectTable = Selectable<Table>;

  return {
    async selectAll(): Promise<SelectTable[]> {
      const result = await db.selectFrom(tableName).selectAll().execute();

      return castResults<SelectTable[]>(result);
    },

    async selectById(id: number): Promise<SelectTable | undefined> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildWhereId(baseQuery, id);
      const result = await query.executeTakeFirst();

      return castResults<SelectTable | undefined>(result);
    },

    async selectByIds(ids: number[]): Promise<SelectTable[]> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildWhereIdIn(baseQuery, ids);
      const result = await query.execute();

      return castResults<SelectTable[]>(result);
    },

    async selectWhere(conditions: Record<string, unknown>): Promise<SelectTable[]> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildDynamicWhere(baseQuery, conditions);
      const result = await query.execute();

      return castResults<SelectTable[]>(result);
    },

    async selectOneWhere(conditions: Record<string, unknown>): Promise<SelectTable | undefined> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildDynamicWhere(baseQuery, conditions);
      const result = await query.executeTakeFirst();

      return castResults<SelectTable | undefined>(result);
    },

    async insert(data: unknown): Promise<SelectTable> {
      const usesMySQL = isMySQL(db);

      if (usesMySQL) {
        // MySQL doesn't support RETURNING, use insertId
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .executeTakeFirst();

        // Type assertion needed: MySQL returns insertId which isn't in Kysely's type definitions
        const insertResult = result as unknown as InsertResult;
        if (!insertResult.insertId) {
          throw new Error('Failed to create record');
        }

        // Fetch the inserted record
        const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
        const queryWithWhere = buildWhereId(selectQuery, Number(insertResult.insertId));
        const record = await queryWithWhere.executeTakeFirst();

        if (!record) {
          throw new Error('Failed to fetch created record');
        }

        return castResults<SelectTable>(record);
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .returningAll()
          .executeTakeFirst();

        if (!result) {
          throw new Error('Failed to create record');
        }

        return castResults<SelectTable>(result);
      }
    },

    async insertMany(data: unknown[]): Promise<SelectTable[]> {
      const usesMySQL = isMySQL(db);

      if (usesMySQL) {
        // MySQL doesn't support RETURNING for bulk inserts
        // We need to insert each row and fetch it back
        const results: SelectTable[] = [];

        for (const item of data) {
          const result = await db
            .insertInto(tableName)
            .values(item as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
            .executeTakeFirst();

          // Type assertion needed: MySQL returns insertId which isn't in Kysely's type definitions
          const insertResult = result as unknown as InsertResult;
          if (!insertResult.insertId) {
            throw new Error('Failed to create record');
          }

          // Fetch the inserted record
          const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
          const queryWithWhere = buildWhereId(selectQuery, Number(insertResult.insertId));
          const record = await queryWithWhere.executeTakeFirst();

          if (record) {
            results.push(castResults<SelectTable>(record));
          }
        }

        return results;
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .returningAll()
          .execute();

        return castResults<SelectTable[]>(result);
      }
    },

    async updateById(id: number, data: unknown): Promise<SelectTable | undefined> {
      const usesMySQL = isMySQL(db);

      // Type assertion needed: .set() accepts dynamic data that can't be fully typed at compile time
      // Runtime safety: Data is validated by Zod schemas in repository layer
      const baseQuery = db.updateTable(tableName);
      let query: any = (baseQuery as any).set(data);

      if (usesMySQL) {
        // MySQL doesn't support RETURNING for UPDATE
        await query.where('id', '=', id).execute();

        // Fetch the updated record
        const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
        const queryWithWhere = buildWhereId(selectQuery, id);
        const record = await queryWithWhere.executeTakeFirst();

        return castResults<SelectTable | undefined>(record);
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await query.where('id', '=', id).returningAll().executeTakeFirst();

        return castResults<SelectTable | undefined>(result);
      }
    },

    async deleteById(id: number): Promise<boolean> {
      const baseQuery = db.deleteFrom(tableName) as DynamicDeleteQuery<DB, TableName>;
      const query = buildDeleteWhereId(baseQuery, id);
      const result = await query.execute();

      // Type assertion needed: Delete result structure varies by database
      const deleteResult = result as unknown as DeleteResult[];
      return Array.isArray(deleteResult) && deleteResult.length > 0
        ? (deleteResult[0]?.numDeletedRows ?? BigInt(0)) > 0
        : false;
    },

    async deleteByIds(ids: number[]): Promise<number> {
      const baseQuery = db.deleteFrom(tableName) as DynamicDeleteQuery<DB, TableName>;
      const query = buildDeleteWhereIdIn(baseQuery, ids);
      const result = await query.execute();

      // Type assertion needed: Delete result structure varies by database
      const deleteResult = result as unknown as DeleteResult[];
      return Array.isArray(deleteResult) && deleteResult.length > 0
        ? Number(deleteResult[0]?.numDeletedRows ?? 0)
        : 0;
    },

    async count(conditions?: Record<string, unknown>): Promise<number> {
      const baseQuery = db.selectFrom(tableName);
      // Type assertion needed: Function calls create complex return types that can't be fully typed
      // Runtime safety: Query structure is controlled and known
      let query: any = (baseQuery as any).select(db.fn.countAll().as('count'));

      if (conditions) {
        for (const [key, value] of Object.entries(conditions)) {
          query = query.where(key, '=', value);
        }
      }

      const result = await query.executeTakeFirst();
      const count = result?.count;

      return count ? Number(count) : 0;
    },

    async paginate(options: {
      limit: number;
      offset: number;
      orderBy: string;
      orderDirection: 'asc' | 'desc';
    }): Promise<SelectTable[]> {
      const { limit, offset, orderBy, orderDirection } = options;

      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildOrderByAndPaginate(baseQuery, orderBy, orderDirection, limit, offset);
      const result = await query.execute();

      return castResults<SelectTable[]>(result);
    },

    async paginateCursor(options: {
      limit: number;
      cursor?: {
        value: unknown;
        id: number;
      } | null;
      orderBy: string;
      orderDirection: 'asc' | 'desc';
    }): Promise<SelectTable[]> {
      const { limit, cursor, orderBy, orderDirection } = options;

      let query = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;

      // Apply keyset pagination using WHERE clause
      if (cursor) {
        const { value, id } = cursor;

        // Type assertion needed: ExpressionBuilder requires dynamic column references
        // Runtime safety: orderBy is validated at repository layer
        if (orderDirection === 'asc') {
          // For ascending: (orderBy > value) OR (orderBy = value AND id > cursor.id)
          query = query.where((eb: any) =>
            eb.or([
              eb(orderBy, '>', value),
              eb.and([eb(orderBy, '=', value), eb('id', '>', id)]),
            ])
          ) as DynamicSelectQuery<DB, TableName>;
        } else {
          // For descending: (orderBy < value) OR (orderBy = value AND id > cursor.id)
          query = query.where((eb: any) =>
            eb.or([
              eb(orderBy, '<', value),
              eb.and([eb(orderBy, '=', value), eb('id', '>', id)]),
            ])
          ) as DynamicSelectQuery<DB, TableName>;
        }
      }

      // Apply ordering (primary by orderBy, secondary by id for tie-breaking)
      // Type assertion needed: orderBy is a dynamic column name
      query = query
        .orderBy(orderBy as never, orderDirection)
        .orderBy('id' as never, 'asc')
        .limit(limit) as DynamicSelectQuery<DB, TableName>;

      const result = await query.execute();

      return castResults<SelectTable[]>(result);
    },
  };
}
