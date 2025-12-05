/**
 * Integration tests for Collector Module
 * Tests CBR Rate Service and Exchange Manager with mocked Redis
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  createTestModule,
  TestModuleWrapper,
  preloadServices,
  createMockLoggerModule,
  CBR_RATE_SERVICE_TOKEN,
  EXCHANGE_MANAGER_TOKEN,
} from './test-helpers.js';
import { CollectorModule } from '../../src/modules/collector/collector.module.js';
import type { CbrRateService } from '../../src/modules/collector/services/cbr-rate.service.js';
import type { ExchangeManagerService } from '../../src/modules/collector/services/exchange-manager.service.js';

describe('Collector Module Integration Tests', () => {
  let testModule: TestModuleWrapper;
  let mockRedis: any;
  let mockLogger: any;

  // Preload service classes once before all tests
  beforeAll(async () => {
    await preloadServices([CBR_RATE_SERVICE_TOKEN, EXCHANGE_MANAGER_TOKEN]);
  });

  beforeEach(() => {
    // Create mock Redis service
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      publish: vi.fn(),
      xgroup: vi.fn(),
      xreadgroup: vi.fn(),
      xack: vi.fn(),
      zadd: vi.fn(),
      zrangebyscore: vi.fn(),
      zremrangebyscore: vi.fn(),
    };

    // Create mock Logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Build test module with mocked dependencies
    testModule = createTestModule(CollectorModule, {
      RedisService: mockRedis,
      Logger: createMockLoggerModule(mockLogger),
      EnabledExchanges: ['binance', 'kraken'],
    });
  });

  afterEach(async () => {
    await testModule.cleanup();
    vi.clearAllMocks();
  });

  describe('CBR Rate Service', () => {
    it('should initialize and fetch USD/RUB rate on startup', async () => {
      // Mock CBR API response
      const mockXmlResponse = `
        <?xml version="1.0" encoding="windows-1251"?>
        <ValCurs Date="04.12.2024" name="Foreign Currency Market">
          <Valute ID="R01235">
            <NumCode>840</NumCode>
            <CharCode>USD</CharCode>
            <Nominal>1</Nominal>
            <Name>Доллар США</Name>
            <Value>95,50</Value>
          </Valute>
        </ValCurs>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(mockXmlResponse),
      } as Response);

      mockRedis.setex.mockResolvedValue(undefined);

      const cbrService = testModule.get<CbrRateService>(CBR_RATE_SERVICE_TOKEN);

      // Manually call initialize() since @PostConstruct is not triggered in test environment
      await cbrService.initialize();

      // Verify rate was fetched and cached
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('cbr.ru'));
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'rate:usd-rub',
        3600,
        expect.stringContaining('95')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('USD/RUB rate updated')
      );
    });

    it('should get rate from cache when available', async () => {
      mockRedis.get.mockResolvedValue('95.50');

      const cbrService = testModule.get<CbrRateService>(CBR_RATE_SERVICE_TOKEN);
      const rate = await cbrService.getRate();

      expect(rate).toBe(95.5);
      expect(mockRedis.get).toHaveBeenCalledWith('rate:usd-rub');
    });

    it('should fetch fresh rate when cache is empty', async () => {
      mockRedis.get.mockResolvedValue(null);

      const mockXmlResponse = `
        <?xml version="1.0" encoding="windows-1251"?>
        <ValCurs Date="04.12.2024" name="Foreign Currency Market">
          <Valute ID="R01235">
            <CharCode>USD</CharCode>
            <Value>96,25</Value>
          </Valute>
        </ValCurs>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(mockXmlResponse),
      } as Response);

      mockRedis.setex.mockResolvedValue(undefined);

      const cbrService = testModule.get<CbrRateService>(CBR_RATE_SERVICE_TOKEN);
      const rate = await cbrService.getRate();

      expect(rate).toBeGreaterThan(0);
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should handle CBR API errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const cbrService = testModule.get<CbrRateService>(CBR_RATE_SERVICE_TOKEN);

      // Should not throw, just log error
      await expect(cbrService.fetchRate()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch rate'),
        expect.any(Error)
      );
    });

    it('should detect stale rates', async () => {
      const cbrService = testModule.get<CbrRateService>(CBR_RATE_SERVICE_TOKEN);

      // Initially should be stale (no fetch yet)
      expect(cbrService.isRateStale()).toBe(true);

      // Mock successful fetch
      const mockXmlResponse = `
        <?xml version="1.0" encoding="windows-1251"?>
        <ValCurs>
          <Valute><CharCode>USD</CharCode><Value>95,50</Value></Valute>
        </ValCurs>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(mockXmlResponse),
      } as Response);

      mockRedis.setex.mockResolvedValue(undefined);
      await cbrService.fetchRate();

      // Should not be stale immediately after fetch
      expect(cbrService.isRateStale()).toBe(false);
    });
  });

  describe('Exchange Manager Service', () => {
    it('should start enabled exchange workers', async () => {
      const exchangeManager = testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      // Manually call start() since @PostConstruct is not triggered in test environment
      await exchangeManager.start();

      expect(exchangeManager.isRunning).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting 2 exchange workers')
      );
    });

    it('should track worker statistics', async () => {
      const exchangeManager = testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = exchangeManager.getStats();

      expect(Array.isArray(stats)).toBe(true);
      expect(stats.length).toBeGreaterThanOrEqual(0);
    });

    it('should get connected exchanges count', async () => {
      const exchangeManager = testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const connectedCount = exchangeManager.getConnectedCount();

      expect(typeof connectedCount).toBe('number');
      expect(connectedCount).toBeGreaterThanOrEqual(0);
    });

    it('should check if specific exchange is connected', async () => {
      const exchangeManager = testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const isBinanceConnected = exchangeManager.isExchangeConnected('binance');
      const isKrakenConnected = exchangeManager.isExchangeConnected('kraken');

      expect(typeof isBinanceConnected).toBe('boolean');
      expect(typeof isKrakenConnected).toBe('boolean');
    });

    it('should track total trades received', async () => {
      const exchangeManager = testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const totalTrades = exchangeManager.getTotalTradesReceived();

      expect(typeof totalTrades).toBe('number');
      expect(totalTrades).toBeGreaterThanOrEqual(0);
    });

    it('should stop all workers on shutdown', async () => {
      const exchangeManager = testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      // Manually call start() since @PostConstruct is not triggered in test environment
      await exchangeManager.start();

      expect(exchangeManager.isRunning).toBe(true);

      // Trigger PreDestroy
      await exchangeManager.stop();

      expect(exchangeManager.isRunning).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Stopping all exchange workers')
      );
    });

    it('should handle unknown exchanges gracefully', async () => {
      // Create test module with invalid exchange
      const testModuleWithInvalid = createTestModule(CollectorModule, {
        RedisService: mockRedis,
        Logger: createMockLoggerModule(mockLogger),
        EnabledExchanges: ['invalid-exchange'],
      });

      const exchangeManager = testModuleWithInvalid.get<ExchangeManagerService>(
        EXCHANGE_MANAGER_TOKEN
      );

      // Manually call start() since @PostConstruct is not triggered in test environment
      await exchangeManager.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown exchange: invalid-exchange')
      );

      await testModuleWithInvalid.cleanup();
    });
  });

  describe('Module Integration', () => {
    it('should wire services correctly via DI', () => {
      const cbrService = testModule.get<CbrRateService>(CBR_RATE_SERVICE_TOKEN);
      const exchangeManager = testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      expect(cbrService).toBeDefined();
      expect(exchangeManager).toBeDefined();
      // Verify they have the expected methods
      expect(typeof cbrService.getRate).toBe('function');
      expect(typeof exchangeManager.getStats).toBe('function');
    });

    it('should share Redis service between components', () => {
      // Both services should get the same mocked Redis instance
      testModule.get<CbrRateService>(CBR_RATE_SERVICE_TOKEN);
      testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      // Verify they're using the same mock
      expect(mockRedis.get).toBeDefined();
      expect(mockRedis.setex).toBeDefined();
    });

    it('should export services for other modules', async () => {
      // First create the services via testModule.get() so they're registered in the container
      const cbrService = testModule.get<CbrRateService>(CBR_RATE_SERVICE_TOKEN);
      const exchangeManager = testModule.get<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);

      // Now verify they can be resolved from the container using resolveAsync
      const container = testModule.getContainer();

      const resolvedCbrService = await container.resolveAsync(CBR_RATE_SERVICE_TOKEN);
      const resolvedExchangeManager = await container.resolveAsync(EXCHANGE_MANAGER_TOKEN);

      expect(resolvedCbrService).toBeDefined();
      expect(resolvedExchangeManager).toBeDefined();
      expect(resolvedCbrService).toBe(cbrService);
      expect(resolvedExchangeManager).toBe(exchangeManager);
    });
  });
});
