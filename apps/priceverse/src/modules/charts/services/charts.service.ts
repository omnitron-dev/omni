/**
 * Priceverse 2.0 - Charts Service
 * Uses cursor pagination for efficient large dataset handling
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { withRetry, ErrorCodes } from '@omnitron-dev/titan/module/database';
import type {
  PairSymbol,
  ChartInterval,
  TimePeriod,
  ChartResponse,
  OhlcvResponse,
  OhlcvCandle,
} from '../../../shared/types.js';
import { OHLCV_AGGREGATOR_TOKEN } from '../../../shared/tokens.js';
import type { OhlcvAggregatorService } from '../../aggregator/services/ohlcv-aggregator.service.js';
import { PriceVerseError, PriceVerseErrorCode } from '../../../contracts/errors.js';

// Cursor-paginated response
export interface CursorPaginatedOhlcvResponse {
  candles: OhlcvCandle[];
  pagination: {
    nextCursor: string | null;
    previousCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

const RETRY_OPTIONS = {
  maxAttempts: 3,
  delayMs: 500,
  backoff: true,
};

@Injectable()
export class ChartsService {
  constructor(
    @Inject(OHLCV_AGGREGATOR_TOKEN)
    private readonly ohlcvAggregator: OhlcvAggregatorService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule
  ) {}

  private get logger() {
    return this.loggerModule.logger;
  }

  /**
   * Get chart data with dates and series arrays
   */
  async getChartData(
    pair: PairSymbol,
    period: TimePeriod,
    interval: ChartInterval,
    from?: string,
    to?: string
  ): Promise<ChartResponse> {
    const { startDate, endDate } = this.calculateDateRange(period, from, to);

    // Use cursor-based pagination for efficient retrieval
    const result = await withRetry(
      () =>
        this.ohlcvAggregator.getCandlesWithCursor(pair, interval, {
          limit: 1000,
          from: startDate,
          to: endDate,
        }),
      RETRY_OPTIONS
    );

    // Sort by timestamp ascending (oldest first)
    const sortedCandles = [...result.candles].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Build response arrays
    const dates: string[] = [];
    const series: number[] = [];
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];

    for (const candle of sortedCandles) {
      const timestamp =
        candle.timestamp instanceof Date
          ? candle.timestamp.toISOString()
          : candle.timestamp;
      const closePrice = parseFloat(candle.close);
      const openPrice = parseFloat(candle.open);
      const highPrice = parseFloat(candle.high);
      const lowPrice = parseFloat(candle.low);
      const volumeVal = parseFloat(candle.volume);

      dates.push(timestamp);
      series.push(closePrice); // Use close price for series
      open.push(openPrice);
      high.push(highPrice);
      low.push(lowPrice);
      close.push(closePrice);
      volume.push(volumeVal);
    }

    this.logger.debug(
      `[Charts] getChartData for ${pair}, ${period}, ${interval}: ${dates.length} candles`
    );

    return {
      dates,
      series,
      ohlcv: {
        open,
        high,
        low,
        close,
        volume,
      },
    };
  }

  /**
   * Get OHLCV candles with offset pagination (backwards compatible)
   */
  async getOhlcv(
    pair: PairSymbol,
    interval: ChartInterval,
    limit: number,
    offset: number
  ): Promise<OhlcvResponse> {
    const result = await withRetry(
      () => this.ohlcvAggregator.getCandles(pair, interval, limit, offset),
      RETRY_OPTIONS
    );

    this.logger.debug(
      `[Charts] getOHLCV for ${pair}, ${interval}: ${result.candles.length}/${result.total} candles (offset: ${offset})`
    );

    return {
      candles: result.candles as OhlcvCandle[],
      pagination: {
        total: result.total,
        limit,
        offset,
      },
    };
  }

  /**
   * Get OHLCV candles with cursor pagination (more efficient for large datasets)
   */
  async getOhlcvWithCursor(
    pair: PairSymbol,
    interval: ChartInterval,
    options: {
      limit?: number;
      cursor?: string;
      from?: Date;
      to?: Date;
    } = {}
  ): Promise<CursorPaginatedOhlcvResponse> {
    const limit = options.limit ?? 100;

    const result = await withRetry(
      () => this.ohlcvAggregator.getCandlesWithCursor(pair, interval, options),
      RETRY_OPTIONS
    );

    // Transform candles to OhlcvCandle format
    const candles: OhlcvCandle[] = result.candles.map((c) => ({
      timestamp:
        c.timestamp instanceof Date ? c.timestamp.toISOString() : String(c.timestamp),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
      vwap: c.vwap ? parseFloat(c.vwap) : null,
    }));

    this.logger.debug(
      `[Charts] getOHLCVWithCursor for ${pair}, ${interval}: ${candles.length} candles, hasMore: ${result.hasMore}`
    );

    return {
      candles,
      pagination: {
        nextCursor: result.nextCursor,
        previousCursor: result.previousCursor,
        hasMore: result.hasMore,
        limit,
      },
    };
  }

  /**
   * Get latest candle for a pair
   */
  async getLatestCandle(
    pair: PairSymbol,
    interval: ChartInterval
  ): Promise<OhlcvCandle | null> {
    const result = await withRetry(
      () => this.ohlcvAggregator.getLatestCandle(pair, interval),
      RETRY_OPTIONS
    );

    if (!result) {
      return null;
    }

    return {
      timestamp:
        result.timestamp instanceof Date
          ? result.timestamp.toISOString()
          : String(result.timestamp),
      open: parseFloat(result.open),
      high: parseFloat(result.high),
      low: parseFloat(result.low),
      close: parseFloat(result.close),
      volume: parseFloat(result.volume),
      vwap: result.vwap ? parseFloat(result.vwap) : null,
    };
  }

  /**
   * Get candle count for a pair (useful for pagination)
   */
  async getCandleCount(
    pair: PairSymbol,
    interval: ChartInterval
  ): Promise<number> {
    return this.ohlcvAggregator.getCandleCount(pair, interval);
  }

  /**
   * Stream candles page by page using cursor pagination
   * Useful for processing large amounts of historical data
   */
  async *streamCandles(
    pair: PairSymbol,
    interval: ChartInterval,
    options: {
      limit?: number;
      from?: Date;
      to?: Date;
    } = {}
  ): AsyncGenerator<OhlcvCandle[]> {
    const limit = options.limit ?? 100;
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const result = await this.getOhlcvWithCursor(pair, interval, {
        limit,
        cursor,
        from: options.from,
        to: options.to,
      });

      if (result.candles.length > 0) {
        yield result.candles;
      }

      hasMore = result.pagination.hasMore;
      cursor = result.pagination.nextCursor ?? undefined;
    }
  }

  /**
   * Calculate date range based on period
   */
  private calculateDateRange(
    period: TimePeriod,
    from?: string,
    to?: string
  ): { startDate: Date; endDate: Date } {
    const endDate = to ? new Date(to) : new Date();
    let startDate: Date;

    if (period === 'custom') {
      if (!from) {
        throw new PriceVerseError(
          PriceVerseErrorCode.INVALID_PARAMS,
          'Custom period requires "from" parameter',
          { period, errorCode: ErrorCodes.VALIDATION_REQUIRED_FIELD }
        );
      }
      startDate = new Date(from);
    } else {
      const now = endDate.getTime();
      switch (period) {
        case '24hours':
          startDate = new Date(now - 24 * 60 * 60 * 1000);
          break;
        case '7days':
          startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30days':
          startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now - 7 * 24 * 60 * 60 * 1000); // Default to 7 days
      }
    }

    // Validate date range
    if (startDate >= endDate) {
      throw new PriceVerseError(
        PriceVerseErrorCode.INVALID_TIME_RANGE,
        'Start date must be before end date',
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          errorCode: ErrorCodes.VALIDATION_INVALID_INPUT,
        }
      );
    }

    return { startDate, endDate };
  }
}
