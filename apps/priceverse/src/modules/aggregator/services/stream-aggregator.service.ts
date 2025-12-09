/**
 * Priceverse - Stream Aggregator Service
 * Real-time VWAP calculation using repositories and transactions
 */

import { Injectable, Inject, PostConstruct, PreDestroy } from '@omnitron-dev/titan/decorators';
import {
  withRetry,
} from '@omnitron-dev/titan/module/database';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import {
  PriceHistoryRepository,
  type CreatePriceHistoryInput,
} from '../../../database/index.js';
import { PRICE_HISTORY_REPOSITORY, CBR_RATE_SERVICE_TOKEN } from '../../../shared/tokens.js';
import type { TradeEntry, VwapResult, PairSymbol, SupportedExchange } from '../../../shared/types.js';
import { USD_PAIRS, SUPPORTED_EXCHANGES } from '../../../shared/types.js';
import type { CbrRateService } from '../../collector/services/cbr-rate.service.js';

const AGGREGATION_INTERVAL = 10_000; // 10 seconds
const WINDOW_SIZE = 30_000; // 30 second window
const BUFFER_KEY_PREFIX = 'buffer:trades:';

const RETRY_OPTIONS = {
  maxAttempts: 3,
  delayMs: 500,
  backoff: true,
};

const MAX_CONSECUTIVE_ERRORS = 10;
const ERROR_RESET_INTERVAL = 60_000; // Reset error count after 1 minute of success

