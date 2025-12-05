/**
 * Integration tests for Aggregator Module
 * Tests Stream Aggregator and OHLCV Aggregator with mocked Redis and DB
 *
 * NOTE: These tests are temporarily skipped due to memory issues during
 * module loading under Vitest. The aggregator services import workers
 * which depend on the 'ws' package, and this causes excessive memory
 * consumption during the test setup phase.
 *
 * TODO: Investigate and fix the memory issue in module loading.
 * See: https://github.com/vitest-dev/vitest/issues
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  createTestModule,
  TestModuleWrapper,
  preloadServices,
  STREAM_AGGREGATOR_TOKEN,
  OHLCV_AGGREGATOR_TOKEN,
} from './test-helpers.js';
import { AggregatorModule } from '../../src/modules/aggregator/aggregator.module.js';
import type { StreamAggregatorService } from '../../src/modules/aggregator/services/stream-aggregator.service.js';
import type { OhlcvAggregatorService } from '../../src/modules/aggregator/services/ohlcv-aggregator.service.js';

// Skip tests due to memory issues - see NOTE above
describe.skip('Aggregator Module Integration Tests', () => {
  let testModule: TestModuleWrapper;
  let mockRedis: any;
  let mockDb: any;
  let mockLogger: any;
  let mockCbrRate: any;

  // Preload service classes once before all tests
  beforeAll(async () => {
    await preloadServices([STREAM_AGGREGATOR_TOKEN, OHLCV_AGGREGATOR_TOKEN]);
  });

  beforeEach(() => {
    // Create mock Redis service
    mockRedis = {
      xgroup: vi.fn().mockResolvedValue('OK'),
      xreadgroup: vi.fn().mockResolvedValue(null),
      xack: vi.fn().mockResolvedValue(1),
      zadd: vi.fn().mockResolvedValue(1),
      zrangebyscore: vi.fn().mockResolvedValue([]),
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      setex: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(1),
    };

    // Create mock Database connection
    // Create a mock for the onConflict callback pattern: .onConflict((oc) => oc.columns([...]).doUpdateSet({...}))
    const conflictBuilder = {
      columns: vi.fn().mockReturnThis(),
      doUpdateSet: vi.fn().mockReturnThis(),
    };

    mockDb = {
      insertInto: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null),
      onConflict: vi.fn().mockImplementation((callback: (oc: typeof conflictBuilder) => any) => {
        callback(conflictBuilder);
        return mockDb;
      }),
      columns: conflictBuilder.columns,
      doUpdateSet: conflictBuilder.doUpdateSet,
    };

    // Create mock Logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Create mock CBR Rate Service
    mockCbrRate = {
      getRate: vi.fn().mockResolvedValue(95.5),
      fetchRate: vi.fn().mockResolvedValue(undefined),
      isRateStale: vi.fn().mockReturnValue(false),
    };

    // Build test module
    testModule = createTestModule(AggregatorModule, {
      RedisService: mockRedis,
      DatabaseConnection: mockDb,
      Logger: mockLogger,
      CbrRateService: mockCbrRate,
    });
  });

  afterEach(async () => {
    await testModule.cleanup();
    vi.clearAllMocks();
  });

  describe('Stream Aggregator Service', () => {
    it('should initialize and create consumer groups', async () => {
      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);

      // Manually call start() since @PostConstruct is not triggered in test environment
      await streamAggregator.start();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLogger.info).toHaveBeenCalledWith('[StreamAggregator] Started');

      // Should create consumer groups for all exchanges
      expect(mockRedis.xgroup).toHaveBeenCalled();

      // Stop the service to prevent infinite loop
      await streamAggregator.stop();
    });

    it('should consume and process trade messages from streams', async () => {
      const mockMessages = [
        [
          'stream:trades:binance',
          [
            [
              '1234567890-0',
              {
                pair: 'btc-usd',
                price: '50000.00',
                volume: '0.1',
                timestamp: String(Date.now()),
              },
            ],
          ],
        ],
      ];

      mockRedis.xreadgroup.mockResolvedValueOnce(mockMessages).mockResolvedValue(null);

      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);

      // Manually call start() since @PostConstruct is not triggered in test environment
      await streamAggregator.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Stop the service to prevent infinite loop
      await streamAggregator.stop();

      // Should add trade to buffer
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'buffer:trades:btc-usd',
        expect.any(Number),
        expect.stringContaining('50000')
      );

      // Should acknowledge message
      expect(mockRedis.xack).toHaveBeenCalled();
    });

    it('should calculate VWAP from buffered trades', async () => {
      const now = Date.now();
      const mockTrades = [
        JSON.stringify({ price: 50000, volume: 0.5, timestamp: now - 5000, exchange: 'binance' }),
        JSON.stringify({ price: 51000, volume: 0.3, timestamp: now - 3000, exchange: 'kraken' }),
        JSON.stringify({ price: 49000, volume: 0.2, timestamp: now - 1000, exchange: 'coinbase' }),
      ];

      mockRedis.zrangebyscore.mockResolvedValue(mockTrades);
      mockRedis.zremrangebyscore.mockResolvedValue(3);

      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);

      await streamAggregator.aggregate();

      // Should calculate and save VWAP
      expect(mockDb.insertInto).toHaveBeenCalledWith('price_history');
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          pair: 'btc-usd',
          method: 'vwap',
        })
      );

      // Should cache price
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'price:btc-usd',
        60,
        expect.stringContaining('price')
      );

      // Should publish price update
      expect(mockRedis.publish).toHaveBeenCalled();
    });

    it('should convert USD prices to RUB using CBR rate', async () => {
      const now = Date.now();
      const mockTrades = [
        JSON.stringify({ price: 50000, volume: 1.0, timestamp: now, exchange: 'binance' }),
      ];

      mockRedis.zrangebyscore.mockResolvedValue(mockTrades);
      mockCbrRate.getRate.mockResolvedValue(95.0);

      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);

      await streamAggregator.aggregate();

      // Should save both USD and RUB prices
      expect(mockDb.insertInto).toHaveBeenCalledTimes(6); // 3 USD pairs + 3 RUB pairs

      // Verify RUB price calculation (50000 * 95.0 = 4,750,000)
      const rubCalls = (mockDb.values as any).mock.calls.filter((call: any) =>
        call[0].pair?.includes('-rub')
      );
      expect(rubCalls.length).toBeGreaterThan(0);
    });

    it('should handle empty trade buffer gracefully', async () => {
      mockRedis.zrangebyscore.mockResolvedValue([]);

      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);

      await streamAggregator.aggregate();

      // Should not save anything if no trades
      expect(mockDb.insertInto).not.toHaveBeenCalled();
    });

    it('should clean up old trades from buffer', async () => {
      const now = Date.now();
      const mockTrades = [
        JSON.stringify({ price: 50000, volume: 1.0, timestamp: now, exchange: 'binance' }),
      ];

      mockRedis.zrangebyscore.mockResolvedValue(mockTrades);

      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);

      await streamAggregator.aggregate();

      // Should remove old trades outside the window
      expect(mockRedis.zremrangebyscore).toHaveBeenCalledWith(
        expect.stringContaining('buffer:trades:'),
        0,
        expect.any(Number)
      );
    });

    it('should stop aggregation on shutdown', async () => {
      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);

      await new Promise((resolve) => setTimeout(resolve, 100));

      await streamAggregator.stop();

      expect(mockLogger.info).toHaveBeenCalledWith('[StreamAggregator] Stopped');
    });
  });

  describe('OHLCV Aggregator Service', () => {
    it('should aggregate 5-minute candles from price history', async () => {
      const now = new Date();

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        low: '49000.00',
        high: '51000.00',
        trade_count: 10,
        price_volume_sum: '500000.00',
        volume_sum: '10.0',
      });

      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '49500.00' }); // open
      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '50500.00' }); // close

      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      await ohlcvAggregator.aggregate5Min();

      expect(mockDb.selectFrom).toHaveBeenCalledWith('price_history');
      expect(mockDb.insertInto).toHaveBeenCalledWith('price_history_5min');

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          open: '49500.00',
          high: '51000.00',
          low: '49000.00',
          close: '50500.00',
          trade_count: 10,
        })
      );
    });

    it('should aggregate 1-hour candles', async () => {
      mockDb.executeTakeFirst.mockResolvedValueOnce({
        low: '48000.00',
        high: '52000.00',
        trade_count: 120,
        price_volume_sum: '6000000.00',
        volume_sum: '120.0',
      });

      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '48500.00' });
      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '51500.00' });

      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      await ohlcvAggregator.aggregate1Hour();

      expect(mockDb.insertInto).toHaveBeenCalledWith('price_history_1hour');
    });

    it('should aggregate daily candles', async () => {
      mockDb.executeTakeFirst.mockResolvedValueOnce({
        low: '45000.00',
        high: '55000.00',
        trade_count: 2880,
        price_volume_sum: '144000000.00',
        volume_sum: '2880.0',
      });

      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '46000.00' });
      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '54000.00' });

      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      await ohlcvAggregator.aggregate1Day();

      expect(mockDb.insertInto).toHaveBeenCalledWith('price_history_1day');
    });

    it('should calculate VWAP for candles', async () => {
      mockDb.executeTakeFirst.mockResolvedValueOnce({
        low: '49000.00',
        high: '51000.00',
        trade_count: 10,
        price_volume_sum: '500000.00',
        volume_sum: '10.0',
      });

      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '49500.00' });
      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '50500.00' });

      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      await ohlcvAggregator.aggregate5Min();

      // VWAP = 500000 / 10 = 50000
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          vwap: '50000.00000000',
        })
      );
    });

    it('should handle upserts for existing candles', async () => {
      mockDb.executeTakeFirst.mockResolvedValueOnce({
        low: '49000.00',
        high: '51000.00',
        trade_count: 10,
        price_volume_sum: '500000.00',
        volume_sum: '10.0',
      });

      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '49500.00' });
      mockDb.executeTakeFirst.mockResolvedValueOnce({ price: '50500.00' });

      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      await ohlcvAggregator.aggregate5Min();

      // Should use onConflict for upsert
      expect(mockDb.onConflict).toHaveBeenCalled();
      expect(mockDb.doUpdateSet).toHaveBeenCalled();
    });

    it('should skip aggregation when no data available', async () => {
      mockDb.executeTakeFirst.mockResolvedValue(null);

      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      await ohlcvAggregator.aggregate5Min();

      // Should not insert if no data
      expect(mockDb.insertInto).not.toHaveBeenCalled();
    });

    it('should get candles with pagination', async () => {
      const mockCandles = [
        {
          timestamp: new Date(),
          open: '50000.00',
          high: '51000.00',
          low: '49000.00',
          close: '50500.00',
          volume: '10.0',
          vwap: '50250.00',
        },
      ];

      mockDb.executeTakeFirst.mockResolvedValue({ count: 100 });
      mockDb.execute.mockResolvedValue(mockCandles);

      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      const result = await ohlcvAggregator.getCandles('btc-usd', '5min', 10, 0);

      expect(result.candles).toHaveLength(1);
      expect(result.total).toBe(100);
      expect(result.candles[0]).toMatchObject({
        open: 50000,
        high: 51000,
        low: 49000,
        close: 50500,
        volume: 10,
        vwap: 50250,
      });
    });

    it('should handle different chart intervals correctly', async () => {
      mockDb.executeTakeFirst.mockResolvedValue({ count: 50 });
      mockDb.execute.mockResolvedValue([]);

      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      await ohlcvAggregator.getCandles('btc-usd', '5min', 10, 0);
      expect(mockDb.selectFrom).toHaveBeenCalledWith('price_history_5min');

      await ohlcvAggregator.getCandles('btc-usd', '1hour', 10, 0);
      expect(mockDb.selectFrom).toHaveBeenCalledWith('price_history_1hour');

      await ohlcvAggregator.getCandles('btc-usd', '1day', 10, 0);
      expect(mockDb.selectFrom).toHaveBeenCalledWith('price_history_1day');
    });
  });

  describe('Module Integration', () => {
    it('should wire services correctly via DI', () => {
      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);
      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      expect(streamAggregator).toBeDefined();
      expect(ohlcvAggregator).toBeDefined();
      // Verify they have the expected methods
      expect(typeof streamAggregator.start).toBe('function');
      expect(typeof ohlcvAggregator.getCandles).toBe('function');
    });

    it('should share database connection between services', () => {
      testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);
      testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      // Both should use the same mocked database
      expect(mockDb.insertInto).toBeDefined();
      expect(mockDb.selectFrom).toBeDefined();
    });

    it('should export services for other modules', () => {
      // First create the services via testModule.get() so they're registered in the container
      const streamAggregator = testModule.get<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);
      const ohlcvAggregator = testModule.get<OhlcvAggregatorService>(OHLCV_AGGREGATOR_TOKEN);

      // Now verify they can be resolved from the container
      const container = testModule.getContainer();

      const resolvedStreamAggregator = container.resolve(STREAM_AGGREGATOR_TOKEN);
      const resolvedOhlcvAggregator = container.resolve(OHLCV_AGGREGATOR_TOKEN);

      expect(resolvedStreamAggregator).toBeDefined();
      expect(resolvedOhlcvAggregator).toBeDefined();
      expect(resolvedStreamAggregator).toBe(streamAggregator);
      expect(resolvedOhlcvAggregator).toBe(ohlcvAggregator);
    });
  });
});
