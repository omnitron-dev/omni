/**
 * Priceverse 2.0 - Charts Service
 * Provides chart data and OHLCV candles
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
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

    // Use OHLCV aggregator to get candle data
    const { candles } = await this.ohlcvAggregator.getCandles(
      pair,
      interval,
      1000, // Max candles to return
      0
    );

    // Filter by date range
    const filteredCandles = candles.filter((c) => {
      const timestamp = new Date(c.timestamp).getTime();
      return timestamp >= startDate.getTime() && timestamp <= endDate.getTime();
    });

    // Sort by timestamp ascending (oldest first)
    filteredCandles.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Build response arrays
    const dates: string[] = [];
    const series: number[] = [];
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];

    for (const candle of filteredCandles) {
      dates.push(candle.timestamp);
      series.push(candle.close); // Use close price for series
      open.push(candle.open);
      high.push(candle.high);
      low.push(candle.low);
      close.push(candle.close);
      volume.push(candle.volume);
    }

    this.logger.debug(`[Charts] getChartData for ${pair}, ${period}, ${interval}: ${dates.length} candles`);

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
   * Get OHLCV candles with pagination
   */
  async getOhlcv(pair: PairSymbol, interval: ChartInterval, limit: number, offset: number): Promise<OhlcvResponse> {
    const { candles, total } = await this.ohlcvAggregator.getCandles(pair, interval, limit, offset);

    this.logger.debug(
      `[Charts] getOHLCV for ${pair}, ${interval}: ${candles.length}/${total} candles (offset: ${offset})`
    );

    return {
      candles: candles as OhlcvCandle[],
      pagination: {
        total,
        limit,
        offset,
      },
    };
  }

  /**
   * Calculate date range based on period
   */
  private calculateDateRange(period: TimePeriod, from?: string, to?: string): { startDate: Date; endDate: Date } {
    const endDate = to ? new Date(to) : new Date();
    let startDate: Date;

    if (period === 'custom' && from) {
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

    return { startDate, endDate };
  }
}
