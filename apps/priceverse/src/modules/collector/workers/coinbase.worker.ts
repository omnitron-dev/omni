/**
 * Priceverse - Coinbase Exchange Worker
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import { BaseExchangeWorker, type IRedisService, type ILogger } from './base-worker.js';
import type { Trade } from '../../../shared/types.js';

interface CoinbaseMessage {
  type: string;
  product_id: string;
  price: string;
  size: string;
  time: string;
  trade_id: number;
}

@Injectable()
export class CoinbaseWorker extends BaseExchangeWorker {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTC-USD'],
    ['eth-usd', 'ETH-USD'],
  ]);

  constructor(redis: IRedisService, logger: ILogger) {
    super(redis, logger);
  }

  get exchangeName(): string {
    return 'coinbase';
  }

  get wsUrl(): string {
    return 'wss://ws-feed.exchange.coinbase.com';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as CoinbaseMessage;
    if (msg.type !== 'match' && msg.type !== 'last_match') return null;

    const pair = this.reverseLookup(msg.product_id);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: msg.price,
      volume: msg.size,
      timestamp: new Date(msg.time).getTime(),
      tradeId: msg.trade_id.toString(),
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      type: 'subscribe',
      product_ids: symbols,
      channels: ['matches'],
    };
  }
}
