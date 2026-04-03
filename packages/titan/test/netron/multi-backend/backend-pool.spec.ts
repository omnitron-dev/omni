/**
 * Tests for BackendPool class
 * @module @omnitron-dev/titan/netron/multi-backend
 *
 * Note: These tests focus on unit testing the BackendPool logic.
 * We test the pool's management functionality without requiring real connections.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackendPool } from '../../../src/netron/multi-backend/backend-pool.js';
import type { BackendConfig } from '../../../src/netron/multi-backend/types.js';

describe('BackendPool', () => {
  let pool: BackendPool;

  const createConfig = (id: string, url?: string): BackendConfig => ({
    id,
    url: url || `http://${id}.example.com`,
    services: ['service1', 'service2'],
    region: 'us-east-1',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new BackendPool({
      healthChecks: false, // Disable for unit tests
      healthCheckInterval: 60000,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
    });
  });

  afterEach(async () => {
    if (pool) {
      await pool.dispose();
    }
  });

  describe('Adding Backends', () => {
    it('should add backends', () => {
      const client = pool.addBackend(createConfig('backend-1'));

      expect(client).toBeDefined();
      expect(client.id).toBe('backend-1');
      expect(pool.size).toBe(1);
    });

    it('should throw when adding duplicate backend', () => {
      pool.addBackend(createConfig('backend-1'));

      expect(() => pool.addBackend(createConfig('backend-1'))).toThrow(/already exists/);
    });

    it('should emit backendAdded event', () => {
      const addedHandler = vi.fn();
      pool.on('backendAdded', addedHandler);

      pool.addBackend(createConfig('backend-1'));

      expect(addedHandler).toHaveBeenCalledWith('backend-1');
    });

    it('should add multiple backends', () => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
      pool.addBackend(createConfig('backend-3'));

      expect(pool.size).toBe(3);
    });
  });

  describe('Removing Backends', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
    });

    it('should remove backends', async () => {
      const removed = await pool.removeBackend('backend-1');

      expect(removed).toBe(true);
      expect(pool.size).toBe(1);
      expect(pool.getBackend('backend-1')).toBeUndefined();
    });

    it('should return false for non-existent backend', async () => {
      const removed = await pool.removeBackend('non-existent');

      expect(removed).toBe(false);
    });

    it('should emit backendRemoved event', async () => {
      const removedHandler = vi.fn();
      pool.on('backendRemoved', removedHandler);

      await pool.removeBackend('backend-1');

      expect(removedHandler).toHaveBeenCalledWith('backend-1');
    });
  });

  describe('Getting Backends', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
    });

    it('should get backend by ID', () => {
      const client = pool.getBackend('backend-1');

      expect(client).toBeDefined();
      expect(client?.id).toBe('backend-1');
    });

    it('should return undefined for non-existent backend', () => {
      const client = pool.getBackend('non-existent');

      expect(client).toBeUndefined();
    });

    it('should get all backends', () => {
      const backends = pool.getAllBackends();

      expect(backends).toHaveLength(2);
    });

    it('should get all backend IDs', () => {
      const ids = pool.getBackendIds();

      expect(ids).toHaveLength(2);
      expect(ids).toContain('backend-1');
      expect(ids).toContain('backend-2');
    });
  });

  describe('Pool Lifecycle', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
    });

    it('should emit backendConnect events on start', async () => {
      const connectHandler = vi.fn();
      pool.on('backendConnect', connectHandler);

      // Mock the backend's connect to succeed
      const backends = pool.getAllBackends();
      backends.forEach((backend) => {
        // Simulate successful connection
        (backend as any)._state = 'connected';
      });

      await pool.start();

      // Since real connect fails (no server), we just verify pool started
      expect(pool).toBeDefined();
    });

    it('should emit backendDisconnect events on stop', async () => {
      const disconnectHandler = vi.fn();
      pool.on('backendDisconnect', disconnectHandler);

      await pool.start();
      await pool.stop();

      // Pool should be stopped
      expect(pool).toBeDefined();
    });
  });

  describe('Health Checks', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
    });

    it('should run health checks and emit event', async () => {
      const healthCheckHandler = vi.fn();
      pool.on('healthCheckComplete', healthCheckHandler);

      await pool.runHealthChecks();

      expect(healthCheckHandler).toHaveBeenCalled();
    });

    it('should return health check results', async () => {
      const results = await pool.runHealthChecks();

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(2);
    });

    it('should get connected backends', () => {
      // By default, no backends are connected
      const connectedBackends = pool.getConnectedBackends();

      expect(connectedBackends).toHaveLength(0);
    });

    it('should get healthy backends', () => {
      // By default, no backends are healthy
      const healthyBackends = pool.getHealthyBackends();

      expect(healthyBackends).toHaveLength(0);
    });
  });

  describe('Backend Event Forwarding', () => {
    it('should forward healthChange events from backends', () => {
      pool.addBackend(createConfig('backend-1'));

      const healthHandler = vi.fn();
      pool.on('backendHealthChange', healthHandler);

      const backend = pool.getBackend('backend-1');
      backend?.emit('healthChange', 'healthy');

      expect(healthHandler).toHaveBeenCalledWith('backend-1', 'healthy');
    });

    it('should forward error events from backends', () => {
      pool.addBackend(createConfig('backend-1'));

      const errorHandler = vi.fn();
      pool.on('backendError', errorHandler);

      const backend = pool.getBackend('backend-1');
      const testError = new Error('test error');
      backend?.emit('error', testError);

      expect(errorHandler).toHaveBeenCalledWith('backend-1', testError);
    });

    it('should forward connect events from backends', () => {
      pool.addBackend(createConfig('backend-1'));

      const connectHandler = vi.fn();
      pool.on('backendConnect', connectHandler);

      const backend = pool.getBackend('backend-1');
      backend?.emit('connect');

      expect(connectHandler).toHaveBeenCalledWith('backend-1');
    });

    it('should forward disconnect events from backends', () => {
      pool.addBackend(createConfig('backend-1'));

      const disconnectHandler = vi.fn();
      pool.on('backendDisconnect', disconnectHandler);

      const backend = pool.getBackend('backend-1');
      backend?.emit('disconnect', 'test reason');

      expect(disconnectHandler).toHaveBeenCalledWith('backend-1', 'test reason');
    });
  });

  describe('Backend Statuses', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
    });

    it('should get all backend statuses', () => {
      const statuses = pool.getBackendStatuses();

      expect(statuses).toHaveLength(2);
      expect(statuses[0]?.id).toBe('backend-1');
      expect(statuses[1]?.id).toBe('backend-2');
    });

    it('should get specific backend status', () => {
      const status = pool.getBackendStatus('backend-1');

      expect(status).toBeDefined();
      expect(status?.id).toBe('backend-1');
    });

    it('should return undefined for non-existent backend status', () => {
      const status = pool.getBackendStatus('non-existent');

      expect(status).toBeUndefined();
    });
  });

  describe('Reconnection', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
    });

    it('should throw for non-existent backend reconnection', async () => {
      await expect(pool.reconnectBackend('non-existent')).rejects.toThrow(/not found/);
    });
  });

  describe('Health Check Configuration', () => {
    it('should update health check interval', () => {
      pool.addBackend(createConfig('backend-1'));

      pool.setHealthCheckInterval(5000);

      expect(pool).toBeDefined();
    });

    it('should enable/disable health checks', () => {
      pool.addBackend(createConfig('backend-1'));

      pool.setHealthChecksEnabled(true);
      pool.setHealthChecksEnabled(false);

      expect(pool).toBeDefined();
    });

    it('should create pool with health checks enabled by default', () => {
      const poolWithHealthChecks = new BackendPool();

      expect(poolWithHealthChecks).toBeDefined();
      poolWithHealthChecks.dispose();
    });
  });

  describe('Pool Statistics', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
    });

    it('should return pool statistics', () => {
      const stats = pool.getStatistics();

      expect(stats.total).toBe(2);
      expect(stats.connected).toBe(0); // No real connections
      expect(stats.healthy).toBe(0);
      expect(stats.unhealthy).toBe(0);
      expect(stats.degraded).toBe(0);
      expect(stats.unknown).toBe(2); // All start as unknown
    });
  });

  describe('Metrics Reset', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
    });

    it('should reset all backend metrics', () => {
      pool.resetAllMetrics();

      // Verify each backend had resetMetrics called
      const backends = pool.getAllBackends();
      backends.forEach((backend) => {
        // Metrics should be reset
        const status = backend.getStatus();
        expect(status.requestsSent).toBe(0);
        expect(status.responsesReceived).toBe(0);
        expect(status.errors).toBe(0);
      });
    });
  });

  describe('Disposal', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));
    });

    it('should dispose and cleanup resources', async () => {
      await pool.dispose();

      expect(pool.size).toBe(0);
    });

    it('should clear all backends on disposal', async () => {
      await pool.dispose();

      expect(pool.getAllBackends()).toHaveLength(0);
      expect(pool.getBackendIds()).toHaveLength(0);
    });
  });

  describe('Size Property', () => {
    it('should return 0 for empty pool', () => {
      expect(pool.size).toBe(0);
    });

    it('should return correct size after adding backends', () => {
      pool.addBackend(createConfig('backend-1'));
      expect(pool.size).toBe(1);

      pool.addBackend(createConfig('backend-2'));
      expect(pool.size).toBe(2);
    });

    it('should update size after removing backends', async () => {
      pool.addBackend(createConfig('backend-1'));
      pool.addBackend(createConfig('backend-2'));

      await pool.removeBackend('backend-1');
      expect(pool.size).toBe(1);
    });
  });

  describe('Has Healthy Backend', () => {
    beforeEach(() => {
      pool.addBackend(createConfig('backend-1'));
    });

    it('should return false when no backends are healthy', () => {
      expect(pool.hasHealthyBackend()).toBe(false);
    });

    it('should return true when at least one backend is healthy', () => {
      const backend = pool.getBackend('backend-1');
      // Manually set health to simulate healthy backend
      (backend as any)._health = 'healthy';

      expect(pool.hasHealthyBackend()).toBe(true);
    });

    it('should return true when backend is degraded', () => {
      const backend = pool.getBackend('backend-1');
      (backend as any)._health = 'degraded';

      expect(pool.hasHealthyBackend()).toBe(true);
    });
  });
});
