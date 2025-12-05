/**
 * Unit Tests - OHLCV Aggregator Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockDb = {
  selectFrom: vi.fn(),
  insertInto: vi.fn(),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Create mock ILoggerModule that wraps the logger
const mockLoggerModule = { logger: mockLogger };

// Import after mocks
import { OhlcvAggregatorService } from '../../../src/modules/aggregator/services/ohlcv-aggregator.service.js';

describe('OhlcvAggregatorService', () => {
  let service: OhlcvAggregatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OhlcvAggregatorService(mockDb as any, mockLoggerModule as any);
  });

  describe('floorToInterval', () => {
    it('should floor date to 5-minute interval', () => {
      const date = new Date('2024-01-01T12:07:30Z');
      const result = (service as any).floorToInterval(date, 5 * 60 * 1000);

      expect(result.toISOString()).toBe('2024-01-01T12:05:00.000Z');
    });

    it('should floor date to 1-hour interval', () => {
      const date = new Date('2024-01-01T12:45:30Z');
      const result = (service as any).floorToInterval(date, 60 * 60 * 1000);

      expect(result.toISOString()).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should handle exact interval boundaries', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const result = (service as any).floorToInterval(date, 60 * 60 * 1000);

      expect(result.toISOString()).toBe('2024-01-01T12:00:00.000Z');
    });
  });

  describe('calculateOhlcv', () => {
    it('should calculate OHLCV from price history', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      // Mock aggregate query
      const mockExecuteTakeFirst = vi.fn().mockResolvedValue({
        low: '44000.00000000',
        high: '46000.00000000',
        trade_count: 10,
        price_volume_sum: '448000.00000000',
        volume_sum: '10.00000000',
      });

      // Mock first price query
      const mockFirstPrice = vi.fn().mockResolvedValue({
        price: '44500.00000000',
      });

      // Mock last price query
      const mockLastPrice = vi.fn().mockResolvedValue({
        price: '45500.00000000',
      });

      let callCount = 0;
      mockDb.selectFrom.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn(),
        };

        // First call is aggregate, second is first price, third is last price
        if (callCount === 0) {
          query.executeTakeFirst = mockExecuteTakeFirst;
        } else if (callCount === 1) {
          query.executeTakeFirst = mockFirstPrice;
        } else {
          query.executeTakeFirst = mockLastPrice;
        }
        callCount++;

        return query;
      });

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result).toBeDefined();
      expect(result.pair).toBe('btc-usd');
      expect(result.open).toBe('44500.00000000');
      expect(result.high).toBe('46000.00000000');
      expect(result.low).toBe('44000.00000000');
      expect(result.close).toBe('45500.00000000');
      expect(parseFloat(result.volume)).toBe(10);
      expect(result.vwap).toBe('44800.00000000');
      expect(result.tradeCount).toBe(10);
    });

    it('should return null when no trades in period', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      const mockExecuteTakeFirst = vi.fn().mockResolvedValue({
        trade_count: 0,
      });

      mockDb.selectFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: mockExecuteTakeFirst,
      });

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result).toBeNull();
    });

    it('should calculate VWAP correctly', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      const mockExecuteTakeFirst = vi.fn().mockResolvedValue({
        low: '100.00000000',
        high: '100.00000000',
        trade_count: 3,
        price_volume_sum: '250.00000000', // 100*1 + 100*1.5 = 250
        volume_sum: '2.50000000', // 1 + 1.5 = 2.5
      });

      const mockFirstPrice = vi.fn().mockResolvedValue({
        price: '100.00000000',
      });

      const mockLastPrice = vi.fn().mockResolvedValue({
        price: '100.00000000',
      });

      let callCount = 0;
      mockDb.selectFrom.mockImplementation(() => {
        const query = {
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn(),
        };

        if (callCount === 0) {
          query.executeTakeFirst = mockExecuteTakeFirst;
        } else if (callCount === 1) {
          query.executeTakeFirst = mockFirstPrice;
        } else {
          query.executeTakeFirst = mockLastPrice;
        }
        callCount++;

        return query;
      });

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result.vwap).toBe('100.00000000');
    });

    it('should handle null VWAP when volume is zero', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      const mockExecuteTakeFirst = vi.fn().mockResolvedValue({
        low: '100.00000000',
        high: '100.00000000',
        trade_count: 1,
        price_volume_sum: null,
        volume_sum: '0',
      });

      const mockFirstPrice = vi.fn().mockResolvedValue({
        price: '100.00000000',
      });

      const mockLastPrice = vi.fn().mockResolvedValue({
        price: '100.00000000',
      });

      let callCount = 0;
      mockDb.selectFrom.mockImplementation(() => {
        const query = {
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn(),
        };

        if (callCount === 0) {
          query.executeTakeFirst = mockExecuteTakeFirst;
        } else if (callCount === 1) {
          query.executeTakeFirst = mockFirstPrice;
        } else {
          query.executeTakeFirst = mockLastPrice;
        }
        callCount++;

        return query;
      });

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result.vwap).toBeNull();
    });
  });

  describe('saveCandle', () => {
    it('should insert candle with upsert behavior', async () => {
      const candle = {
        pair: 'btc-usd',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        open: '44000.00000000',
        high: '46000.00000000',
        low: '43500.00000000',
        close: '45000.00000000',
        volume: '10.00000000',
        vwap: '44800.00000000',
        tradeCount: 10,
      };

      const mockExecute = vi.fn();
      const mockDoUpdateSet = vi.fn(() => ({ execute: mockExecute }));
      const mockOnConflict = vi.fn((cb: any) => {
        cb({ columns: vi.fn().mockReturnThis(), doUpdateSet: mockDoUpdateSet });
        return { execute: mockExecute };
      });

      mockDb.insertInto.mockReturnValue({
        values: vi.fn(() => ({
          onConflict: mockOnConflict,
        })),
      });

      await (service as any).saveCandle('price_history_5min', candle);

      expect(mockDb.insertInto).toHaveBeenCalledWith('price_history_5min');
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe('getTableName', () => {
    it('should return correct table for 5min interval', () => {
      const tableName = (service as any).getTableName('5min');
      expect(tableName).toBe('price_history_5min');
    });

    it('should return correct table for 1hour interval', () => {
      const tableName = (service as any).getTableName('1hour');
      expect(tableName).toBe('price_history_1hour');
    });

    it('should return correct table for 1day interval', () => {
      const tableName = (service as any).getTableName('1day');
      expect(tableName).toBe('price_history_1day');
    });

    it('should default to 1hour for invalid interval', () => {
      const tableName = (service as any).getTableName('invalid' as any);
      expect(tableName).toBe('price_history_1hour');
    });
  });

  describe('getCandles', () => {
    it('should return candles with pagination', async () => {
      const mockCountResult = { count: 100 };
      const mockCandles = [
        {
          timestamp: new Date('2024-01-01T12:00:00Z'),
          open: '44000.00000000',
          high: '46000.00000000',
          low: '43500.00000000',
          close: '45000.00000000',
          volume: '10.00000000',
          vwap: '44800.00000000',
        },
      ];

      let callCount = 0;
      mockDb.selectFrom.mockImplementation(() => {
        const query = {
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn(),
          execute: vi.fn(),
        };

        if (callCount === 0) {
          query.executeTakeFirst = vi.fn().mockResolvedValue(mockCountResult);
        } else {
          query.execute = vi.fn().mockResolvedValue(mockCandles);
        }
        callCount++;

        return query;
      });

      const result = await service.getCandles('btc-usd', '1hour', 10, 0);

      expect(result.total).toBe(100);
      expect(result.candles).toHaveLength(1);
      expect(result.candles[0].open).toBe(44000);
      expect(result.candles[0].high).toBe(46000);
      expect(result.candles[0].vwap).toBe(44800);
    });

    it('should handle null VWAP in results', async () => {
      const mockCountResult = { count: 1 };
      const mockCandles = [
        {
          timestamp: new Date('2024-01-01T12:00:00Z'),
          open: '44000.00000000',
          high: '46000.00000000',
          low: '43500.00000000',
          close: '45000.00000000',
          volume: '10.00000000',
          vwap: null,
        },
      ];

      let callCount = 0;
      mockDb.selectFrom.mockImplementation(() => {
        const query = {
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn(),
          execute: vi.fn(),
        };

        if (callCount === 0) {
          query.executeTakeFirst = vi.fn().mockResolvedValue(mockCountResult);
        } else {
          query.execute = vi.fn().mockResolvedValue(mockCandles);
        }
        callCount++;

        return query;
      });

      const result = await service.getCandles('btc-usd', '1hour', 10, 0);

      expect(result.candles[0].vwap).toBeNull();
    });

    it('should return empty result when no candles', async () => {
      const mockCountResult = { count: 0 };

      let callCount = 0;
      mockDb.selectFrom.mockImplementation(() => {
        const query = {
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn(),
          execute: vi.fn(),
        };

        if (callCount === 0) {
          query.executeTakeFirst = vi.fn().mockResolvedValue(mockCountResult);
        } else {
          query.execute = vi.fn().mockResolvedValue([]);
        }
        callCount++;

        return query;
      });

      const result = await service.getCandles('btc-usd', '1hour', 10, 0);

      expect(result.total).toBe(0);
      expect(result.candles).toHaveLength(0);
    });
  });
});
