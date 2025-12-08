/**
 * Priceverse 2.0 - OHLCV Aggregator Service
 * Uses Titan database features: repositories, transactions, cursor pagination
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import {
  Transactional,
  TransactionIsolationLevel,
  withRetry,
  parseDatabaseError,
} from '@omnitron-dev/titan/module/database';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import {
  OhlcvRepository,
  type OhlcvCandleEntity,
  type CreateOhlcvCandleInput,
  type CursorPaginatedCandles,
} from '../../../database/index.js';
import { OHLCV_REPOSITORY } from '../../../shared/tokens.js';
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

const RETRY_OPTIONS = {
  maxAttempts: 3,
  delayMs: 500,
  backoff: true,
};

@Injectable()
export class OhlcvAggregatorService {
  private readonly ohlcvRepo: OhlcvRepository;

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule,
    @Inject(OHLCV_REPOSITORY) ohlcvRepo: OhlcvRepository
  ) {
    this.ohlcvRepo = ohlcvRepo;
  }

  private get logger() {
    return this.loggerModule.logger;
  }

  /**
   * Aggregate 5-minute candles - called by scheduler every 5 minutes
   * Uses transaction for atomic updates across all pairs
   */
  @Transactional({ isolationLevel: TransactionIsolationLevel.READ_COMMITTED })
  async aggregate5Min(): Promise<void> {
    const now = new Date();
    const periodStart = this.floorToInterval(now, 5 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() + 5 * 60 * 1000);

    await this.aggregateCandles('5min', periodStart, periodEnd);
  }

  /**
   * Aggregate 1-hour candles - called by scheduler every hour
   */
  @Transactional({ isolationLevel: TransactionIsolationLevel.READ_COMMITTED })
  async aggregate1Hour(): Promise<void> {
    const now = new Date();
    const periodStart = this.floorToInterval(now, 60 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() + 60 * 60 * 1000);

    await this.aggregateCandles('1hour', periodStart, periodEnd);
  }

  /**
   * Aggregate daily candles - called by scheduler at midnight UTC
   */
  @Transactional({ isolationLevel: TransactionIsolationLevel.READ_COMMITTED })
  async aggregate1Day(): Promise<void> {
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );

    await this.aggregateCandles('1day', periodStart, periodEnd);
  }

  /**
   * Aggregate candles for all supported pairs with error isolation
   */
  private async aggregateCandles(
    interval: ChartInterval,
    periodStart: Date,
    periodEnd: Date
  ): Promise<void> {
    const results = await Promise.allSettled(
      SUPPORTED_PAIRS.map((pair) =>
        this.aggregateSingleCandle(interval, pair, periodStart, periodEnd)
      )
    );

    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const pair = SUPPORTED_PAIRS[index];
        this.logger.error(`[OHLCV] Aggregation failed for ${pair}:`, result.reason);
      }
    });
  }

  /**
   * Calculate and save a single candle with retry
   */
  private async aggregateSingleCandle(
    interval: ChartInterval,
    pair: PairSymbol,
    periodStart: Date,
    periodEnd: Date
  ): Promise<void> {
    try {
      const candle = await this.calculateOhlcv(pair, periodStart, periodEnd);
      if (candle) {
        await withRetry(
          () => this.saveCandle(interval, candle),
          RETRY_OPTIONS
        );
      }
    } catch (error) {
      const parsed = parseDatabaseError(error);
      this.logger.error(`[OHLCV] Error for ${pair}:`, {
        error: parsed.message,
        code: parsed.code,
      });
      throw error;
    }
  }

  /**
   * Calculate OHLCV using optimized repository methods
   */
  private async calculateOhlcv(
    pair: PairSymbol,
    periodStart: Date,
    periodEnd: Date
  ): Promise<OhlcvCandle | null> {
    // Get aggregate stats in a single query
    const stats = await this.ohlcvRepo.getAggregateStats(pair, periodStart, periodEnd);

    if (!stats || stats.tradeCount === 0) {
      return null;
    }

    // Get open/close prices
    const prices = await this.ohlcvRepo.getOpenClosePrice(pair, periodStart, periodEnd);

    if (!prices) {
      return null;
    }

    const volumeSum = parseFloat(stats.volumeSum || '0');
    const priceVolumeSum = parseFloat(stats.priceVolumeSum || '0');
    const vwap = volumeSum > 0 ? (priceVolumeSum / volumeSum).toFixed(8) : null;

    return {
      pair,
      timestamp: periodStart,
      open: prices.open,
      high: stats.high,
      low: stats.low,
      close: prices.close,
      volume: volumeSum.toFixed(8),
      vwap,
      tradeCount: stats.tradeCount,
    };
  }

  /**
   * Save candle using repository upsert
   */
  private async saveCandle(
    interval: ChartInterval,
    candle: OhlcvCandle
  ): Promise<void> {
    const input: CreateOhlcvCandleInput = {
      pair: candle.pair as PairSymbol,
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      vwap: candle.vwap,
      trade_count: candle.tradeCount,
    };

    await this.ohlcvRepo.upsertCandle(interval, input);

    this.logger.debug(
      `[OHLCV] Saved ${interval} candle for ${candle.pair} at ${candle.timestamp.toISOString()}`
    );
  }

  /**
   * Floor timestamp to interval boundary
   */
  private floorToInterval(date: Date, intervalMs: number): Date {
    return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs);
  }

  /**
   * Get OHLCV candles with cursor-based pagination (efficient for large datasets)
   */
  async getCandlesWithCursor(
    pair: PairSymbol,
    interval: ChartInterval,
    options: {
      limit?: number;
      cursor?: string;
      from?: Date;
      to?: Date;
    } = {}
  ): Promise<CursorPaginatedCandles> {
    return withRetry(
      () =>
        this.ohlcvRepo.getCandlesWithCursor(interval, {
          pair,
          limit: options.limit ?? 100,
          cursor: options.cursor,
          from: options.from,
          to: options.to,
          orderBy: 'desc',
        }),
      RETRY_OPTIONS
    );
  }

  /**
   * Get OHLCV candles with offset pagination (backwards compatible)
   */
  async getCandles(
    pair: PairSymbol,
    interval: ChartInterval,
    limit: number,
    offset: number
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
    const result = await withRetry(
      () => this.ohlcvRepo.getCandles(interval, pair, limit, offset),
      RETRY_OPTIONS
    );

    return {
      candles: result.candles.map((c) => ({
        timestamp: c.timestamp.toISOString(),
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume),
        vwap: c.vwap ? parseFloat(c.vwap) : null,
      })),
      total: result.total,
    };
  }

  /**
   * Get latest candle for a pair
   */
  async getLatestCandle(
    pair: PairSymbol,
    interval: ChartInterval
  ): Promise<OhlcvCandleEntity | null> {
    return withRetry(
      () => this.ohlcvRepo.getLatestCandle(interval, pair),
      RETRY_OPTIONS
    );
  }

  /**
   * Get candle count for metrics
   */
  async getCandleCount(
    pair: PairSymbol,
    interval: ChartInterval
  ): Promise<number> {
    return this.ohlcvRepo.getCandleCount(interval, pair);
  }

  /**
   * Cleanup old candles (data retention)
   */
  async cleanupOldCandles(
    interval: ChartInterval,
    retentionDays: number
  ): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    return this.ohlcvRepo.deleteOlderThan(interval, cutoffDate);
  }
}
