/**
 * Priceverse 2.0 - Binance Exchange Worker
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import { BaseExchangeWorker, type IRedisService, type ILogger } from './base-worker.js';
import type { Trade } from '../../../shared/types.js';

interface BinanceTradeMessage {
  stream?: string;
  data?: {
    e: string; // Event type
    s: string; // Symbol
    p: string; // Price
    q: string; // Quantity
    T: number; // Trade time
    t: number; // Trade ID
  };
}

@Injectable()
export class BinanceWorker extends BaseExchangeWorker {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTCUSDT'],
    ['eth-usd', 'ETHUSDT'],
    ['xmr-usd', 'XMRUSDT'],
  ]);

  constructor(redis: IRedisService, logger: ILogger) {
    super(redis, logger);
  }

  get exchangeName(): string {
    return 'binance';
  }

  get wsUrl(): string {
    const streams = Array.from(this._symbolMap.values())
      .map((s) => `${s.toLowerCase()}@trade`)
      .join('/');
    return `wss://stream.binance.com:9443/stream?streams=${streams}`;
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as BinanceTradeMessage;
    if (!msg.data || msg.data.e !== 'trade') return null;

    const trade = msg.data;
    const pair = this.reverseLookup(trade.s);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: trade.p,
      volume: trade.q,
      timestamp: trade.T,
      tradeId: trade.t.toString(),
    };
  }

  buildSubscribeMessage(_symbols: string[]): unknown {
    // Binance uses URL params for stream subscription
    return null;
  }
}
