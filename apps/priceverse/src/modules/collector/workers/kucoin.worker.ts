/**
 * Priceverse 2.0 - KuCoin Exchange Worker
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import { BaseExchangeWorker, type IRedisService, type ILogger } from './base-worker.js';
import type { Trade } from '../../../shared/types.js';

interface KucoinMessage {
  type: string;
  topic?: string;
  data?: {
    symbol: string;
    price: string;
    size: string;
    time: string;
    tradeId: string;
  };
}

@Injectable()
export class KucoinWorker extends BaseExchangeWorker {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTC-USDT'],
    ['eth-usd', 'ETH-USDT'],
    ['xmr-usd', 'XMR-USDT'],
  ]);

  private connectToken: string | null = null;

  constructor(redis: IRedisService, logger: ILogger) {
    super(redis, logger);
  }

  get exchangeName(): string {
    return 'kucoin';
  }

  get wsUrl(): string {
    // KuCoin requires token-based connection
    // In production, fetch token from /api/v1/bullet-public first
    return `wss://ws-api-spot.kucoin.com/?token=${this.connectToken || 'demo'}`;
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as KucoinMessage;
    if (msg.type !== 'message' || !msg.topic?.includes('/market/match')) {
      return null;
    }

    const trade = msg.data;
    if (!trade) return null;

    const pair = this.reverseLookup(trade.symbol);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: trade.price,
      volume: trade.size,
      timestamp: parseInt(trade.time, 10) / 1_000_000, // KuCoin uses nanoseconds
      tradeId: trade.tradeId,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      id: Date.now(),
      type: 'subscribe',
      topic: `/market/match:${symbols.join(',')}`,
      privateChannel: false,
      response: true,
    };
  }

  async fetchConnectToken(): Promise<string> {
    try {
      const response = await fetch(
        'https://api.kucoin.com/api/v1/bullet-public',
        { method: 'POST' },
      );
      const data = (await response.json()) as {
        data?: { token?: string };
      };
      this.connectToken = data?.data?.token || '';
      return this.connectToken;
    } catch {
      this.logger.error('[KuCoin] Failed to fetch connect token');
      return '';
    }
  }
}
