/**
 * Integration tests for Charts Module
 * Tests Charts Service with mocked Database and OHLCV Aggregator
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  createTestModule,
  TestModuleWrapper,
  preloadServices,
  createMockLoggerModule,
  CHARTS_SERVICE_TOKEN,
} from './test-helpers.js';
import { ChartsModule } from '../../src/modules/charts/charts.module.js';
import type { ChartsService } from '../../src/modules/charts/services/charts.service.js';

describe('Charts Module Integration Tests', () => {
  let testModule: TestModuleWrapper;
  let mockLogger: any;
  let mockOhlcvAggregator: any;

  // Preload service classes once before all tests
  beforeAll(async () => {
    await preloadServices([CHARTS_SERVICE_TOKEN]);
  });

  beforeEach(() => {
    // Create mock Logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Create mock OHLCV Aggregator
    mockOhlcvAggregator = {
      getCandles: vi.fn(),
      aggregate5Min: vi.fn(),
      aggregate1Hour: vi.fn(),
      aggregate1Day: vi.fn(),
    };

    // Build test module - pass OHLCV aggregator mock using the token's name as key
    testModule = createTestModule(ChartsModule, {
      Logger: createMockLoggerModule(mockLogger),
      OhlcvAggregatorService: mockOhlcvAggregator,
    });
  });

  afterEach(async () => {
    await testModule.cleanup();
    vi.clearAllMocks();
  });

  describe('ChartsService', () => {
    it('should get chart data for 24 hours period with 5min interval', async () => {
      // Use dynamic timestamps relative to now to ensure they fall within the 24h range
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
      const timestamp2 = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(),
          open: 49000,
          high: 51000,
          low: 48500,
          close: 50000,
          volume: 10.5,
          vwap: 49750,
        },
        {
          timestamp: timestamp2.toISOString(),
          open: 50000,
          high: 51500,
          low: 49800,
          close: 51000,
          volume: 8.2,
          vwap: 50500,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 288, // 24 hours * 12 candles per hour
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData('btc-usd', '24hours', '5min');

      expect(result.dates).toHaveLength(2);
      expect(result.series).toHaveLength(2);
      expect(result.ohlcv).toBeDefined();
      expect(result.ohlcv!.open).toEqual([49000, 50000]);
      expect(result.ohlcv!.high).toEqual([51000, 51500]);
      expect(result.ohlcv!.low).toEqual([48500, 49800]);
      expect(result.ohlcv!.close).toEqual([50000, 51000]);
      expect(result.ohlcv!.volume).toEqual([10.5, 8.2]);

      // Series should contain close prices
      expect(result.series).toEqual([50000, 51000]);

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith(
        'btc-usd',
        '5min',
        1000,
        0
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('getChartData for btc-usd')
      );
    });

    it('should get chart data for 7 days period with 1hour interval', async () => {
      // Use dynamic timestamps relative to now to ensure they fall within the 7 days range
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 2 days ago
      const timestamp2 = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago

      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(),
          open: 45000,
          high: 46000,
          low: 44500,
          close: 45800,
          volume: 120.5,
          vwap: 45500,
        },
        {
          timestamp: timestamp2.toISOString(),
          open: 45800,
          high: 47000,
          low: 45500,
          close: 46500,
          volume: 95.3,
          vwap: 46200,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 168, // 7 days * 24 hours
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData('btc-usd', '7days', '1hour');

      expect(result.dates).toHaveLength(2);
      expect(result.series).toEqual([45800, 46500]);

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith(
        'btc-usd',
        '1hour',
        1000,
        0
      );
    });

    it('should get chart data for 30 days period with 1day interval', async () => {
      // Use dynamic timestamps relative to now to ensure they fall within the 30 days range
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); // 15 days ago

      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(),
          open: 40000,
          high: 42000,
          low: 39500,
          close: 41500,
          volume: 2500.5,
          vwap: 40800,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 30,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData('btc-usd', '30days', '1day');

      expect(result.dates).toHaveLength(1);
      expect(result.series).toEqual([41500]);

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith(
        'btc-usd',
        '1day',
        1000,
        0
      );
    });

    it('should handle custom period with explicit dates', async () => {
      const from = '2024-11-01T00:00:00Z';
      const to = '2024-12-01T00:00:00Z';

      const mockCandles = [
        {
          timestamp: new Date('2024-11-15T00:00:00Z').toISOString(),
          open: 42000,
          high: 43000,
          low: 41500,
          close: 42800,
          volume: 1500,
          vwap: 42500,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 31,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData('btc-usd', 'custom', '1day', from, to);

      expect(result.dates).toHaveLength(1);
      expect(result.series).toEqual([42800]);
    });

    it('should filter candles by date range', async () => {
      const now = new Date('2024-12-04T12:00:00Z');
      const candles24h = [
        {
          timestamp: new Date('2024-12-03T12:00:00Z').toISOString(),
          open: 48000,
          high: 49000,
          low: 47500,
          close: 48500,
          volume: 50,
          vwap: 48250,
        },
        {
          timestamp: new Date('2024-12-04T11:00:00Z').toISOString(),
          open: 48500,
          high: 50000,
          low: 48000,
          close: 49500,
          volume: 45,
          vwap: 49000,
        },
        {
          timestamp: new Date('2024-12-02T11:00:00Z').toISOString(), // Outside 24h range
          open: 45000,
          high: 46000,
          low: 44500,
          close: 45500,
          volume: 60,
          vwap: 45250,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: candles24h,
        total: 3,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData(
        'btc-usd',
        'custom',
        '1hour',
        '2024-12-03T12:00:00Z',
        '2024-12-04T12:00:00Z'
      );

      // Should only include candles within date range
      expect(result.dates.length).toBeLessThanOrEqual(2);
    });

    it('should sort candles by timestamp ascending', async () => {
      // Use dynamic timestamps relative to now to ensure they fall within the 24h range
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago (later)
      const timestamp2 = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3 hours ago (earlier)

      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(),
          open: 50000,
          high: 51000,
          low: 49500,
          close: 50500,
          volume: 10,
          vwap: 50250,
        },
        {
          timestamp: timestamp2.toISOString(),
          open: 48000,
          high: 49000,
          low: 47500,
          close: 48500,
          volume: 8,
          vwap: 48250,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 2,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData('btc-usd', '24hours', '1hour');

      // Should be sorted with earliest first
      expect(new Date(result.dates[0]).getTime()).toBeLessThan(
        new Date(result.dates[1]).getTime()
      );
    });

    it('should get OHLCV data with pagination', async () => {
      const mockCandles = Array(10)
        .fill(null)
        .map((_, i) => ({
          timestamp: new Date(Date.now() - i * 300000).toISOString(),
          open: 50000 + i * 100,
          high: 51000 + i * 100,
          low: 49000 + i * 100,
          close: 50500 + i * 100,
          volume: 10 + i,
          vwap: 50250 + i * 100,
        }));

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 1000,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getOhlcv('btc-usd', '5min', 10, 0);

      expect(result.candles).toHaveLength(10);
      expect(result.pagination).toEqual({
        total: 1000,
        limit: 10,
        offset: 0,
      });

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', '5min', 10, 0);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('getOHLCV for btc-usd')
      );
    });

    it('should handle pagination with offset', async () => {
      const mockCandles = Array(10)
        .fill(null)
        .map((_, i) => ({
          timestamp: new Date(Date.now() - (i + 20) * 300000).toISOString(),
          open: 50000,
          high: 51000,
          low: 49000,
          close: 50500,
          volume: 10,
          vwap: 50250,
        }));

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 1000,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getOhlcv('btc-usd', '5min', 10, 20);

      expect(result.pagination).toEqual({
        total: 1000,
        limit: 10,
        offset: 20,
      });

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', '5min', 10, 20);
    });

    it('should handle empty candle data', async () => {
      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData('btc-usd', '24hours', '5min');

      expect(result.dates).toEqual([]);
      expect(result.series).toEqual([]);
      expect(result.ohlcv).toBeDefined();
      expect(result.ohlcv!.open).toEqual([]);
    });

    it('should handle candles with null VWAP', async () => {
      const mockCandles = [
        {
          timestamp: new Date().toISOString(),
          open: 50000,
          high: 51000,
          low: 49000,
          close: 50500,
          volume: 10,
          vwap: null,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 1,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getOhlcv('btc-usd', '5min', 10, 0);

      expect(result.candles[0].vwap).toBeNull();
    });

    it('should support different trading pairs', async () => {
      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);

      await chartsService.getChartData('btc-usd', '24hours', '5min');
      await chartsService.getChartData('eth-usd', '24hours', '5min');
      await chartsService.getChartData('xmr-usd', '24hours', '5min');

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', '5min', 1000, 0);
      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('eth-usd', '5min', 1000, 0);
      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('xmr-usd', '5min', 1000, 0);
    });

    it('should support all chart intervals', async () => {
      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);

      await chartsService.getOhlcv('btc-usd', '5min', 10, 0);
      await chartsService.getOhlcv('btc-usd', '1hour', 10, 0);
      await chartsService.getOhlcv('btc-usd', '1day', 10, 0);

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', '5min', 10, 0);
      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', '1hour', 10, 0);
      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', '1day', 10, 0);
    });
  });

  describe('Module Integration', () => {
    it('should wire services correctly via DI', () => {
      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);

      expect(chartsService).toBeDefined();
      // Verify it has the expected methods
      expect(typeof chartsService.getChartData).toBe('function');
      expect(typeof chartsService.getOhlcv).toBe('function');
    });

    it('should inject OHLCV Aggregator dependency', async () => {
      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      await chartsService.getChartData('btc-usd', '24hours', '5min');

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalled();
    });

    it('should export ChartsService for other modules', () => {
      // First create the service via testModule.get() so it's registered in the container
      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);

      // Now verify it can be resolved from the container
      const container = testModule.getContainer();
      const resolvedChartsService = container.resolve(CHARTS_SERVICE_TOKEN);

      expect(resolvedChartsService).toBeDefined();
      // Verify it has the expected methods
      expect(typeof resolvedChartsService.getChartData).toBe('function');
      expect(resolvedChartsService).toBe(chartsService);
    });
  });

  describe('Data Transformation', () => {
    it('should correctly transform OHLCV data to chart format', async () => {
      // Use dynamic timestamps relative to now to ensure they fall within the 24h range
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago

      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(),
          open: 49000,
          high: 51000,
          low: 48500,
          close: 50000,
          volume: 10.5,
          vwap: 49750,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 1,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData('btc-usd', '24hours', '5min');

      expect(result).toMatchObject({
        dates: [expect.any(String)],
        series: [50000],
        ohlcv: {
          open: [49000],
          high: [51000],
          low: [48500],
          close: [50000],
          volume: [10.5],
        },
      });
    });

    it('should preserve numeric precision in transformation', async () => {
      const mockCandles = [
        {
          timestamp: new Date().toISOString(),
          open: 0.00012345,
          high: 0.00012567,
          low: 0.00012123,
          close: 0.00012456,
          volume: 1000000.123456,
          vwap: 0.00012345,
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 1,
      });

      const chartsService = testModule.get<ChartsService>(CHARTS_SERVICE_TOKEN);
      const result = await chartsService.getChartData('xmr-usd', '24hours', '5min');

      expect(result.ohlcv!.open[0]).toBe(0.00012345);
      expect(result.ohlcv!.volume[0]).toBe(1000000.123456);
    });
  });
});
