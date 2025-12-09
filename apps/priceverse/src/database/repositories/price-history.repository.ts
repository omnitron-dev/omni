/**
 * Priceverse - Price History Repository
 * Uses Titan's BaseRepository for type-safe CRUD operations
 */

import {
  BaseRepository,
  Repository,
  type Kysely,
  type Insertable,
  type Selectable,
} from '@omnitron-dev/titan/module/database';
import type { Database, PriceHistoryTable } from '../schema.js';
import type { PairSymbol, AggregationMethod } from '../../shared/types.js';

// Entity type (what we get from DB)
export type PriceHistoryEntity = Selectable<PriceHistoryTable>;

// Create input type
export interface CreatePriceHistoryInput {
  pair: PairSymbol;
  price: string;
  timestamp: Date | string;
  method: AggregationMethod;
  sources: string[];
  volume?: string | null;
}

// Update input type (all fields optional except ID)
export interface UpdatePriceHistoryInput {
  price?: string;
  method?: AggregationMethod;
  sources?: string[];
  volume?: string | null;
}

// Query options for findByPair
export interface PriceHistoryQueryOptions {
  pair: PairSymbol;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  orderBy?: 'asc' | 'desc';
}

@Repository({
  table: 'price_history',
  connection: 'default',
})
export class PriceHistoryRepository extends BaseRepository<
  Database,
  'price_history',
  PriceHistoryEntity,
  CreatePriceHistoryInput,
  UpdatePriceHistoryInput
> {
  constructor(db: Kysely<Database>) {
    super(db, {
      tableName: 'price_history',
      connectionName: 'default',
    });
  }

  /**
   * Override mapEntity to serialize sources array to JSON for PostgreSQL JSONB column
   */
  protected override mapEntity(
    entity: PriceHistoryEntity | CreatePriceHistoryInput | UpdatePriceHistoryInput
  ): Record<string, unknown> {
    const mapped = { ...entity } as Record<string, unknown>;
    if ('sources' in entity && Array.isArray(entity.sources)) {
      mapped.sources = JSON.stringify(entity.sources);
    }
    return mapped;
  }

  /**
   * Get latest price for a specific pair
   */
  async getLatestPrice(pair: PairSymbol): Promise<PriceHistoryEntity | null> {
    const result = await this.db
      .selectFrom('price_history')
      .selectAll()
      .where('pair', '=', pair)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .executeTakeFirst();

    return result ?? null;
  }

  /**
   * Get prices for a pair within a time range
   */
  async findByPairInRange(
    options: PriceHistoryQueryOptions
  ): Promise<PriceHistoryEntity[]> {
    let query = this.db
      .selectFrom('price_history')
      .selectAll()
      .where('pair', '=', options.pair);

    if (options.from) {
      query = query.where('timestamp', '>=', options.from);
    }

    if (options.to) {
      query = query.where('timestamp', '<=', options.to);
    }

    query = query.orderBy('timestamp', options.orderBy ?? 'desc');

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.offset(options.offset);
    }

    return query.execute();
  }

  /**
   * Get first price after a timestamp (for price change calculation)
   */
  async getFirstPriceAfter(
    pair: PairSymbol,
    after: Date
  ): Promise<PriceHistoryEntity | null> {
    const result = await this.db
      .selectFrom('price_history')
      .selectAll()
      .where('pair', '=', pair)
      .where('timestamp', '>=', after)
      .orderBy('timestamp', 'asc')
      .limit(1)
      .executeTakeFirst();

    return result ?? null;
  }

  /**
   * Get last price before a timestamp (for price change calculation)
   */
  async getLastPriceBefore(
    pair: PairSymbol,
    before: Date
  ): Promise<PriceHistoryEntity | null> {
    const result = await this.db
      .selectFrom('price_history')
      .selectAll()
      .where('pair', '=', pair)
      .where('timestamp', '<=', before)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .executeTakeFirst();

    return result ?? null;
  }

  /**
   * Batch insert multiple prices (for bulk operations)
   */
  async insertMany(
    prices: CreatePriceHistoryInput[]
  ): Promise<void> {
    if (prices.length === 0) return;

    const values = prices.map((p) => ({
      pair: p.pair,
      price: p.price,
      timestamp: p.timestamp instanceof Date ? p.timestamp : new Date(p.timestamp),
      method: p.method,
      sources: JSON.stringify(p.sources), // Serialize for PostgreSQL JSONB
      volume: p.volume ?? null,
    }));

    await this.db
      .insertInto('price_history')
      .values(values as unknown as Insertable<PriceHistoryTable>[])
      .execute();
  }

  /**
   * Count prices for a pair in a time range
   */
  async countInRange(
    pair: PairSymbol,
    from: Date,
    to: Date
  ): Promise<number> {
    const result = await this.db
      .selectFrom('price_history')
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .where('pair', '=', pair)
      .where('timestamp', '>=', from)
      .where('timestamp', '<', to)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  /**
   * Delete old prices (for data retention)
   */
  async deleteOlderThan(cutoffDate: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('price_history')
      .where('timestamp', '<', cutoffDate)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  }
}
