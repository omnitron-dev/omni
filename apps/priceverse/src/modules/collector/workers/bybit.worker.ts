/**
 * Priceverse 2.0 - Bybit Exchange Worker
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import { BaseExchangeWorker, type IRedisService, type ILogger } from './base-worker.js';
import type { Trade } from '../../../shared/types.js';

interface BybitMessage {
  topic?: string;
  data?: Array<{
    s: string; // Symbol
    p: string; // Price
    v: string; // Volume
    T: number; // Timestamp
    i: string; // Trade ID
  }>;
}

@Injectable()
export class BybitWorker extends BaseExchangeWorker {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTCUSDT'],
    ['eth-usd', 'ETHUSDT'],
    ['xmr-usd', 'XMRUSDT'],
  ]);

  constructor(redis: IRedisService, logger: ILogger) {
    super(redis, logger);
  }

  get exchangeName(): string {
    return 'bybit';
  }

  get wsUrl(): string {
    return 'wss://stream.bybit.com/v5/public/spot';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as BybitMessage;
    if (!msg.topic?.startsWith('publicTrade') || !msg.data?.length) {
      return null;
    }

    const trade = msg.data[msg.data.length - 1];
    const pair = this.reverseLookup(trade.s);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: trade.p,
      volume: trade.v,
      timestamp: trade.T,
      tradeId: trade.i,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      op: 'subscribe',
      args: symbols.map((s) => `publicTrade.${s}`),
    };
  }
}
