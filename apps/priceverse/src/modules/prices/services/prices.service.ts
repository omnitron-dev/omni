/**
 * Priceverse - Prices Service
 * Uses Titan database module features: repositories, error handling, resilience
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import {
  withRetry,
  parseDatabaseError,
  ErrorCodes,
} from '@omnitron-dev/titan/module/database';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { RedisService, type RedisClient } from '@omnitron-dev/titan/module/redis';
import {
  PriceHistoryRepository,
  type PriceHistoryEntity,
} from '../../../database/index.js';
import { PRICE_HISTORY_REPOSITORY } from '../../../shared/tokens.js';
import type {
  PairSymbol,
  PriceResponse,
  PriceChangeResponse,
  TimePeriod,
} from '../../../shared/types.js';
import { PriceVerseError, PriceVerseErrorCode } from '../../../contracts/errors.js';

const CACHE_TTL = 60; // 60 seconds
const STALE_THRESHOLD = 120_000; // 2 minutes
const RETRY_OPTIONS = {
  maxAttempts: 3,
  delayMs: 500,
  backoff: true,
};

@Injectable()
export class PricesService {
  private readonly priceHistoryRepo: PriceHistoryRepository;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule,
    @Inject(PRICE_HISTORY_REPOSITORY) priceHistoryRepo: PriceHistoryRepository
  ) {
    this.priceHistoryRepo = priceHistoryRepo;
  }

  private get logger() {
    return this.loggerModule.logger;
  }

  /**
   * Get single price from cache, fallback to database with retry
   */
  async getPrice(pair: PairSymbol): Promise<PriceResponse> {
    this.logger.debug(`[PricesService] Getting price for ${pair}`);

    // Try cache first
    const cached = await this.getPriceFromCache(pair);
    if (cached) {
      return cached;
    }

    // Fallback to database with retry for resilience
    const dbPrice = await this.getPriceFromDbWithRetry(pair);
    if (!dbPrice) {
      throw new PriceVerseError(
        PriceVerseErrorCode.PRICE_UNAVAILABLE,
        `Price unavailable for pair ${pair}`,
        { pair, errorCode: ErrorCodes.RESOURCE_NOT_FOUND }
      );
    }

    // Cache the result
    await this.cachePriceResponse(dbPrice);

    return dbPrice;
  }

  /**
   * Get multiple prices in parallel with proper error handling
   */
  async getMultiplePrices(pairs: PairSymbol[]): Promise<PriceResponse[]> {
    this.logger.debug(`[PricesService] Getting multiple prices for ${pairs.length} pairs`);

    const results = await Promise.allSettled(
      pairs.map((pair) => this.getPrice(pair))
    );

    // Return successful results, log failures
    return results
      .filter((result): result is PromiseFulfilledResult<PriceResponse> => {
        if (result.status === 'rejected') {
          this.logger.warn('[PricesService] Failed to get price:', result.reason);
          return false;
        }
        return true;
      })
      .map((result) => result.value);
  }

  /**
   * Calculate price change percentage over a period using repository
   */
  async getPriceChange(
    pair: PairSymbol,
    period: TimePeriod,
    from?: string,
    to?: string
  ): Promise<PriceChangeResponse> {
    this.logger.debug(`[PricesService] Getting price change for ${pair} (${period})`);

    // Calculate time range
    const endDate = to ? new Date(to) : new Date();
    const startDate = from ? new Date(from) : this.calculateStartDate(endDate, period);

    // Validate time range
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

    // Use repository methods with retry
    const startPriceRow = await withRetry(
      () => this.priceHistoryRepo.getFirstPriceAfter(pair, startDate),
      RETRY_OPTIONS
    );

    if (!startPriceRow) {
      throw new PriceVerseError(
        PriceVerseErrorCode.PRICE_UNAVAILABLE,
        `No price data available for ${pair} at start date`,
        {
          pair,
          startDate: startDate.toISOString(),
          errorCode: ErrorCodes.RESOURCE_NOT_FOUND,
        }
      );
    }

    const endPriceRow = await withRetry(
      () => this.priceHistoryRepo.getLastPriceBefore(pair, endDate),
      RETRY_OPTIONS
    );

    if (!endPriceRow) {
      throw new PriceVerseError(
        PriceVerseErrorCode.PRICE_UNAVAILABLE,
        `No price data available for ${pair} at end date`,
        {
          pair,
          endDate: endDate.toISOString(),
          errorCode: ErrorCodes.RESOURCE_NOT_FOUND,
        }
      );
    }

    const startPrice = parseFloat(startPriceRow.price);
    const endPrice = parseFloat(endPriceRow.price);
    const changePercent = ((endPrice - startPrice) / startPrice) * 100;

    return {
      pair,
      startDate: new Date(startPriceRow.timestamp).getTime(),
      endDate: new Date(endPriceRow.timestamp).getTime(),
      startPrice,
      endPrice,
      changePercent,
    };
  }

  /**
   * Get price history for a pair
   */
  async getPriceHistory(
    pair: PairSymbol,
    from: Date,
    to: Date,
    limit?: number
  ): Promise<PriceHistoryEntity[]> {
    return withRetry(
      () =>
        this.priceHistoryRepo.findByPairInRange({
          pair,
          from,
          to,
          limit,
          orderBy: 'desc',
        }),
      RETRY_OPTIONS
    );
  }

  /**
   * Stream real-time price updates via Redis pub/sub
   */
  async *streamPrices(pairs: PairSymbol[]): AsyncGenerator<PriceResponse> {
    this.logger.info(`[PricesService] Starting price stream for ${pairs.length} pairs`);

    // Create a separate Redis client for subscriptions
    const subscriber: RedisClient = this.redis.createSubscriber();
    const channels = pairs.map((pair) => `price:${pair}`);

    // Queue for buffering messages
    const messageQueue: PriceResponse[] = [];
    let resolveNext: ((value: PriceResponse) => void) | null = null;

    // Subscribe to all channels
    const messageHandler = (channel: string, message: string) => {
      try {
        const data = JSON.parse(message);
        const pair = channel.replace('price:', '');

        const priceResponse: PriceResponse = {
          pair,
          price: parseFloat(data.price),
          timestamp: data.timestamp,
        };

        if (resolveNext) {
          resolveNext(priceResponse);
          resolveNext = null;
        } else {
          messageQueue.push(priceResponse);
        }
      } catch (error) {
        this.logger.error('[PricesService] Error parsing stream message:', error);
      }
    };

    subscriber.on('message', messageHandler);

    // Subscribe using Titan's API
    await this.redis.subscribeClient(subscriber, channels);

    try {
      while (true) {
        if (messageQueue.length > 0) {
          const price = messageQueue.shift();
          if (price) {
            yield price;
          }
        } else {
          // Wait for next message
          const price = await new Promise<PriceResponse>((resolve) => {
            resolveNext = resolve;
          });
          yield price;
        }
      }
    } finally {
      // Cleanup on generator close
      await this.redis.unsubscribeClient(subscriber, channels);
      this.logger.info('[PricesService] Price stream closed');
    }
  }

  /**
   * Get price from Redis cache
   */
  private async getPriceFromCache(pair: PairSymbol): Promise<PriceResponse | null> {
    try {
      const cacheKey = `price:${pair}`;
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        const data = JSON.parse(cached);
        const age = Date.now() - data.timestamp;

        // Check if price is stale
        if (age > STALE_THRESHOLD) {
          this.logger.warn(`[PricesService] Stale price in cache for ${pair} (age: ${age}ms)`);
          return null;
        }

        return {
          pair,
          price: parseFloat(data.price),
          timestamp: data.timestamp,
        };
      }
    } catch (error) {
      this.logger.error(`[PricesService] Cache read error for ${pair}:`, error);
    }

    return null;
  }

  /**
   * Get latest price from database using repository with retry
   */
  private async getPriceFromDbWithRetry(pair: PairSymbol): Promise<PriceResponse | null> {
    try {
      const row = await withRetry(
        () => this.priceHistoryRepo.getLatestPrice(pair),
        RETRY_OPTIONS
      );

      if (!row) {
        return null;
      }

      return {
        pair: row.pair,
        price: parseFloat(row.price),
        timestamp: new Date(row.timestamp).getTime(),
      };
    } catch (error) {
      // Parse database error for better error handling
      const parsed = parseDatabaseError(error);
      this.logger.error(`[PricesService] Database error for ${pair}:`, {
        error: parsed.message,
        code: parsed.code,
      });

      throw new PriceVerseError(
        PriceVerseErrorCode.DATABASE_ERROR,
        `Failed to retrieve price from database for ${pair}`,
        {
          pair,
          originalError: parsed.message,
          errorCode: parsed.code,
        }
      );
    }
  }

  /**
   * Cache price response in Redis
   */
  private async cachePriceResponse(price: PriceResponse): Promise<void> {
    try {
      const cacheKey = `price:${price.pair}`;
      const cacheValue = JSON.stringify({
        price: price.price.toFixed(8),
        timestamp: price.timestamp,
      });

      await this.redis.setex(cacheKey, CACHE_TTL, cacheValue);
    } catch (error) {
      // Non-fatal: log but don't throw
      this.logger.error(`[PricesService] Cache write error for ${price.pair}:`, error);
    }
  }

  /**
   * Calculate start date based on period
   */
  private calculateStartDate(endDate: Date, period: TimePeriod): Date {
    const start = new Date(endDate);

    switch (period) {
      case '24hours':
        start.setHours(start.getHours() - 24);
        break;
      case '7days':
        start.setDate(start.getDate() - 7);
        break;
      case '30days':
        start.setDate(start.getDate() - 30);
        break;
      case 'custom':
        // For custom, caller must provide 'from'
        throw new PriceVerseError(
          PriceVerseErrorCode.INVALID_PARAMS,
          'Custom period requires explicit "from" parameter',
          { period, errorCode: ErrorCodes.VALIDATION_REQUIRED_FIELD }
        );
    }

    return start;
  }
}
