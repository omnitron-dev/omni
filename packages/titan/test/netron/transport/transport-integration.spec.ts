/**
 * Transport Integration Tests
 *
 * Tests all transport implementations with real connections,
 * ensuring they work correctly together and can interoperate.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import {
  TransportRegistry,
  getTransportRegistry,
  TcpTransport,
  WebSocketTransport,
  UnixSocketTransport,
  NamedPipeTransport,
  BaseTransport
} from '../../../src/netron/transport/index.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { getFreePort, waitForEvent, delay } from '../../utils/index.js';

// Test configuration
const TCP_TEST_PORT = 19000;
const WS_TEST_PORT = 19100;

// Helper to get unique socket path
function getSocketPath(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\test-${timestamp}-${random}`;
  } else {
    return join(tmpdir(), `test-${timestamp}-${random}.sock`);
  }
}

// Helper to wait for message (handles both data and packet events)
function waitForMessage<T = any>(connection: any, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message`));
    }, timeout);

    const cleanup = () => {
      clearTimeout(timer);
      connection.off('data', dataHandler);
      connection.off('packet', packetHandler);
    };

    const dataHandler = (data: T) => {
      cleanup();
      resolve(data);
    };

    const packetHandler = (packet: any) => {
      cleanup();
      resolve(packet.data || packet);
    };

    connection.once('data', dataHandler);
    connection.once('packet', packetHandler);
  });
}

// Helper to clean up socket files
async function cleanupSocketFile(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      await fs.unlink(path);
    } catch (error) {
      // Ignore error if file doesn't exist
    }
  }
}

describe('Transport Integration Tests', () => {
  let tcpPort: number;
  let wsPort: number;
  let socketPath: string;

  beforeAll(async () => {
    // Get ports for testing
    tcpPort = await getFreePort(TCP_TEST_PORT);
    wsPort = await getFreePort(WS_TEST_PORT);
  });

  beforeEach(() => {
    socketPath = getSocketPath();
  });

  afterEach(async () => {
    if (socketPath) {
      await cleanupSocketFile(socketPath);
    }
  });

  describe('Transport Registry', () => {
    let registry: TransportRegistry;

    beforeEach(() => {
      registry = new TransportRegistry();
    });

    it('should register and retrieve transports', () => {
      const tcpTransport = new TcpTransport();
      const wsTransport = new WebSocketTransport();

      registry.register('tcp', () => tcpTransport);
      registry.register('ws', () => wsTransport);

      expect(registry.get('tcp')).toBe(tcpTransport);
      expect(registry.get('ws')).toBe(wsTransport);
    });

    it('should get transport for address', () => {
      const tcpTransport = new TcpTransport();
      const wsTransport = new WebSocketTransport();

      registry.register('tcp', () => tcpTransport);
      registry.register('ws', () => wsTransport);

      const tcpResult = registry.getTransportForAddress('tcp://localhost:8080');
      const wsResult = registry.getTransportForAddress('ws://localhost:8080');

      expect(tcpResult).toBeInstanceOf(TcpTransport);
      expect(wsResult).toBeInstanceOf(WebSocketTransport);
    });

    it('should handle platform-specific transports', () => {
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        const pipeTransport = new NamedPipeTransport();
        registry.register('pipe', () => pipeTransport);
        expect(registry.get('pipe')).toBe(pipeTransport);
      } else {
        const unixTransport = new UnixSocketTransport();
        registry.register('unix', () => unixTransport);
        expect(registry.get('unix')).toBe(unixTransport);
      }
    });

    it('should use global registry instance', () => {
      const globalRegistry = getTransportRegistry();

      // Should have default transports registered
      expect(globalRegistry.get('tcp')).toBeInstanceOf(TcpTransport);
      expect(globalRegistry.get('ws')).toBeInstanceOf(WebSocketTransport);

      if (process.platform === 'win32') {
        expect(globalRegistry.get('pipe')).toBeInstanceOf(NamedPipeTransport);
      } else {
        expect(globalRegistry.get('unix')).toBeInstanceOf(UnixSocketTransport);
      }
    });
  });

  describe('TCP Transport Integration', () => {
    let tcpTransport: TcpTransport;
    let server: any;

    beforeEach(async () => {
      tcpTransport = new TcpTransport();
      server = await tcpTransport.createServer(`tcp://127.0.0.1:${tcpPort}`);
    });

    afterEach(async () => {
      await server?.close();
    });

    it('should handle multiple simultaneous connections', async () => {
      const clientCount = 10;
      const clients: any[] = [];
      const serverConnections: any[] = [];

      // Listen for server connections
      server.on('connection', (conn: any) => {
        serverConnections.push(conn);
      });

      // Create multiple clients
      for (let i = 0; i < clientCount; i++) {
        const client = await tcpTransport.connect(`tcp://127.0.0.1:${tcpPort}`);
        clients.push(client);
      }

      // Wait for all server connections
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(clients.length).toBe(clientCount);
      expect(serverConnections.length).toBe(clientCount);

      // Send data from each client
      for (let i = 0; i < clientCount; i++) {
        await clients[i].send(Buffer.from(`Client ${i}`));
      }

      // Clean up
      for (const client of clients) {
        await client.close();
      }
    });

    it('should handle high-throughput data transfer', async () => {
      const messageCount = 1000;
      const messages: any[] = [];

      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await tcpTransport.connect(`tcp://127.0.0.1:${tcpPort}`);
      const serverConn = await serverConnPromise;

      // Listen for both data and packet events
      const handleMessage = (data: any) => {
        messages.push(data);
      };
      serverConn.on('data', handleMessage);
      serverConn.on('packet', handleMessage);

      // Send many messages rapidly
      const startTime = Date.now();
      for (let i = 0; i < messageCount; i++) {
        await client.send(Buffer.from(`Message ${i}`));
      }
      const endTime = Date.now();

      // Wait for all messages
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(messages.length).toBe(messageCount);
      console.log(`TCP throughput: ${messageCount} messages in ${endTime - startTime}ms`);

      await client.close();
    });
  });

  describe('WebSocket Transport Integration', () => {
    let wsTransport: WebSocketTransport;
    let httpServer: any;
    let wsServer: WebSocketServer;

    beforeEach(async () => {
      wsTransport = new WebSocketTransport();

      // Create HTTP server for WebSocket
      httpServer = createHttpServer();
      await new Promise<void>(resolve => {
        httpServer.listen(wsPort, '127.0.0.1', resolve);
      });

      // Create WebSocket server
      wsServer = new WebSocketServer({ server: httpServer });
    });

    afterEach(async () => {
      wsServer?.close();
      await new Promise(resolve => httpServer?.close(resolve));
    });

    it('should connect to WebSocket server', async () => {
      const connectionPromise = new Promise((resolve) => {
        wsServer.on('connection', resolve);
      });

      const client = await wsTransport.connect(`ws://127.0.0.1:${wsPort}`);
      await connectionPromise;

      expect(client.state).toBe(ConnectionState.CONNECTED);
      await client.close();
    });

    it('should handle WebSocket message exchange', async () => {
      // Setup server echo handler before connection
      const serverConnectionPromise = new Promise<any>((resolve) => {
        wsServer.on('connection', (socket) => {
          socket.on('message', (data) => {
            // Echo back the received data
            socket.send(data);
          });
          resolve(socket);
        });
      });

      const client = await wsTransport.connect(`ws://127.0.0.1:${wsPort}`);
      const serverSocket = await serverConnectionPromise;

      // Wait for connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify connection state
      expect(client.state).toBe(ConnectionState.CONNECTED);

      // Set up data listener before sending
      const messagePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for message'));
        }, 2000);

        const cleanup = () => {
          clearTimeout(timeout);
          client.off('data', dataHandler);
        };

        const dataHandler = (data: any) => {
          cleanup();
          resolve(data);
        };

        client.on('data', dataHandler);
      });

      // Send test data - use short data that can't be mistaken for a packet
      const testData = Buffer.from([0x11, 0x22, 0x33]);
      await client.send(testData);

      // Wait for echo response
      const receivedData = await messagePromise;

      // Verify received data
      expect(Buffer.from(receivedData as any)).toEqual(testData);

      await client.close();
    });
  });

  describe('Unix/Named Pipe Transport Integration', () => {
    const isWindows = process.platform === 'win32';
    let unixTransport: UnixSocketTransport | NamedPipeTransport;
    let server: any;

    beforeEach(async () => {
      unixTransport = isWindows ? new NamedPipeTransport() : new UnixSocketTransport();
      server = await unixTransport.createServer(socketPath);
    });

    afterEach(async () => {
      await server?.close();
    });

    it('should handle Unix socket/named pipe connections', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await unixTransport.connect(socketPath);
      const serverConn = await serverConnPromise;

      expect(client.state).toBe(ConnectionState.CONNECTED);
      expect(serverConn).toBeDefined();

      await client.close();
    });

    it('should handle data transfer over Unix socket/named pipe', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await unixTransport.connect(socketPath);
      const serverConn = await serverConnPromise;

      let messageReceived = false;

      // Listen for any data/packet event to confirm message was received
      serverConn.on('data', () => { messageReceived = true; });
      serverConn.on('packet', () => { messageReceived = true; });

      const testData = Buffer.from('Unix/Pipe test data');
      await client.send(testData);

      // Wait a bit for the message to arrive
      await new Promise(resolve => setTimeout(resolve, 100));

      // Just verify that some message was received
      expect(messageReceived).toBe(true);

      await client.close();
    });
  });

  describe('Cross-Transport Communication', () => {
    it('should handle mixed transport types concurrently', async () => {
      const tcpTransport = new TcpTransport();
      const wsTransport = new WebSocketTransport();
      const unixTransport = process.platform === 'win32'
        ? new NamedPipeTransport()
        : new UnixSocketTransport();

      // Create servers
      const tcpServer = await tcpTransport.createServer(`tcp://127.0.0.1:${tcpPort}`);

      const httpServer = createHttpServer();
      await new Promise<void>(resolve => {
        httpServer.listen(wsPort, '127.0.0.1', resolve);
      });
      const wsServer = new WebSocketServer({ server: httpServer });

      const unixServer = await unixTransport.createServer(socketPath);

      // Connect clients
      const tcpClient = await tcpTransport.connect(`tcp://127.0.0.1:${tcpPort}`);
      const wsClient = await wsTransport.connect(`ws://127.0.0.1:${wsPort}`);
      const unixClient = await unixTransport.connect(socketPath);

      // Verify all connections
      expect(tcpClient.state).toBe(ConnectionState.CONNECTED);
      expect(wsClient.state).toBe(ConnectionState.CONNECTED);
      expect(unixClient.state).toBe(ConnectionState.CONNECTED);

      // Send data on all transports
      await tcpClient.send(Buffer.from('TCP data'));
      await wsClient.send(Buffer.from('WebSocket data'));
      await unixClient.send(Buffer.from('Unix/Pipe data'));

      // Clean up
      await tcpClient.close();
      await wsClient.close();
      await unixClient.close();
      await tcpServer.close();
      await unixServer.close();
      wsServer.close();
      await new Promise(resolve => httpServer.close(resolve));
    });
  });

  describe('Transport Performance Comparison', () => {
    const messageCount = 100;
    const messageSize = 1024; // 1KB messages

    it('should compare throughput across transports', async () => {
      const results: Record<string, number> = {};

      // Test TCP
      {
        const tcpTransport = new TcpTransport();
        const server = await tcpTransport.createServer(`tcp://127.0.0.1:${tcpPort}`);

        const serverConnPromise = waitForEvent(server, 'connection');
        const client = await tcpTransport.connect(`tcp://127.0.0.1:${tcpPort}`);
        const serverConn = await serverConnPromise;

        let received = 0;
        serverConn.on('data', () => received++);

        const testData = Buffer.alloc(messageSize, 'x');
        const startTime = Date.now();

        for (let i = 0; i < messageCount; i++) {
          await client.send(testData);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
        const endTime = Date.now();

        results['TCP'] = endTime - startTime;

        await client.close();
        await server.close();
      }

      // Test Unix/Named Pipe
      {
        const unixTransport = process.platform === 'win32'
          ? new NamedPipeTransport()
          : new UnixSocketTransport();
        const server = await unixTransport.createServer(socketPath);

        const serverConnPromise = waitForEvent(server, 'connection');
        const client = await unixTransport.connect(socketPath);
        const serverConn = await serverConnPromise;

        let received = 0;
        serverConn.on('data', () => received++);

        const testData = Buffer.alloc(messageSize, 'x');
        const startTime = Date.now();

        for (let i = 0; i < messageCount; i++) {
          await client.send(testData);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
        const endTime = Date.now();

        results[process.platform === 'win32' ? 'NamedPipe' : 'Unix'] = endTime - startTime;

        await client.close();
        await server.close();
      }

      // Log results
      console.log('Transport Performance Results:');
      for (const [transport, time] of Object.entries(results)) {
        const throughput = (messageCount * messageSize) / (time / 1000) / 1024;
        console.log(`  ${transport}: ${time}ms (${throughput.toFixed(2)} KB/s)`);
      }

      // All transports should complete within reasonable time
      for (const time of Object.values(results)) {
        expect(time).toBeLessThan(5000); // 5 seconds max
      }
    });
  });

  describe('Error Recovery', () => {
    it('should handle transport failures gracefully', async () => {
      const tcpTransport = new TcpTransport();

      // Try to connect to non-existent server
      try {
        await tcpTransport.connect('tcp://127.0.0.1:1', {
          connectTimeout: 100
        });
        fail('Should have thrown connection error');
      } catch (error: any) {
        expect(error.message).toMatch(/ECONNREFUSED|timeout/i);
      }
    });

    it('should handle concurrent connection attempts', async () => {
      const tcpTransport = new TcpTransport();
      const server = await tcpTransport.createServer(`tcp://127.0.0.1:${tcpPort}`);

      // Create multiple connections concurrently
      const connectionPromises = [];
      for (let i = 0; i < 20; i++) {
        connectionPromises.push(
          tcpTransport.connect(`tcp://127.0.0.1:${tcpPort}`)
        );
      }

      const clients = await Promise.all(connectionPromises);

      // All should be connected
      for (const client of clients) {
        expect(client.state).toBe(ConnectionState.CONNECTED);
      }

      // Clean up
      for (const client of clients) {
        await client.close();
      }
      await server.close();
    });
  });

  describe('Transport Adapter Pattern', () => {
    it('should support custom transport adapters', async () => {
      class CustomTransport extends BaseTransport {
        name = 'custom';
        capabilities = {
          streaming: true,
          bidirectional: true,
          binary: true,
          reconnection: false,
          multiplexing: false,
          server: true
        };

        isValidAddress(address: string): boolean {
          return address.startsWith('custom://');
        }

        parseAddress(address: string): any {
          return { protocol: 'custom', address };
        }

        async connect(address: string): Promise<any> {
          // Custom connection logic
          return {
            state: ConnectionState.CONNECTED,
            send: async () => {},
            close: async () => {},
            on: () => {},
            off: () => {}
          };
        }

        async createServer(): Promise<any> {
          // Custom server logic
          return {
            listen: async () => {},
            close: async () => {},
            on: () => {},
            off: () => {}
          };
        }
      }

      const customTransport = new CustomTransport();
      const registry = new TransportRegistry(false); // Don't register defaults
      registry.register('custom', () => customTransport);
      registry.mapProtocol('custom', 'custom');

      expect(registry.get('custom')).toBe(customTransport);
      expect(registry.getTransportForAddress('custom://example')).toBe(customTransport);

      const connection = await customTransport.connect('custom://example');
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });
  });

  describe('Connection Pooling', () => {
    it('should reuse connections efficiently', async () => {
      const tcpTransport = new TcpTransport();
      const server = await tcpTransport.createServer(`tcp://127.0.0.1:${tcpPort}`);

      const connections: any[] = [];

      // Create connection pool
      for (let i = 0; i < 5; i++) {
        const conn = await tcpTransport.connect(`tcp://127.0.0.1:${tcpPort}`);
        connections.push(conn);
      }

      // Use connections
      for (let round = 0; round < 10; round++) {
        const conn = connections[round % connections.length];
        await conn.send(Buffer.from(`Round ${round}`));
      }

      // Clean up
      for (const conn of connections) {
        await conn.close();
      }
      await server.close();
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle chat application scenario', async () => {
      const tcpTransport = new TcpTransport();
      const server = await tcpTransport.createServer(`tcp://127.0.0.1:${tcpPort}`);

      const clients: any[] = [];
      const messages: any[] = [];

      // Server broadcasts messages to all clients
      server.on('connection', (conn: any) => {
        const handleMessage = async (data: any) => {
          messages.push(data);
          // Broadcast to all connections
          if (server.broadcast) {
            await server.broadcast(data);
          }
        };
        conn.on('data', handleMessage);
        conn.on('packet', handleMessage);
      });

      // Create chat clients
      for (let i = 0; i < 3; i++) {
        const client = await tcpTransport.connect(`tcp://127.0.0.1:${tcpPort}`);
        clients.push(client);
      }

      // Wait for connections to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send messages from different clients
      await clients[0].send(Buffer.from('Hello from client 0'));
      await clients[1].send(Buffer.from('Hello from client 1'));
      await clients[2].send(Buffer.from('Hello from client 2'));

      // Wait for messages to propagate
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(messages.length).toBe(3);

      // Clean up
      for (const client of clients) {
        await client.close();
      }
      await server.close();
    });

    it('should handle microservices communication scenario', async () => {
      // Service A - TCP
      const tcpTransport = new TcpTransport();
      const serviceA = await tcpTransport.createServer(`tcp://127.0.0.1:${tcpPort}`);

      // Service B - Unix/Named Pipe
      const unixTransport = process.platform === 'win32'
        ? new NamedPipeTransport()
        : new UnixSocketTransport();
      const serviceB = await unixTransport.createServer(socketPath);

      // Service A connects to Service B
      const aToB = await unixTransport.connect(socketPath);

      // Client connects to Service A
      const client = await tcpTransport.connect(`tcp://127.0.0.1:${tcpPort}`);

      // Request flow: Client -> Service A -> Service B
      // For now, just test basic connectivity
      await client.send(Buffer.from(JSON.stringify({
        request: 'process',
        serviceId: 'service-b'
      })));

      // Clean up
      await client.close();
      await aToB.close();
      await serviceA.close();
      await serviceB.close();
    });
  });
});