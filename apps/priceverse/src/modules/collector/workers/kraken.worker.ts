/**
 * Priceverse 2.0 - Kraken Exchange Worker
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import { BaseExchangeWorker, type IRedisService, type ILogger } from './base-worker.js';
import type { Trade } from '../../../shared/types.js';

type KrakenMessage = [number, unknown[], string, string];

@Injectable()
export class KrakenWorker extends BaseExchangeWorker {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'XBT/USD'],
    ['eth-usd', 'ETH/USD'],
    ['xmr-usd', 'XMR/USD'],
  ]);

  constructor(redis: IRedisService, logger: ILogger) {
    super(redis, logger);
  }

  get exchangeName(): string {
    return 'kraken';
  }

  get wsUrl(): string {
    return 'wss://ws.kraken.com';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    if (!Array.isArray(data) || data.length < 4) return null;

    const [channelId, tradeData, channelName, pairName] = data as KrakenMessage;

    if (typeof channelName !== 'string' || !channelName.startsWith('trade')) {
      return null;
    }

    const pair = this.reverseLookup(pairName);
    if (!pair || !Array.isArray(tradeData)) return null;

    // Kraken sends array of trades, take the last one
    const lastTrade = tradeData[tradeData.length - 1] as string[];
    if (!lastTrade || lastTrade.length < 3) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: lastTrade[0],
      volume: lastTrade[1],
      timestamp: Math.floor(parseFloat(lastTrade[2]) * 1000),
      tradeId: `${channelId}-${lastTrade[2]}`,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      event: 'subscribe',
      pair: symbols,
      subscription: { name: 'trade' },
    };
  }
}
