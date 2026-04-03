/**
 * Connection Manager Tests
 *
 * Tests for industrial-grade connection management including:
 * - Connection pooling and reuse
 * - Health monitoring with heartbeat mechanism
 * - Exponential backoff with jitter for reconnection
 * - Connection limits per peer
 * - Idle connection timeout and cleanup
 * - Graceful shutdown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConnectionManager,
  ConnectionManagerConfig,
  ConnectionManagerState,
  ManagedConnectionState,
} from '../../src/netron/connection-manager.js';
import type { ITransportConnection, ConnectionState, ConnectionMetrics } from '../../src/netron/transport/types.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';

// Mock logger
const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  time: vi.fn(),
  timeEnd: vi.fn(),
  setBindings: vi.fn(),
  level: 'info' as const,
});

// Mock transport connection
class MockTransportConnection extends EventEmitter implements ITransportConnection {
  id: string;
  private _state: ConnectionState = 'connected' as any;
  remoteAddress?: string;
  localAddress?: string;
  private shouldFailPing = false;

  constructor(id: string = 'mock-' + Math.random().toString(36).substring(7)) {
    super();
    this.id = id;
    this.remoteAddress = '127.0.0.1:8080';
    this.localAddress = '127.0.0.1:12345';
  }

  get state(): ConnectionState {
    return this._state;
  }

  setState(state: ConnectionState): void {
    this._state = state;
  }

  setFailPing(fail: boolean): void {
    this.shouldFailPing = fail;
  }

  async send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void> {
    // Mock send
  }

  async sendPacket(packet: any): Promise<void> {
    // Mock sendPacket
  }

  async close(code?: number, reason?: string): Promise<void> {
    this._state = 'disconnected' as any;
    this.emit('disconnect', reason);
  }

  async ping(): Promise<number> {
    if (this.shouldFailPing) {
      throw new Error('Ping failed');
    }
    return 10;
  }

  getMetrics(): ConnectionMetrics {
    return {
      bytesSent: 1000,
      bytesReceived: 2000,
      packetsSent: 10,
      packetsReceived: 20,
      duration: 5000,
      rtt: 10,
    };
  }
}

describe('ConnectionManager', () => {
  let manager: ConnectionManager;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  afterEach(async () => {
    if (manager && manager.getState() === ConnectionManagerState.RUNNING) {
      await manager.stop();
    }
  });

  describe('Initialization', () => {
    it('should create with default configuration', () => {
      manager = new ConnectionManager(logger as any);
      expect(manager.getState()).toBe(ConnectionManagerState.IDLE);
    });

    it('should create with custom configuration', () => {
      const config: ConnectionManagerConfig = {
        maxConnectionsPerPeer: 5,
        maxTotalConnections: 50,
        poolSize: 2,
        idleTimeout: 10000,
        healthCheckInterval: 5000,
      };
      manager = new ConnectionManager(logger as any, config);
      expect(manager.getState()).toBe(ConnectionManagerState.IDLE);
    });

    it('should start and change state to RUNNING', () => {
      manager = new ConnectionManager(logger as any);
      manager.start();
      expect(manager.getState()).toBe(ConnectionManagerState.RUNNING);
    });

    it('should stop and change state to STOPPED', async () => {
      manager = new ConnectionManager(logger as any);
      manager.start();
      await manager.stop();
      expect(manager.getState()).toBe(ConnectionManagerState.STOPPED);
    });
  });

  describe('Connection Pooling', () => {
    beforeEach(() => {
      manager = new ConnectionManager(logger as any, {
        maxConnectionsPerPeer: 3,
        maxTotalConnections: 10,
        poolSize: 2,
      });
      manager.start();
    });

    it('should add connection to pool', () => {
      const conn = new MockTransportConnection();
      const managed = manager.addConnection('peer-1', conn);

      expect(managed).not.toBeNull();
      expect(managed!.peerId).toBe('peer-1');
      expect(managed!.state).toBe(ManagedConnectionState.HEALTHY);
    });

    it('should reject connection when per-peer limit reached', () => {
      const conn1 = new MockTransportConnection('conn-1');
      const conn2 = new MockTransportConnection('conn-2');
      const conn3 = new MockTransportConnection('conn-3');
      const conn4 = new MockTransportConnection('conn-4');

      manager.addConnection('peer-1', conn1);
      manager.addConnection('peer-1', conn2);
      manager.addConnection('peer-1', conn3);
      const result = manager.addConnection('peer-1', conn4);

      expect(result).toBeNull();
    });

    it('should checkout connection from pool', () => {
      const conn = new MockTransportConnection();
      manager.addConnection('peer-1', conn);

      const checked = manager.checkout('peer-1');

      expect(checked).not.toBeNull();
      expect(checked!.state).toBe(ManagedConnectionState.IN_USE);
    });

    it('should checkin connection back to pool', () => {
      const conn = new MockTransportConnection();
      const managed = manager.addConnection('peer-1', conn)!;
      manager.checkout('peer-1');

      manager.checkin(managed.id);

      expect(managed.state).toBe(ManagedConnectionState.IDLE);
    });

    it('should track reuse count', () => {
      const conn = new MockTransportConnection();
      const managed = manager.addConnection('peer-1', conn)!;

      manager.checkout('peer-1');
      manager.checkin(managed.id);
      manager.checkout('peer-1');
      manager.checkin(managed.id);

      expect(managed.reuseCount).toBe(2);
    });

    it('should return null when no available connections', () => {
      const result = manager.checkout('non-existent-peer');
      expect(result).toBeNull();
    });

    it('should not checkout unhealthy connections', () => {
      const conn = new MockTransportConnection();
      const managed = manager.addConnection('peer-1', conn)!;
      managed.state = ManagedConnectionState.UNHEALTHY;

      const result = manager.checkout('peer-1');

      expect(result).toBeNull();
    });
  });

  describe('Connection Limits', () => {
    beforeEach(() => {
      manager = new ConnectionManager(logger as any, {
        maxConnectionsPerPeer: 2,
        maxTotalConnections: 5,
      });
      manager.start();
    });

    it('should enforce per-peer connection limit', () => {
      const conn1 = manager.addConnection('peer-1', new MockTransportConnection());
      const conn2 = manager.addConnection('peer-1', new MockTransportConnection());
      const conn3 = manager.addConnection('peer-1', new MockTransportConnection());

      expect(conn1).not.toBeNull();
      expect(conn2).not.toBeNull();
      expect(conn3).toBeNull();
    });

    it('should enforce global connection limit', () => {
      manager.addConnection('peer-1', new MockTransportConnection());
      manager.addConnection('peer-1', new MockTransportConnection());
      manager.addConnection('peer-2', new MockTransportConnection());
      manager.addConnection('peer-2', new MockTransportConnection());
      manager.addConnection('peer-3', new MockTransportConnection());
      const result = manager.addConnection('peer-3', new MockTransportConnection());

      expect(result).toBeNull();
    });

    it('should emit pool:limit_reached event', () => {
      const limitHandler = vi.fn();
      manager.on('pool:limit_reached', limitHandler);

      manager.addConnection('peer-1', new MockTransportConnection());
      manager.addConnection('peer-1', new MockTransportConnection());
      manager.addConnection('peer-1', new MockTransportConnection()); // Should trigger limit

      expect(limitHandler).toHaveBeenCalledWith('peer-1', 2);
    });
  });

  describe('Health Monitoring', () => {
    beforeEach(() => {
      manager = new ConnectionManager(logger as any, {
        healthCheckInterval: 1000,
        maxMissedHeartbeats: 2,
        heartbeatTimeout: 500,
      });
      manager.start();
    });

    it('should mark connection unhealthy after missed heartbeats via forceHealthCheck', async () => {
      const conn = new MockTransportConnection();
      conn.setFailPing(true);
      const managed = manager.addConnection('peer-1', conn)!;

      const unhealthyHandler = vi.fn();
      manager.on('connection:unhealthy', unhealthyHandler);

      // First health check - 1 missed heartbeat
      await manager.forceHealthCheck();
      expect(managed.missedHeartbeats).toBe(1);

      // Second health check - 2 missed heartbeats = unhealthy
      await manager.forceHealthCheck();

      expect(managed.state).toBe(ManagedConnectionState.UNHEALTHY);
      expect(unhealthyHandler).toHaveBeenCalled();
    });

    it('should recover unhealthy connection when heartbeat succeeds', async () => {
      const conn = new MockTransportConnection();
      conn.setFailPing(true);
      const managed = manager.addConnection('peer-1', conn)!;

      const recoveredHandler = vi.fn();
      manager.on('connection:recovered', recoveredHandler);

      // Miss heartbeats
      await manager.forceHealthCheck();
      await manager.forceHealthCheck();

      expect(managed.state).toBe(ManagedConnectionState.UNHEALTHY);

      // Fix ping and check again
      conn.setFailPing(false);
      await manager.forceHealthCheck();

      expect(managed.state).toBe(ManagedConnectionState.HEALTHY);
      expect(recoveredHandler).toHaveBeenCalled();
    });

    it('should not health check in-use connections', async () => {
      const conn = new MockTransportConnection();
      const pingSpy = vi.spyOn(conn, 'ping');
      manager.addConnection('peer-1', conn);

      manager.checkout('peer-1'); // Mark as in-use

      await manager.forceHealthCheck();

      expect(pingSpy).not.toHaveBeenCalled();
    });

    it('should perform health checks and maintain healthy connection', async () => {
      const conn = new MockTransportConnection();
      manager.addConnection('peer-1', conn);

      await manager.forceHealthCheck();

      const managed = manager.getConnection(conn.id);
      expect(managed?.state).toBe(ManagedConnectionState.HEALTHY);
      expect(managed?.missedHeartbeats).toBe(0);
    });
  });

  describe('Reconnection with Exponential Backoff', () => {
    beforeEach(() => {
      manager = new ConnectionManager(logger as any, {
        reconnect: {
          enabled: true,
          baseDelay: 100,
          maxDelay: 3000,
          maxAttempts: 5,
          jitterFactor: 0,
        },
      });
      manager.start();
    });

    it('should calculate exponential backoff delays', () => {
      const delay0 = manager.calculateReconnectDelay(0);
      const delay1 = manager.calculateReconnectDelay(1);
      const delay2 = manager.calculateReconnectDelay(2);

      expect(delay0).toBe(100); // baseDelay
      expect(delay1).toBe(200); // 100 * 2^1
      expect(delay2).toBe(400); // 100 * 2^2
    });

    it('should cap delay at maxDelay', () => {
      const delay10 = manager.calculateReconnectDelay(10);

      expect(delay10).toBe(3000); // maxDelay
    });

    it('should emit reconnect_failed after max attempts', () => {
      const failedHandler = vi.fn();
      manager.on('connection:reconnect_failed', failedHandler);

      // Add existing connection with maxAttempts already reached
      const conn = new MockTransportConnection();
      const managed = manager.addConnection('peer-1', conn)!;
      managed.reconnectAttempts = 5;

      const connectionFactory = vi.fn().mockRejectedValue(new Error('Connection failed'));

      manager.scheduleReconnect('peer-1', connectionFactory);

      expect(failedHandler).toHaveBeenCalled();
    });

    it('should cancel scheduled reconnection', () => {
      vi.useFakeTimers();
      const connectionFactory = vi.fn();

      manager.scheduleReconnect('peer-1', connectionFactory);
      manager.cancelReconnect('peer-1');

      vi.advanceTimersByTime(1000);

      expect(connectionFactory).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('Jitter', () => {
    it('should add jitter to reconnection delay', () => {
      manager = new ConnectionManager(logger as any, {
        reconnect: {
          enabled: true,
          baseDelay: 1000,
          maxDelay: 30000,
          maxAttempts: 10,
          jitterFactor: 0.3,
        },
      });

      // With jitter, delays should vary
      const delays: number[] = [];
      for (let i = 0; i < 10; i++) {
        delays.push(manager.calculateReconnectDelay(2));
      }

      // Check that not all delays are exactly the same (jitter should vary them)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);

      // All delays should be within expected range (baseDelay * 2^2 = 4000 +/- 30%)
      delays.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(1000); // Min: baseDelay
        expect(delay).toBeLessThanOrEqual(30000); // Max: maxDelay
      });
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      manager = new ConnectionManager(logger as any);
      manager.start();
    });

    it('should return accurate pool statistics', () => {
      const conn1 = new MockTransportConnection('conn-1');
      const conn2 = new MockTransportConnection('conn-2');

      manager.addConnection('peer-1', conn1);
      manager.addConnection('peer-2', conn2);

      manager.checkout('peer-1');

      const stats = manager.getStats();

      expect(stats.totalConnections).toBe(2);
      expect(stats.activeConnections).toBe(1);
      expect(stats.idleConnections).toBe(1);
      expect(stats.connectionsPerPeer.get('peer-1')).toBe(1);
      expect(stats.connectionsPerPeer.get('peer-2')).toBe(1);
    });

    it('should track bytes sent and received', async () => {
      const conn = new MockTransportConnection();
      manager.addConnection('peer-1', conn);

      // Remove connection to aggregate metrics
      await manager.removeConnection(conn.id, 'test');

      const stats = manager.getStats();
      expect(stats.totalBytesSent).toBe(1000);
    });
  });

  describe('Graceful Shutdown', () => {
    beforeEach(() => {
      manager = new ConnectionManager(logger as any);
      manager.start();
    });

    it('should close all connections on stop', async () => {
      const conn1 = new MockTransportConnection();
      const conn2 = new MockTransportConnection();

      const closeSpy1 = vi.spyOn(conn1, 'close');
      const closeSpy2 = vi.spyOn(conn2, 'close');

      manager.addConnection('peer-1', conn1);
      manager.addConnection('peer-2', conn2);

      await manager.stop();

      expect(closeSpy1).toHaveBeenCalled();
      expect(closeSpy2).toHaveBeenCalled();
    });

    it('should clear all timers on stop', async () => {
      manager.addConnection('peer-1', new MockTransportConnection());

      await manager.stop();

      // Verify manager is stopped
      expect(manager.getState()).toBe(ConnectionManagerState.STOPPED);
    });

    it('should emit state change events', async () => {
      const stateChangeHandler = vi.fn();
      manager.on('manager:state_change', stateChangeHandler);

      await manager.stop();

      expect(stateChangeHandler).toHaveBeenCalledWith(ConnectionManagerState.RUNNING, ConnectionManagerState.STOPPING);
      expect(stateChangeHandler).toHaveBeenCalledWith(ConnectionManagerState.STOPPING, ConnectionManagerState.STOPPED);
    });
  });

  describe('Connection Events', () => {
    beforeEach(() => {
      manager = new ConnectionManager(logger as any);
      manager.start();
    });

    it('should emit connection:added event', () => {
      const addedHandler = vi.fn();
      manager.on('connection:added', addedHandler);

      const conn = new MockTransportConnection();
      manager.addConnection('peer-1', conn);

      expect(addedHandler).toHaveBeenCalled();
    });

    it('should emit connection:removed event', async () => {
      const removedHandler = vi.fn();
      manager.on('connection:removed', removedHandler);

      const conn = new MockTransportConnection();
      manager.addConnection('peer-1', conn);

      await manager.removeConnection(conn.id, 'test');

      expect(removedHandler).toHaveBeenCalled();
    });

    it('should handle connection disconnect event', () => {
      const removedHandler = vi.fn();
      manager.on('connection:removed', removedHandler);

      const conn = new MockTransportConnection();
      manager.addConnection('peer-1', conn);

      conn.emit('disconnect', 'peer closed');

      expect(removedHandler).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      manager = new ConnectionManager(logger as any);
      manager.start();
    });

    it('should handle checkin of unknown connection gracefully', () => {
      expect(() => manager.checkin('unknown-id')).not.toThrow();
    });

    it('should handle remove of non-existent connection gracefully', async () => {
      await expect(manager.removeConnection('unknown-id', 'test')).resolves.not.toThrow();
    });

    it('should handle multiple stop calls gracefully', async () => {
      await manager.stop();
      await expect(manager.stop()).resolves.not.toThrow();
    });

    it('should not start if already running', () => {
      manager.start();
      // Second start should just log a warning
      expect(() => manager.start()).not.toThrow();
    });

    it('should check hasAvailableConnection correctly', () => {
      expect(manager.hasAvailableConnection('peer-1')).toBe(false);

      manager.addConnection('peer-1', new MockTransportConnection());
      expect(manager.hasAvailableConnection('peer-1')).toBe(true);
    });

    it('should get connections for peer', () => {
      manager.addConnection('peer-1', new MockTransportConnection());
      manager.addConnection('peer-1', new MockTransportConnection());
      manager.addConnection('peer-2', new MockTransportConnection());

      const peer1Conns = manager.getConnectionsForPeer('peer-1');
      expect(peer1Conns).toHaveLength(2);

      const peer2Conns = manager.getConnectionsForPeer('peer-2');
      expect(peer2Conns).toHaveLength(1);

      const peer3Conns = manager.getConnectionsForPeer('peer-3');
      expect(peer3Conns).toHaveLength(0);
    });
  });
});
