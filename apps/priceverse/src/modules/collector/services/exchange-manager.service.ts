/**
 * Priceverse - Exchange Manager Service
 * Manages all exchange workers and their lifecycle
 */

import { Injectable, Inject, PostConstruct, PreDestroy } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import type { ILogger, IRedisService } from '../workers/base-worker.js';
import { BaseExchangeWorker } from '../workers/base-worker.js';
import { BinanceWorker } from '../workers/binance.worker.js';
import { KrakenWorker } from '../workers/kraken.worker.js';
import { CoinbaseWorker } from '../workers/coinbase.worker.js';
import { OkxWorker } from '../workers/okx.worker.js';
import { BybitWorker } from '../workers/bybit.worker.js';
import { KucoinWorker } from '../workers/kucoin.worker.js';
import type { ExchangeWorkerStats, SupportedExchange } from '../../../shared/types.js';

type WorkerConstructor = new (redis: IRedisService, logger: ILogger) => BaseExchangeWorker;

const WORKER_MAP: Record<string, WorkerConstructor> = {
  binance: BinanceWorker,
  kraken: KrakenWorker,
  coinbase: CoinbaseWorker,
  okx: OkxWorker,
  bybit: BybitWorker,
  kucoin: KucoinWorker,
};

@Injectable({ scope: 'singleton' })
export class ExchangeManagerService {
  private workers: Map<string, BaseExchangeWorker> = new Map();
  private running = false;

  /** Check if the exchange manager is running */
  get isRunning(): boolean {
    return this.running;
  }

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule,
    @Inject('EnabledExchanges')
    private readonly enabledExchanges: string[] = [
      'binance',
      'kraken',
      'coinbase',
      'okx',
      'bybit',
      'kucoin',
    ],
  ) { }

  private get logger(): ILogger {
    return this.loggerModule.logger;
  }

  @PostConstruct()
  async start(): Promise<void> {
    if (this.running) {
      this.logger.info('[ExchangeManager] Already running, skipping start');
      return;
    }
    this.running = true;
    this.logger.info(
      `[ExchangeManager] Starting ${this.enabledExchanges.length} exchange workers`,
    );

    for (const exchange of this.enabledExchanges) {
      await this.startWorker(exchange);
    }
  }

  @PreDestroy()
  async stop(): Promise<void> {
    this.running = false;
    this.logger.info('[ExchangeManager] Stopping all exchange workers');

    const stopPromises = Array.from(this.workers.values()).map((worker) =>
      worker.stop(),
    );
    await Promise.allSettled(stopPromises);

    this.workers.clear();
  }

  private async startWorker(exchange: string): Promise<void> {
    const WorkerClass = WORKER_MAP[exchange];
    if (!WorkerClass) {
      this.logger.warn(`[ExchangeManager] Unknown exchange: ${exchange}`);
      return;
    }

    try {
      const worker = new WorkerClass(this.redis, this.logger);
      await worker.start();
      this.workers.set(exchange, worker);
      this.logger.info(`[ExchangeManager] Started ${exchange} worker`);
    } catch (error) {
      this.logger.error(`[ExchangeManager] Failed to start ${exchange}:`, error);
    }
  }

  /**
   * Get stats for all workers
   */
  getStats(): ExchangeWorkerStats[] {
    return Array.from(this.workers.values()).map((worker) => worker.getStats());
  }

  /**
   * Get connected exchanges count
   */
  getConnectedCount(): number {
    return Array.from(this.workers.values()).filter(
      (w) => w.getStats().connected,
    ).length;
  }

  /**
   * Check if specific exchange is connected
   */
  isExchangeConnected(exchange: SupportedExchange): boolean {
    const worker = this.workers.get(exchange);
    return worker?.getStats().connected ?? false;
  }

  /**
   * Get total trades received across all exchanges
   */
  getTotalTradesReceived(): number {
    return Array.from(this.workers.values()).reduce(
      (total, worker) => total + worker.getStats().tradesReceived,
      0,
    );
  }
}
