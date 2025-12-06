/**
 * Health Service Comprehensive Tests
 *
 * Tests for HealthService, HealthIndicator, and CompositeHealthIndicator
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  HealthService,
  HealthIndicator,
  CompositeHealthIndicator,
} from '../../../src/modules/health/index.js';
import type { HealthIndicatorResult, HealthStatus } from '../../../src/modules/health/index.js';

// Mock indicator for testing
class MockHealthIndicator extends HealthIndicator {
  readonly name: string;
  private mockStatus: HealthStatus = 'healthy';
  private mockMessage: string = 'OK';
  private mockDetails?: Record<string, unknown>;
  private mockDelay: number = 0;
  private shouldThrow: boolean = false;
  private throwError?: Error;
  public checkCallCount: number = 0;

  constructor(name: string) {
    super();
    this.name = name;
  }

  setStatus(status: HealthStatus, message?: string, details?: Record<string, unknown>): this {
    this.mockStatus = status;
    if (message) this.mockMessage = message;
    if (details) this.mockDetails = details;
    return this;
  }

  setDelay(ms: number): this {
    this.mockDelay = ms;
    return this;
  }

  setThrow(error: Error): this {
    this.shouldThrow = true;
    this.throwError = error;
    return this;
  }

  async check(): Promise<HealthIndicatorResult> {
    this.checkCallCount++;

    if (this.mockDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.mockDelay));
    }

    if (this.shouldThrow && this.throwError) {
      throw this.throwError;
    }

    switch (this.mockStatus) {
      case 'healthy':
        return this.healthy(this.mockMessage, this.mockDetails);
      case 'degraded':
        return this.degraded(this.mockMessage, this.mockDetails);
      case 'unhealthy':
        return this.unhealthy(this.mockMessage, this.mockDetails);
    }
  }
}

describe('HealthService', () => {
  let healthService: HealthService;

  beforeEach(() => {
    healthService = new HealthService();
  });

  afterEach(() => {
    healthService.clearIndicators();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const service = new HealthService();
      expect(service.getIndicatorCount()).toBe(0);
    });

    it('should create with custom options', () => {
      const service = new HealthService({
        timeout: 10000,
        enableCaching: true,
        cacheTtl: 5000,
      });
      expect(service.getIndicatorCount()).toBe(0);
    });
  });

  describe('registerIndicator', () => {
    it('should register a health indicator', () => {
      const indicator = new MockHealthIndicator('test');
      healthService.registerIndicator(indicator);
      expect(healthService.hasIndicator('test')).toBe(true);
      expect(healthService.getIndicatorCount()).toBe(1);
    });

    it('should throw when registering indicator without name', () => {
      const indicator = { check: async () => ({ status: 'healthy' as const, timestamp: new Date() }) };
      expect(() => healthService.registerIndicator(indicator as any)).toThrow();
    });

    it('should throw when registering duplicate indicator', () => {
      const indicator1 = new MockHealthIndicator('test');
      const indicator2 = new MockHealthIndicator('test');
      healthService.registerIndicator(indicator1);
      expect(() => healthService.registerIndicator(indicator2)).toThrow();
    });

    it('should register multiple unique indicators', () => {
      healthService.registerIndicator(new MockHealthIndicator('test1'));
      healthService.registerIndicator(new MockHealthIndicator('test2'));
      healthService.registerIndicator(new MockHealthIndicator('test3'));
      expect(healthService.getIndicatorCount()).toBe(3);
    });
  });

  describe('unregisterIndicator', () => {
    it('should unregister an existing indicator', () => {
      healthService.registerIndicator(new MockHealthIndicator('test'));
      expect(healthService.unregisterIndicator('test')).toBe(true);
      expect(healthService.hasIndicator('test')).toBe(false);
    });

    it('should return false for non-existent indicator', () => {
      expect(healthService.unregisterIndicator('nonexistent')).toBe(false);
    });
  });

  describe('check', () => {
    it('should return healthy when no indicators registered', async () => {
      const result = await healthService.check();
      expect(result.status).toBe('healthy');
      expect(Object.keys(result.indicators)).toHaveLength(0);
    });

    it('should return healthy when all indicators healthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      healthService.registerIndicator(new MockHealthIndicator('test2').setStatus('healthy'));

      const result = await healthService.check();
      expect(result.status).toBe('healthy');
      expect(result.indicators['test1']?.status).toBe('healthy');
      expect(result.indicators['test2']?.status).toBe('healthy');
    });

    it('should return degraded when any indicator degraded', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      healthService.registerIndicator(new MockHealthIndicator('test2').setStatus('degraded'));

      const result = await healthService.check();
      expect(result.status).toBe('degraded');
    });

    it('should return unhealthy when any indicator unhealthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      healthService.registerIndicator(new MockHealthIndicator('test2').setStatus('degraded'));
      healthService.registerIndicator(new MockHealthIndicator('test3').setStatus('unhealthy'));

      const result = await healthService.check();
      expect(result.status).toBe('unhealthy');
    });

    it('should handle indicator errors gracefully', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      healthService.registerIndicator(
        new MockHealthIndicator('test2').setThrow(new Error('Connection failed'))
      );

      const result = await healthService.check();
      expect(result.status).toBe('unhealthy');
      expect(result.indicators['test2']?.status).toBe('unhealthy');
      expect(result.indicators['test2']?.error?.message).toBe('Connection failed');
    });

    it('should include uptime and totalLatency', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test'));

      const result = await healthService.check();
      expect(typeof result.uptime).toBe('number');
      expect(typeof result.totalLatency).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.totalLatency).toBeGreaterThanOrEqual(0);
    });

    it('should handle timeout for slow indicators', async () => {
      const service = new HealthService({ timeout: 100 });
      service.registerIndicator(new MockHealthIndicator('slow').setDelay(500));

      const result = await service.check();
      expect(result.status).toBe('unhealthy');
      expect(result.indicators['slow']?.message).toContain('timed out');
    });

    it('should run indicators in parallel', async () => {
      const indicator1 = new MockHealthIndicator('test1').setDelay(50);
      const indicator2 = new MockHealthIndicator('test2').setDelay(50);
      const indicator3 = new MockHealthIndicator('test3').setDelay(50);

      healthService.registerIndicator(indicator1);
      healthService.registerIndicator(indicator2);
      healthService.registerIndicator(indicator3);

      const start = Date.now();
      await healthService.check();
      const elapsed = Date.now() - start;

      // If run in parallel, should take ~50ms, not ~150ms
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('caching', () => {
    it('should cache results when enabled', async () => {
      const service = new HealthService({ enableCaching: true, cacheTtl: 1000 });
      const indicator = new MockHealthIndicator('test');
      service.registerIndicator(indicator);

      await service.check();
      await service.check();
      await service.check();

      expect(indicator.checkCallCount).toBe(1);
    });

    it('should not cache when disabled', async () => {
      const service = new HealthService({ enableCaching: false });
      const indicator = new MockHealthIndicator('test');
      service.registerIndicator(indicator);

      await service.check();
      await service.check();
      await service.check();

      expect(indicator.checkCallCount).toBe(3);
    });

    it('should invalidate cache after TTL', async () => {
      const service = new HealthService({ enableCaching: true, cacheTtl: 50 });
      const indicator = new MockHealthIndicator('test');
      service.registerIndicator(indicator);

      await service.check();
      expect(indicator.checkCallCount).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 60));

      await service.check();
      expect(indicator.checkCallCount).toBe(2);
    });

    it('should invalidate cache on indicator change', async () => {
      const service = new HealthService({ enableCaching: true, cacheTtl: 10000 });
      const indicator = new MockHealthIndicator('test');
      service.registerIndicator(indicator);

      await service.check();
      expect(indicator.checkCallCount).toBe(1);

      service.unregisterIndicator('test');
      service.registerIndicator(new MockHealthIndicator('test2'));

      const newIndicator = service.getIndicator('test2') as MockHealthIndicator;
      await service.check();
      expect(newIndicator.checkCallCount).toBe(1);
    });

    it('should manually invalidate cache', async () => {
      const service = new HealthService({ enableCaching: true, cacheTtl: 10000 });
      const indicator = new MockHealthIndicator('test');
      service.registerIndicator(indicator);

      await service.check();
      expect(indicator.checkCallCount).toBe(1);

      service.invalidateCache();

      await service.check();
      expect(indicator.checkCallCount).toBe(2);
    });
  });

  describe('checkOne', () => {
    it('should check single indicator', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('healthy', 'OK'));

      const result = await healthService.checkOne('test');
      expect(result.status).toBe('healthy');
      expect(result.message).toBe('OK');
    });

    it('should throw for non-existent indicator', async () => {
      await expect(healthService.checkOne('nonexistent')).rejects.toThrow();
    });
  });

  describe('isHealthy', () => {
    it('should return true when all healthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('healthy'));
      expect(await healthService.isHealthy()).toBe(true);
    });

    it('should return false when any unhealthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('unhealthy'));
      expect(await healthService.isHealthy()).toBe(false);
    });

    it('should return false when any degraded', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('degraded'));
      expect(await healthService.isHealthy()).toBe(false);
    });
  });

  describe('isReady', () => {
    it('should return true when healthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('healthy'));
      expect(await healthService.isReady()).toBe(true);
    });

    it('should return true when degraded', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('degraded'));
      expect(await healthService.isReady()).toBe(true);
    });

    it('should return false when unhealthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('unhealthy'));
      expect(await healthService.isReady()).toBe(false);
    });
  });

  describe('isAlive', () => {
    it('should always return true', async () => {
      expect(await healthService.isAlive()).toBe(true);
    });
  });

  describe('getIndicators', () => {
    it('should return list of indicator names', () => {
      healthService.registerIndicator(new MockHealthIndicator('test1'));
      healthService.registerIndicator(new MockHealthIndicator('test2'));

      const names = healthService.getIndicators();
      expect(names).toContain('test1');
      expect(names).toContain('test2');
    });
  });

  describe('getIndicator', () => {
    it('should return indicator by name', () => {
      const indicator = new MockHealthIndicator('test');
      healthService.registerIndicator(indicator);

      expect(healthService.getIndicator('test')).toBe(indicator);
    });

    it('should return undefined for non-existent', () => {
      expect(healthService.getIndicator('nonexistent')).toBeUndefined();
    });
  });

  describe('clearIndicators', () => {
    it('should remove all indicators', () => {
      healthService.registerIndicator(new MockHealthIndicator('test1'));
      healthService.registerIndicator(new MockHealthIndicator('test2'));
      healthService.clearIndicators();

      expect(healthService.getIndicatorCount()).toBe(0);
    });
  });

  describe('getUptime', () => {
    it('should return uptime in milliseconds', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const uptime = healthService.getUptime();
      expect(uptime).toBeGreaterThanOrEqual(10);
    });
  });
});

describe('HealthIndicator', () => {
  class TestIndicator extends HealthIndicator {
    readonly name = 'test';

    async check(): Promise<HealthIndicatorResult> {
      return this.healthy('OK');
    }

    // Expose protected methods for testing
    public testHealthy(message?: string, details?: Record<string, unknown>) {
      return this.healthy(message, details);
    }

    public testDegraded(message?: string, details?: Record<string, unknown>) {
      return this.degraded(message, details);
    }

    public testUnhealthy(message?: string, details?: Record<string, unknown>, error?: Error) {
      return this.unhealthy(message, details, error);
    }

    public testCreateResultFromCondition(
      isHealthy: boolean,
      healthyMessage?: string,
      unhealthyMessage?: string,
      details?: Record<string, unknown>
    ) {
      return this.createResultFromCondition(isHealthy, healthyMessage, unhealthyMessage, details);
    }

    public async testWithLatency<T>(operation: () => Promise<T>) {
      return this.withLatency(operation);
    }

    public async testWithTimeout<T>(
      operation: () => Promise<T>,
      timeoutMs: number,
      timeoutMessage?: string
    ) {
      return this.withTimeout(operation, timeoutMs, timeoutMessage);
    }

    public testGetWorstStatus(statuses: HealthStatus[]) {
      return this.getWorstStatus(statuses);
    }
  }

  let indicator: TestIndicator;

  beforeEach(() => {
    indicator = new TestIndicator();
  });

  describe('healthy', () => {
    it('should create healthy result', () => {
      const result = indicator.testHealthy('All good');
      expect(result.status).toBe('healthy');
      expect(result.message).toBe('All good');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should include details', () => {
      const result = indicator.testHealthy('OK', { latency: 50 });
      expect(result.details?.latency).toBe(50);
    });
  });

  describe('degraded', () => {
    it('should create degraded result', () => {
      const result = indicator.testDegraded('Slow response');
      expect(result.status).toBe('degraded');
      expect(result.message).toBe('Slow response');
    });
  });

  describe('unhealthy', () => {
    it('should create unhealthy result', () => {
      const result = indicator.testUnhealthy('Connection failed');
      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Connection failed');
    });

    it('should include error details', () => {
      const error = new Error('Test error');
      const result = indicator.testUnhealthy('Failed', {}, error);
      expect(result.error?.message).toBe('Test error');
    });
  });

  describe('createResultFromCondition', () => {
    it('should create healthy result when condition is true', () => {
      const result = indicator.testCreateResultFromCondition(true, 'Healthy', 'Unhealthy');
      expect(result.status).toBe('healthy');
      expect(result.message).toBe('Healthy');
    });

    it('should create unhealthy result when condition is false', () => {
      const result = indicator.testCreateResultFromCondition(false, 'Healthy', 'Unhealthy');
      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Unhealthy');
    });
  });

  describe('withLatency', () => {
    it('should measure operation latency', async () => {
      const { result, latency } = await indicator.testWithLatency(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      });

      expect(result).toBe('done');
      expect(latency).toBeGreaterThanOrEqual(50);
    });
  });

  describe('withTimeout', () => {
    it('should complete before timeout', async () => {
      const result = await indicator.testWithTimeout(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'done';
        },
        100
      );

      expect(result).toBe('done');
    });

    it('should throw on timeout', async () => {
      await expect(
        indicator.testWithTimeout(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return 'done';
          },
          50,
          'Operation timed out'
        )
      ).rejects.toThrow('Operation timed out');
    });
  });

  describe('status helpers', () => {
    it('isHealthy should return true for healthy status', () => {
      const result = indicator.testHealthy();
      expect(indicator.isHealthy(result)).toBe(true);
      expect(indicator.isDegraded(result)).toBe(false);
      expect(indicator.isUnhealthy(result)).toBe(false);
    });

    it('isDegraded should return true for degraded status', () => {
      const result = indicator.testDegraded();
      expect(indicator.isHealthy(result)).toBe(false);
      expect(indicator.isDegraded(result)).toBe(true);
      expect(indicator.isUnhealthy(result)).toBe(false);
    });

    it('isUnhealthy should return true for unhealthy status', () => {
      const result = indicator.testUnhealthy();
      expect(indicator.isHealthy(result)).toBe(false);
      expect(indicator.isDegraded(result)).toBe(false);
      expect(indicator.isUnhealthy(result)).toBe(true);
    });
  });

  describe('getWorstStatus', () => {
    it('should return healthy for empty array', () => {
      expect(indicator.testGetWorstStatus([])).toBe('healthy');
    });

    it('should return healthy for all healthy', () => {
      expect(indicator.testGetWorstStatus(['healthy', 'healthy'])).toBe('healthy');
    });

    it('should return degraded if any degraded', () => {
      expect(indicator.testGetWorstStatus(['healthy', 'degraded'])).toBe('degraded');
    });

    it('should return unhealthy if any unhealthy', () => {
      expect(indicator.testGetWorstStatus(['healthy', 'degraded', 'unhealthy'])).toBe('unhealthy');
    });
  });
});

describe('CompositeHealthIndicator', () => {
  let composite: CompositeHealthIndicator;

  beforeEach(() => {
    composite = new CompositeHealthIndicator('composite');
  });

  describe('constructor', () => {
    it('should create with name', () => {
      expect(composite.name).toBe('composite');
    });

    it('should create with initial indicators', () => {
      const indicators = [
        new MockHealthIndicator('test1'),
        new MockHealthIndicator('test2'),
      ];
      const c = new CompositeHealthIndicator('comp', indicators);

      // Check by running check and verifying results
      c.check().then((result) => {
        expect(result.details?.indicatorCount).toBe(2);
      });
    });
  });

  describe('addIndicator', () => {
    it('should add indicator', async () => {
      composite.addIndicator(new MockHealthIndicator('test'));

      const result = await composite.check();
      expect(result.details?.indicatorCount).toBe(1);
    });

    it('should return this for chaining', () => {
      const returned = composite.addIndicator(new MockHealthIndicator('test'));
      expect(returned).toBe(composite);
    });
  });

  describe('removeIndicator', () => {
    it('should remove existing indicator', async () => {
      composite.addIndicator(new MockHealthIndicator('test1'));
      composite.addIndicator(new MockHealthIndicator('test2'));

      expect(composite.removeIndicator('test1')).toBe(true);

      const result = await composite.check();
      expect(result.details?.indicatorCount).toBe(1);
    });

    it('should return false for non-existent indicator', () => {
      expect(composite.removeIndicator('nonexistent')).toBe(false);
    });
  });

  describe('check', () => {
    it('should aggregate healthy results', async () => {
      composite.addIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      composite.addIndicator(new MockHealthIndicator('test2').setStatus('healthy'));

      const result = await composite.check();
      expect(result.status).toBe('healthy');
      expect(result.message).toContain('2 indicators');
    });

    it('should return worst status', async () => {
      composite.addIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      composite.addIndicator(new MockHealthIndicator('test2').setStatus('degraded'));
      composite.addIndicator(new MockHealthIndicator('test3').setStatus('unhealthy'));

      const result = await composite.check();
      expect(result.status).toBe('unhealthy');
    });

    it('should include individual results in details', async () => {
      composite.addIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      composite.addIndicator(new MockHealthIndicator('test2').setStatus('degraded'));

      const result = await composite.check();
      const indicators = result.details?.indicators as Record<string, HealthIndicatorResult>;
      expect(indicators['test1']?.status).toBe('healthy');
      expect(indicators['test2']?.status).toBe('degraded');
    });

    it('should handle errors gracefully', async () => {
      composite.addIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      composite.addIndicator(
        new MockHealthIndicator('test2').setThrow(new Error('Check failed'))
      );

      const result = await composite.check();
      expect(result.status).toBe('unhealthy');

      const indicators = result.details?.indicators as Record<string, HealthIndicatorResult>;
      expect(indicators['test2']?.status).toBe('unhealthy');
      expect(indicators['test2']?.error?.message).toBe('Check failed');
    });

    it('should include latency', async () => {
      composite.addIndicator(new MockHealthIndicator('test').setDelay(10));

      const result = await composite.check();
      expect(result.latency).toBeGreaterThanOrEqual(10);
    });
  });
});