@Injectable({ scope: 'singleton' })
export class StreamAggregatorService {
  private isRunning = false;
  private consumerName: string;
  private aggregationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly priceHistoryRepo: PriceHistoryRepository;
  private consumptionPromise: Promise<void> | null = null;
  private consecutiveErrors = 0;
  private lastErrorTime = 0;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule,
    @Inject(CBR_RATE_SERVICE_TOKEN) private readonly cbrRate: CbrRateService,
    @Inject(PRICE_HISTORY_REPOSITORY) priceHistoryRepo: PriceHistoryRepository
  ) {
    this.consumerName = `aggregator-${process.pid}`;
    this.priceHistoryRepo = priceHistoryRepo;
  }

  private get logger() {
    return this.loggerModule.logger;
  }

  @PostConstruct()
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('[StreamAggregator] Already running, skipping start');
      return;
    }
    this.isRunning = true;
    await this.createConsumerGroups();
    this.startConsumption();
    this.startAggregation();
    this.logger.info('[StreamAggregator] Started');
  }

  @PreDestroy()
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
    // Wait for consumption loop to finish
    if (this.consumptionPromise) {
      try {
        await this.consumptionPromise;
      } catch {
        // Ignore errors during shutdown
      }
      this.consumptionPromise = null;
    }
    this.logger.info('[StreamAggregator] Stopped');
  }

  private async createConsumerGroups(): Promise<void> {
    for (const exchange of SUPPORTED_EXCHANGES) {
      const streamKey = `stream:trades:${exchange}`;
      try {
        await this.redis.xgroup('CREATE', streamKey, 'aggregator-group', '0', 'MKSTREAM');
      } catch {
        // Group already exists, ignore
      }
    }
  }

  private startConsumption(): void {
    // Store promise for proper shutdown handling
    this.consumptionPromise = this.consumeStreams().catch((error) => {
      // This should only happen for truly fatal errors
      this.logger.error('[StreamAggregator] Fatal consumption error:', error);
      this.isRunning = false;
    });
  }

  private async consumeStreams(): Promise<void> {
    while (this.isRunning) {
      try {
        for (const exchange of SUPPORTED_EXCHANGES) {
          if (!this.isRunning) break; // Check between exchanges

          const streamKey = `stream:trades:${exchange}`;

          const messages = await this.redis.xreadgroup(
            'aggregator-group',
            this.consumerName,
            100,
            1000,
            [{ key: streamKey, id: '>' }]
          );

          if (messages && messages.length > 0) {
            await this.processBatch(exchange, messages);
          }
        }

        // Reset error count on successful iteration
        if (this.consecutiveErrors > 0 && Date.now() - this.lastErrorTime > ERROR_RESET_INTERVAL) {
          this.consecutiveErrors = 0;
        }
      } catch (error) {
        this.consecutiveErrors++;
        this.lastErrorTime = Date.now();

        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`[StreamAggregator] Stream consumption error (${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${errorMessage}`);

        // Circuit breaker: stop if too many consecutive errors
        if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.logger.error('[StreamAggregator] Circuit breaker triggered - too many consecutive errors');
          this.isRunning = false;
          throw new Error(`Stream consumption failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        }

        // Exponential backoff with cap
        const backoffMs = Math.min(1000 * Math.pow(2, this.consecutiveErrors - 1), 30_000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  private async processBatch(
    exchange: string,
    messages: Array<[string, Array<[string, Record<string, string>]>]>
  ): Promise<void> {
    for (const [streamKey, entries] of messages) {
      for (const [id, fields] of entries) {
        const trade: TradeEntry = {
          price: parseFloat(fields.price),
          volume: parseFloat(fields.volume),
          timestamp: parseInt(fields.timestamp, 10),
          exchange,
        };

        const pair = fields.pair;
        const bufferKey = `${BUFFER_KEY_PREFIX}${pair}`;

        // Add to sorted set buffer (score = timestamp)
        await this.redis.zadd(bufferKey, trade.timestamp, JSON.stringify(trade));

        // Acknowledge message
        await this.redis.xack(streamKey, 'aggregator-group', id);
      }
    }
  }

  private startAggregation(): void {
    this.aggregationTimer = setInterval(() => this.aggregate(), AGGREGATION_INTERVAL);
  }

  /**
   * Run aggregation for all USD pairs
   * Uses transaction for atomic price saves
   */
  async aggregate(): Promise<void> {
    for (const pair of USD_PAIRS) {
      try {
        const vwap = await this.calculateVwap(pair);
        if (vwap) {
          await this.savePricesWithTransaction(vwap);
          await this.cachePrice(vwap);
        }
      } catch (error) {
        // Log the raw error first for debugging
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`[StreamAggregator] Aggregation error for ${pair}: ${errorMessage}`, {
          stack: errorStack,
        });
      }
    }
  }

  private async calculateVwap(pair: string): Promise<VwapResult | null> {
    const bufferKey = `${BUFFER_KEY_PREFIX}${pair}`;
    const now = Date.now();
    const windowStart = now - WINDOW_SIZE;

    // Get trades within window
    const trades = await this.redis.zrangebyscore(bufferKey, windowStart, now);

    if (trades.length === 0) return null;

    // Calculate VWAP
    let totalPriceVolume = 0;
    let totalVolume = 0;
    const sources = new Set<string>();

    for (const tradeStr of trades) {
      const trade: TradeEntry = JSON.parse(tradeStr);
      totalPriceVolume += trade.price * trade.volume;
      totalVolume += trade.volume;
      sources.add(trade.exchange);
    }

    const vwapPrice = totalPriceVolume / totalVolume;

    // Cleanup old trades
    await this.redis.zremrangebyscore(bufferKey, 0, windowStart);

    return {
      pair,
      price: vwapPrice,
      volume: totalVolume,
      sources: Array.from(sources),
      timestamp: now,
    };
  }

  /**
   * Save USD and RUB prices
   * Note: @Transactional requires TransactionManager injection
   * For simplicity, we save prices sequentially here
   */
  private async savePricesWithTransaction(vwap: VwapResult): Promise<void> {
    // Save USD price
    await this.savePrice(vwap);

    // Convert and save RUB price
    await this.convertAndSaveRub(vwap);
  }

  /**
   * Save price using repository with retry
   */
  private async savePrice(vwap: VwapResult): Promise<void> {
    const input: CreatePriceHistoryInput = {
      pair: vwap.pair as PairSymbol,
      price: vwap.price.toFixed(8),
      timestamp: new Date(vwap.timestamp),
      method: 'vwap',
      sources: vwap.sources,
      volume: vwap.volume.toFixed(8),
    };

    await withRetry(
      () => this.priceHistoryRepo.create(input),
      RETRY_OPTIONS
    );
  }

  /**
   * Convert USD price to RUB and save
   */
  private async convertAndSaveRub(vwap: VwapResult): Promise<void> {
    const usdRubRate = await this.cbrRate.getRate();
    if (usdRubRate <= 0) return;

    const rubPair = vwap.pair.replace('-usd', '-rub') as PairSymbol;
    const rubPrice = vwap.price * usdRubRate;

    const input: CreatePriceHistoryInput = {
      pair: rubPair,
      price: rubPrice.toFixed(8),
      timestamp: new Date(vwap.timestamp),
      method: 'vwap',
      sources: [...vwap.sources, 'cbr'],
      volume: vwap.volume.toFixed(8),
    };

    await withRetry(
      () => this.priceHistoryRepo.create(input),
      RETRY_OPTIONS
    );

    // Cache RUB price
    await this.cachePrice({
      ...vwap,
      pair: rubPair,
      price: rubPrice,
      sources: [...vwap.sources, 'cbr'],
    });
  }

  /**
   * Cache price in Redis and publish for real-time subscribers
   */
  private async cachePrice(vwap: VwapResult): Promise<void> {
    const cacheKey = `price:${vwap.pair}`;
    const cacheValue = JSON.stringify({
      price: vwap.price.toFixed(8),
      timestamp: vwap.timestamp,
      sources: vwap.sources,
    });

    await this.redis.setex(cacheKey, 60, cacheValue);

    // Publish for real-time subscribers
    await this.redis.publish(cacheKey, cacheValue);
  }

  /**
   * Batch save prices (for bulk operations)
   */
  async savePricesBatch(prices: CreatePriceHistoryInput[]): Promise<void> {
    if (prices.length === 0) return;

    await withRetry(
      () => this.priceHistoryRepo.insertMany(prices),
      RETRY_OPTIONS
    );
  }

  /**
   * Get aggregation stats for monitoring
   */
  async getStats(): Promise<{
    isRunning: boolean;
    consumerName: string;
    exchanges: readonly SupportedExchange[];
    windowSize: number;
    interval: number;
  }> {
    return {
      isRunning: this.isRunning,
      consumerName: this.consumerName,
      exchanges: SUPPORTED_EXCHANGES,
      windowSize: WINDOW_SIZE,
      interval: AGGREGATION_INTERVAL,
    };
  }
}
