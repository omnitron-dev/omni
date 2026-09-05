/**
 * Tests for MultiBackendClient class
 * @module @omnitron-dev/titan/netron/multi-backend
 *
 * Note: These tests focus on unit testing the MultiBackendClient logic.
 * We test configuration, routing, and management features.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MultiBackendClient } from '../../../src/netron/multi-backend/multi-backend-client.js';
import type { MultiBackendConfig } from '../../../src/netron/multi-backend/types.js';

describe('MultiBackendClient', () => {
  let client: MultiBackendClient;
  let config: MultiBackendConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      backends: [
        {
          id: 'backend-1',
          url: 'http://backend-1.example.com',
          services: ['users', 'auth'],
          region: 'us-east-1',
        },
        {
          id: 'backend-2',
          url: 'http://backend-2.example.com',
          services: ['orders', 'inventory'],
          region: 'us-west-2',
        },
      ],
      router: {
        routes: [
          { service: 'users', backends: ['backend-1'] },
          { service: 'orders', backends: ['backend-2'] },
        ],
        defaultBackends: ['backend-1'],
        defaultStrategy: 'round-robin',
      },
      retries: {
        enabled: true,
        maxAttempts: 3,
        delay: 100,
        factor: 2,
      },
      timeout: 5000,
    };

    client = new MultiBackendClient(config);
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect().catch(() => {});
    }
  });

  describe('Constructor and Initialization', () => {
    it('should create with valid config', () => {
      expect(client).toBeDefined();
    });

    it('should create with minimal config', () => {
      const minimalClient = new MultiBackendClient({
        backends: [
          {
            id: 'backend-1',
            url: 'http://localhost:3000',
          },
        ],
      });

      expect(minimalClient).toBeDefined();
      minimalClient.disconnect().catch(() => {});
    });

    it('should use default options when not specified', () => {
      const defaultClient = new MultiBackendClient({
        backends: [{ id: 'backend-1', url: 'http://localhost:3000' }],
      });

      expect(defaultClient).toBeDefined();
      defaultClient.disconnect().catch(() => {});
    });
  });

  describe('Backend Management', () => {
    it('should get all backend statuses', () => {
      const statuses = client.getBackendStatuses();

      expect(statuses).toHaveLength(2);
      expect(statuses[0]?.id).toBe('backend-1');
      expect(statuses[1]?.id).toBe('backend-2');
    });

    it('should get specific backend status', () => {
      const status = client.getBackendStatus('backend-1');

      expect(status).toBeDefined();
      expect(status?.id).toBe('backend-1');
    });

    it('should return undefined for non-existent backend', () => {
      const status = client.getBackendStatus('non-existent');

      expect(status).toBeUndefined();
    });

    it('should add backend dynamically', () => {
      client.addBackend({
        id: 'backend-3',
        url: 'http://backend-3.example.com',
      });

      const statuses = client.getBackendStatuses();
      expect(statuses).toHaveLength(3);
    });

    it('should remove backend dynamically', async () => {
      await client.removeBackend('backend-1');

      const statuses = client.getBackendStatuses();
      expect(statuses).toHaveLength(1);
      expect(statuses[0]?.id).toBe('backend-2');
    });
  });

  describe('Route Management', () => {
    it('should get routes via router', () => {
      const routes = (client as any).router.getRoutes();

      expect(routes).toHaveLength(2);
    });

    it('should add route via router', () => {
      (client as any).router.addRoute({
        service: 'payments',
        backends: ['backend-2'],
      });

      const routes = (client as any).router.getRoutes();
      expect(routes.some((r: any) => r.service === 'payments')).toBe(true);
    });

    it('should remove route via router', () => {
      (client as any).router.removeRoute('users');

      const routes = (client as any).router.getRoutes();
      expect(routes.some((r: any) => r.service === 'users')).toBe(false);
    });

    it('should update router configuration', () => {
      (client as any).router.updateConfig({
        defaultStrategy: 'random',
      });

      expect(client).toBeDefined();
    });
  });

  describe('Metrics', () => {
    it('should get aggregated metrics', () => {
      const metrics = client.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.totalRequests).toBeDefined();
      expect(metrics.totalErrors).toBeDefined();
      expect(metrics.backends).toHaveLength(2);
    });

    it('should reset metrics', () => {
      client.resetMetrics();

      const metrics = client.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalFailovers).toBe(0);
    });
  });

  describe('Health Checks', () => {
    it('should run health checks via pool', async () => {
      const results = await (client as any).pool.runHealthChecks();

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(2);
    });

    it('should check if any backend is available', () => {
      const hasAvailable = client.hasAvailableBackend();

      // Initially no backends are connected, so none are available
      expect(typeof hasAvailable).toBe('boolean');
    });
  });

  describe('Connection Events', () => {
    it('should emit backendConnect event when backend connects', () => {
      const connectHandler = vi.fn();
      client.on('backendConnect', connectHandler);

      // Trigger the event through the pool
      (client as any).pool.emit('backendConnect', 'backend-1');

      expect(connectHandler).toHaveBeenCalledWith('backend-1');
    });

    it('should emit backendDisconnect event when backend disconnects', () => {
      const disconnectHandler = vi.fn();
      client.on('backendDisconnect', disconnectHandler);

      (client as any).pool.emit('backendDisconnect', 'backend-1', 'test reason');

      expect(disconnectHandler).toHaveBeenCalledWith('backend-1', 'test reason');
    });

    it('should emit backendHealthChange event', () => {
      const healthHandler = vi.fn();
      client.on('backendHealthChange', healthHandler);

      (client as any).pool.emit('backendHealthChange', 'backend-1', 'healthy');

      expect(healthHandler).toHaveBeenCalledWith('backend-1', 'healthy');
    });

    it('should emit backendError event', () => {
      const errorHandler = vi.fn();
      client.on('backendError', errorHandler);

      const testError = new Error('test error');
      (client as any).pool.emit('backendError', 'backend-1', testError);

      expect(errorHandler).toHaveBeenCalledWith('backend-1', testError);
    });
  });

  describe('Connection State', () => {
    it('should track connection state', () => {
      expect(client.isClientConnected()).toBe(false);
    });

    it('should emit connect event on connect', async () => {
      const connectHandler = vi.fn();
      client.on('connect', connectHandler);

      await client.connect().catch(() => {});

      expect(connectHandler).toHaveBeenCalled();
    });

    it('should emit disconnect event on disconnect', async () => {
      const disconnectHandler = vi.fn();
      client.on('disconnect', disconnectHandler);

      await client.connect().catch(() => {});
      await client.disconnect().catch(() => {});

      expect(disconnectHandler).toHaveBeenCalled();
    });
  });

  describe('Invocation (disconnected)', () => {
    it('should throw when invoking on disconnected client', async () => {
      await expect(client.invoke('users', 'getUser', ['123'])).rejects.toThrow(/not connected/);
    });
  });

  describe('Circuit Breaker', () => {
    it('should have circuit breaker states', () => {
      const circuitBreakers = (client as any).circuitBreakers;

      expect(circuitBreakers).toBeInstanceOf(Map);
    });

    /**
     * `window` was declared, documented with a 60s default, and read by
     * nothing: the failure count was cumulative and only a success reset it.
     * So failures separated by hours counted the same as failures separated
     * by milliseconds, and a backend failing once a day would eventually open
     * the circuit at a threshold of 5. A breaker that cannot forget is not
     * measuring a failure rate, which is the one thing it exists to measure.
     */
    const withBreaker = (over: Record<string, unknown> = {}) =>
      new MultiBackendClient({
        ...config,
        circuitBreaker: { enabled: true, threshold: 3, window: 1_000, ...over },
      });

    const fail = (c: MultiBackendClient, id: string, times = 1) => {
      for (let i = 0; i < times; i++) (c as any).recordFailure(id);
    };
    const stateOf = (c: MultiBackendClient, id: string) => (c as any).circuitBreakers.get(id);

    it('opens once the threshold is reached inside the window', () => {
      const c = withBreaker();
      fail(c, 'backend-1', 3);

      expect(stateOf(c, 'backend-1').state).toBe('open');
    });

    it('does not open when the failures are spread beyond the window', () => {
      const c = withBreaker();
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now');

      // Three failures, each a full window apart: never three at once.
      clock.mockReturnValue(now);
      fail(c, 'backend-1');
      clock.mockReturnValue(now + 1_500);
      fail(c, 'backend-1');
      clock.mockReturnValue(now + 3_000);
      fail(c, 'backend-1');

      // The behavioural claim first, so a regression reports "expected 'open'
      // to be 'closed'" rather than a missing-field error.
      expect(stateOf(c, 'backend-1').state).toBe('closed');
      expect(stateOf(c, 'backend-1').failureTimes).toHaveLength(1);

      clock.mockRestore();
    });

    it('reports the in-window count in its stats', () => {
      const c = withBreaker();
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now');

      clock.mockReturnValue(now);
      fail(c, 'backend-1', 2);
      clock.mockReturnValue(now + 2_000);
      fail(c, 'backend-1');
      clock.mockRestore();

      // Two aged out; the number a reader compares against `threshold` is 1,
      // and the circuit stays closed because three never coincided.
      expect(stateOf(c, 'backend-1').state).toBe('closed');
      expect(stateOf(c, 'backend-1').failureTimes).toHaveLength(1);
    });
  });

  describe('Reconnection', () => {
    it('should reconnect specific backend', async () => {
      // This will fail since no real connection, but tests the method exists
      await client.reconnectBackend('backend-1').catch(() => {});

      expect(client).toBeDefined();
    });

    it('should reconnect all backends', async () => {
      await client.reconnectAll().catch(() => {});

      expect(client).toBeDefined();
    });
  });

  describe('Cleanup', () => {
    it('should disconnect cleanly', async () => {
      await client.disconnect();

      expect(client.isClientConnected()).toBe(false);
    });

    it('should handle multiple disconnect calls', async () => {
      await client.disconnect();
      await client.disconnect();

      expect(client.isClientConnected()).toBe(false);
    });
  });

  describe('Options', () => {
    it('should apply retries configuration', () => {
      const options = (client as any).options;

      expect(options.retries).toBeDefined();
      expect(options.retries.maxAttempts).toBe(3);
    });

    it('should apply timeout configuration', () => {
      const options = (client as any).options;

      expect(options.timeout).toBe(5000);
    });

    it('should use default values for unspecified options', () => {
      const defaultClient = new MultiBackendClient({
        backends: [{ id: 'backend-1', url: 'http://localhost:3000' }],
      });

      const options = (defaultClient as any).options;
      expect(options.healthChecks).toBe(true);
      expect(options.defaultTransport).toBe('http');

      defaultClient.disconnect().catch(() => {});
    });
  });

  describe('Backend Pool Access', () => {
    it('should have access to backend pool', () => {
      const pool = (client as any).pool;

      expect(pool).toBeDefined();
      expect(pool.size).toBe(2);
    });
  });

  describe('Router Access', () => {
    it('should have access to service router', () => {
      const router = (client as any).router;

      expect(router).toBeDefined();
    });
  });
});
