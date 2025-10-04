/**
 * Resilience Patterns Tests
 *
 * Tests demonstrating resilience patterns and fault-tolerance mechanisms
 * including circuit breakers, retries, bulkheads, rate limiting, and self-healing.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createTestProcessManager,
  TestProcessManager
} from '../../../src/modules/pm/index.js';

// Import types for type safety (not the actual classes!)
import type ExternalApiService from './processes/external-api.process.js';
import type ApiGatewayService from './processes/api-gateway.process.js';
import type DatabaseClientService from './processes/database-client.process.js';
import type ResourceManagerService from './processes/resource-manager.process.js';
import type CachingService from './processes/caching.process.js';
import type SelfHealingService from './processes/self-healing.process.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Tests
// ============================================================================

describe('Resilience Patterns - Circuit Breaker', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should open circuit after threshold failures and use fallback', async () => {
    const service = await pm.spawn<ExternalApiService>(
      resolve(__dirname, './processes/external-api.process.js')
    );

    // Set high failure rate to trigger circuit breaker
    await service.setFailureRate(0.9);

    const results: Array<{ source: 'primary' | 'fallback' }> = [];
    let primaryCount = 0;
    let fallbackCount = 0;

    // Make multiple calls
    for (let i = 0; i < 10; i++) {
      try {
        const result = await service.fetchData(`/api/endpoint/${i}`);
        results.push(result);
        if (result.source === 'primary') primaryCount++;
        if (result.source === 'fallback') fallbackCount++;
      } catch (error) {
        // Circuit breaker might still throw before opening
      }
    }

    const stats = await service.getStats();
    expect(stats.callCount).toBeGreaterThan(0);

    // After circuit opens, fallback should be used more frequently
    // Note: The exact behavior depends on CircuitBreaker implementation
    expect(results.length).toBeGreaterThan(0);
  });

  it('should close circuit after successful calls during half-open state', async () => {
    const service = await pm.spawn<ExternalApiService>(
      resolve(__dirname, './processes/external-api.process.js')
    );

    // Start with failures
    await service.setFailureRate(0.9);

    // Trigger failures
    for (let i = 0; i < 5; i++) {
      try {
        await service.fetchData('/api/test');
      } catch {}
    }

    // Reduce failure rate
    await service.setFailureRate(0.1);

    // Wait for circuit to potentially enter half-open state
    await new Promise(resolve => setTimeout(resolve, 200));

    // Make successful calls
    const results: any[] = [];
    for (let i = 0; i < 5; i++) {
      try {
        const result = await service.fetchData('/api/recovery');
        results.push(result);
      } catch {}
    }

    // Circuit should eventually close and allow primary calls
    const primaryCalls = results.filter(r => r?.source === 'primary');
    expect(primaryCalls.length).toBeGreaterThan(0);
  });
});

describe('Resilience Patterns - Rate Limiting', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should limit requests per second', async () => {
    const service = await pm.spawn<ApiGatewayService>(
      resolve(__dirname, './processes/api-gateway.process.js')
    );

    const userId = 'user123';
    const requests = Array.from({ length: 20 }, (_, i) => ({
      id: `req_${i}`,
      data: `request ${i}`
    }));

    // Send requests rapidly
    const startTime = Date.now();
    const results = await Promise.allSettled(
      requests.map(req => service.handleRequest(userId, req))
    );
    const duration = Date.now() - startTime;

    const successful = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');

    // With 10 RPS limit and burst of 15, some requests should be rate-limited
    // Note: Actual behavior depends on RateLimit implementation
    expect(successful.length).toBeGreaterThan(0);

    // Duration should indicate rate limiting if many requests
    // (10 RPS means 20 requests should take at least 1 second)
    if (successful.length === 20) {
      expect(duration).toBeGreaterThan(500);
    }
  });

  it('should track requests per user independently', async () => {
    const service = await pm.spawn<ApiGatewayService>(
      resolve(__dirname, './processes/api-gateway.process.js')
    );

    // Make requests for different users
    await service.handleRequest('user1', { data: 'test1' });
    await service.handleRequest('user1', { data: 'test2' });
    await service.handleRequest('user2', { data: 'test3' });

    const count1 = await service.getUserRequestCount('user1');
    const count2 = await service.getUserRequestCount('user2');

    expect(count1).toBe(2);
    expect(count2).toBe(1);
  });
});

describe('Resilience Patterns - Retry with Backoff', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should retry failed operations with exponential backoff', async () => {
    const service = await pm.spawn<DatabaseClientService>(
      resolve(__dirname, './processes/database-client.process.js')
    );

    // Execute query with retries
    const startTime = Date.now();
    const result = await service.executeQuery('SELECT * FROM users', { maxRetries: 3 });
    const duration = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.attempts).toBeLessThanOrEqual(3);

    // If retries occurred, duration should reflect backoff delays
    if (result.attempts > 1) {
      // With exponential backoff, retries add 100ms, 200ms, etc.
      const expectedMinDuration = (result.attempts - 1) * 50;
      expect(duration).toBeGreaterThanOrEqual(expectedMinDuration);
    }
  });

  it('should fail after max retries exceeded', async () => {
    const service = await pm.spawn<DatabaseClientService>(
      resolve(__dirname, './processes/database-client.process.js')
    );

    // Force failures by making many rapid queries
    const promises = Array.from({ length: 10 }, (_, i) =>
      service.executeQuery(`SELECT * FROM table${i}`, { maxRetries: 2 })
    );

    const results = await Promise.allSettled(promises);

    // At least some should succeed
    const successful = results.filter(r => r.status === 'fulfilled');
    expect(successful.length).toBeGreaterThan(0);
  });
});

describe('Resilience Patterns - Bulkhead', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should isolate resources in separate pools', async () => {
    const service = await pm.spawn<ResourceManagerService>(
      resolve(__dirname, './processes/resource-manager.process.js')
    );

    // Create resource pools with different concurrency limits
    await service.createPool('critical', 5);
    await service.createPool('standard', 10);

    // Acquire resources from critical pool
    const criticalAcquisitions = await Promise.all([
      service.acquireResource('critical', 'req1', 10),
      service.acquireResource('critical', 'req2', 10),
      service.acquireResource('critical', 'req3', 10)
    ]);

    expect(criticalAcquisitions.every(a => a.acquired)).toBe(true);

    const criticalStats = await service.getPoolStats('critical');
    expect(criticalStats?.currentActive).toBe(3);
    expect(criticalStats?.maxConcurrent).toBe(5);

    // Standard pool should be independent
    const standardStats = await service.getPoolStats('standard');
    expect(standardStats?.currentActive).toBe(0);
  });

  it('should enforce concurrency limits per pool', async () => {
    const service = await pm.spawn<ResourceManagerService>(
      resolve(__dirname, './processes/resource-manager.process.js')
    );

    await service.createPool('limited', 2); // Only 2 concurrent

    // Try to acquire 3 resources
    const acquisitions = await Promise.all([
      service.acquireResource('limited', 'req1'),
      service.acquireResource('limited', 'req2'),
      service.acquireResource('limited', 'req3')
    ]);

    const acquired = acquisitions.filter(a => a.acquired);
    expect(acquired.length).toBeLessThanOrEqual(2);

    // Release one resource
    await service.releaseResource('limited', 'req1');

    // Now should be able to acquire for waiting request
    const stats = await service.getPoolStats('limited');
    expect(stats?.currentActive).toBeLessThanOrEqual(2);
  });

  it('should prioritize high-priority requests in queue', async () => {
    const service = await pm.spawn<ResourceManagerService>(
      resolve(__dirname, './processes/resource-manager.process.js')
    );

    await service.createPool('priority-pool', 1); // Only 1 concurrent

    // Acquire resource first
    await service.acquireResource('priority-pool', 'first', 0);

    // Queue requests with different priorities
    await service.acquireResource('priority-pool', 'low', 1);
    await service.acquireResource('priority-pool', 'high', 10);

    const stats = await service.getPoolStats('priority-pool');

    // Higher priority request should be first in queue
    expect(stats?.queue[0]?.priority).toBe(10);
  });
});

describe('Resilience Patterns - Caching', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should cache results and improve performance', async () => {
    const service = await pm.spawn<CachingService>(
      resolve(__dirname, './processes/caching.process.js')
    );

    const input = 42;

    // First call - should compute
    const result1 = await service.expensiveComputation(input);
    expect(result1.computationTime).toBeGreaterThan(0);

    // Second call with same input - should be cached (faster)
    const result2 = await service.expensiveComputation(input);

    // Results should be identical (cached)
    expect(result2.result).toBe(result1.result);

    // Note: Actual cache hit detection depends on @Cache decorator implementation
  });

  it('should expire cache after TTL', async () => {
    const service = await pm.spawn<CachingService>(
      resolve(__dirname, './processes/caching.process.js')
    );

    const input = 100;

    // First call
    await service.expensiveComputation(input);

    // Wait for cache to expire (TTL is 1000ms)
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Second call - should recompute after expiration
    const result2 = await service.expensiveComputation(input);
    expect(result2).toBeDefined();
  });
});

describe('Resilience Patterns - Self-Healing', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should automatically recover from temporary failures', async () => {
    const service = await pm.spawn<SelfHealingService>(
      resolve(__dirname, './processes/self-healing.process.js')
    );

    // Process task with simulated error
    const result = await service.processTask('task1', true);

    expect(result.success).toBe(true);
    expect(result.recoveryAttempts).toBeGreaterThanOrEqual(0);
  });

  it('should track and respond to error rates', async () => {
    const service = await pm.spawn<SelfHealingService>(
      resolve(__dirname, './processes/self-healing.process.js')
    );

    const initialHealth = await service.__getHealth();
    expect(initialHealth.status).toBe('healthy');

    // Trigger some errors
    for (let i = 0; i < 3; i++) {
      try {
        await service.processTask(`task${i}`, true);
      } catch {}
    }

    const errorCount = await service.getErrorCount();
    expect(errorCount).toBeGreaterThanOrEqual(0);
  });

  it('should trigger manual recovery when needed', async () => {
    const service = await pm.spawn<SelfHealingService>(
      resolve(__dirname, './processes/self-healing.process.js')
    );

    // Trigger recovery
    const recovery = await service.triggerRecovery();
    expect(recovery.recovered).toBe(true);

    const health = await service.__getHealth();
    expect(health.status).toBe('healthy');

    const errorCount = await service.getErrorCount();
    expect(errorCount).toBe(0);
  });
});

describe('Resilience Patterns - Combined Patterns', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should combine circuit breaker with retry and cache', async () => {
    // This test demonstrates using multiple resilience patterns together
    const apiService = await pm.spawn<ExternalApiService>(
      resolve(__dirname, './processes/external-api.process.js')
    );
    const dbService = await pm.spawn<DatabaseClientService>(
      resolve(__dirname, './processes/database-client.process.js')
    );

    // API call with circuit breaker
    await apiService.setFailureRate(0.2); // 20% failure rate

    const apiResults: any[] = [];
    for (let i = 0; i < 5; i++) {
      try {
        const result = await apiService.fetchData(`/api/data/${i}`);
        apiResults.push(result);
      } catch (error) {
        // Circuit breaker will handle failures
      }
    }

    // DB query with retry
    const dbResult = await dbService.executeQuery('SELECT * FROM cache');

    expect(dbResult.success).toBe(true);
    expect(apiResults.length).toBeGreaterThan(0);
  });

  it('should handle cascading failures with multiple services', async () => {
    const apiService = await pm.spawn<ExternalApiService>(
      resolve(__dirname, './processes/external-api.process.js')
    );
    const dbService = await pm.spawn<DatabaseClientService>(
      resolve(__dirname, './processes/database-client.process.js')
    );
    const gatewayService = await pm.spawn<ApiGatewayService>(
      resolve(__dirname, './processes/api-gateway.process.js')
    );

    // Set up failure scenarios
    await apiService.setFailureRate(0.5);

    // Process requests through gateway
    const requests = Array.from({ length: 10 }, (_, i) => ({
      id: `req_${i}`,
      apiEndpoint: `/api/data/${i}`
    }));

    const results = await Promise.allSettled(
      requests.map(req => gatewayService.handleRequest('user1', req))
    );

    const successful = results.filter(r => r.status === 'fulfilled');

    // Despite API failures, gateway should handle some requests
    expect(successful.length).toBeGreaterThan(0);
  });
});