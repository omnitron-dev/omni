/**
 * Priceverse 2.0 - OHLCV Aggregator Service
 * Creates candlestick data (5min, 1hour, 1day)
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { DATABASE_CONNECTION } from '@omnitron-dev/titan/module/database';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../database/schema.js';
import type { PairSymbol, ChartInterval } from '../../../shared/types.js';
import { SUPPORTED_PAIRS } from '../../../shared/types.js';

interface OhlcvCandle {
  pair: string;
  timestamp: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  vwap: string | null;
  tradeCount: number;
}

type CandleTableName = 'price_history_5min' | 'price_history_1hour' | 'price_history_1day';

@Injectable()
export class OhlcvAggregatorService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Kysely<Database>,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule,
  ) {}

  private get logger() {
    return this.loggerModule.logger;
  }

  /**
   * Aggregate 5-minute candles - called by scheduler every 5 minutes
   */
  async aggregate5Min(): Promise<void> {
    const now = new Date();
    const periodStart = this.floorToInterval(now, 5 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() + 5 * 60 * 1000);

    await this.aggregateCandles('price_history_5min', periodStart, periodEnd);
  }

  /**
   * Aggregate 1-hour candles - called by scheduler every hour
   */
  async aggregate1Hour(): Promise<void> {
    const now = new Date();
    const periodStart = this.floorToInterval(now, 60 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() + 60 * 60 * 1000);

    await this.aggregateCandles('price_history_1hour', periodStart, periodEnd);
  }

  /**
   * Aggregate daily candles - called by scheduler at midnight UTC
   */
  async aggregate1Day(): Promise<void> {
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    await this.aggregateCandles('price_history_1day', periodStart, periodEnd);
  }

  private async aggregateCandles(
    tableName: CandleTableName,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    for (const pair of SUPPORTED_PAIRS) {
      try {
        const candle = await this.calculateOhlcv(pair, periodStart, periodEnd);
        if (candle) {
          await this.saveCandle(tableName, candle);
        }
      } catch (error) {
        this.logger.error(`[OHLCV] Aggregation error for ${pair}:`, error);
      }
    }
  }

  private async calculateOhlcv(
    pair: PairSymbol,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<OhlcvCandle | null> {
    // Get aggregate stats
    const result = await this.db
      .selectFrom('price_history')
      .select([
        sql<string>`MIN(price)`.as('low'),
        sql<string>`MAX(price)`.as('high'),
        sql<number>`COUNT(*)`.as('trade_count'),
        sql<string>`SUM(CAST(price AS DECIMAL) * CAST(volume AS DECIMAL))`.as(
          'price_volume_sum',
        ),
        sql<string>`SUM(CAST(volume AS DECIMAL))`.as('volume_sum'),
      ])
      .where('pair', '=', pair)
      .where('timestamp', '>=', periodStart)
      .where('timestamp', '<', periodEnd)
      .executeTakeFirst();

    if (!result || result.trade_count === 0) return null;

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

    const volumeSum = parseFloat(result.volume_sum || '0');
    const priceVolumeSum = parseFloat(result.price_volume_sum || '0');
    const vwap =
      volumeSum > 0 ? (priceVolumeSum / volumeSum).toFixed(8) : null;

    return {
      pair,
      timestamp: periodStart,
      open: firstPrice?.price ?? '0',
      high: result.high,
      low: result.low,
      close: lastPrice?.price ?? '0',
      volume: volumeSum.toFixed(8),
      vwap,
      tradeCount: Number(result.trade_count),
    };
  }

  private async saveCandle(
    tableName: CandleTableName,
    candle: OhlcvCandle,
  ): Promise<void> {
    await this.db
      .insertInto(tableName)
      .values({
        pair: candle.pair as PairSymbol,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        vwap: candle.vwap,
        trade_count: candle.tradeCount,
      })
      .onConflict((oc) =>
        oc.columns(['pair', 'timestamp']).doUpdateSet({
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          vwap: candle.vwap,
          trade_count: candle.tradeCount,
        }),
      )
      .execute();

    this.logger.debug(
      `[OHLCV] Saved ${tableName} candle for ${candle.pair} at ${candle.timestamp.toISOString()}`,
    );
  }

  private floorToInterval(date: Date, intervalMs: number): Date {
    return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs);
  }

  /**
   * Get OHLCV candles for a pair
   */
  async getCandles(
    pair: PairSymbol,
    interval: ChartInterval,
    limit: number,
    offset: number,
  ): Promise<{
    candles: Array<{
      timestamp: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      vwap: number | null;
    }>;
    total: number;
  }> {
    const tableName = this.getTableName(interval);

    // Get total count
    const countResult = await this.db
      .selectFrom(tableName)
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('pair', '=', pair)
      .executeTakeFirst();

    const total = Number(countResult?.count ?? 0);

    // Get candles
    const candles = await this.db
      .selectFrom(tableName)
      .select([
        'timestamp',
        'open',
        'high',
        'low',
        'close',
        'volume',
        'vwap',
      ])
      .where('pair', '=', pair)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return {
      candles: candles.map((c) => ({
        timestamp: c.timestamp.toISOString(),
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume),
        vwap: c.vwap ? parseFloat(c.vwap) : null,
      })),
      total,
    };
  }

  private getTableName(interval: ChartInterval): CandleTableName {
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
}
