/**
 * Transport Adapter Tests
 *
 * Tests the transport adapter that bridges different transport implementations
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TransportAdapter } from '../../../src/netron/transport/transport-adapter.js';
import { TransportRegistry } from '../../../src/netron/transport/transport-registry.js';
import { TcpTransport } from '../../../src/netron/transport/tcp-transport.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket-transport.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { promisify } from 'node:util';
import type { ITransportConnection, ITransportServer } from '../../../src/netron/transport/types.js';

// Helper to find free port
async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });
  });
}

// Helper to wait for event
function waitForEvent<T = any>(emitter: EventEmitter, event: string, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    emitter.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('TransportAdapter', () => {
  let adapter: TransportAdapter;
  let registry: TransportRegistry;
  let testPort: number;

  beforeEach(async () => {
    registry = TransportRegistry.createWithDefaults();
    adapter = new TransportAdapter(registry);
    testPort = await getFreePort();
  });

  describe('Basic Functionality', () => {
    it('should create adapter with registry', () => {
      expect(adapter).toBeDefined();
      expect((adapter as any).registry).toBe(registry);
    });

    it('should create adapter with default registry', () => {
      const defaultAdapter = new TransportAdapter();
      expect(defaultAdapter).toBeDefined();
      expect((defaultAdapter as any).registry).toBeDefined();
    });

    it('should get available transports', () => {
      const transports = adapter.getAvailableTransports();
      expect(transports).toContain('tcp');
      expect(transports).toContain('websocket');
      expect(transports).toContain('ws');
      expect(transports).toContain('unix');
    });
  });

  describe('Connection Creation', () => {
    let tcpServer: ITransportServer;
    let wsServer: WebSocketServer;
    let httpServer: any;

    beforeEach(async () => {
      // Set up TCP server with specific port
      const tcpTransport = new TcpTransport();
      tcpServer = await tcpTransport.createServer!({
        port: testPort,
        host: '127.0.0.1'
      } as any);

      // Set up WebSocket server
      const wsPort = await getFreePort();
      httpServer = createServer();
      await promisify(httpServer.listen).bind(httpServer)(wsPort);
      wsServer = new WebSocketServer({ server: httpServer });
    });

    afterEach(async () => {
      await tcpServer?.close();
      wsServer?.close();
      if (httpServer) {
        await promisify(httpServer.close).bind(httpServer)();
      }
    });

    it('should connect to TCP server', async () => {
      const connection = await adapter.connect(`tcp://127.0.0.1:${testPort}`);

      expect(connection).toBeDefined();
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      await connection.close();
    });

    it('should connect to WebSocket server', async () => {
      const wsPort = (httpServer.address() as any).port;
      const connection = await adapter.connect(`ws://127.0.0.1:${wsPort}`);

      expect(connection).toBeDefined();
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      await connection.close();
    });

    it('should auto-detect protocol from address', async () => {
      const tcpConnection = await adapter.connect(`tcp://127.0.0.1:${testPort}`);
      expect(tcpConnection).toBeDefined();
      await tcpConnection.close();

      const wsPort = (httpServer.address() as any).port;
      const wsConnection = await adapter.connect(`ws://127.0.0.1:${wsPort}`);
      expect(wsConnection).toBeDefined();
      await wsConnection.close();
    });

    it('should throw error for unsupported protocol', async () => {
      await expect(adapter.connect('unknown://localhost:8080'))
        .rejects.toThrow('No transport found for protocol: unknown');
    });

    it('should pass options to transport', async () => {
      const connection = await adapter.connect(`tcp://127.0.0.1:${testPort}`, {
        connectTimeout: 5000,
        keepAlive: {
          enabled: true,
          interval: 1000
        }
      });

      expect(connection.state).toBe(ConnectionState.CONNECTED);
      await connection.close();
    });
  });

  describe('Server Creation', () => {
    it('should create TCP server', async () => {
      const tcpPort = await getFreePort();
      const server = await adapter.createServer('tcp', {
        port: tcpPort,
        host: '127.0.0.1'
      });

      expect(server).toBeDefined();

      // Should be able to connect to it
      const connection = await adapter.connect(`tcp://127.0.0.1:${tcpPort}`);
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      await connection.close();
      await server.close();
    });

    it('should create WebSocket server', async () => {
      const wsPort = await getFreePort();
      const server = await adapter.createServer('websocket', {
        port: wsPort,
        host: '127.0.0.1'
      });

      expect(server).toBeDefined();

      // Should be able to connect to it
      const connection = await adapter.connect(`ws://127.0.0.1:${wsPort}`);
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      await connection.close();
      await server.close();
    });

    it('should handle server creation for non-existent transport', async () => {
      await expect(adapter.createServer('nonexistent', {}))
        .rejects.toThrow('Transport not found: nonexistent');
    });

    it('should handle server creation for transport without server support', async () => {
      // Create a mock transport without server support
      class NoServerTransport {
        name = 'noserver';
        capabilities = { server: false };
        connect() { return Promise.resolve({} as any); }
        isValidAddress() { return false; }
        parseAddress() { return {} as any; }
      }

      registry.register('noserver', () => new NoServerTransport() as any);

      await expect(adapter.createServer('noserver', {}))
        .rejects.toThrow('does not support server mode');
    });
  });

  describe('Protocol Detection', () => {
    it('should detect TCP protocol', () => {
      const protocol = adapter.detectProtocol('tcp://localhost:8080');
      expect(protocol).toBe('tcp');
    });

    it('should detect WebSocket protocol', () => {
      expect(adapter.detectProtocol('ws://localhost:8080')).toBe('ws');
      expect(adapter.detectProtocol('wss://example.com')).toBe('wss');
    });

    it('should detect Unix socket protocol', () => {
      const protocol = adapter.detectProtocol('unix:///tmp/test.sock');
      expect(protocol).toBe('unix');
    });

    it('should return null for invalid addresses', () => {
      expect(adapter.detectProtocol('invalid')).toBeNull();
      expect(adapter.detectProtocol('')).toBeNull();
      expect(adapter.detectProtocol('http://example.com')).toBeNull();
    });

    it('should handle malformed URLs', () => {
      expect(adapter.detectProtocol('://')).toBeNull();
      expect(adapter.detectProtocol('tcp:')).toBeNull();
      expect(adapter.detectProtocol('ws://')).toBeNull();
    });
  });

  describe('Transport Validation', () => {
    it('should validate address for correct transport', () => {
      expect(adapter.isValidAddress('tcp://localhost:8080')).toBe(true);
      expect(adapter.isValidAddress('ws://localhost:8080')).toBe(true);
      expect(adapter.isValidAddress('wss://example.com')).toBe(true);
      expect(adapter.isValidAddress('unix:///tmp/test.sock')).toBe(true);
    });

    it('should reject invalid addresses', () => {
      expect(adapter.isValidAddress('invalid://address')).toBe(false);
      expect(adapter.isValidAddress('http://example.com')).toBe(false);
      expect(adapter.isValidAddress('')).toBe(false);
    });

    it('should parse valid addresses', () => {
      const tcpAddr = adapter.parseAddress('tcp://localhost:8080');
      expect(tcpAddr).toEqual({
        protocol: 'tcp',
        host: 'localhost',
        port: 8080,
        params: {}
      });

      const wsAddr = adapter.parseAddress('ws://example.com:3000/path');
      expect(wsAddr).toEqual({
        protocol: 'ws',
        host: 'example.com',
        port: 3000,
        path: '/path',
        params: {}
      });
    });

    it('should throw for unparseable addresses', () => {
      expect(() => adapter.parseAddress('invalid://address')).toThrow();
      expect(() => adapter.parseAddress('')).toThrow();
    });
  });

  describe('Multi-Transport Communication', () => {
    it('should handle mixed transport types', async () => {
      // Create TCP server
      const tcpPort = await getFreePort();
      const tcpTransport = new TcpTransport();
      const tcpServer = await tcpTransport.createServer!({
        port: tcpPort,
        host: '127.0.0.1'
      } as any);

      // Create WebSocket server
      const wsPort = await getFreePort();
      const httpServer = createServer();
      await promisify(httpServer.listen).bind(httpServer)(wsPort);
      const wsServer = new WebSocketServer({ server: httpServer });

      // Connect to both
      const tcpConnection = await adapter.connect(`tcp://127.0.0.1:${tcpPort}`);
      const wsConnection = await adapter.connect(`ws://127.0.0.1:${wsPort}`);

      expect(tcpConnection.state).toBe(ConnectionState.CONNECTED);
      expect(wsConnection.state).toBe(ConnectionState.CONNECTED);

      // Send data through both
      const tcpData = Buffer.from('TCP data');
      const wsData = Buffer.from('WS data');

      await tcpConnection.send(tcpData);
      await wsConnection.send(wsData);

      // Clean up
      await tcpConnection.close();
      await wsConnection.close();
      await tcpServer.close();
      wsServer.close();
      await promisify(httpServer.close).bind(httpServer)();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection failures gracefully', async () => {
      const fakePort = await getFreePort();

      try {
        await adapter.connect(`tcp://127.0.0.1:${fakePort}`, {
          connectTimeout: 500
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toMatch(/ECONNREFUSED|Connection failed/);
      }
    });

    it('should handle registry without transport', async () => {
      const emptyRegistry = new TransportRegistry(false); // No defaults
      const emptyAdapter = new TransportAdapter(emptyRegistry);

      await expect(emptyAdapter.connect('tcp://localhost:8080'))
        .rejects.toThrow('No transport found for protocol: tcp');
    });

    it('should handle transport registration dynamically', async () => {
      const dynamicRegistry = new TransportRegistry(false); // No defaults
      const dynamicAdapter = new TransportAdapter(dynamicRegistry);

      // Initially no TCP transport
      await expect(dynamicAdapter.connect('tcp://localhost:8080'))
        .rejects.toThrow('No transport found');

      // Register TCP transport
      dynamicRegistry.register('tcp', () => new TcpTransport());

      // Now it should work (will fail to connect but transport is found)
      try {
        await dynamicAdapter.connect('tcp://localhost:8080', {
          connectTimeout: 100
        });
      } catch (error: any) {
        // Connection will fail but transport should be found
        expect(error.message).not.toContain('No transport found');
      }
    });
  });

  describe('Transport Capabilities', () => {
    it('should check transport capabilities', () => {
      const tcpCapabilities = adapter.getTransportCapabilities('tcp');
      expect(tcpCapabilities).toEqual({
        streaming: true,
        bidirectional: true,
        binary: true,
        reconnection: true,
        multiplexing: false,
        server: true
      });

      const wsCapabilities = adapter.getTransportCapabilities('websocket');
      expect(wsCapabilities).toEqual({
        streaming: true,
        bidirectional: true,
        binary: true,
        reconnection: false, // WebSockets don't support reconnection natively
        multiplexing: false,
        server: true
      });
    });

    it('should return null for non-existent transport', () => {
      const capabilities = adapter.getTransportCapabilities('nonexistent');
      expect(capabilities).toBeNull();
    });
  });

  describe('Connection Management', () => {
    it('should track active connections', async () => {
      const tcpPort = await getFreePort();
      const tcpTransport = new TcpTransport();
      const tcpServer = await tcpTransport.createServer!({
        port: tcpPort,
        host: '127.0.0.1'
      } as any);

      const connections: ITransportConnection[] = [];

      // Create multiple connections
      for (let i = 0; i < 3; i++) {
        const conn = await adapter.connect(`tcp://127.0.0.1:${tcpPort}`);
        connections.push(conn);
      }

      // All should be connected
      connections.forEach(conn => {
        expect(conn.state).toBe(ConnectionState.CONNECTED);
      });

      // Close all connections
      await Promise.all(connections.map(conn => conn.close()));

      // All should be disconnected
      connections.forEach(conn => {
        expect(conn.state).toBe(ConnectionState.DISCONNECTED);
      });

      await tcpServer.close();
    });
  });

  describe('Custom Transport Registration', () => {
    it('should work with custom transport', async () => {
      // Create custom transport
      class CustomTransport {
        readonly name = 'custom';
        readonly capabilities = {
          streaming: true,
          bidirectional: true,
          binary: true,
          reconnection: false,
          multiplexing: false,
          server: true
        };

        async connect(address: string) {
          const connection = new CustomConnection();
          await connection.doConnect();
          return connection;
        }

        async createServer() {
          return new CustomServer();
        }

        isValidAddress(address: string) {
          return address.startsWith('custom://');
        }

        parseAddress(address: string) {
          return {
            protocol: 'custom',
            host: 'localhost',
            port: 9999,
            params: {}
          };
        }
      }

      class CustomConnection extends EventEmitter {
        readonly id = 'custom-conn';
        readonly state = ConnectionState.CONNECTED;

        async doConnect() {
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        async send() { }
        async sendPacket() { }
        async close() { }
        getMetrics() {
          return {
            bytesSent: 0,
            bytesReceived: 0,
            packetsSent: 0,
            packetsReceived: 0,
            duration: 0
          };
        }
      }

      class CustomServer extends EventEmitter {
        readonly connections = new Map();
        async listen() { }
        async close() { }
        async broadcast() { }
      }

      // Register custom transport
      registry.register('custom', () => new CustomTransport() as any);

      // Should be able to use it
      const connection = await adapter.connect('custom://test');
      expect(connection).toBeDefined();
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      await connection.close();
    });
  });

  describe('Address Resolution', () => {
    it('should resolve complex addresses', () => {
      const addresses = [
        'tcp://192.168.1.1:8080',
        'tcp://[::1]:8080',
        'ws://example.com/socket',
        'wss://secure.example.com:443/path',
        'unix:///var/run/app.sock'
      ];

      addresses.forEach(addr => {
        const isValid = adapter.isValidAddress(addr);
        expect(isValid).toBe(true);

        if (isValid) {
          const parsed = adapter.parseAddress(addr);
          expect(parsed.protocol).toBeDefined();
        }
      });
    });

    it('should handle IPv6 addresses', () => {
      const ipv6Addr = 'tcp://[2001:db8::1]:8080';
      expect(adapter.isValidAddress(ipv6Addr)).toBe(true);

      const parsed = adapter.parseAddress(ipv6Addr);
      expect(parsed.protocol).toBe('tcp');
      expect(parsed.host).toBe('[2001:db8::1]');
      expect(parsed.port).toBe(8080);
    });
  });
});