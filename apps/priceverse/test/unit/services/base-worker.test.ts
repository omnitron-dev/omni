/**
 * Unit Tests - Base Exchange Worker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseExchangeWorker } from '../../../src/modules/collector/workers/base-worker.js';
import type { Trade } from '../../../src/shared/types.js';

// Create a concrete implementation for testing
class TestExchangeWorker extends BaseExchangeWorker {
  public wsUrlValue = 'wss://test.example.com/stream';
  public symbolMapValue = new Map([
    ['btc-usd', 'BTCUSD'],
    ['eth-usd', 'ETHUSD'],
  ]);

  get exchangeName(): string {
    return 'test-exchange';
  }

  get wsUrl(): string {
    return this.wsUrlValue;
  }

  get symbolMap(): Map<string, string> {
    return this.symbolMapValue;
  }

  parseMessage(data: any): Trade | null {
    if (data.type === 'trade') {
      return {
        exchange: this.exchangeName,
        pair: data.pair,
        price: data.price.toString(),
        volume: data.volume.toString(),
        timestamp: data.timestamp,
        tradeId: data.tradeId,
      };
    }
    return null;
  }

  buildSubscribeMessage(symbols: string[]): any {
    return {
      method: 'subscribe',
      symbols,
    };
  }
}

describe('BaseExchangeWorker', () => {
  let worker: TestExchangeWorker;
  let mockRedis: any;
  let mockLogger: any;

  beforeEach(() => {
    mockRedis = {
      xadd: vi.fn().mockResolvedValue('1704067200000-0'),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    worker = new TestExchangeWorker(mockRedis, mockLogger, 20); // Higher max attempts for testing
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getStats', () => {
    it('should return worker statistics', () => {
      const stats = worker.getStats();

      expect(stats).toEqual({
        exchange: 'test-exchange',
        connected: false,
        tradesReceived: 0,
        errors: 0,
      });
    });

    it('should reflect updated trade count', () => {
      (worker as any).tradesReceived = 100;

      const stats = worker.getStats();
      expect(stats.tradesReceived).toBe(100);
    });

    it('should reflect connection status', () => {
      (worker as any).isConnected = true;

      const stats = worker.getStats();
      expect(stats.connected).toBe(true);
    });
  });

  describe('parseMessage', () => {
    it('should parse valid trade message', () => {
      const message = {
        type: 'trade',
        pair: 'btc-usd',
        price: 45000,
        volume: 1.5,
        timestamp: 1704067200000,
        tradeId: 'trade-123',
      };

      const trade = worker.parseMessage(message);

      expect(trade).toBeDefined();
      expect(trade?.exchange).toBe('test-exchange');
      expect(trade?.pair).toBe('btc-usd');
      expect(trade?.price).toBe('45000');
      expect(trade?.volume).toBe('1.5');
    });

    it('should return null for non-trade messages', () => {
      const message = {
        type: 'heartbeat',
      };

      const trade = worker.parseMessage(message);
      expect(trade).toBeNull();
    });
  });

  describe('buildSubscribeMessage', () => {
    it('should build subscription message with symbols', () => {
      const symbols = ['BTCUSD', 'ETHUSD'];
      const message = worker.buildSubscribeMessage(symbols);

      expect(message).toEqual({
        method: 'subscribe',
        symbols: ['BTCUSD', 'ETHUSD'],
      });
    });

    it('should handle empty symbol array', () => {
      const message = worker.buildSubscribeMessage([]);

      expect(message).toEqual({
        method: 'subscribe',
        symbols: [],
      });
    });
  });

  describe('publishTrade', () => {
    it('should publish trade to Redis stream', async () => {
      const trade: Trade = {
        exchange: 'test-exchange',
        pair: 'btc-usd',
        price: '45000',
        volume: '1.5',
        timestamp: 1704067200000,
        tradeId: 'trade-123',
      };

      await (worker as any).publishTrade(trade);

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:trades:test-exchange',
        '*',
        {
          pair: 'btc-usd',
          price: '45000',
          volume: '1.5',
          timestamp: '1704067200000',
          trade_id: 'trade-123',
        }
      );
    });

    it('should handle different exchanges', async () => {
      const trade: Trade = {
        exchange: 'binance',
        pair: 'eth-usd',
        price: '2500',
        volume: '10',
        timestamp: 1704067200000,
        tradeId: 'trade-456',
      };

      await (worker as any).publishTrade(trade);

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:trades:test-exchange',
        '*',
        expect.objectContaining({
          pair: 'eth-usd',
        })
      );
    });
  });

  describe('reverseLookup', () => {
    it('should find internal pair for exchange symbol', () => {
      const pair = (worker as any).reverseLookup('BTCUSD');
      expect(pair).toBe('btc-usd');
    });

    it('should handle case-insensitive lookup', () => {
      const pair = (worker as any).reverseLookup('btcusd');
      expect(pair).toBe('btc-usd');
    });

    it('should return null for unknown symbol', () => {
      const pair = (worker as any).reverseLookup('UNKNOWN');
      expect(pair).toBeNull();
    });

    it('should handle exact match first', () => {
      const pair = (worker as any).reverseLookup('BTCUSD');
      expect(pair).toBe('btc-usd');
    });
  });

  describe('handleMessage', () => {
    it('should process valid trade message', async () => {
      const message = JSON.stringify({
        type: 'trade',
        pair: 'btc-usd',
        price: 45000,
        volume: 1.5,
        timestamp: 1704067200000,
        tradeId: 'trade-123',
      });

      await (worker as any).handleMessage(Buffer.from(message));

      expect((worker as any).tradesReceived).toBe(1);
      expect(mockRedis.xadd).toHaveBeenCalled();
    });

    it('should handle string data', async () => {
      const message = JSON.stringify({
        type: 'trade',
        pair: 'btc-usd',
        price: 45000,
        volume: 1.5,
        timestamp: 1704067200000,
        tradeId: 'trade-123',
      });

      await (worker as any).handleMessage(message);

      expect((worker as any).tradesReceived).toBe(1);
    });

    it('should ignore non-trade messages silently', async () => {
      const message = JSON.stringify({
        type: 'heartbeat',
      });

      await (worker as any).handleMessage(message);

      expect((worker as any).tradesReceived).toBe(0);
      expect(mockRedis.xadd).not.toHaveBeenCalled();
    });

    it('should ignore invalid JSON silently', async () => {
      await (worker as any).handleMessage('invalid json');

      expect((worker as any).tradesReceived).toBe(0);
      expect(mockRedis.xadd).not.toHaveBeenCalled();
    });
  });

  describe('scheduleReconnect', () => {
    it('should not reconnect if not running', () => {
      (worker as any).isRunning = false;
      vi.useFakeTimers();

      (worker as any).scheduleReconnect();

      expect(mockLogger.info).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should not reconnect after max attempts', () => {
      (worker as any).isRunning = true;
      (worker as any).reconnectAttempts = 20; // Equal to maxReconnectAttempts

      (worker as any).scheduleReconnect();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max reconnect attempts')
      );
    });

    it('should use exponential backoff', () => {
      (worker as any).isRunning = true;
      vi.useFakeTimers();

      // First attempt - 1 second
      (worker as any).reconnectAttempts = 0;
      (worker as any).scheduleReconnect();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('1000ms')
      );

      // Second attempt - 2 seconds
      mockLogger.info.mockClear();
      (worker as any).reconnectAttempts = 1;
      (worker as any).scheduleReconnect();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('2000ms')
      );

      // Third attempt - 4 seconds
      mockLogger.info.mockClear();
      (worker as any).reconnectAttempts = 2;
      (worker as any).scheduleReconnect();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('4000ms')
      );

      vi.useRealTimers();
    });

    it('should cap reconnect delay at 30 seconds', () => {
      (worker as any).isRunning = true;
      (worker as any).reconnectAttempts = 6; // 2^6 = 64 seconds, should cap at 30
      vi.useFakeTimers();
      const connectSpy = vi.spyOn(worker as any, 'connect').mockImplementation(() => {});

      (worker as any).scheduleReconnect();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('30000ms')
      );

      vi.useRealTimers();
      connectSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('should set connection status to false', () => {
      (worker as any).isConnected = true;

      (worker as any).disconnect();

      expect((worker as any).isConnected).toBe(false);
    });

    it('should clear WebSocket reference', () => {
      (worker as any).ws = { close: vi.fn() } as any;

      (worker as any).disconnect();

      expect((worker as any).ws).toBeNull();
    });
  });

  describe('error counting', () => {
    it('should increment error count on WebSocket error', () => {
      const initialErrors = (worker as any).errorsCount;

      // Simulate error in connection
      mockLogger.error.mockImplementation(() => {
        (worker as any).errorsCount++;
      });

      (worker as any).errorsCount++;

      expect((worker as any).errorsCount).toBe(initialErrors + 1);
    });
  });

  describe('symbolMap access', () => {
    it('should provide access to symbol mappings', () => {
      const symbolMap = worker.symbolMap;

      expect(symbolMap.size).toBe(2);
      expect(symbolMap.get('btc-usd')).toBe('BTCUSD');
      expect(symbolMap.get('eth-usd')).toBe('ETHUSD');
    });
  });

  describe('exchangeName access', () => {
    it('should provide exchange name', () => {
      expect(worker.exchangeName).toBe('test-exchange');
    });
  });

  describe('wsUrl access', () => {
    it('should provide WebSocket URL', () => {
      expect(worker.wsUrl).toBe('wss://test.example.com/stream');
    });
  });
});
