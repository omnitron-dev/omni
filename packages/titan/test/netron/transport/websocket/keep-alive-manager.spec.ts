/**
 * Keep-Alive Manager Tests
 *
 * Tests for the shared WebSocket keep-alive manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer, Server } from 'node:http';
import { promisify } from 'node:util';
import { KeepAliveManager } from '../../../../src/netron/transport/websocket/keep-alive-manager.js';
import { WebSocketConnection } from '../../../../src/netron/transport/websocket/connection.js';
import { getFreeHttpPort as getFreePort, delay } from '../../../utils/index.js';

describe('KeepAliveManager', () => {
  let httpServer: Server;
  let wsServer: WebSocketServer;
  let testPort: number;

  beforeEach(async () => {
    // Reset the singleton before each test
    KeepAliveManager.reset();

    testPort = await getFreePort();
    httpServer = createServer();
    await promisify(httpServer.listen).bind(httpServer)(testPort);
    wsServer = new WebSocketServer({ server: httpServer });
  });

  afterEach(async () => {
    // Reset the singleton after each test
    KeepAliveManager.reset();

    // Clean up WebSocket server
    wsServer.clients.forEach((client) => client.close());
    wsServer.close();

    // Clean up HTTP server
    await promisify(httpServer.close).bind(httpServer)();

    await delay(50);
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const config = { interval: 30000, timeout: 5000 };
      const instance1 = KeepAliveManager.getInstance(config);
      const instance2 = KeepAliveManager.getInstance(config);

      expect(instance1).toBe(instance2);
    });

    it('should reset instance correctly', () => {
      const config = { interval: 30000, timeout: 5000 };
      const instance1 = KeepAliveManager.getInstance(config);

      KeepAliveManager.reset();

      const instance2 = KeepAliveManager.getInstance(config);

      // After reset, should get a new instance
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Connection Registration', () => {
    it('should register a connection', async () => {
      const config = { interval: 30000, timeout: 5000 };
      const manager = KeepAliveManager.getInstance(config);

      // Create WebSocket connection
      const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      await new Promise((resolve) => clientWs.on('open', resolve));

      const connection = new WebSocketConnection(clientWs, {}, false);

      manager.register(connection, clientWs);

      expect(manager.getConnectionCount()).toBe(1);
      expect(manager.isRegistered(connection)).toBe(true);

      clientWs.close();
    });

    it('should unregister a connection', async () => {
      const config = { interval: 30000, timeout: 5000 };
      const manager = KeepAliveManager.getInstance(config);

      const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      await new Promise((resolve) => clientWs.on('open', resolve));

      const connection = new WebSocketConnection(clientWs, {}, false);

      manager.register(connection, clientWs);
      expect(manager.getConnectionCount()).toBe(1);

      manager.unregister(connection);
      expect(manager.getConnectionCount()).toBe(0);
      expect(manager.isRegistered(connection)).toBe(false);

      clientWs.close();
    });

    it('should handle unregistering non-existent connection gracefully', () => {
      const config = { interval: 30000, timeout: 5000 };
      const manager = KeepAliveManager.getInstance(config);

      // Create a mock connection
      const mockConnection = { id: 'non-existent' } as WebSocketConnection;

      // Should not throw
      expect(() => manager.unregister(mockConnection)).not.toThrow();
    });

    it('should manage multiple connections', async () => {
      const config = { interval: 30000, timeout: 5000 };
      const manager = KeepAliveManager.getInstance(config);

      const clientWs1 = new WebSocket(`ws://127.0.0.1:${testPort}`);
      const clientWs2 = new WebSocket(`ws://127.0.0.1:${testPort}`);
      const clientWs3 = new WebSocket(`ws://127.0.0.1:${testPort}`);

      await Promise.all([
        new Promise((resolve) => clientWs1.on('open', resolve)),
        new Promise((resolve) => clientWs2.on('open', resolve)),
        new Promise((resolve) => clientWs3.on('open', resolve)),
      ]);

      const conn1 = new WebSocketConnection(clientWs1, {}, false);
      const conn2 = new WebSocketConnection(clientWs2, {}, false);
      const conn3 = new WebSocketConnection(clientWs3, {}, false);

      manager.register(conn1, clientWs1);
      manager.register(conn2, clientWs2);
      manager.register(conn3, clientWs3);

      expect(manager.getConnectionCount()).toBe(3);

      manager.unregister(conn2);
      expect(manager.getConnectionCount()).toBe(2);
      expect(manager.isRegistered(conn1)).toBe(true);
      expect(manager.isRegistered(conn2)).toBe(false);
      expect(manager.isRegistered(conn3)).toBe(true);

      clientWs1.close();
      clientWs2.close();
      clientWs3.close();
    });
  });

  describe('Configuration', () => {
    it('should return correct configuration', () => {
      const config = { interval: 30000, timeout: 5000 };
      const manager = KeepAliveManager.getInstance(config);

      const storedConfig = manager.getConfig();

      expect(storedConfig.interval).toBe(30000);
      expect(storedConfig.timeout).toBe(5000);
    });

    it('should return immutable configuration', () => {
      const config = { interval: 30000, timeout: 5000 };
      const manager = KeepAliveManager.getInstance(config);

      const storedConfig = manager.getConfig();
      (storedConfig as any).interval = 99999;

      // Original should not be modified
      expect(manager.getConfig().interval).toBe(30000);
    });
  });

  describe('Timer Management', () => {
    it('should start timer on first connection', async () => {
      const config = { interval: 100, timeout: 50 }; // Short intervals for testing
      const manager = KeepAliveManager.getInstance(config);

      // Initially no timer
      expect((manager as any).timer).toBeUndefined();

      const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      await new Promise((resolve) => clientWs.on('open', resolve));

      const connection = new WebSocketConnection(clientWs, {}, false);
      manager.register(connection, clientWs);

      // Timer should be started
      expect((manager as any).timer).toBeDefined();

      clientWs.close();
    });

    it('should stop timer when last connection is unregistered', async () => {
      const config = { interval: 100, timeout: 50 };
      const manager = KeepAliveManager.getInstance(config);

      const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      await new Promise((resolve) => clientWs.on('open', resolve));

      const connection = new WebSocketConnection(clientWs, {}, false);
      manager.register(connection, clientWs);

      expect((manager as any).timer).toBeDefined();

      manager.unregister(connection);

      expect((manager as any).timer).toBeUndefined();

      clientWs.close();
    });

    it('should keep timer running with multiple connections', async () => {
      const config = { interval: 100, timeout: 50 };
      const manager = KeepAliveManager.getInstance(config);

      const clientWs1 = new WebSocket(`ws://127.0.0.1:${testPort}`);
      const clientWs2 = new WebSocket(`ws://127.0.0.1:${testPort}`);

      await Promise.all([
        new Promise((resolve) => clientWs1.on('open', resolve)),
        new Promise((resolve) => clientWs2.on('open', resolve)),
      ]);

      const conn1 = new WebSocketConnection(clientWs1, {}, false);
      const conn2 = new WebSocketConnection(clientWs2, {}, false);

      manager.register(conn1, clientWs1);
      manager.register(conn2, clientWs2);

      // Unregister one
      manager.unregister(conn1);

      // Timer should still be running
      expect((manager as any).timer).toBeDefined();

      clientWs1.close();
      clientWs2.close();
    });
  });

  describe('Ping/Pong Behavior', () => {
    it('should send ping to registered connections', async () => {
      const config = { interval: 100, timeout: 1000 };
      const manager = KeepAliveManager.getInstance(config);

      let pingReceived = false;

      // Set up server-side connection
      const serverWsPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => resolve(ws));
      });

      const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      await new Promise((resolve) => clientWs.on('open', resolve));
      const serverWs = await serverWsPromise;

      // Listen for ping on the CLIENT side - server sends ping, client receives it
      clientWs.on('ping', () => {
        pingReceived = true;
      });

      // Register the server socket (server sends pings to client)
      const connection = new WebSocketConnection(serverWs, {}, true);
      manager.register(connection, serverWs);

      // Wait for ping interval
      await delay(150);

      expect(pingReceived).toBe(true);

      clientWs.close();
      serverWs.close();
    });

    it('should clear pong timeout when pong is received', async () => {
      const config = { interval: 100, timeout: 1000 };
      const manager = KeepAliveManager.getInstance(config);

      const serverWsPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => resolve(ws));
      });

      const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      await new Promise((resolve) => clientWs.on('open', resolve));
      const serverWs = await serverWsPromise;

      const connection = new WebSocketConnection(serverWs, {}, true);
      manager.register(connection, serverWs);

      // Wait for ping interval
      await delay(150);

      // The pong should have been received and timeout cleared
      // Connection should still be registered
      expect(manager.isRegistered(connection)).toBe(true);
      expect(serverWs.readyState).toBe(WebSocket.OPEN);

      clientWs.close();
      serverWs.close();
    });

    it('should skip closed connections when pinging', async () => {
      const config = { interval: 100, timeout: 1000 };
      const manager = KeepAliveManager.getInstance(config);

      const serverWsPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => resolve(ws));
      });

      const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      await new Promise((resolve) => clientWs.on('open', resolve));
      const serverWs = await serverWsPromise;

      const connection = new WebSocketConnection(serverWs, {}, true);
      manager.register(connection, serverWs);

      // Close the socket before the ping
      serverWs.close();
      await delay(50);

      // Should not throw when trying to ping closed socket
      await delay(150); // Wait for ping interval

      clientWs.close();
    });
  });

  describe('Destroy', () => {
    it('should clean up all resources on destroy', async () => {
      const config = { interval: 100, timeout: 50 };
      const manager = KeepAliveManager.getInstance(config);

      const clientWs1 = new WebSocket(`ws://127.0.0.1:${testPort}`);
      const clientWs2 = new WebSocket(`ws://127.0.0.1:${testPort}`);

      await Promise.all([
        new Promise((resolve) => clientWs1.on('open', resolve)),
        new Promise((resolve) => clientWs2.on('open', resolve)),
      ]);

      const conn1 = new WebSocketConnection(clientWs1, {}, false);
      const conn2 = new WebSocketConnection(clientWs2, {}, false);

      manager.register(conn1, clientWs1);
      manager.register(conn2, clientWs2);

      expect(manager.getConnectionCount()).toBe(2);

      manager.destroy();

      expect(manager.getConnectionCount()).toBe(0);
      expect((manager as any).timer).toBeUndefined();

      clientWs1.close();
      clientWs2.close();
    });
  });

  describe('Pong Timeout', () => {
    it('should remove connection from registry after timeout when pong is not received', async () => {
      const config = { interval: 100, timeout: 50 }; // Very short timeout
      const manager = KeepAliveManager.getInstance(config);

      // Create a mock socket that will trigger timeout
      // by not responding to ping automatically
      const mockSocket = {
        readyState: WebSocket.OPEN,
        ping: vi.fn(),
        on: vi.fn(),
        terminate: vi.fn(),
        removeListener: vi.fn(),
      } as unknown as WebSocket;

      // Create mock connection
      const mockConnection = {
        id: 'test-connection-timeout',
      } as WebSocketConnection;

      manager.register(mockConnection, mockSocket);
      expect(manager.getConnectionCount()).toBe(1);

      // Wait for ping interval + timeout + buffer
      await delay(200);

      // The mock socket was pinged
      expect(mockSocket.ping).toHaveBeenCalled();

      // The socket should have been terminated due to timeout
      expect(mockSocket.terminate).toHaveBeenCalled();

      // Connection should be removed from registry
      expect(manager.isRegistered(mockConnection)).toBe(false);
    });

    it('should not terminate connection if pong is received in time', async () => {
      const config = { interval: 100, timeout: 1000 };
      const manager = KeepAliveManager.getInstance(config);

      const serverWsPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => resolve(ws));
      });

      const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      await new Promise((resolve) => clientWs.on('open', resolve));
      const serverWs = await serverWsPromise;

      const connection = new WebSocketConnection(serverWs, {}, true);
      manager.register(connection, serverWs);

      // Wait for a couple of ping cycles
      await delay(250);

      // Connection should still be registered (pong was received)
      expect(manager.isRegistered(connection)).toBe(true);
      expect(serverWs.readyState).toBe(WebSocket.OPEN);

      clientWs.close();
      serverWs.close();
    });
  });
});
