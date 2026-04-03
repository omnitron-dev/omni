/**
 * Keep-Alive Manager Tests
 *
 * Tests for the shared WebSocket keep-alive manager that reduces timer overhead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { KeepAliveManager } from '../../../src/netron/transport/websocket/keep-alive-manager.js';
import { WebSocketConnection } from '../../../src/netron/transport/websocket/connection.js';

describe('KeepAliveManager', () => {
  beforeEach(() => {
    // Reset singleton before each test
    KeepAliveManager.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    KeepAliveManager.reset();
  });

  describe('singleton pattern', () => {
    it('should return same instance for multiple getInstance calls', () => {
      const manager1 = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const manager2 = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });

      expect(manager1).toBe(manager2);
    });

    it('should reset instance with reset()', () => {
      const manager1 = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      KeepAliveManager.reset();
      const manager2 = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });

      expect(manager1).not.toBe(manager2);
    });
  });

  describe('connection registration', () => {
    it('should register and track connections', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      manager.register(connection, socket);

      expect(manager.getConnectionCount()).toBe(1);
      expect(manager.isRegistered(connection)).toBe(true);
    });

    it('should unregister connections', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      manager.register(connection, socket);
      manager.unregister(connection);

      expect(manager.getConnectionCount()).toBe(0);
      expect(manager.isRegistered(connection)).toBe(false);
    });

    it('should handle multiple connections', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const connections: WebSocketConnection[] = [];
      const sockets: WebSocket[] = [];

      // Register 10 connections
      for (let i = 0; i < 10; i++) {
        const socket = new WebSocket('ws://localhost:8080');
        const connection = new WebSocketConnection(socket, {}, true);
        sockets.push(socket);
        connections.push(connection);
        manager.register(connection, socket);
      }

      expect(manager.getConnectionCount()).toBe(10);

      // Unregister half
      for (let i = 0; i < 5; i++) {
        manager.unregister(connections[i]);
      }

      expect(manager.getConnectionCount()).toBe(5);
    });
  });

  describe('ping operations', () => {
    it('should ping all connections at interval', async () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket1 = new WebSocket('ws://localhost:8080');
      const socket2 = new WebSocket('ws://localhost:8080');
      const connection1 = new WebSocketConnection(socket1, {}, true);
      const connection2 = new WebSocketConnection(socket2, {}, true);

      const ping1 = vi.spyOn(socket1, 'ping');
      const ping2 = vi.spyOn(socket2, 'ping');

      // Mock readyState as OPEN
      Object.defineProperty(socket1, 'readyState', { value: WebSocket.OPEN, configurable: true });
      Object.defineProperty(socket2, 'readyState', { value: WebSocket.OPEN, configurable: true });

      manager.register(connection1, socket1);
      manager.register(connection2, socket2);

      // Advance time by interval
      await vi.advanceTimersByTimeAsync(30000);

      expect(ping1).toHaveBeenCalledTimes(1);
      expect(ping2).toHaveBeenCalledTimes(1);

      // Advance again
      await vi.advanceTimersByTimeAsync(30000);

      expect(ping1).toHaveBeenCalledTimes(2);
      expect(ping2).toHaveBeenCalledTimes(2);
    });

    it('should not ping connections that are not open', async () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      const ping = vi.spyOn(socket, 'ping');

      // Mock readyState as CONNECTING
      Object.defineProperty(socket, 'readyState', { value: WebSocket.CONNECTING, configurable: true });

      manager.register(connection, socket);

      // Advance time by interval
      await vi.advanceTimersByTimeAsync(30000);

      expect(ping).not.toHaveBeenCalled();
    });

    it('should terminate connection if pong not received within timeout', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      const ping = vi.spyOn(socket, 'ping').mockImplementation(() => {});
      const terminate = vi.spyOn(socket, 'terminate').mockImplementation(() => {});

      // Mock readyState as OPEN
      Object.defineProperty(socket, 'readyState', { value: WebSocket.OPEN, configurable: true });

      manager.register(connection, socket);

      // Advance time by interval (triggers ping)
      vi.advanceTimersByTime(30000);

      expect(ping).toHaveBeenCalledTimes(1);

      // Advance time by timeout (no pong received)
      vi.advanceTimersByTime(5000);

      expect(terminate).toHaveBeenCalledTimes(1);
      expect(manager.getConnectionCount()).toBe(0);
    });

    it('should not terminate connection if pong received', async () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      const terminate = vi.spyOn(socket, 'terminate');

      // Mock readyState as OPEN
      Object.defineProperty(socket, 'readyState', { value: WebSocket.OPEN, configurable: true });

      manager.register(connection, socket);

      // Advance time by interval (triggers ping)
      await vi.advanceTimersByTimeAsync(30000);

      // Simulate pong
      socket.emit('pong');

      // Advance time by timeout
      await vi.advanceTimersByTimeAsync(5000);

      expect(terminate).not.toHaveBeenCalled();
    });
  });

  describe('timer management', () => {
    it('should start timer when first connection registered', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      // Timer should not be started yet
      const timerCount1 = vi.getTimerCount();

      manager.register(connection, socket);

      // Timer should be started now
      const timerCount2 = vi.getTimerCount();

      expect(timerCount2).toBeGreaterThan(timerCount1);
    });

    it('should stop timer when last connection unregistered', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      manager.register(connection, socket);

      const timerCountBefore = vi.getTimerCount();

      manager.unregister(connection);

      const timerCountAfter = vi.getTimerCount();

      // Timer should be stopped (fewer timers)
      expect(timerCountAfter).toBeLessThan(timerCountBefore);
    });

    it('should keep timer running while connections exist', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket1 = new WebSocket('ws://localhost:8080');
      const socket2 = new WebSocket('ws://localhost:8080');
      const connection1 = new WebSocketConnection(socket1, {}, true);
      const connection2 = new WebSocketConnection(socket2, {}, true);

      manager.register(connection1, socket1);
      manager.register(connection2, socket2);

      const timerCountBefore = vi.getTimerCount();

      // Unregister one connection
      manager.unregister(connection1);

      const timerCountAfter = vi.getTimerCount();

      // Timer should still be running (same number of timers)
      expect(timerCountAfter).toBe(timerCountBefore);
    });
  });

  describe('configuration', () => {
    it('should return configuration', () => {
      const config = { interval: 45000, timeout: 8000 };
      const manager = KeepAliveManager.getInstance(config);

      const returnedConfig = manager.getConfig();

      expect(returnedConfig).toEqual(config);
    });

    it('should not allow modification of returned config', () => {
      const config = { interval: 45000, timeout: 8000 };
      const manager = KeepAliveManager.getInstance(config);

      const returnedConfig = manager.getConfig();
      (returnedConfig as any).interval = 99999;

      // Original config should be unchanged
      expect(manager.getConfig().interval).toBe(45000);
    });
  });

  describe('cleanup', () => {
    it('should clean up all resources on destroy', async () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      Object.defineProperty(socket, 'readyState', { value: WebSocket.OPEN, configurable: true });

      manager.register(connection, socket);

      // Trigger ping
      await vi.advanceTimersByTimeAsync(30000);

      const timerCountBefore = vi.getTimerCount();

      manager.destroy();

      const timerCountAfter = vi.getTimerCount();

      expect(manager.getConnectionCount()).toBe(0);
      expect(timerCountAfter).toBeLessThan(timerCountBefore);
    });

    it('should remove pong listeners on unregister', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      manager.register(connection, socket);

      const listenerCountBefore = socket.listenerCount('pong');

      manager.unregister(connection);

      const listenerCountAfter = socket.listenerCount('pong');

      expect(listenerCountAfter).toBeLessThan(listenerCountBefore);
    });
  });

  describe('edge cases', () => {
    it('should handle unregistering non-registered connection', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      // Should not throw
      expect(() => manager.unregister(connection)).not.toThrow();
    });

    it('should handle ping errors gracefully', async () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      // Mock ping to throw error
      vi.spyOn(socket, 'ping').mockImplementation(() => {
        throw new Error('Ping failed');
      });

      Object.defineProperty(socket, 'readyState', { value: WebSocket.OPEN, configurable: true });

      manager.register(connection, socket);

      // Should not throw when ping fails
      await expect(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      }).resolves.not.toThrow();
    });

    it('should handle terminate errors gracefully', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      // Mock ping to succeed
      vi.spyOn(socket, 'ping').mockImplementation(() => {});

      // Mock terminate to throw error
      vi.spyOn(socket, 'terminate').mockImplementation(() => {
        throw new Error('Terminate failed');
      });

      Object.defineProperty(socket, 'readyState', { value: WebSocket.OPEN, configurable: true });

      manager.register(connection, socket);

      // Advance time to trigger ping and timeout
      vi.advanceTimersByTime(30000);
      vi.advanceTimersByTime(5000);

      // Should not throw even if terminate fails
      expect(manager.getConnectionCount()).toBe(0);
    });

    it('should handle multiple pongs for same connection', async () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const socket = new WebSocket('ws://localhost:8080');
      const connection = new WebSocketConnection(socket, {}, true);

      const terminate = vi.spyOn(socket, 'terminate');

      Object.defineProperty(socket, 'readyState', { value: WebSocket.OPEN, configurable: true });

      manager.register(connection, socket);

      // Advance time by interval (triggers ping)
      await vi.advanceTimersByTimeAsync(30000);

      // Simulate multiple pongs (should not error)
      socket.emit('pong');
      socket.emit('pong');
      socket.emit('pong');

      // Advance time by timeout
      await vi.advanceTimersByTimeAsync(5000);

      expect(terminate).not.toHaveBeenCalled();
    });
  });

  describe('performance characteristics', () => {
    it('should use single timer for many connections', () => {
      const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
      const connections: WebSocketConnection[] = [];

      const timerCountBefore = vi.getTimerCount();

      // Register 100 connections
      for (let i = 0; i < 100; i++) {
        const socket = new WebSocket('ws://localhost:8080');
        const connection = new WebSocketConnection(socket, {}, true);
        connections.push(connection);
        manager.register(connection, socket);
      }

      const timerCountAfter = vi.getTimerCount();

      // Should only add 1 timer for the shared interval
      // (not 100 individual timers)
      expect(timerCountAfter - timerCountBefore).toBeLessThan(10);
    });
  });
});
