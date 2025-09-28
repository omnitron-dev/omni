/**
 * Service Mesh Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ServiceMeshProxy } from '../../../../src/modules/pm/enterprise/service-mesh.js';
import type { ServiceProxy } from '../../../../src/modules/pm/types.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
} as any;

// Mock service
class TestService {
  private callCount = 0;
  private failuresBeforeSuccess = 0;

  async normalMethod(value: string): Promise<string> {
    this.callCount++;
    return `processed: ${value}`;
  }

  async slowMethod(): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return 'slow-result';
  }

  async failingMethod(): Promise<string> {
    throw new Error('Method failed');
  }

  async flakeyMethod(): Promise<string> {
    this.callCount++;
    if (this.callCount <= this.failuresBeforeSuccess) {
      throw new Error('Temporary failure');
    }
    return 'success';
  }

  setFailuresBeforeSuccess(count: number): void {
    this.failuresBeforeSuccess = count;
    this.callCount = 0;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// Create mock service proxy
function createMockServiceProxy(service: any): ServiceProxy<any> {
  // Create a proxy that delegates to the service instance
  const proxy = Object.create(Object.getPrototypeOf(service));

  // Copy all properties and methods from the service
  for (const key of Object.getOwnPropertyNames(service)) {
    proxy[key] = service[key];
  }

  // Copy methods from the prototype
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(service))) {
    if (key !== 'constructor' && typeof service[key] === 'function') {
      proxy[key] = service[key].bind(service);
    }
  }

  // Add ServiceProxy specific methods
  proxy.__processId = 'test-process';
  proxy.__destroy = async () => {};
  proxy.__getMetrics = async () => ({});
  proxy.__getHealth = async () => ({ status: 'healthy', checks: [], timestamp: Date.now() });

  return proxy;
}

describe('ServiceMeshProxy', () => {
  describe('Circuit Breaker', () => {
    it('should open circuit after threshold failures', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        circuitBreaker: {
          threshold: 3,
          timeout: 1000
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // Cause failures to open circuit
      for (let i = 0; i < 3; i++) {
        await expect(meshedService.failingMethod()).rejects.toThrow('Method failed');
      }

      // Circuit should now be open
      await expect(meshedService.normalMethod('test')).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after timeout', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        circuitBreaker: {
          threshold: 2,
          resetTimeout: 100
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // Open circuit
      for (let i = 0; i < 2; i++) {
        await expect(meshedService.failingMethod()).rejects.toThrow();
      }

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should allow one request in half-open state
      const result = await meshedService.normalMethod('test');
      expect(result).toBe('processed: test');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        rateLimit: {
          rps: 2,
          burst: 2,
          strategy: 'token-bucket'
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // First 2 calls should succeed (burst)
      await meshedService.normalMethod('1');
      await meshedService.normalMethod('2');

      // Third call should be rate limited
      await expect(meshedService.normalMethod('3')).rejects.toThrow('Rate limit exceeded');
    });

    it('should refill tokens over time', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        rateLimit: {
          rps: 10,
          burst: 2,
          strategy: 'token-bucket'
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // Use up burst
      await meshedService.normalMethod('1');
      await meshedService.normalMethod('2');

      // Wait for token refill
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should have new tokens
      const result = await meshedService.normalMethod('3');
      expect(result).toBe('processed: 3');
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed requests', async () => {
      const service = new TestService();
      service.setFailuresBeforeSuccess(2);
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        retry: {
          attempts: 3,
          backoff: 'fixed'
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      const result = await meshedService.flakeyMethod();
      expect(result).toBe('success');
      expect(service.getCallCount()).toBe(3); // 2 failures + 1 success
    });

    it('should use exponential backoff', async () => {
      const service = new TestService();
      service.setFailuresBeforeSuccess(2);
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        retry: {
          attempts: 3,
          backoff: 'exponential',
          factor: 2,
          maxDelay: 100
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      const startTime = Date.now();
      await meshedService.flakeyMethod();
      const duration = Date.now() - startTime;

      // Should have delays between retries
      expect(duration).toBeGreaterThan(50);
    });

    it('should fail after max retries', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        retry: {
          attempts: 2,
          backoff: 'fixed'
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      await expect(meshedService.failingMethod()).rejects.toThrow('Method failed');
    });
  });

  describe('Bulkhead', () => {
    it('should limit concurrent requests', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        bulkhead: {
          maxConcurrent: 2,
          maxQueue: 1
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // Start 3 concurrent slow requests
      const promises = [
        meshedService.slowMethod(),
        meshedService.slowMethod(),
        meshedService.slowMethod()
      ];

      // First 2 should run, third should queue
      await Promise.all(promises);
    });

    it('should reject when queue is full', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        bulkhead: {
          maxConcurrent: 1,
          maxQueue: 1
        }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // Start concurrent requests exceeding queue
      const promises = [
        meshedService.slowMethod(),
        meshedService.slowMethod(),
        meshedService.slowMethod().catch(e => e.message)
      ];

      const results = await Promise.all(promises);
      expect(results[2]).toBe('Bulkhead queue full');
    });
  });

  describe('Combined Features', () => {
    it('should apply all mesh features', async () => {
      const service = new TestService();
      service.setFailuresBeforeSuccess(1);
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        circuitBreaker: { threshold: 5 },
        rateLimit: { rps: 10 },
        retry: { attempts: 2 },
        bulkhead: { maxConcurrent: 5 }
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // Should succeed with retry
      const result = await meshedService.flakeyMethod();
      expect(result).toBe('success');

      // Get metrics
      const metrics = meshProxy.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.circuitBreaker).toBeDefined();
      expect(metrics.rateLimiter).toBeDefined();
      expect(metrics.bulkhead).toBeDefined();
    });
  });

  describe('Metrics Collection', () => {
    it('should collect service metrics', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        metrics: true
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // Make some successful calls
      await meshedService.normalMethod('1');
      await meshedService.normalMethod('2');

      // Make a failed call
      await meshedService.failingMethod().catch(() => {});

      const metrics = meshProxy.getMetrics();
      expect(metrics.service.requests).toBe(3);
      expect(metrics.service.successes).toBe(2);
      expect(metrics.service.failures).toBe(1);
      expect(metrics.service.successRate).toBeCloseTo(0.67, 1);
    });

    it('should track latency metrics', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        metrics: true
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // Make multiple calls
      for (let i = 0; i < 5; i++) {
        await meshedService.normalMethod(`${i}`);
      }

      const metrics = meshProxy.getMetrics();
      expect(metrics.service.latency).toBeDefined();
      expect(metrics.service.latency.p50).toBeGreaterThanOrEqual(0);
      expect(metrics.service.latency.mean).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Timeout', () => {
    it('should timeout slow requests', async () => {
      const service = new TestService();
      const proxy = createMockServiceProxy(service);

      const meshProxy = new ServiceMeshProxy(proxy, {
        timeout: 50
      }, mockLogger as any);

      const meshedService = meshProxy.createProxy();

      // slowMethod takes 100ms, timeout is 50ms
      await expect(meshedService.slowMethod()).rejects.toThrow();
    });
  });
});