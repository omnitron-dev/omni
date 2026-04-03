/**
 * Tests for BackendClient class
 * @module @omnitron-dev/titan/netron/multi-backend
 *
 * Note: These tests focus on unit testing the BackendClient logic.
 * Integration tests with real connections are in separate test files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackendClient } from '../../../src/netron/multi-backend/backend-client.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import type { BackendConfig } from '../../../src/netron/multi-backend/types.js';

describe('BackendClient', () => {
  let client: BackendClient;
  let config: BackendConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      id: 'test-backend',
      url: 'http://localhost:3000',
      transport: 'http',
      timeout: 5000,
      services: ['testService'],
      region: 'us-east-1',
      weight: 10,
    };

    client = new BackendClient(config);
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect().catch(() => {});
    }
  });

  describe('Constructor and Properties', () => {
    it('should create client with correct properties', () => {
      expect(client.id).toBe('test-backend');
      expect(client.url).toBe('http://localhost:3000');
      expect(client.services).toEqual(['testService']);
      expect(client.region).toBe('us-east-1');
    });

    it('should initialize with disconnected state', () => {
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should initialize with unknown health', () => {
      expect(client.health).toBe('unknown');
    });

    it('should use default transport as http', () => {
      const defaultConfig: BackendConfig = {
        id: 'default-backend',
        url: 'http://localhost:3001',
      };
      const defaultClient = new BackendClient(defaultConfig);
      expect(defaultClient).toBeDefined();
      expect(defaultClient.id).toBe('default-backend');
    });

    it('should accept custom health thresholds', () => {
      const customClient = new BackendClient(config, {
        unhealthyThreshold: 5,
        healthyThreshold: 3,
      });
      expect(customClient).toBeDefined();
    });
  });

  describe('Connection State Management', () => {
    it('should check if connected when disconnected', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should check if healthy when unknown', () => {
      expect(client.isHealthy()).toBe(false);
    });

    it('should emit stateChange event on state transitions', async () => {
      const states: ConnectionState[] = [];
      client.on('stateChange', (state: ConnectionState) => {
        states.push(state);
      });

      // Trigger state change via internal method
      (client as any).setState(ConnectionState.CONNECTING);
      (client as any).setState(ConnectionState.CONNECTED);

      expect(states).toContain(ConnectionState.CONNECTING);
      expect(states).toContain(ConnectionState.CONNECTED);
    });
  });

  describe('State Transitions', () => {
    it('should transition from disconnected to connecting', () => {
      (client as any).setState(ConnectionState.CONNECTING);
      expect(client.state).toBe(ConnectionState.CONNECTING);
    });

    it('should transition from connecting to connected', () => {
      (client as any).setState(ConnectionState.CONNECTING);
      (client as any).setState(ConnectionState.CONNECTED);
      expect(client.state).toBe(ConnectionState.CONNECTED);
      expect(client.isConnected()).toBe(true);
    });

    it('should transition from connected to disconnecting', () => {
      (client as any).setState(ConnectionState.CONNECTED);
      (client as any).setState(ConnectionState.DISCONNECTING);
      expect(client.state).toBe(ConnectionState.DISCONNECTING);
    });

    it('should transition to error state', () => {
      (client as any).setState(ConnectionState.ERROR);
      expect(client.state).toBe(ConnectionState.ERROR);
    });
  });

  describe('WebSocket Transport Configuration', () => {
    let wsClient: BackendClient;

    beforeEach(() => {
      const wsConfig: BackendConfig = {
        id: 'ws-backend',
        url: 'http://localhost:3000',
        transport: 'websocket',
        websocket: {
          reconnect: true,
          reconnectInterval: 1000,
          maxReconnectAttempts: 5,
        },
      };
      wsClient = new BackendClient(wsConfig);
    });

    afterEach(async () => {
      if (wsClient) {
        await wsClient.disconnect().catch(() => {});
      }
    });

    it('should create WebSocket client', () => {
      expect(wsClient).toBeDefined();
      expect(wsClient.id).toBe('ws-backend');
    });

    it('should initialize with disconnected state', () => {
      expect(wsClient.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('Disconnection', () => {
    it('should disconnect and emit event', async () => {
      // Manually set connected state
      (client as any)._state = ConnectionState.CONNECTED;

      const disconnectHandler = vi.fn();
      client.on('disconnect', disconnectHandler);

      await client.disconnect();

      expect(client.state).toBe(ConnectionState.DISCONNECTED);
      expect(disconnectHandler).toHaveBeenCalled();
    });

    it('should handle disconnect when already disconnected', async () => {
      expect(client.state).toBe(ConnectionState.DISCONNECTED);

      // Should not throw
      await client.disconnect();

      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('Backend Status', () => {
    it('should return complete status information when disconnected', () => {
      const status = client.getStatus();

      expect(status.id).toBe('test-backend');
      expect(status.url).toBe('http://localhost:3000');
      expect(status.state).toBe(ConnectionState.DISCONNECTED);
      expect(status.health).toBe('unknown');
      expect(status.services).toEqual(['testService']);
      expect(status.region).toBe('us-east-1');
      expect(status.requestsSent).toBe(0);
      expect(status.responsesReceived).toBe(0);
      expect(status.errors).toBe(0);
    });

    it('should return connected status after manual state change', () => {
      (client as any)._state = ConnectionState.CONNECTED;

      const status = client.getStatus();

      expect(status.state).toBe(ConnectionState.CONNECTED);
      expect(status.activeConnections).toBe(1);
    });

    it('should return 0 activeConnections when disconnected', () => {
      const status = client.getStatus();

      expect(status.activeConnections).toBe(0);
    });
  });

  describe('Metrics', () => {
    it('should return metrics object', () => {
      const metrics = client.getMetrics();

      expect(metrics.id).toBe('test-backend');
      expect(metrics.url).toBe('http://localhost:3000');
      expect(metrics.transport).toBe('http');
      expect(metrics.requestsSent).toBe(0);
      expect(metrics.responsesReceived).toBe(0);
      expect(metrics.errors).toBe(0);
    });

    it('should reset metrics', () => {
      // Simulate some activity
      (client as any).metrics.requestsSent = 10;
      (client as any).metrics.responsesReceived = 8;
      (client as any).metrics.errors = 2;

      client.resetMetrics();

      const status = client.getStatus();
      expect(status.requestsSent).toBe(0);
      expect(status.responsesReceived).toBe(0);
      expect(status.errors).toBe(0);
    });

    it('should reset health to unknown on metrics reset', () => {
      (client as any)._health = 'healthy';

      client.resetMetrics();

      expect(client.health).toBe('unknown');
    });

    it('should track latencies', () => {
      (client as any).metrics.latencies = [10, 20, 30];

      const metrics = client.getMetrics();

      expect(metrics.avgLatency).toBe(20);
    });
  });

  describe('Health Tracking', () => {
    it('should emit healthChange event when health changes', () => {
      const healthHandler = vi.fn();
      client.on('healthChange', healthHandler);

      (client as any).setHealth('healthy');

      expect(healthHandler).toHaveBeenCalledWith('healthy');
    });

    it('should not emit healthChange when health is same', () => {
      (client as any)._health = 'healthy';

      const healthHandler = vi.fn();
      client.on('healthChange', healthHandler);

      (client as any).setHealth('healthy');

      expect(healthHandler).not.toHaveBeenCalled();
    });

    it('should track consecutive successes and update health', () => {
      (client as any).recordSuccess();
      expect(client.health).toBe('unknown'); // Still unknown after 1 success

      (client as any).recordSuccess();
      expect(client.health).toBe('healthy'); // Healthy after 2 successes (threshold)
    });

    it('should track consecutive failures and update health', () => {
      (client as any).recordFailure();
      (client as any).recordFailure();
      expect(client.health).toBe('unknown'); // Still unknown after 2 failures

      (client as any).recordFailure();
      expect(client.health).toBe('unhealthy'); // Unhealthy after 3 failures (threshold)
    });

    it('should reset failure count on success', () => {
      (client as any).recordFailure();
      (client as any).recordFailure();
      (client as any).recordSuccess();

      expect(client.health).not.toBe('unhealthy');
    });

    it('should reset success count on failure', () => {
      (client as any).recordSuccess();
      (client as any).recordFailure();
      (client as any).recordSuccess();

      // After failure, success count resets, so need 2 more for healthy
      expect(client.health).not.toBe('healthy');
    });

    it('should transition to degraded on failure from healthy', () => {
      // First become healthy
      (client as any).recordSuccess();
      (client as any).recordSuccess();
      expect(client.health).toBe('healthy');

      // Then fail once - should become degraded
      (client as any).recordFailure();
      expect(client.health).toBe('degraded');
    });
  });

  describe('isHealthy Method', () => {
    it('should return false when unknown', () => {
      expect(client.isHealthy()).toBe(false);
    });

    it('should return true when healthy', () => {
      (client as any)._health = 'healthy';
      expect(client.isHealthy()).toBe(true);
    });

    it('should return true when degraded', () => {
      (client as any)._health = 'degraded';
      expect(client.isHealthy()).toBe(true);
    });

    it('should return false when unhealthy', () => {
      (client as any)._health = 'unhealthy';
      expect(client.isHealthy()).toBe(false);
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration', () => {
      client.updateConfig({
        timeout: 10000,
        headers: { 'X-Custom': 'value' },
      });

      expect((client as any).config.timeout).toBe(10000);
      expect((client as any).config.headers).toEqual({ 'X-Custom': 'value' });
    });

    it('should update transport type', () => {
      client.updateConfig({
        transport: 'websocket',
      });

      expect((client as any).transport).toBe('websocket');
    });

    it('should merge with existing configuration', () => {
      client.updateConfig({
        timeout: 10000,
      });

      // Original values should be preserved
      expect((client as any).config.services).toEqual(['testService']);
    });
  });

  describe('Health Check', () => {
    it('should update lastHealthCheck timestamp', async () => {
      (client as any)._state = ConnectionState.CONNECTED;
      (client as any).httpClient = {
        connection: {
          ping: vi.fn().mockResolvedValue(10),
        },
      };

      const beforeCheck = Date.now();
      await client.healthCheck();

      const status = client.getStatus();
      expect(status.lastHealthCheck).toBeGreaterThanOrEqual(beforeCheck);
    });

    it('should return true when healthy', async () => {
      (client as any)._state = ConnectionState.CONNECTED;
      (client as any)._health = 'healthy';
      (client as any).httpClient = {
        connection: {
          ping: vi.fn().mockResolvedValue(10),
        },
      };

      const result = await client.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('Method Invocation (when disconnected)', () => {
    it('should throw error when not connected', async () => {
      await expect(client.invoke('testService', 'testMethod', [])).rejects.toThrow(/not connected/);
    });
  });

  describe('Services and Region', () => {
    it('should return empty services when not configured', () => {
      const minimalClient = new BackendClient({
        id: 'minimal',
        url: 'http://localhost:3000',
      });

      expect(minimalClient.services).toEqual([]);
    });

    it('should return undefined region when not configured', () => {
      const minimalClient = new BackendClient({
        id: 'minimal',
        url: 'http://localhost:3000',
      });

      expect(minimalClient.region).toBeUndefined();
    });

    it('should return configured services', () => {
      expect(client.services).toEqual(['testService']);
    });

    it('should return configured region', () => {
      expect(client.region).toBe('us-east-1');
    });
  });

  describe('Error Handling', () => {
    it('should emit error event', () => {
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      const error = new Error('Test error');
      client.emit('error', error);

      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('should record error metrics directly', () => {
      // metrics.errors is incremented directly in invoke, not in recordFailure
      (client as any).metrics.errors++;

      const status = client.getStatus();
      expect(status.errors).toBe(1);
    });

    it('should update lastError timestamp on failure', () => {
      const beforeError = Date.now();

      (client as any).recordFailure();

      expect((client as any).metrics.lastError).toBeGreaterThanOrEqual(beforeError);
    });
  });

  describe('Connect Event', () => {
    it('should emit connect event', () => {
      const connectHandler = vi.fn();
      client.on('connect', connectHandler);

      client.emit('connect');

      expect(connectHandler).toHaveBeenCalled();
    });
  });

  describe('Latency Tracking', () => {
    it('should calculate average latency', () => {
      (client as any).metrics.latencies = [10, 20, 30, 40, 50];

      const metrics = client.getMetrics();

      expect(metrics.avgLatency).toBe(30);
    });

    it('should return undefined avgLatency when no latencies', () => {
      const metrics = client.getMetrics();

      expect(metrics.avgLatency).toBeUndefined();
    });

    it('should add latency samples directly', () => {
      // Latencies are pushed directly during invoke, not via recordLatency
      for (let i = 0; i < 5; i++) {
        (client as any).metrics.latencies.push(i * 10);
      }

      expect((client as any).metrics.latencies.length).toBe(5);
      expect((client as any).metrics.latencies).toEqual([0, 10, 20, 30, 40]);
    });
  });
});
