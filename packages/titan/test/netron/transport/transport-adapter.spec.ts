/**
 * Transport Adapter Tests
 *
 * Tests the transport adapter that bridges different transport implementations
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { TransportAdapter, BinaryTransportAdapter, TransportConnectionFactory } from '../../../src/netron/transport/transport-adapter.js';
import { TransportRegistry } from '../../../src/netron/transport/transport-registry.js';
import { TcpTransport } from '../../../src/netron/transport/tcp-transport.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { promisify } from 'node:util';
import type { ITransportConnection, ITransportServer } from '../../../src/netron/transport/types.js';
import { getFreeHttpPort as getFreePort, waitForEvent, delay } from '../../utils/index.js';
import { Packet } from '../../../src/netron/packet/index.js';

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
        .rejects.toThrow('Transport with id unknown not found');
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
        .rejects.toThrow('Transport with id nonexistent not found');
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
        .rejects.toThrow('Transport noserver server mode is not implemented');
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
        .rejects.toThrow('Transport with id tcp not found');
    });

    it('should handle transport registration dynamically', async () => {
      const dynamicRegistry = new TransportRegistry(false); // No defaults
      const dynamicAdapter = new TransportAdapter(dynamicRegistry);

      // Initially no TCP transport
      await expect(dynamicAdapter.connect('tcp://localhost:8080'))
        .rejects.toThrow('Transport with id tcp not found');

      // Register TCP transport
      dynamicRegistry.register('tcp', () => new TcpTransport());

      // Now it should work (will fail to connect but transport is found)
      try {
        await dynamicAdapter.connect('tcp://localhost:8080', {
          connectTimeout: 100
        });
      } catch (error: any) {
        // Connection will fail but transport should be found
        expect(error.message).not.toContain('Transport with id tcp not found');
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

describe('BinaryTransportAdapter', () => {
  let mockConnection: ITransportConnection & EventEmitter;
  let adapter: BinaryTransportAdapter;

  beforeEach(() => {
    // Create mock connection
    mockConnection = new EventEmitter() as any;
    mockConnection.state = ConnectionState.CONNECTING;
    mockConnection.id = 'test-connection';
    mockConnection.remoteAddress = '127.0.0.1:8080';
    mockConnection.localAddress = '127.0.0.1:12345';
    mockConnection.send = jest.fn().mockResolvedValue(undefined);
    mockConnection.sendPacket = jest.fn().mockResolvedValue(undefined);
    mockConnection.close = jest.fn().mockResolvedValue(undefined);
    mockConnection.ping = jest.fn().mockResolvedValue(10);

    adapter = new BinaryTransportAdapter(mockConnection, 'tcp://127.0.0.1:8080');
  });

  describe('State Management', () => {
    it('should map CONNECTING state', () => {
      mockConnection.state = ConnectionState.CONNECTING;
      expect(adapter.readyState).toBe(0); // BinaryTransportAdapter.CONNECTING
    });

    it('should map CONNECTED state', () => {
      mockConnection.state = ConnectionState.CONNECTED;
      expect(adapter.readyState).toBe(1); // BinaryTransportAdapter.OPEN
    });

    it('should map DISCONNECTING state', () => {
      mockConnection.state = ConnectionState.DISCONNECTING;
      expect(adapter.readyState).toBe(2); // BinaryTransportAdapter.CLOSING
    });

    it('should map DISCONNECTED state', () => {
      mockConnection.state = ConnectionState.DISCONNECTED;
      expect(adapter.readyState).toBe(3); // BinaryTransportAdapter.CLOSED
    });

    it('should map ERROR state to CLOSED', () => {
      mockConnection.state = ConnectionState.ERROR;
      expect(adapter.readyState).toBe(3); // BinaryTransportAdapter.CLOSED
    });

    it('should handle unknown state as CLOSED', () => {
      mockConnection.state = 999 as any;
      expect(adapter.readyState).toBe(3); // BinaryTransportAdapter.CLOSED
    });
  });

  describe('Binary Type Handling', () => {
    it('should have default binaryType as nodebuffer', () => {
      expect(adapter.binaryType).toBe('nodebuffer');
    });

    it('should allow setting binaryType to arraybuffer', () => {
      adapter.binaryType = 'arraybuffer';
      expect(adapter.binaryType).toBe('arraybuffer');
    });

    it('should throw error for invalid binaryType', () => {
      expect(() => {
        adapter.binaryType = 'invalid';
      }).toThrow('Invalid binary type');
    });

    it('should convert packet data to ArrayBuffer when binaryType is arraybuffer', () => {
      adapter.binaryType = 'arraybuffer';

      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      // Emit packet event - use proper Packet class
      const packet = new Packet(1, 123, Buffer.from('test'));
      mockConnection.emit('packet', packet);

      // Message should be ArrayBuffer
      expect(messageHandler).toHaveBeenCalled();
      const receivedData = messageHandler.mock.calls[0][0];
      expect(receivedData instanceof ArrayBuffer).toBe(true);
    });

    it('should keep data as Buffer when binaryType is nodebuffer', () => {
      adapter.binaryType = 'nodebuffer';

      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      // Emit data event
      const data = Buffer.from('test data');
      mockConnection.emit('data', data);

      // Message should be Buffer
      expect(messageHandler).toHaveBeenCalled();
      const receivedData = messageHandler.mock.calls[0][0];
      expect(Buffer.isBuffer(receivedData)).toBe(true);
    });

    it('should convert data to ArrayBuffer when binaryType is arraybuffer and data is Buffer', () => {
      adapter.binaryType = 'arraybuffer';

      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      // Emit data event with Buffer
      const data = Buffer.from('test data');
      mockConnection.emit('data', data);

      // Message should be ArrayBuffer
      expect(messageHandler).toHaveBeenCalled();
      const receivedData = messageHandler.mock.calls[0][0];
      expect(receivedData instanceof ArrayBuffer).toBe(true);
    });
  });

  describe('Data Conversion in send()', () => {
    it('should send Buffer data directly', async () => {
      const buffer = Buffer.from('test');
      const callback = jest.fn();

      adapter.send(buffer, callback);

      await delay(10);
      expect(mockConnection.send).toHaveBeenCalledWith(buffer);
      expect(callback).toHaveBeenCalledWith();
    });

    it('should convert ArrayBuffer to Buffer', async () => {
      const arrayBuffer = new ArrayBuffer(4);
      const view = new Uint8Array(arrayBuffer);
      view.set([1, 2, 3, 4]);

      const callback = jest.fn();
      adapter.send(arrayBuffer, callback);

      await delay(10);
      expect(mockConnection.send).toHaveBeenCalled();
      const sentBuffer = (mockConnection.send as jest.Mock).mock.calls[0][0];
      expect(Buffer.isBuffer(sentBuffer)).toBe(true);
      expect(callback).toHaveBeenCalledWith();
    });

    it('should convert Uint8Array to Buffer', async () => {
      const uint8Array = new Uint8Array([1, 2, 3, 4]);
      const callback = jest.fn();

      adapter.send(uint8Array, callback);

      await delay(10);
      expect(mockConnection.send).toHaveBeenCalled();
      const sentBuffer = (mockConnection.send as jest.Mock).mock.calls[0][0];
      expect(Buffer.isBuffer(sentBuffer)).toBe(true);
      expect(callback).toHaveBeenCalledWith();
    });

    it('should convert string to Buffer', async () => {
      const str = 'test string';
      const callback = jest.fn();

      adapter.send(str, callback);

      await delay(10);
      expect(mockConnection.send).toHaveBeenCalled();
      const sentBuffer = (mockConnection.send as jest.Mock).mock.calls[0][0];
      expect(Buffer.isBuffer(sentBuffer)).toBe(true);
      expect(sentBuffer.toString()).toBe(str);
      expect(callback).toHaveBeenCalledWith();
    });

    it('should call callback with error for invalid data type', () => {
      const callback = jest.fn();
      const invalidData = { invalid: 'data' };

      adapter.send(invalidData, callback);

      expect(callback).toHaveBeenCalled();
      const error = callback.mock.calls[0][0];
      expect(error).toBeDefined();
      expect(error.message).toContain('Invalid data type');
    });

    it('should throw error for invalid data type when no callback provided', () => {
      const invalidData = { invalid: 'data' };

      expect(() => {
        adapter.send(invalidData);
      }).toThrow('Invalid data type');
    });

    it('should handle send error with callback', async () => {
      const error = new Error('Send failed');
      (mockConnection.send as jest.Mock).mockRejectedValue(error);

      const callback = jest.fn();
      adapter.send(Buffer.from('test'), callback);

      await delay(10);
      expect(callback).toHaveBeenCalledWith(error);
    });

    it('should log error when send fails without callback', async () => {
      const error = new Error('Send failed');
      (mockConnection.send as jest.Mock).mockRejectedValue(error);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      adapter.send(Buffer.from('test'));

      await delay(10);
      expect(consoleErrorSpy).toHaveBeenCalledWith('BinaryTransportAdapter send error:', error);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Socket Properties', () => {
    it('should expose _socket property with address parsing', () => {
      const socket = adapter._socket;
      expect(socket).toBeDefined();
      expect(socket.remoteAddress).toBe('127.0.0.1');
      expect(socket.remotePort).toBe('8080');
      expect(socket.localAddress).toBe('127.0.0.1');
      expect(socket.localPort).toBe('12345');
    });

    it('should handle missing remote address', () => {
      mockConnection.remoteAddress = undefined;
      const socket = adapter._socket;
      expect(socket.remoteAddress).toBeUndefined();
      expect(socket.remotePort).toBeUndefined();
    });

    it('should expose url property', () => {
      expect(adapter.url).toBe('tcp://127.0.0.1:8080');
    });
  });

  describe('Event Mapping', () => {
    it('should map connect event to open', () => {
      const openHandler = jest.fn();
      adapter.on('open', openHandler);

      mockConnection.state = ConnectionState.CONNECTED;
      mockConnection.emit('connect');

      expect(openHandler).toHaveBeenCalled();
      expect(adapter.readyState).toBe(1); // OPEN
    });

    it('should map error event', () => {
      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);

      const error = new Error('Test error');
      mockConnection.emit('error', error);

      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('should map disconnect event to close', () => {
      const closeHandler = jest.fn();
      adapter.on('close', closeHandler);

      mockConnection.state = ConnectionState.DISCONNECTED;
      mockConnection.emit('disconnect', 'Test reason');

      expect(closeHandler).toHaveBeenCalled();
      expect(closeHandler.mock.calls[0][0]).toBe(1000);
      expect(Buffer.isBuffer(closeHandler.mock.calls[0][1])).toBe(true);
      expect(adapter.readyState).toBe(3); // CLOSED
    });

    it('should handle disconnect without reason', () => {
      const closeHandler = jest.fn();
      adapter.on('close', closeHandler);

      mockConnection.emit('disconnect');

      expect(closeHandler).toHaveBeenCalled();
      const reasonBuffer = closeHandler.mock.calls[0][1];
      expect(Buffer.isBuffer(reasonBuffer)).toBe(true);
      expect(reasonBuffer.toString()).toBe('');
    });
  });

  describe('Close and Terminate', () => {
    it('should close connection with code and reason', async () => {
      mockConnection.state = ConnectionState.DISCONNECTING;
      adapter.close(1000, 'Normal close');

      expect(adapter.readyState).toBe(2); // CLOSING
      expect(mockConnection.close).toHaveBeenCalledWith(1000, 'Normal close');
    });

    it('should handle close error', async () => {
      const error = new Error('Close failed');
      (mockConnection.close as jest.Mock).mockRejectedValue(error);

      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);

      adapter.close();

      await delay(10);
      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('should terminate connection immediately', async () => {
      mockConnection.state = ConnectionState.DISCONNECTED;
      adapter.terminate();

      expect(adapter.readyState).toBe(3); // CLOSED
      expect(mockConnection.close).toHaveBeenCalledWith(1006, 'Terminated');
    });

    it('should ignore errors on terminate', async () => {
      const error = new Error('Close failed');
      (mockConnection.close as jest.Mock).mockRejectedValue(error);

      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);

      adapter.terminate();

      await delay(10);
      expect(errorHandler).not.toHaveBeenCalled();
    });
  });

  describe('Ping and Pong', () => {
    it('should call connection ping with callback', async () => {
      const callback = jest.fn();

      adapter.ping(null, false, callback);

      await delay(10);
      expect(mockConnection.ping).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith();
    });

    it('should handle ping error with callback', async () => {
      const error = new Error('Ping failed');
      (mockConnection.ping as jest.Mock).mockRejectedValue(error);

      const callback = jest.fn();
      adapter.ping(null, false, callback);

      await delay(10);
      expect(callback).toHaveBeenCalledWith(error);
    });

    it('should handle pong call', () => {
      const callback = jest.fn();
      adapter.pong(null, false, callback);
      expect(callback).toHaveBeenCalled();
    });
  });
});

describe('TransportConnectionFactory', () => {
  describe('Static connect method', () => {
    let tcpServer: any;
    let testPort: number;

    beforeEach(async () => {
      testPort = await getFreePort();
      const tcpTransport = new TcpTransport();
      tcpServer = await tcpTransport.createServer!({
        port: testPort,
        host: '127.0.0.1'
      } as any);
    });

    afterEach(async () => {
      await tcpServer?.close();
    });

    it('should connect and return BinaryTransportAdapter', async () => {
      const adapter = await TransportConnectionFactory.connect(`tcp://127.0.0.1:${testPort}`);

      expect(adapter).toBeDefined();
      expect(adapter.readyState).toBe(1); // OPEN
      expect(adapter.url).toBe(`tcp://127.0.0.1:${testPort}`);

      adapter.close();
    });

    it('should throw error for unknown transport', async () => {
      await expect(TransportConnectionFactory.connect('unknown://localhost:8080'))
        .rejects.toThrow('Transport');
    });

    it('should pass options to transport', async () => {
      const adapter = await TransportConnectionFactory.connect(
        `tcp://127.0.0.1:${testPort}`,
        { connectTimeout: 5000 }
      );

      expect(adapter).toBeDefined();
      adapter.close();
    });
  });

  describe('fromConnection', () => {
    it('should create adapter from connection', () => {
      const mockConnection = new EventEmitter() as any;
      mockConnection.state = ConnectionState.CONNECTED;
      mockConnection.id = 'test';

      const adapter = TransportConnectionFactory.fromConnection(mockConnection, 'tcp://test');

      expect(adapter).toBeDefined();
      expect(adapter.url).toBe('tcp://test');
    });
  });

  describe('isNativeWebSocket', () => {
    it('should detect native WebSocket via instanceof', () => {
      // Use a plain object with WebSocket prototype to test instanceof
      const ws = Object.create(WebSocket.prototype);

      const isNative = TransportConnectionFactory.isNativeWebSocket(ws);
      expect(isNative).toBe(true);
    });

    it('should detect WebSocket-like object', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      const isNative = TransportConnectionFactory.isNativeWebSocket(mockWs);
      expect(isNative).toBe(true);
    });

    it('should reject adapter objects with connection property', () => {
      const mockAdapter = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn(),
        connection: {} // Has connection property - our adapter
      };

      const isNative = TransportConnectionFactory.isNativeWebSocket(mockAdapter);
      expect(isNative).toBe(false);
    });

    it('should reject non-WebSocket objects', () => {
      expect(TransportConnectionFactory.isNativeWebSocket({})).toBe(false);
      expect(TransportConnectionFactory.isNativeWebSocket(null as any)).toBe(false);
      expect(TransportConnectionFactory.isNativeWebSocket('string' as any)).toBe(false);
    });
  });

  describe('getAdapter', () => {
    it('should get adapter from native WebSocket', () => {
      // Create EventEmitter-based mock that looks like WebSocket
      const ws = new EventEmitter() as any;
      Object.setPrototypeOf(ws, WebSocket.prototype);
      ws.send = jest.fn();
      ws.close = jest.fn();
      ws._socket = { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' };

      const adapter = TransportConnectionFactory.getAdapter(ws);
      expect(adapter).toBeDefined();
    });

    it('should get adapter from ITransportConnection', () => {
      const mockConnection = new EventEmitter() as any;
      mockConnection.state = ConnectionState.CONNECTED;
      mockConnection.id = 'test';

      const adapter = TransportConnectionFactory.getAdapter(mockConnection);
      expect(adapter).toBeDefined();
    });
  });
});

describe('NativeWebSocketWrapper', () => {
  let mockWs: any;
  let wrapper: any;

  beforeEach(() => {
    // Create mock WebSocket
    mockWs = new EventEmitter();
    mockWs.readyState = 0; // CONNECTING
    mockWs.send = jest.fn((data, callback) => callback?.());
    mockWs.close = jest.fn();
    mockWs.ping = jest.fn((callback) => callback?.());
    mockWs._socket = {
      remoteAddress: '127.0.0.1',
      localAddress: '127.0.0.1'
    };

    // Make it look like a WebSocket
    Object.setPrototypeOf(mockWs, WebSocket.prototype);

    // Create wrapper using getAdapter which will create NativeWebSocketWrapper
    const adapter = TransportConnectionFactory.getAdapter(mockWs);
    wrapper = (adapter as any).connection;
  });

  describe('State Mapping', () => {
    it('should map WebSocket CONNECTING state', () => {
      mockWs.readyState = 0; // WebSocket.CONNECTING
      expect(wrapper.state).toBe(ConnectionState.CONNECTING);
    });

    it('should map WebSocket OPEN state', () => {
      mockWs.readyState = 1; // WebSocket.OPEN
      expect(wrapper.state).toBe(ConnectionState.CONNECTED);
    });

    it('should map WebSocket CLOSING state', () => {
      mockWs.readyState = 2; // WebSocket.CLOSING
      expect(wrapper.state).toBe(ConnectionState.DISCONNECTING);
    });

    it('should map WebSocket CLOSED state', () => {
      mockWs.readyState = 3; // WebSocket.CLOSED
      expect(wrapper.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should map unknown state to DISCONNECTED', () => {
      mockWs.readyState = 999;
      expect(wrapper.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('Address Properties', () => {
    it('should get remoteAddress from socket', () => {
      expect(wrapper.remoteAddress).toBe('127.0.0.1');
    });

    it('should get localAddress from socket', () => {
      expect(wrapper.localAddress).toBe('127.0.0.1');
    });

    it('should handle missing socket', () => {
      mockWs._socket = undefined;
      expect(wrapper.remoteAddress).toBeUndefined();
      expect(wrapper.localAddress).toBeUndefined();
    });
  });

  describe('Event Handling', () => {
    it('should emit connect on WebSocket open', () => {
      const connectHandler = jest.fn();
      wrapper.on('connect', connectHandler);

      mockWs.emit('open');

      expect(connectHandler).toHaveBeenCalled();
    });

    it('should emit data on WebSocket message with Buffer', () => {
      const dataHandler = jest.fn();
      wrapper.on('data', dataHandler);

      const buffer = Buffer.from('test data');
      mockWs.emit('message', buffer);

      expect(dataHandler).toHaveBeenCalled();
      expect(Buffer.isBuffer(dataHandler.mock.calls[0][0])).toBe(true);
    });

    it('should convert ArrayBuffer message to Buffer', () => {
      const dataHandler = jest.fn();
      wrapper.on('data', dataHandler);

      const arrayBuffer = new ArrayBuffer(4);
      new Uint8Array(arrayBuffer).set([1, 2, 3, 4]);
      mockWs.emit('message', arrayBuffer);

      expect(dataHandler).toHaveBeenCalled();
      const receivedData = dataHandler.mock.calls[0][0];
      expect(Buffer.isBuffer(receivedData)).toBe(true);
    });

    it('should concat array of Buffers', () => {
      const dataHandler = jest.fn();
      wrapper.on('data', dataHandler);

      const buffers = [Buffer.from('part1'), Buffer.from('part2')];
      mockWs.emit('message', buffers);

      expect(dataHandler).toHaveBeenCalled();
      const receivedData = dataHandler.mock.calls[0][0];
      expect(Buffer.isBuffer(receivedData)).toBe(true);
      expect(receivedData.toString()).toBe('part1part2');
    });

    it('should emit error on WebSocket error', () => {
      const errorHandler = jest.fn();
      wrapper.on('error', errorHandler);

      const error = new Error('WebSocket error');
      mockWs.emit('error', error);

      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('should emit disconnect on WebSocket close', () => {
      const disconnectHandler = jest.fn();
      wrapper.on('disconnect', disconnectHandler);

      const reason = Buffer.from('Close reason');
      mockWs.emit('close', 1000, reason);

      expect(disconnectHandler).toHaveBeenCalledWith('Close reason');
    });

    it('should handle close without reason', () => {
      const disconnectHandler = jest.fn();
      wrapper.on('disconnect', disconnectHandler);

      mockWs.emit('close', 1000);

      expect(disconnectHandler).toHaveBeenCalled();
    });
  });

  describe('Send Methods', () => {
    it('should send Buffer data', async () => {
      const buffer = Buffer.from('test');
      await wrapper.send(buffer);

      expect(mockWs.send).toHaveBeenCalledWith(buffer, expect.any(Function));
    });

    it('should send ArrayBuffer data', async () => {
      const arrayBuffer = new ArrayBuffer(4);
      await wrapper.send(arrayBuffer);

      expect(mockWs.send).toHaveBeenCalledWith(arrayBuffer, expect.any(Function));
    });

    it('should send Uint8Array data', async () => {
      const uint8Array = new Uint8Array([1, 2, 3]);
      await wrapper.send(uint8Array);

      expect(mockWs.send).toHaveBeenCalledWith(uint8Array, expect.any(Function));
    });

    it('should reject on send error', async () => {
      const error = new Error('Send failed');
      mockWs.send = jest.fn((data, callback) => callback(error));

      await expect(wrapper.send(Buffer.from('test'))).rejects.toThrow('Send failed');
    });

    it('should send packet with encoding', async () => {
      const packet = new Packet(1, 123, Buffer.from('test'));
      await wrapper.sendPacket(packet);

      expect(mockWs.send).toHaveBeenCalled();
      // Verify data was encoded
      const sentData = (mockWs.send as jest.Mock).mock.calls[0][0];
      expect(Buffer.isBuffer(sentData) || sentData instanceof Uint8Array).toBe(true);
    });
  });

  describe('Close Method', () => {
    it('should close with code and reason', async () => {
      await wrapper.close(1000, 'Normal close');

      expect(mockWs.close).toHaveBeenCalledWith(1000, 'Normal close');
    });

    it('should close without parameters', async () => {
      await wrapper.close();

      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('Ping Method', () => {
    it('should ping and wait for pong', async () => {
      const pingPromise = wrapper.ping();

      // Simulate pong response after 10ms
      setTimeout(() => {
        mockWs.emit('pong');
      }, 10);

      const rtt = await pingPromise;
      expect(rtt).toBeGreaterThanOrEqual(10);
      expect(mockWs.ping).toHaveBeenCalled();
    });

    it('should timeout if no pong received', async () => {
      await expect(wrapper.ping()).rejects.toThrow('Ping timed out');
    }, 6000);

    it('should reject on ping error', async () => {
      const error = new Error('Ping failed');
      mockWs.ping = jest.fn((callback) => callback(error));

      await expect(wrapper.ping()).rejects.toThrow('Ping failed');
    });

    it('should cleanup pong listener on ping error', async () => {
      const error = new Error('Ping failed');
      mockWs.ping = jest.fn((callback) => callback(error));

      try {
        await wrapper.ping();
      } catch (e) {
        // Expected error
      }

      // Verify pong listener was removed
      expect(mockWs.listenerCount('pong')).toBe(0);
    });

    it('should cleanup timeout on successful pong', async () => {
      const pingPromise = wrapper.ping();

      // Immediately emit pong
      mockWs.emit('pong');

      const rtt = await pingPromise;
      expect(rtt).toBeDefined();

      // Verify pong listener was removed
      expect(mockWs.listenerCount('pong')).toBe(0);
    });
  });

  describe('ID Property', () => {
    it('should have unique id', () => {
      expect(wrapper.id).toBeDefined();
      expect(typeof wrapper.id).toBe('string');
      expect(wrapper.id.length).toBeGreaterThan(0);
    });
  });
});