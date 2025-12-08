/**
 * Priceverse 2.0 - OHLCV Repository
 * Handles candlestick data for 5min, 1hour, 1day intervals
 */

import {
  BaseRepository,
  Repository,
  type Kysely,
  type Insertable,
  type Selectable,
} from '@omnitron-dev/titan/module/database';
import { sql } from 'kysely';
import type {
  Database,
  PriceHistory5MinTable,
  PriceHistory1HourTable,
  PriceHistory1DayTable,
} from '../schema.js';
import type { PairSymbol, ChartInterval } from '../../shared/types.js';

// Entity types
export type OhlcvCandle5Min = Selectable<PriceHistory5MinTable>;
export type OhlcvCandle1Hour = Selectable<PriceHistory1HourTable>;
export type OhlcvCandle1Day = Selectable<PriceHistory1DayTable>;

// Union type for any OHLCV candle
export type OhlcvCandleEntity = OhlcvCandle5Min | OhlcvCandle1Hour | OhlcvCandle1Day;

// Table name type
export type OhlcvTableName = 'price_history_5min' | 'price_history_1hour' | 'price_history_1day';

// Create input type
export interface CreateOhlcvCandleInput {
  pair: PairSymbol;
  timestamp: Date | string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  vwap?: string | null;
  trade_count: number;
}

// Update input type
export interface UpdateOhlcvCandleInput {
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  vwap?: string | null;
  trade_count?: number;
}

// Query options
export interface OhlcvQueryOptions {
  pair: PairSymbol;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
  orderBy?: 'asc' | 'desc';
}

