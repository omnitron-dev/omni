/**
 * Priceverse - OKX Exchange Worker
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import { BaseExchangeWorker, type IRedisService, type ILogger } from './base-worker.js';
import type { Trade } from '../../../shared/types.js';

interface OkxMessage {
  arg?: { channel: string; instId: string };
  data?: Array<{
    instId: string;
    px: string;
    sz: string;
    ts: string;
    tradeId: string;
  }>;
}

@Injectable()
export class OkxWorker extends BaseExchangeWorker {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTC-USDT'],
    ['eth-usd', 'ETH-USDT'],
    ['xmr-usd', 'XMR-USDT'],
  ]);

  constructor(redis: IRedisService, logger: ILogger) {
    super(redis, logger);
  }

  get exchangeName(): string {
    return 'okx';
  }

  get wsUrl(): string {
    return 'wss://ws.okx.com:8443/ws/v5/public';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as OkxMessage;
    if (!msg.arg || msg.arg.channel !== 'trades' || !msg.data?.length) {
      return null;
    }

    const trade = msg.data[msg.data.length - 1];
    const pair = this.reverseLookup(trade.instId);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: trade.px,
      volume: trade.sz,
      timestamp: parseInt(trade.ts, 10),
      tradeId: trade.tradeId,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      op: 'subscribe',
      args: symbols.map((s) => ({ channel: 'trades', instId: s })),
    };
  }
}
