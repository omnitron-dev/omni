/**
 * Priceverse 2.0 - Stream Aggregator Service
 * Real-time VWAP calculation from Redis Streams
 */

import { Injectable, Inject, PostConstruct, PreDestroy } from '@omnitron-dev/titan/decorators';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import { DATABASE_CONNECTION } from '@omnitron-dev/titan/module/database';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import type { Kysely } from 'kysely';
import type { Database } from '../../../database/schema.js';
import type { TradeEntry, VwapResult, PairSymbol } from '../../../shared/types.js';
import { USD_PAIRS } from '../../../shared/types.js';
import type { CbrRateService } from '../../collector/services/cbr-rate.service.js';

interface IRedisService {
  xgroup(
    command: string,
    key: string,
    group: string,
    id: string,
    mkstream?: string,
  ): Promise<unknown>;
  xreadgroup(
    ...args: (string | number)[]
  ): Promise<Array<[string, Array<[string, Record<string, string>]>]> | null>;
  xack(key: string, group: string, id: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrangebyscore(
    key: string,
    min: number,
    max: number,
  ): Promise<string[]>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  setex(key: string, ttl: number, value: string): Promise<void>;
  publish(channel: string, message: string): Promise<number>;
}

const AGGREGATION_INTERVAL = 10_000; // 10 seconds
const WINDOW_SIZE = 30_000; // 30 second window
const BUFFER_KEY_PREFIX = 'buffer:trades:';
const EXCHANGES = ['binance', 'kraken', 'coinbase', 'okx', 'bybit', 'kucoin'];

@Injectable()
export class StreamAggregatorService {
  private isRunning = false;
  private consumerName: string;
  private aggregationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: IRedisService,
    @Inject(DATABASE_CONNECTION) private readonly db: Kysely<Database>,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule,
    @Inject('CbrRateService') private readonly cbrRate: CbrRateService,
  ) {
    this.consumerName = `aggregator-${process.pid}`;
  }

  private get logger() {
    return this.loggerModule.logger;
  }

  @PostConstruct()
  async start(): Promise<void> {
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
    }
    this.logger.info('[StreamAggregator] Stopped');
  }

  private async createConsumerGroups(): Promise<void> {
    for (const exchange of EXCHANGES) {
      const streamKey = `stream:trades:${exchange}`;
      try {
        await this.redis.xgroup(
          'CREATE',
          streamKey,
          'aggregator-group',
          '0',
          'MKSTREAM',
        );
      } catch {
        // Group already exists, ignore
      }
    }
  }

  private startConsumption(): void {
    this.consumeStreams();
  }

  private async consumeStreams(): Promise<void> {
    while (this.isRunning) {
      try {
        for (const exchange of EXCHANGES) {
          const streamKey = `stream:trades:${exchange}`;

          const messages = await this.redis.xreadgroup(
            'GROUP',
            'aggregator-group',
            this.consumerName,
            'COUNT',
            100,
            'BLOCK',
            1000,
            'STREAMS',
            streamKey,
            '>',
          );

          if (messages && messages.length > 0) {
            await this.processBatch(exchange, messages);
          }
        }
      } catch (error) {
        this.logger.error('[StreamAggregator] Stream consumption error:', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async processBatch(
    exchange: string,
    messages: Array<[string, Array<[string, Record<string, string>]>]>,
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
    this.aggregationTimer = setInterval(
      () => this.aggregate(),
      AGGREGATION_INTERVAL,
    );
  }

  /**
   * Run aggregation for all USD pairs
   */
  async aggregate(): Promise<void> {
    for (const pair of USD_PAIRS) {
      try {
        const vwap = await this.calculateVwap(pair);
        if (vwap) {
          await this.savePrice(vwap);
          await this.convertAndSaveRub(vwap);
          await this.cachePrice(vwap);
        }
      } catch (error) {
        this.logger.error(`[StreamAggregator] Aggregation error for ${pair}:`, error);
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

  private async savePrice(vwap: VwapResult): Promise<void> {
    await this.db
      .insertInto('price_history')
      .values({
        pair: vwap.pair as PairSymbol,
        price: vwap.price.toFixed(8),
        timestamp: new Date(vwap.timestamp),
        method: 'vwap',
        sources: vwap.sources,
        volume: vwap.volume.toFixed(8),
      })
      .execute();
  }

  private async convertAndSaveRub(vwap: VwapResult): Promise<void> {
    const usdRubRate = await this.cbrRate.getRate();
    if (usdRubRate <= 0) return;

    const rubPair = vwap.pair.replace('-usd', '-rub') as PairSymbol;
    const rubPrice = vwap.price * usdRubRate;

    await this.db
      .insertInto('price_history')
      .values({
        pair: rubPair,
        price: rubPrice.toFixed(8),
        timestamp: new Date(vwap.timestamp),
        method: 'vwap',
        sources: [...vwap.sources, 'cbr'],
        volume: vwap.volume.toFixed(8),
      })
      .execute();

    // Cache RUB price
    await this.cachePrice({
      ...vwap,
      pair: rubPair,
      price: rubPrice,
      sources: [...vwap.sources, 'cbr'],
    });
  }

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
}