// Cursor pagination result
export interface CursorPaginatedCandles {
  candles: OhlcvCandleEntity[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
}

// Aggregate stats for OHLCV calculation
export interface OhlcvAggregateStats {
  low: string;
  high: string;
  tradeCount: number;
  priceVolumeSum: string;
  volumeSum: string;
}

@Repository({
  table: 'price_history_5min',
  connection: 'default',
})
export class OhlcvRepository extends BaseRepository<
  Database,
  'price_history_5min',
  OhlcvCandle5Min,
  CreateOhlcvCandleInput,
  UpdateOhlcvCandleInput
> {
  constructor(db: Kysely<Database>) {
    super(db, {
      tableName: 'price_history_5min',
      connectionName: 'default',
    });
  }

  /**
   * Get interval-to-table mapping
   */
  private getTableName(interval: ChartInterval): OhlcvTableName {
    switch (interval) {
      case '5min':
        return 'price_history_5min';
      case '1hour':
        return 'price_history_1hour';
      case '1day':
        return 'price_history_1day';
      default:
        return 'price_history_1hour';
    }
  }

  /**
   * Get candles with cursor-based pagination (efficient for large datasets)
   */
  async getCandlesWithCursor(
    interval: ChartInterval,
    options: OhlcvQueryOptions
  ): Promise<CursorPaginatedCandles> {
    const tableName = this.getTableName(interval);
    const limit = options.limit ?? 100;

    let query = this.db
      .selectFrom(tableName)
      .selectAll()
      .where('pair', '=', options.pair);

    // Apply cursor (timestamp-based)
    if (options.cursor) {
      const cursorTimestamp = new Date(
        Buffer.from(options.cursor, 'base64').toString('utf-8')
      );
      query = query.where('timestamp', '<', cursorTimestamp);
    }

    // Apply date filters
    if (options.from) {
      query = query.where('timestamp', '>=', options.from);
    }

    if (options.to) {
      query = query.where('timestamp', '<=', options.to);
    }

    // Order and limit (+1 to check for more)
    const candles = await query
      .orderBy('timestamp', options.orderBy ?? 'desc')
      .limit(limit + 1)
      .execute();

    const hasMore = candles.length > limit;
    const resultCandles = hasMore ? candles.slice(0, limit) : candles;

    // Generate cursors
    let nextCursor: string | null = null;
    let previousCursor: string | null = null;

    if (hasMore && resultCandles.length > 0) {
      const lastCandle = resultCandles[resultCandles.length - 1];
      nextCursor = Buffer.from(
        lastCandle.timestamp.toISOString()
      ).toString('base64');
    }

    if (options.cursor && resultCandles.length > 0) {
      const firstCandle = resultCandles[0];
      previousCursor = Buffer.from(
        firstCandle.timestamp.toISOString()
      ).toString('base64');
    }

    return {
      candles: resultCandles,
      nextCursor,
      previousCursor,
      hasMore,
    };
  }

  /**
   * Get candles with offset pagination (for backwards compatibility)
   */
  async getCandles(
    interval: ChartInterval,
    pair: PairSymbol,
    limit: number,
    offset: number
  ): Promise<{ candles: OhlcvCandleEntity[]; total: number }> {
    const tableName = this.getTableName(interval);

    // Get total count
    const countResult = await this.db
      .selectFrom(tableName)
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .where('pair', '=', pair)
      .executeTakeFirst();

    const total = Number(countResult?.count ?? 0);

    // Get candles
    const candles = await this.db
      .selectFrom(tableName)
      .selectAll()
      .where('pair', '=', pair)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return { candles, total };
  }

  /**
   * Upsert a candle (insert or update on conflict)
   */
  async upsertCandle(
    interval: ChartInterval,
    candle: CreateOhlcvCandleInput
  ): Promise<void> {
    const tableName = this.getTableName(interval);
    const timestamp = candle.timestamp instanceof Date
      ? candle.timestamp
      : new Date(candle.timestamp);

    await this.db
      .insertInto(tableName)
      .values({
        pair: candle.pair,
        timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        vwap: candle.vwap ?? null,
        trade_count: candle.trade_count,
      } as Insertable<PriceHistory5MinTable>)
      .onConflict((oc) =>
        oc.columns(['pair', 'timestamp']).doUpdateSet({
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          vwap: candle.vwap ?? null,
          trade_count: candle.trade_count,
        })
      )
      .execute();
  }

  /**
   * Get aggregate stats from price_history for OHLCV calculation
   * Uses a single optimized query instead of multiple queries
   */
  async getAggregateStats(
    pair: PairSymbol,
    periodStart: Date,
    periodEnd: Date
  ): Promise<OhlcvAggregateStats | null> {
    const result = await this.db
      .selectFrom('price_history')
      .select([
        sql<string>`MIN(price)`.as('low'),
        sql<string>`MAX(price)`.as('high'),
        sql<number>`COUNT(*)`.as('trade_count'),
        sql<string>`SUM(CAST(price AS DECIMAL) * CAST(volume AS DECIMAL))`.as(
          'price_volume_sum'
        ),
        sql<string>`SUM(CAST(volume AS DECIMAL))`.as('volume_sum'),
      ])
      .where('pair', '=', pair)
      .where('timestamp', '>=', periodStart)
      .where('timestamp', '<', periodEnd)
      .executeTakeFirst();

    if (!result || result.trade_count === 0) {
      return null;
    }

    return {
      low: result.low,
      high: result.high,
      tradeCount: Number(result.trade_count),
      priceVolumeSum: result.price_volume_sum || '0',
      volumeSum: result.volume_sum || '0',
    };
  }

  /**
   * Get first/last prices for open/close calculation
   */
  async getOpenClosePrice(
    pair: PairSymbol,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{ open: string; close: string } | null> {
    // Get first price (open)
    const firstPrice = await this.db
      .selectFrom('price_history')
      .select('price')
      .where('pair', '=', pair)
      .where('timestamp', '>=', periodStart)
      .where('timestamp', '<', periodEnd)
      .orderBy('timestamp', 'asc')
      .limit(1)
      .executeTakeFirst();

    // Get last price (close)
    const lastPrice = await this.db
      .selectFrom('price_history')
      .select('price')
      .where('pair', '=', pair)
      .where('timestamp', '>=', periodStart)
      .where('timestamp', '<', periodEnd)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!firstPrice || !lastPrice) {
      return null;
    }

    return {
      open: firstPrice.price,
      close: lastPrice.price,
    };
  }

  /**
   * Get latest candle for a pair
   */
  async getLatestCandle(
    interval: ChartInterval,
    pair: PairSymbol
  ): Promise<OhlcvCandleEntity | null> {
    const tableName = this.getTableName(interval);

    const result = await this.db
      .selectFrom(tableName)
      .selectAll()
      .where('pair', '=', pair)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .executeTakeFirst();

    return result ?? null;
  }

  /**
   * Delete old candles (for data retention)
   */
  async deleteOlderThan(
    interval: ChartInterval,
    cutoffDate: Date
  ): Promise<number> {
    const tableName = this.getTableName(interval);

    const result = await this.db
      .deleteFrom(tableName)
      .where('timestamp', '<', cutoffDate)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  }

  /**
   * Get candle count for a pair
   */
  async getCandleCount(
    interval: ChartInterval,
    pair: PairSymbol
  ): Promise<number> {
    const tableName = this.getTableName(interval);

    const result = await this.db
      .selectFrom(tableName)
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .where('pair', '=', pair)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }
}
