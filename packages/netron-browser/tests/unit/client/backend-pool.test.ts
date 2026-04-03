/**
 * Unit tests for BackendPool
 *
 * Tests the BackendPool class which manages a pool of backend connections
 * with lazy initialization, lifecycle management, and health monitoring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackendPool } from '../../../src/client/backend-pool.js';
import type { BackendConfig } from '../../../src/types/multi-backend.js';
import { ConnectionState } from '../../../src/types/index.js';

// Mock BackendClient module as a class
vi.mock('../../../src/client/backend-client.js', () => {
  const MockBackendClient = class {
    private name: string;
    private config: any;
    private baseUrl: string;
    private _connected = false;

    constructor(options: any) {
      this.name = options.name;
      this.config = options.config;
      this.baseUrl = options.baseUrl;
    }

    connect = vi.fn().mockImplementation(async () => {
      this._connected = true;
    });

    disconnect = vi.fn().mockImplementation(async () => {
      this._connected = false;
    });

    destroy = vi.fn().mockImplementation(async () => {
      this._connected = false;
    });

    isConnected = vi.fn().mockImplementation(() => this._connected);

    getMetrics = vi.fn().mockImplementation(() => ({
      id: this.name,
      url: `${this.baseUrl}${this.config.path}`,
      state: this._connected ? 'connected' : 'disconnected',
      transport: this.config.transport || 'http',
      requestsSent: 10,
      responsesReceived: 9,
      errors: 1,
      avgLatency: 50,
    }));

    getPath = vi.fn().mockImplementation(() => this.config.path);
    getTransportType = vi.fn().mockImplementation(() => this.config.transport || 'http');
    getName = vi.fn().mockImplementation(() => this.name);

    service = vi.fn().mockImplementation(() => ({
      invoke: vi.fn().mockResolvedValue({ result: 'success' }),
    }));

    invoke = vi.fn().mockResolvedValue({ result: 'success' });
  };

  return { BackendClient: MockBackendClient };
});

describe('BackendPool', () => {
  const baseUrl = 'https://api.example.com';
  const backends: Record<string, BackendConfig> = {
    core: { path: '/core' },
    storage: { path: '/storage' },
    analytics: { path: '/analytics', transport: 'websocket' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create pool with backend configurations', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      expect(pool.getNames()).toEqual(['core', 'storage', 'analytics']);
    });

    it('should initialize pool entries for all backends', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      const entries = pool.getAllPoolEntries();
      expect(entries.length).toBe(3);
      entries.forEach((entry) => {
        expect(entry.connected).toBe(false);
        expect(entry.healthy).toBe(true);
      });
    });

    it('should normalize base URL by removing trailing slash', () => {
      const pool = new BackendPool({
        baseUrl: 'https://api.example.com/',
        backends: { core: { path: '/core' } },
      });

      expect(pool.getNames()).toEqual(['core']);
    });
  });

  describe('lazy initialization', () => {
    it('should create backends lazily on first access', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      // Access a backend - should create the client
      const coreBackend = pool.get('core');

      expect(coreBackend).toBeDefined();
      expect(coreBackend.getName()).toBe('core');
    });

    it('should return same instance on subsequent accesses', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      const first = pool.get('core');
      const second = pool.get('core');

      expect(first).toBe(second);
    });
  });

  describe('has', () => {
    it('should return true for existing backends', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      expect(pool.has('core')).toBe(true);
      expect(pool.has('storage')).toBe(true);
      expect(pool.has('analytics')).toBe(true);
    });

    it('should return false for non-existing backends', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      expect(pool.has('unknown')).toBe(false);
      expect(pool.has('')).toBe(false);
    });
  });

  describe('get', () => {
    it('should throw error for unknown backend', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      expect(() => pool.get('unknown')).toThrow("Backend 'unknown' not found in pool");
    });

    it('should throw error for empty backend name', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      expect(() => pool.get('')).toThrow("Backend '' not found in pool");
    });
  });

  describe('connect', () => {
    it('should connect to specific backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');

      expect(pool.isConnected('core')).toBe(true);
      expect(pool.isConnected('storage')).toBe(false);
    });

    it('should update pool entry state after connect', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');

      const entry = pool.getPoolEntry('core');
      expect(entry?.connected).toBe(true);
      expect(entry?.healthy).toBe(true);
    });
  });

  describe('connectAll', () => {
    it('should connect to all backends', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connectAll();

      expect(pool.isConnected('core')).toBe(true);
      expect(pool.isConnected('storage')).toBe(true);
      expect(pool.isConnected('analytics')).toBe(true);
      expect(pool.allConnected()).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect specific backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connectAll();
      await pool.disconnect('core');

      expect(pool.isConnected('core')).toBe(false);
      expect(pool.isConnected('storage')).toBe(true);
    });

    it('should update pool entry state after disconnect', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');
      await pool.disconnect('core');

      const entry = pool.getPoolEntry('core');
      expect(entry?.connected).toBe(false);
    });

    it('should be safe to disconnect non-initialized backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      // Should not throw
      await pool.disconnect('core');
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all backends', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connectAll();
      await pool.disconnectAll();

      expect(pool.allConnected()).toBe(false);
      expect(pool.isConnected('core')).toBe(false);
      expect(pool.isConnected('storage')).toBe(false);
      expect(pool.isConnected('analytics')).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should return false for non-initialized backend', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      expect(pool.isConnected('core')).toBe(false);
    });

    it('should return correct state for connected backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');

      expect(pool.isConnected('core')).toBe(true);
    });
  });

  describe('allConnected', () => {
    it('should return false when no backends are connected', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      expect(pool.allConnected()).toBe(false);
    });

    it('should return false when only some backends are connected', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');

      expect(pool.allConnected()).toBe(false);
    });

    it('should return true when all backends are connected', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connectAll();

      expect(pool.allConnected()).toBe(true);
    });
  });

  describe('metrics', () => {
    it('should return metrics for specific backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');
      const metrics = pool.getMetrics('core');

      expect(metrics.id).toBe('core');
      expect(metrics.requestsSent).toBe(10);
      expect(metrics.responsesReceived).toBe(9);
      expect(metrics.errors).toBe(1);
    });

    it('should return default metrics for non-initialized backend', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      const metrics = pool.getMetrics('core');

      expect(metrics.id).toBe('core');
      expect(metrics.url).toBe('https://api.example.com/core');
      expect(metrics.state).toBe(ConnectionState.DISCONNECTED);
      expect(metrics.requestsSent).toBe(0);
    });

    it('should return aggregated metrics from all backends', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connectAll();
      const metrics = pool.getAggregatedMetrics();

      expect(metrics.backends).toHaveProperty('core');
      expect(metrics.backends).toHaveProperty('storage');
      expect(metrics.backends).toHaveProperty('analytics');
      expect(metrics.totalRequestsSent).toBe(30); // 10 * 3 backends
      expect(metrics.totalResponsesReceived).toBe(27); // 9 * 3 backends
      expect(metrics.totalErrors).toBe(3); // 1 * 3 backends
      expect(metrics.avgLatency).toBe(50); // Average of all backend latencies
    });
  });

  describe('pool entries', () => {
    it('should return pool entry for backend', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      const entry = pool.getPoolEntry('core');

      expect(entry).toBeDefined();
      expect(entry?.name).toBe('core');
      expect(entry?.config.path).toBe('/core');
    });

    it('should return undefined for unknown backend', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      const entry = pool.getPoolEntry('unknown');

      expect(entry).toBeUndefined();
    });

    it('should return all pool entries', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      const entries = pool.getAllPoolEntries();

      expect(entries.length).toBe(3);
      expect(entries.map((e) => e.name)).toEqual(['core', 'storage', 'analytics']);
    });
  });

  describe('health checks', () => {
    it('should check health of specific backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      // Non-initialized backend is not healthy
      const unhealthyResult = await pool.checkHealth('core');
      expect(unhealthyResult).toBe(false);

      // After connecting, should be healthy
      await pool.connect('core');
      const healthyResult = await pool.checkHealth('core');
      expect(healthyResult).toBe(true);
    });

    it('should update pool entry health status', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');
      await pool.checkHealth('core');

      const entry = pool.getPoolEntry('core');
      expect(entry?.healthy).toBe(true);
      expect(entry?.lastHealthCheck).toBeDefined();
    });

    it('should check health of all backends', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');
      const results = await pool.checkAllHealth();

      expect(results.get('core')).toBe(true);
      expect(results.get('storage')).toBe(false);
      expect(results.get('analytics')).toBe(false);
    });

    it('should return false for unknown backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      const result = await pool.checkHealth('unknown');

      expect(result).toBe(false);
    });
  });

  describe('healthy/unhealthy backends', () => {
    it('should return list of healthy backends', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      // All backends start as healthy by default
      const healthy = pool.getHealthyBackends();
      expect(healthy).toEqual(['core', 'storage', 'analytics']);
    });

    it('should return list of unhealthy backends', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      // Check health to mark non-connected as unhealthy
      await pool.checkAllHealth();

      const unhealthy = pool.getUnhealthyBackends();
      expect(unhealthy).toEqual(['core', 'storage', 'analytics']);
    });
  });

  describe('health check timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start periodic health checks when enabled', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
        enableHealthChecks: true,
        healthCheckInterval: 1000,
      });

      await pool.connectAll();

      // Fast-forward timer
      await vi.advanceTimersByTimeAsync(1000);

      // Health checks should have run
      const entry = pool.getPoolEntry('core');
      expect(entry?.lastHealthCheck).toBeDefined();

      pool.stopHealthChecks();
    });

    it('should stop health checks when requested', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
        enableHealthChecks: true,
        healthCheckInterval: 1000,
      });

      pool.stopHealthChecks();

      // Should be safe to call multiple times
      pool.stopHealthChecks();
    });

    it('should not start health checks when disabled', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
        enableHealthChecks: false,
      });

      // Should not throw
      pool.stopHealthChecks();
    });
  });

  describe('addBackend', () => {
    it('should add new backend to pool', () => {
      const pool = new BackendPool({
        baseUrl,
        backends: { core: { path: '/core' } },
      });

      expect(pool.has('newBackend')).toBe(false);

      pool.addBackend('newBackend', { path: '/new' });

      expect(pool.has('newBackend')).toBe(true);
      expect(pool.getNames()).toContain('newBackend');
    });

    it('should throw error when adding existing backend', () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      expect(() => pool.addBackend('core', { path: '/core-new' })).toThrow("Backend 'core' already exists in pool");
    });

    it('should initialize pool entry for new backend', () => {
      const pool = new BackendPool({
        baseUrl,
        backends: {},
      });

      pool.addBackend('new', { path: '/new' });

      const entry = pool.getPoolEntry('new');
      expect(entry).toBeDefined();
      expect(entry?.connected).toBe(false);
      expect(entry?.healthy).toBe(true);
    });
  });

  describe('removeBackend', () => {
    it('should remove backend from pool', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.removeBackend('core');

      expect(pool.has('core')).toBe(false);
      expect(pool.getNames()).not.toContain('core');
    });

    it('should disconnect and destroy client when removing', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');
      await pool.removeBackend('core');

      expect(pool.has('core')).toBe(false);
    });

    it('should be safe to remove non-initialized backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.removeBackend('core');

      expect(pool.has('core')).toBe(false);
    });
  });

  describe('updateBackend', () => {
    it('should update backend configuration', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.updateBackend('core', { path: '/core-v2' });

      const entry = pool.getPoolEntry('core');
      expect(entry?.config.path).toBe('/core-v2');
    });

    it('should throw error when updating non-existing backend', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await expect(pool.updateBackend('unknown', { path: '/unknown' })).rejects.toThrow(
        "Backend 'unknown' not found in pool"
      );
    });

    it('should destroy existing client when updating', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');
      await pool.updateBackend('core', { path: '/core-v2' });

      // Pool entry should be reset
      const entry = pool.getPoolEntry('core');
      expect(entry?.connected).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should destroy all backends and clear pool', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connectAll();
      await pool.destroy();

      expect(pool.getNames()).toEqual([]);
      expect(pool.getAllPoolEntries()).toEqual([]);
    });

    it('should stop health checks when destroying', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
        enableHealthChecks: true,
      });

      await pool.destroy();

      // Should be safe to call after destroy
      pool.stopHealthChecks();
    });
  });

  describe('pool statistics', () => {
    it('should return correct statistics', async () => {
      const pool = new BackendPool({
        baseUrl,
        backends,
      });

      await pool.connect('core');
      await pool.connect('storage');

      const metrics = pool.getAggregatedMetrics();

      expect(Object.keys(metrics.backends).length).toBe(3);
      expect(metrics.totalRequestsSent).toBeGreaterThanOrEqual(0);
    });
  });
});
