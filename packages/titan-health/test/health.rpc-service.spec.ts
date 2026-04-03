/**
 * Health RPC Service Tests
 *
 * Tests for the Netron-native HealthRpcService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HealthRpcService, HealthService, HealthIndicator } from '../src/index.js';
import type { HealthIndicatorResult, HealthStatus } from '../src/index.js';

// Mock indicator for testing
class MockHealthIndicator extends HealthIndicator {
  readonly name: string;
  private mockStatus: HealthStatus = 'healthy';
  private mockMessage: string = 'OK';
  private mockDetails?: Record<string, unknown>;

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

  async check(): Promise<HealthIndicatorResult> {
    switch (this.mockStatus) {
      case 'healthy':
        return this.healthy(this.mockMessage, this.mockDetails);
      case 'degraded':
        return this.degraded(this.mockMessage, this.mockDetails);
      case 'unhealthy':
        return this.unhealthy(this.mockMessage, this.mockDetails);
      default:
        return this.healthy(this.mockMessage, this.mockDetails);
    }
  }
}

describe('HealthRpcService', () => {
  let rpcService: HealthRpcService;
  let healthService: HealthService;

  beforeEach(() => {
    healthService = new HealthService();
    rpcService = new HealthRpcService();
    rpcService.setHealthService(healthService);
  });

  afterEach(() => {
    healthService.clearIndicators();
  });

  describe('setHealthService', () => {
    it('should set the health service', async () => {
      const result = await rpcService.check();
      expect(result.status).toBe('healthy');
    });
  });

  describe('setVersion', () => {
    it('should set the version', async () => {
      rpcService.setVersion('1.0.0');
      const result = await rpcService.check();
      expect(result.version).toBe('1.0.0');
    });
  });

  describe('check', () => {
    it('should return healthy when all indicators healthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      healthService.registerIndicator(new MockHealthIndicator('test2').setStatus('healthy'));

      const result = await rpcService.check();
      expect(result.status).toBe('healthy');
      expect(result.indicators['test1']?.status).toBe('healthy');
      expect(result.indicators['test2']?.status).toBe('healthy');
    });

    it('should return degraded when any indicator degraded', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      healthService.registerIndicator(new MockHealthIndicator('test2').setStatus('degraded'));

      const result = await rpcService.check();
      expect(result.status).toBe('degraded');
    });

    it('should return unhealthy when any indicator unhealthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test1').setStatus('healthy'));
      healthService.registerIndicator(new MockHealthIndicator('test2').setStatus('unhealthy'));

      const result = await rpcService.check();
      expect(result.status).toBe('unhealthy');
    });

    it('should include timestamp', async () => {
      const result = await rpcService.check();
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
    });

    it('should include uptime', async () => {
      const result = await rpcService.check();
      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should include totalLatency', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test'));
      const result = await rpcService.check();
      expect(typeof result.totalLatency).toBe('number');
    });
  });

  describe('live', () => {
    it('should return up status', async () => {
      const result = await rpcService.live();
      expect(result.status).toBe('up');
      expect(result.timestamp).toBeDefined();
    });

    it('should always return up regardless of indicators', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('unhealthy'));
      const result = await rpcService.live();
      expect(result.status).toBe('up');
    });
  });

  describe('ready', () => {
    it('should return healthy status when all healthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('healthy'));

      const result = await rpcService.ready();
      expect(result.status).toBe('healthy');
      expect(result.checks).toBeUndefined();
    });

    it('should return degraded status and include checks', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('degraded', 'Slow response'));

      const result = await rpcService.ready();
      expect(result.status).toBe('degraded');
      expect(result.checks?.['test']?.status).toBe('degraded');
      expect(result.checks?.['test']?.message).toBe('Slow response');
    });

    it('should return unhealthy status and include checks', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('unhealthy', 'Connection failed'));

      const result = await rpcService.ready();
      expect(result.status).toBe('unhealthy');
      expect(result.checks?.['test']?.status).toBe('unhealthy');
    });

    it('should only include non-healthy checks', async () => {
      healthService.registerIndicator(new MockHealthIndicator('healthy').setStatus('healthy'));
      healthService.registerIndicator(new MockHealthIndicator('degraded').setStatus('degraded'));

      const result = await rpcService.ready();
      expect(result.checks?.['healthy']).toBeUndefined();
      expect(result.checks?.['degraded']).toBeDefined();
    });
  });

  describe('checkIndicator', () => {
    it('should check single indicator', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('healthy', 'OK'));

      const result = await rpcService.checkIndicator('test');
      expect(result.name).toBe('test');
      expect(result.result.status).toBe('healthy');
      expect(result.result.message).toBe('OK');
    });

    it('should throw for non-existent indicator', async () => {
      await expect(rpcService.checkIndicator('nonexistent')).rejects.toThrow();
    });
  });

  describe('listIndicators', () => {
    it('should return empty list when no indicators', async () => {
      const result = await rpcService.listIndicators();
      expect(result.indicators).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should return list of indicator names', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test1'));
      healthService.registerIndicator(new MockHealthIndicator('test2'));

      const result = await rpcService.listIndicators();
      expect(result.indicators).toContain('test1');
      expect(result.indicators).toContain('test2');
      expect(result.count).toBe(2);
    });
  });

  describe('uptime', () => {
    it('should return uptime info', async () => {
      const result = await rpcService.uptime();

      expect(typeof result.uptime.ms).toBe('number');
      expect(result.uptime.ms).toBeGreaterThanOrEqual(0);
      expect(typeof result.uptime.formatted).toBe('string');
      expect(typeof result.uptime.days).toBe('number');
      expect(typeof result.uptime.hours).toBe('number');
      expect(typeof result.uptime.minutes).toBe('number');
      expect(typeof result.uptime.seconds).toBe('number');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('isHealthy', () => {
    it('should return true when healthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('healthy'));
      const result = await rpcService.isHealthy();
      expect(result.healthy).toBe(true);
    });

    it('should return false when degraded', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('degraded'));
      const result = await rpcService.isHealthy();
      expect(result.healthy).toBe(false);
    });

    it('should return false when unhealthy', async () => {
      healthService.registerIndicator(new MockHealthIndicator('test').setStatus('unhealthy'));
      const result = await rpcService.isHealthy();
      expect(result.healthy).toBe(false);
    });
  });
});
