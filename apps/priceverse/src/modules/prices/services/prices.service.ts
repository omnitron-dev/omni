/**
 * Priceverse 2.0 - Prices Service
 * Provides price retrieval, history queries, and real-time streaming
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import { DATABASE_CONNECTION } from '@omnitron-dev/titan/module/database';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import type { Kysely } from 'kysely';
import type { Database } from '../../../database/schema.js';
import type { PairSymbol, PriceResponse, PriceChangeResponse, TimePeriod } from '../../../shared/types.js';
import { PriceVerseError, PriceVerseErrorCode } from '../../../contracts/errors.js';

interface IRedisService {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<void>;
  subscribe(channel: string): Promise<void>;
  on(event: string, callback: (channel: string, message: string) => void): void;
  unsubscribe(channel: string): Promise<void>;
  duplicate(): IRedisService;
}

const CACHE_TTL = 60; // 60 seconds
const STALE_THRESHOLD = 120_000; // 2 minutes

@Injectable()
export class PricesService {
  constructor(
    @Inject(RedisService) private readonly redis: IRedisService,
    @Inject(DATABASE_CONNECTION) private readonly db: Kysely<Database>,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule
  ) {}

  private get logger() {
    return this.loggerModule.logger;
  }

  /**
   * Get single price from cache, fallback to database
   */
  async getPrice(pair: PairSymbol): Promise<PriceResponse> {
    this.logger.debug(`[PricesService] Getting price for ${pair}`);

    // Try cache first
    const cached = await this.getPriceFromCache(pair);
    if (cached) {
      return cached;
    }

    // Fallback to database
    const dbPrice = await this.getPriceFromDb(pair);
    if (!dbPrice) {
      throw new PriceVerseError(PriceVerseErrorCode.PRICE_UNAVAILABLE, `Price unavailable for pair ${pair}`, { pair });
    }

    // Cache the result
    await this.cachePriceResponse(dbPrice);

    return dbPrice;
  }

  /**
   * Get multiple prices in parallel
   */
  async getMultiplePrices(pairs: PairSymbol[]): Promise<PriceResponse[]> {
    this.logger.debug(`[PricesService] Getting multiple prices for ${pairs.length} pairs`);

    const pricePromises = pairs.map((pair) => this.getPrice(pair));
    return Promise.all(pricePromises);
  }

  /**
   * Calculate price change percentage over a period
   */
  async getPriceChange(pair: PairSymbol, period: TimePeriod, from?: string, to?: string): Promise<PriceChangeResponse> {
    this.logger.debug(`[PricesService] Getting price change for ${pair} (${period})`);

    // Calculate time range
    const endDate = to ? new Date(to) : new Date();
    const startDate = from ? new Date(from) : this.calculateStartDate(endDate, period);

    // Validate time range
    if (startDate >= endDate) {
      throw new PriceVerseError(PriceVerseErrorCode.INVALID_TIME_RANGE, 'Start date must be before end date', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }

    // Get start price (closest to start date)
    const startPriceRow = await this.db
      .selectFrom('price_history')
      .select(['price', 'timestamp'])
      .where('pair', '=', pair)
      .where('timestamp', '>=', startDate)
      .orderBy('timestamp', 'asc')
      .limit(1)
      .executeTakeFirst();

    if (!startPriceRow) {
      throw new PriceVerseError(
        PriceVerseErrorCode.PRICE_UNAVAILABLE,
        `No price data available for ${pair} at start date`,
        { pair, startDate: startDate.toISOString() }
      );
    }

    // Get end price (closest to end date)
    const endPriceRow = await this.db
      .selectFrom('price_history')
      .select(['price', 'timestamp'])
      .where('pair', '=', pair)
      .where('timestamp', '<=', endDate)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!endPriceRow) {
      throw new PriceVerseError(
        PriceVerseErrorCode.PRICE_UNAVAILABLE,
        `No price data available for ${pair} at end date`,
        { pair, endDate: endDate.toISOString() }
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
   * Stream real-time price updates via Redis pub/sub
   */
  async *streamPrices(pairs: PairSymbol[]): AsyncGenerator<PriceResponse> {
    this.logger.info(`[PricesService] Starting price stream for ${pairs.length} pairs`);

    // Create a separate Redis client for subscriptions
    const subscriber = this.redis.duplicate();
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

    for (const channel of channels) {
      await subscriber.subscribe(channel);
    }

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
      for (const channel of channels) {
        await subscriber.unsubscribe(channel);
      }
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
   * Get latest price from database
   */
  private async getPriceFromDb(pair: PairSymbol): Promise<PriceResponse | null> {
    try {
      const row = await this.db
        .selectFrom('price_history')
        .select(['pair', 'price', 'timestamp'])
        .where('pair', '=', pair)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .executeTakeFirst();

      if (!row) {
        return null;
      }

      return {
        pair: row.pair,
        price: parseFloat(row.price),
        timestamp: new Date(row.timestamp).getTime(),
      };
    } catch (error) {
      this.logger.error(`[PricesService] Database read error for ${pair}:`, error);
      throw new PriceVerseError(
        PriceVerseErrorCode.DATABASE_ERROR,
        `Failed to retrieve price from database for ${pair}`,
        { pair, error: String(error) }
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
          { period }
        );
    }

    return start;
  }
}
