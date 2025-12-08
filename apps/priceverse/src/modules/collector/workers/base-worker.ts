/**
 * Priceverse 2.0 - Base Exchange Worker
 * Abstract base class for all exchange WebSocket workers
 */

import { PostConstruct, PreDestroy } from '@omnitron-dev/titan/decorators';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import WebSocket from 'ws';
import type { Trade } from '../../../shared/types.js';

// Re-export ILogger for convenience
export type { ILogger };

// Redis service token for DI
export const REDIS_SERVICE_TOKEN = Symbol('RedisService');

export interface ExchangeWorkerConfig {
  name: string;
  wsUrl: string;
  symbols: Map<string, string>; // internal pair -> exchange symbol
  reconnectDelay: number;
  maxReconnectAttempts: number;
}

export interface IRedisService {
  xadd(
    key: string,
    id: string,
    fields: Record<string, string>,
  ): Promise<string | null>;
}

// Note: @Injectable() cannot be applied to abstract classes
// Concrete implementations should use @Injectable()
export abstract class BaseExchangeWorker {
  protected ws: WebSocket | null = null;
  protected isConnected = false;
  protected reconnectAttempts = 0;
  protected isRunning = false;
  protected tradesReceived = 0;
  protected errorsCount = 0;

  constructor(
    protected readonly redis: IRedisService,
    protected readonly logger: ILogger,
    protected readonly maxReconnectAttempts: number = 10,
  ) {}

  abstract get exchangeName(): string;
  abstract get wsUrl(): string;
  abstract get symbolMap(): Map<string, string>;

  abstract parseMessage(data: unknown): Trade | null;
  abstract buildSubscribeMessage(symbols: string[]): unknown;

  @PostConstruct()
  async start(): Promise<void> {
    this.isRunning = true;
    await this.connect();
  }

  @PreDestroy()
  async stop(): Promise<void> {
    this.isRunning = false;
    this.disconnect();
  }

  getStats() {
    return {
      exchange: this.exchangeName,
      connected: this.isConnected,
      tradesReceived: this.tradesReceived,
      errors: this.errorsCount,
    };
  }

  protected async connect(): Promise<void> {
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.logger.info(`[${this.exchangeName}] Connected to WebSocket`);
        this.subscribe();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.logger.warn(`[${this.exchangeName}] WebSocket disconnected`);
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.errorsCount++;
        this.logger.error(`[${this.exchangeName}] WebSocket error:`, error);
      });
    } catch (error) {
      this.errorsCount++;
      this.logger.error(`[${this.exchangeName}] Connection failed:`, error);
      this.scheduleReconnect();
    }
  }

  protected subscribe(): void {
    if (!this.ws || !this.isConnected) return;

    const symbols = Array.from(this.symbolMap.values());
    const message = this.buildSubscribeMessage(symbols);

    if (message) {
      this.ws.send(JSON.stringify(message));
      this.logger.info(
        `[${this.exchangeName}] Subscribed to ${symbols.length} symbols`,
      );
    }
  }

  protected async handleMessage(data: WebSocket.RawData): Promise<void> {
    try {
      const dataStr = typeof data === 'string' ? data : data.toString();
      const parsed = JSON.parse(dataStr);
      const trade = this.parseMessage(parsed);

      if (trade) {
        this.tradesReceived++;
        await this.publishTrade(trade);
      }
    } catch {
      // Ignore parse errors for non-trade messages
    }
  }

  protected async publishTrade(trade: Trade): Promise<void> {
    const streamKey = `stream:trades:${this.exchangeName}`;

    await this.redis.xadd(streamKey, '*', {
      pair: trade.pair,
      price: trade.price,
      volume: trade.volume,
      timestamp: trade.timestamp.toString(),
      trade_id: trade.tradeId,
    });
  }

  protected disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  protected scheduleReconnect(): void {
    if (!this.isRunning) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `[${this.exchangeName}] Max reconnect attempts (${this.maxReconnectAttempts}) reached`,
      );
      return;
    }

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      30000, // Max 30 seconds
    );

    this.reconnectAttempts++;
    this.logger.info(
      `[${this.exchangeName}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    setTimeout(() => this.connect(), delay);
  }

  protected reverseLookup(symbol: string): string | null {
    for (const [pair, sym] of this.symbolMap.entries()) {
      if (sym === symbol || sym.toUpperCase() === symbol.toUpperCase()) {
        return pair;
      }
    }
    return null;
  }
}
