/**
 * Integration tests for Prices Module
 * Tests Prices Service with mocked Redis and Database
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createTestModule, TestModuleWrapper, preloadServices, createMockLoggerModule } from './test-helpers.js';
import { PricesModule } from '../../src/modules/prices/prices.module.js';
import type { PricesService } from '../../src/modules/prices/services/prices.service.js';

describe('Prices Module Integration Tests', () => {
  let testModule: TestModuleWrapper;
  let mockRedis: any;
  let mockDb: any;
  let mockLogger: any;

  // Preload service classes once before all tests
  beforeAll(async () => {
    await preloadServices(['PricesService']);
  });

  beforeEach(() => {
    // Create mock Redis service
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      on: vi.fn(),
      duplicate: vi.fn(),
    };

    // Mock duplicate returns a new instance with same methods
    mockRedis.duplicate.mockReturnValue({
      ...mockRedis,
      duplicate: vi.fn(),
    });

    // Create mock Database connection
    mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn(),
    };

    // Create mock Logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Build test module
    testModule = createTestModule(PricesModule, {
      RedisService: mockRedis,
      DatabaseConnection: mockDb,
      Logger: createMockLoggerModule(mockLogger),
    });
  });

  afterEach(async () => {
    await testModule.cleanup();
    vi.clearAllMocks();
  });

  describe('PricesService', () => {
    it('should get price from cache when available', async () => {
      const mockCachedPrice = JSON.stringify({
        price: '50000.12345678',
        timestamp: Date.now(),
      });

      mockRedis.get.mockResolvedValue(mockCachedPrice);

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPrice('btc-usd');

      expect(result).toEqual({
        pair: 'btc-usd',
        price: 50000.12345678,
        timestamp: expect.any(Number),
      });

      expect(mockRedis.get).toHaveBeenCalledWith('price:btc-usd');
      expect(mockDb.selectFrom).not.toHaveBeenCalled(); // Should not hit DB
    });

    it('should fallback to database when cache is empty', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.executeTakeFirst.mockResolvedValue({
        pair: 'btc-usd',
        price: '51000.00',
        timestamp: new Date(),
      });

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPrice('btc-usd');

      expect(result.pair).toBe('btc-usd');
      expect(result.price).toBe(51000);

      expect(mockRedis.get).toHaveBeenCalled();
      expect(mockDb.selectFrom).toHaveBeenCalledWith('price_history');

      // Should cache the result
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'price:btc-usd',
        60,
        expect.stringContaining('51000')
      );
    });

    it('should reject stale cached prices', async () => {
      const staleTimestamp = Date.now() - 200000; // 200 seconds ago (> 120s threshold)
      const staleCachedPrice = JSON.stringify({
        price: '50000.00',
        timestamp: staleTimestamp,
      });

      mockRedis.get.mockResolvedValue(staleCachedPrice);
      mockDb.executeTakeFirst.mockResolvedValue({
        pair: 'btc-usd',
        price: '52000.00',
        timestamp: new Date(),
      });

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPrice('btc-usd');

      // Should fetch from DB instead
      expect(mockDb.selectFrom).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Stale price')
      );
    });

    it('should throw error when price is unavailable', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.executeTakeFirst.mockResolvedValue(null);

      const pricesService = testModule.get<PricesService>('PricesService');

      await expect(pricesService.getPrice('btc-usd')).rejects.toThrow(
        'Price unavailable for pair btc-usd'
      );
    });

    it('should get multiple prices in parallel', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ price: '50000.00', timestamp: Date.now() })
      );

      const pricesService = testModule.get<PricesService>('PricesService');
      const results = await pricesService.getMultiplePrices(['btc-usd', 'eth-usd', 'xmr-usd']);

      expect(results).toHaveLength(3);
      expect(results[0].pair).toBe('btc-usd');
      expect(results[1].pair).toBe('eth-usd');
      expect(results[2].pair).toBe('xmr-usd');

      // Should call cache for each pair
      expect(mockRedis.get).toHaveBeenCalledTimes(3);
    });

    it('should calculate price change over 24 hours', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

      mockDb.executeTakeFirst
        .mockResolvedValueOnce({
          price: '48000.00',
          timestamp: startDate,
        })
        .mockResolvedValueOnce({
          price: '50000.00',
          timestamp: endDate,
        });

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPriceChange('btc-usd', '24hours');

      expect(result).toMatchObject({
        pair: 'btc-usd',
        startPrice: 48000,
        endPrice: 50000,
        changePercent: expect.closeTo(4.167, 2), // (50000-48000)/48000 * 100
      });
    });

    it('should calculate price change over 7 days', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      mockDb.executeTakeFirst
        .mockResolvedValueOnce({
          price: '45000.00',
          timestamp: startDate,
        })
        .mockResolvedValueOnce({
          price: '50000.00',
          timestamp: endDate,
        });

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPriceChange('btc-usd', '7days');

      expect(result.changePercent).toBeCloseTo(11.11, 1);
    });

    it('should calculate price change over 30 days', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      mockDb.executeTakeFirst
        .mockResolvedValueOnce({
          price: '40000.00',
          timestamp: startDate,
        })
        .mockResolvedValueOnce({
          price: '50000.00',
          timestamp: endDate,
        });

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPriceChange('btc-usd', '30days');

      expect(result.changePercent).toBe(25);
    });

    it('should handle custom period with explicit dates', async () => {
      const from = '2024-11-01T00:00:00Z';
      const to = '2024-12-01T00:00:00Z';

      mockDb.executeTakeFirst
        .mockResolvedValueOnce({
          price: '40000.00',
          timestamp: new Date(from),
        })
        .mockResolvedValueOnce({
          price: '50000.00',
          timestamp: new Date(to),
        });

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPriceChange('btc-usd', 'custom', from, to);

      expect(result.changePercent).toBe(25);
    });

    it('should throw error for custom period without from parameter', async () => {
      const pricesService = testModule.get<PricesService>('PricesService');

      await expect(
        pricesService.getPriceChange('btc-usd', 'custom')
      ).rejects.toThrow('Custom period requires explicit "from" parameter');
    });

    it('should throw error for invalid time range', async () => {
      const from = '2024-12-01T00:00:00Z';
      const to = '2024-11-01T00:00:00Z'; // to is before from

      const pricesService = testModule.get<PricesService>('PricesService');

      await expect(
        pricesService.getPriceChange('btc-usd', 'custom', from, to)
      ).rejects.toThrow('Start date must be before end date');
    });

    it('should throw error when no price data at start date', async () => {
      mockDb.executeTakeFirst.mockResolvedValue(null);

      const pricesService = testModule.get<PricesService>('PricesService');

      await expect(
        pricesService.getPriceChange('btc-usd', '24hours')
      ).rejects.toThrow('No price data available');
    });

    it('should stream real-time price updates', async () => {
      // This test verifies the streaming setup by simulating a message
      const onHandlers: Map<string, (channel: string, message: string) => void> = new Map();

      const mockSubscriber = {
        ...mockRedis,
        on: vi.fn().mockImplementation((event: string, handler: (channel: string, message: string) => void) => {
          onHandlers.set(event, handler);
        }),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      };

      mockRedis.duplicate.mockReturnValue(mockSubscriber);

      const pricesService = testModule.get<PricesService>('PricesService');

      // Create the stream and start iterating
      const stream = pricesService.streamPrices(['btc-usd', 'eth-usd']);
      const received: any[] = [];

      // Start iteration in background and collect first message
      const iterPromise = (async () => {
        for await (const price of stream) {
          received.push(price);
          break; // Only get first message
        }
      })();

      // Wait for subscription setup
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verify message handler was registered
      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockSubscriber.subscribe).toHaveBeenCalled();

      // Simulate receiving a message
      const messageHandler = onHandlers.get('message');
      if (messageHandler) {
        messageHandler('price:btc-usd', JSON.stringify({ price: '50000.00', timestamp: Date.now() }));
      }

      // Wait for message to be processed
      await iterPromise;

      // Verify the message was received
      expect(received).toHaveLength(1);
      expect(received[0].pair).toBe('btc-usd');
      expect(received[0].price).toBe(50000);

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting price stream')
      );
    });

    it('should handle cache write errors gracefully', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockRejectedValue(new Error('Redis write error'));

      mockDb.executeTakeFirst.mockResolvedValue({
        pair: 'btc-usd',
        price: '50000.00',
        timestamp: new Date(),
      });

      const pricesService = testModule.get<PricesService>('PricesService');

      // Should not throw, just log the cache error
      const result = await pricesService.getPrice('btc-usd');

      expect(result.price).toBe(50000);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Cache write error'),
        expect.any(Error)
      );
    });

    it('should handle database errors appropriately', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.executeTakeFirst.mockRejectedValue(new Error('Database error'));

      const pricesService = testModule.get<PricesService>('PricesService');

      await expect(pricesService.getPrice('btc-usd')).rejects.toThrow(
        'Failed to retrieve price from database'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Database read error'),
        expect.any(Error)
      );
    });
  });

  describe('Module Integration', () => {
    it('should wire services correctly via DI', () => {
      const pricesService = testModule.get<PricesService>('PricesService');

      expect(pricesService).toBeDefined();
      // Verify it has the expected methods
      expect(typeof pricesService.getPrice).toBe('function');
      expect(typeof pricesService.getPriceChange).toBe('function');
    });

    it('should inject Redis and Database dependencies', async () => {
      const pricesService = testModule.get<PricesService>('PricesService');

      mockRedis.get.mockResolvedValue(
        JSON.stringify({ price: '50000.00', timestamp: Date.now() })
      );

      await pricesService.getPrice('btc-usd');

      // Verify dependencies are injected and working
      expect(mockRedis.get).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should export PricesService for other modules', () => {
      // First create the service via testModule.get() so it's registered in the container
      const pricesService = testModule.get<PricesService>('PricesService');

      // Now verify it can be resolved from the container
      const container = testModule.getContainer();
      const resolvedPricesService = container.resolve('PricesService');

      expect(resolvedPricesService).toBeDefined();
      // Verify it has the expected methods
      expect(typeof resolvedPricesService.getPrice).toBe('function');
      expect(resolvedPricesService).toBe(pricesService);
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle concurrent price requests efficiently', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ price: '50000.00', timestamp: Date.now() })
      );

      const pricesService = testModule.get<PricesService>('PricesService');

      // Make 100 concurrent requests
      const requests = Array(100)
        .fill(null)
        .map(() => pricesService.getPrice('btc-usd'));

      const results = await Promise.all(requests);

      expect(results).toHaveLength(100);
      expect(results.every((r) => r.price === 50000)).toBe(true);
    });

    it('should handle price with very high precision', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          price: '0.00000001',
          timestamp: Date.now(),
        })
      );

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPrice('btc-usd');

      expect(result.price).toBe(0.00000001);
    });

    it('should handle very large price values', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          price: '999999999.99999999',
          timestamp: Date.now(),
        })
      );

      const pricesService = testModule.get<PricesService>('PricesService');
      const result = await pricesService.getPrice('btc-usd');

      expect(result.price).toBeCloseTo(999999999.99999999, 8);
    });
  });
});
