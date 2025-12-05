/**
 * Unit Tests - Stream Aggregator Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TradeEntry, VwapResult } from '../../../src/shared/types.js';

// Mock dependencies
const mockRedis = {
  xgroup: vi.fn(),
  xreadgroup: vi.fn(),
  xack: vi.fn(),
  zadd: vi.fn(),
  zrangebyscore: vi.fn(),
  zremrangebyscore: vi.fn(),
  setex: vi.fn(),
  publish: vi.fn(),
};

const mockDb = {
  insertInto: vi.fn(() => ({
    values: vi.fn(() => ({
      execute: vi.fn(),
    })),
  })),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockCbrRate = {
  getRate: vi.fn(),
};

// Import after mocks are set up
import { StreamAggregatorService } from '../../../src/modules/aggregator/services/stream-aggregator.service.js';

describe('StreamAggregatorService - VWAP Calculation', () => {
  let service: StreamAggregatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StreamAggregatorService(
      mockRedis as any,
      mockDb as any,
      mockLogger as any,
      mockCbrRate as any
    );
  });

  describe('calculateVwap', () => {
    it('should calculate VWAP correctly with single trade', async () => {
      const now = Date.now();
      const trade: TradeEntry = {
        price: 45000,
        volume: 1.0,
        timestamp: now,
        exchange: 'binance',
      };

      mockRedis.zrangebyscore.mockResolvedValue([JSON.stringify(trade)]);
      mockRedis.zremrangebyscore.mockResolvedValue(0);

      const result = await (service as any).calculateVwap('btc-usd');

      expect(result).toBeDefined();
      expect(result.pair).toBe('btc-usd');
      expect(result.price).toBe(45000);
      expect(result.volume).toBe(1.0);
      expect(result.sources).toContain('binance');
    });

    it('should calculate VWAP correctly with multiple trades', async () => {
      const now = Date.now();
      const trades: TradeEntry[] = [
        { price: 45000, volume: 1.0, timestamp: now - 5000, exchange: 'binance' },
        { price: 45100, volume: 2.0, timestamp: now - 3000, exchange: 'kraken' },
        { price: 44900, volume: 1.5, timestamp: now - 1000, exchange: 'coinbase' },
      ];

      mockRedis.zrangebyscore.mockResolvedValue(trades.map((t) => JSON.stringify(t)));
      mockRedis.zremrangebyscore.mockResolvedValue(0);

      const result = await (service as any).calculateVwap('btc-usd');

      // VWAP = (45000*1 + 45100*2 + 44900*1.5) / (1 + 2 + 1.5)
      // VWAP = (45000 + 90200 + 67350) / 4.5 = 202550 / 4.5 = 45011.111...
      expect(result).toBeDefined();
      expect(result.price).toBeCloseTo(45011.11, 2);
      expect(result.volume).toBe(4.5);
      expect(result.sources).toHaveLength(3);
      expect(result.sources).toContain('binance');
      expect(result.sources).toContain('kraken');
      expect(result.sources).toContain('coinbase');
    });

    it('should return null when no trades in window', async () => {
      mockRedis.zrangebyscore.mockResolvedValue([]);

      const result = await (service as any).calculateVwap('btc-usd');

      expect(result).toBeNull();
    });

    it('should handle trades with same exchange (deduplicate sources)', async () => {
      const now = Date.now();
      const trades: TradeEntry[] = [
        { price: 45000, volume: 1.0, timestamp: now - 5000, exchange: 'binance' },
        { price: 45100, volume: 2.0, timestamp: now - 3000, exchange: 'binance' },
      ];

      mockRedis.zrangebyscore.mockResolvedValue(trades.map((t) => JSON.stringify(t)));
      mockRedis.zremrangebyscore.mockResolvedValue(0);

      const result = await (service as any).calculateVwap('btc-usd');

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toBe('binance');
    });

    it('should clean up old trades after calculation', async () => {
      const now = Date.now();
      const windowStart = now - 30000; // 30 second window
      const trade: TradeEntry = {
        price: 45000,
        volume: 1.0,
        timestamp: now,
        exchange: 'binance',
      };

      mockRedis.zrangebyscore.mockResolvedValue([JSON.stringify(trade)]);
      mockRedis.zremrangebyscore.mockResolvedValue(5);

      await (service as any).calculateVwap('btc-usd');

      expect(mockRedis.zremrangebyscore).toHaveBeenCalledWith(
        'buffer:trades:btc-usd',
        0,
        expect.any(Number)
      );
    });

    it('should handle large volume differences correctly', async () => {
      const now = Date.now();
      const trades: TradeEntry[] = [
        { price: 50000, volume: 0.01, timestamp: now - 5000, exchange: 'binance' },
        { price: 45000, volume: 100, timestamp: now - 3000, exchange: 'kraken' },
      ];

      mockRedis.zrangebyscore.mockResolvedValue(trades.map((t) => JSON.stringify(t)));
      mockRedis.zremrangebyscore.mockResolvedValue(0);

      const result = await (service as any).calculateVwap('btc-usd');

      // VWAP should be close to 45000 due to large volume
      expect(result.price).toBeCloseTo(45000, -2);
    });

    it('should handle zero volume gracefully', async () => {
      const now = Date.now();
      const trades: TradeEntry[] = [
        { price: 45000, volume: 0, timestamp: now - 5000, exchange: 'binance' },
      ];

      mockRedis.zrangebyscore.mockResolvedValue(trades.map((t) => JSON.stringify(t)));
      mockRedis.zremrangebyscore.mockResolvedValue(0);

      const result = await (service as any).calculateVwap('btc-usd');

      // Should handle division by zero or very small volumes
      expect(result).toBeDefined();
    });
  });

  describe('savePrice', () => {
    it('should save price to database with correct format', async () => {
      const vwap: VwapResult = {
        pair: 'btc-usd',
        price: 45123.456789,
        volume: 10.5,
        sources: ['binance', 'kraken'],
        timestamp: 1704067200000,
      };

      const mockExecute = vi.fn();
      mockDb.insertInto.mockReturnValue({
        values: vi.fn(() => ({
          execute: mockExecute,
        })),
      });

      await (service as any).savePrice(vwap);

      expect(mockDb.insertInto).toHaveBeenCalledWith('price_history');
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe('cachePrice', () => {
    it('should cache price with TTL and publish', async () => {
      const vwap: VwapResult = {
        pair: 'btc-usd',
        price: 45000,
        volume: 10,
        sources: ['binance'],
        timestamp: 1704067200000,
      };

      await (service as any).cachePrice(vwap);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'price:btc-usd',
        60,
        expect.any(String)
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'price:btc-usd',
        expect.any(String)
      );
    });

    it('should format cached price with fixed decimals', async () => {
      const vwap: VwapResult = {
        pair: 'btc-usd',
        price: 45123.456789012,
        volume: 10,
        sources: ['binance'],
        timestamp: 1704067200000,
      };

      await (service as any).cachePrice(vwap);

      const [[, , cacheValue]] = mockRedis.setex.mock.calls;
      const cached = JSON.parse(cacheValue);
      expect(cached.price).toBe('45123.45678901');
    });
  });

  describe('convertAndSaveRub', () => {
    it('should convert USD to RUB and save', async () => {
      const vwap: VwapResult = {
        pair: 'btc-usd',
        price: 45000,
        volume: 10,
        sources: ['binance'],
        timestamp: 1704067200000,
      };

      mockCbrRate.getRate.mockResolvedValue(75.5);

      const mockExecute = vi.fn();
      mockDb.insertInto.mockReturnValue({
        values: vi.fn(() => ({
          execute: mockExecute,
        })),
      });

      await (service as any).convertAndSaveRub(vwap);

      expect(mockCbrRate.getRate).toHaveBeenCalled();
      expect(mockDb.insertInto).toHaveBeenCalledWith('price_history');
      expect(mockExecute).toHaveBeenCalled();
    });

    it('should not save if RUB rate is invalid', async () => {
      const vwap: VwapResult = {
        pair: 'btc-usd',
        price: 45000,
        volume: 10,
        sources: ['binance'],
        timestamp: 1704067200000,
      };

      mockCbrRate.getRate.mockResolvedValue(0);

      await (service as any).convertAndSaveRub(vwap);

      expect(mockDb.insertInto).not.toHaveBeenCalled();
    });

    it('should not save if RUB rate is negative', async () => {
      const vwap: VwapResult = {
        pair: 'btc-usd',
        price: 45000,
        volume: 10,
        sources: ['binance'],
        timestamp: 1704067200000,
      };

      mockCbrRate.getRate.mockResolvedValue(-1);

      await (service as any).convertAndSaveRub(vwap);

      expect(mockDb.insertInto).not.toHaveBeenCalled();
    });

    it('should add cbr to sources for RUB prices', async () => {
      const vwap: VwapResult = {
        pair: 'btc-usd',
        price: 45000,
        volume: 10,
        sources: ['binance', 'kraken'],
        timestamp: 1704067200000,
      };

      mockCbrRate.getRate.mockResolvedValue(75.5);

      const mockValues = vi.fn(() => ({ execute: vi.fn() }));
      mockDb.insertInto.mockReturnValue({ values: mockValues });

      await (service as any).convertAndSaveRub(vwap);

      const [[values]] = mockValues.mock.calls;
      expect(values.sources).toContain('cbr');
      expect(values.sources).toHaveLength(3);
    });
  });

  describe('processBatch', () => {
    it('should process batch of messages and add to buffer', async () => {
      const messages: Array<[string, Array<[string, Record<string, string>]>]> = [
        [
          'stream:trades:binance',
          [
            [
              '1704067200000-0',
              {
                pair: 'btc-usd',
                price: '45000',
                volume: '1.0',
                timestamp: '1704067200000',
              },
            ],
          ],
        ],
      ];

      mockRedis.zadd.mockResolvedValue(1);
      mockRedis.xack.mockResolvedValue(1);

      await (service as any).processBatch('binance', messages);

      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'buffer:trades:btc-usd',
        1704067200000,
        expect.any(String)
      );
      expect(mockRedis.xack).toHaveBeenCalledWith(
        'stream:trades:binance',
        'aggregator-group',
        '1704067200000-0'
      );
    });

    it('should parse trade data correctly', async () => {
      const messages: Array<[string, Array<[string, Record<string, string>]>]> = [
        [
          'stream:trades:kraken',
          [
            [
              '1704067200000-0',
              {
                pair: 'eth-usd',
                price: '2500.50',
                volume: '10.5',
                timestamp: '1704067200000',
              },
            ],
          ],
        ],
      ];

      mockRedis.zadd.mockResolvedValue(1);
      mockRedis.xack.mockResolvedValue(1);

      await (service as any).processBatch('kraken', messages);

      const [[, , tradeStr]] = mockRedis.zadd.mock.calls;
      const trade = JSON.parse(tradeStr);
      expect(trade.price).toBe(2500.50);
      expect(trade.volume).toBe(10.5);
      expect(trade.exchange).toBe('kraken');
    });
  });
});
