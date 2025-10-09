/**
 * WebSocket Transport Tests
 *
 * Tests WebSocket transport implementation with real connections
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { WebSocketTransport } from '../../../src/netron/transport/websocket-transport.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { promisify } from 'node:util';
import { getFreeHttpPort as getFreePort, waitForEvent, delay } from '../../utils/index.js';

describe('WebSocketTransport', () => {
  let transport: WebSocketTransport;
  let testPort: number;
  let httpServer: any;
  let wsServer: WebSocketServer;

  beforeEach(async () => {
    transport = new WebSocketTransport();
    testPort = await getFreePort();

    // Create HTTP server for WebSocket
    httpServer = createServer();
    await promisify(httpServer.listen).bind(httpServer)(testPort);

    // Create WebSocket server
    wsServer = new WebSocketServer({ server: httpServer });
  });

  afterEach(async () => {
    // Clean up WebSocket server
    wsServer.clients.forEach(client => client.close());
    wsServer.close();

    // Clean up HTTP server
    await promisify(httpServer.close).bind(httpServer)();

    // Small delay to ensure cleanup
    await delay(100);
  });

  describe('Basic Functionality', () => {
    it('should have correct capabilities', () => {
      expect(transport.name).toBe('websocket');
      expect(transport.capabilities).toEqual({
        streaming: true,
        bidirectional: true,
        binary: true,
        reconnection: false, // WebSockets don't support native reconnection
        multiplexing: false,
        server: true
      });
    });

    it('should validate WebSocket addresses correctly', () => {
      expect(transport.isValidAddress('ws://localhost:8080')).toBe(true);
      expect(transport.isValidAddress('wss://example.com:443')).toBe(true);
      expect(transport.isValidAddress('ws://192.168.1.1:3000')).toBe(true);
      expect(transport.isValidAddress('ws://[::1]:8080')).toBe(true);
      expect(transport.isValidAddress('tcp://localhost:8080')).toBe(false);
      expect(transport.isValidAddress('invalid')).toBe(false);
    });

    it('should parse WebSocket addresses correctly', () => {
      const addr1 = transport.parseAddress('ws://localhost:8080/path');
      expect(addr1).toEqual({
        protocol: 'ws',
        host: 'localhost',
        port: 8080,
        path: '/path',
        params: {}
      });

      const addr2 = transport.parseAddress('wss://example.com');
      expect(addr2).toEqual({
        protocol: 'wss',
        host: 'example.com',
        port: 443, // Default for wss
        path: '/',
        params: {}
      });

      const addr3 = transport.parseAddress('ws://localhost:8080?token=abc');
      expect(addr3.params).toEqual({ token: 'abc' });
    });
  });

  describe('Server Creation and Listening', () => {
    it('should create and start a WebSocket server', async () => {
      const serverPort = await getFreePort();
      const server = await transport.createServer({ port: serverPort });
      expect(server).toBeDefined();

      await server.listen();

      expect(server.port).toBe(serverPort);
      await server.close();
    });

    it('should emit listening event when server starts', async () => {
      const serverPort = await getFreePort();
      const server = await transport.createServer({ port: serverPort });

      const listeningPromise = waitForEvent(server, 'listening');
      await server.listen();
      await listeningPromise;

      expect(server.port).toBe(serverPort);
      await server.close();
    });

    it('should handle multiple WebSocket connections', async () => {
      const serverPort = await getFreePort();
      const server = await transport.createServer({ port: serverPort });

      // Wait for the server to emit 'listening' event
      const listeningPromise = waitForEvent(server, 'listening');
      await server.listen();
      await listeningPromise;

      // Create client connections
      const connPromise1 = waitForEvent(server, 'connection');
      const client1 = await transport.connect(`ws://127.0.0.1:${serverPort}`);
      await connPromise1;

      const connPromise2 = waitForEvent(server, 'connection');
      const client2 = await transport.connect(`ws://127.0.0.1:${serverPort}`);
      await connPromise2;

      expect(server.connections.size).toBe(2);

      await client1.close();
      await client2.close();
      await server.close();
    });
  });

  describe('Client Connection', () => {
    it('should connect to WebSocket server', async () => {
      // Set up WebSocket server handler
      let resolveConnection: (ws: WebSocket) => void;
      const connectionPromise = new Promise<WebSocket>(resolve => {
        resolveConnection = resolve;
      });

      wsServer.on('connection', (ws) => {
        resolveConnection(ws);
      });

      // Connect client
      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);

      expect(client).toBeDefined();
      expect(client.state).toBe(ConnectionState.CONNECTED);

      const serverWs = await connectionPromise;
      expect(serverWs.readyState).toBe(WebSocket.OPEN);

      await client.close();
    });

    it('should handle connection with custom headers', async () => {
      let receivedHeaders: any;

      wsServer.on('connection', (ws, request) => {
        receivedHeaders = request.headers;
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`, {
        headers: {
          'Authorization': 'Bearer test-token',
          'X-Custom-Header': 'custom-value'
        }
      });

      // Wait a bit for the connection to be established
      await delay(100);

      expect(receivedHeaders).toBeDefined();
      expect(receivedHeaders['authorization']).toBe('Bearer test-token');
      expect(receivedHeaders['x-custom-header']).toBe('custom-value');

      await client.close();
    });

    it('should handle connection failure', async () => {
      const fakePort = await getFreePort();

      try {
        await transport.connect(`ws://127.0.0.1:${fakePort}`, {
          connectTimeout: 1000
        });
        fail('Should have thrown connection error');
      } catch (error: any) {
        expect(error.message).toMatch(/ECONNREFUSED|Connection failed/);
      }
    });

    it('should handle connection timeout', async () => {
      // Create a server that doesn't respond to WebSocket upgrades
      const slowServer = createServer((req, res) => {
        // Just hang, don't respond
        setTimeout(() => res.end(), 10000);
      });

      const slowPort = await getFreePort();
      await promisify(slowServer.listen).bind(slowServer)(slowPort);

      try {
        await transport.connect(`ws://127.0.0.1:${slowPort}`, {
          connectTimeout: 500
        });
        fail('Should have timed out');
      } catch (error: any) {
        expect(error.message).toContain('timeout');
      } finally {
        slowServer.close();
      }
    });
  });

  describe('Data Transmission', () => {
    let serverWs: WebSocket;
    let clientConnection: any;

    beforeEach(async () => {
      // Set up WebSocket server handler
      let resolveConnection: (ws: WebSocket) => void;
      const connectionPromise = new Promise<WebSocket>(resolve => {
        resolveConnection = resolve;
      });

      const connectionHandler = (ws: WebSocket) => {
        resolveConnection(ws);
      };

      wsServer.once('connection', connectionHandler);

      // Connect client
      clientConnection = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverWs = await connectionPromise;

      // Wait a bit to ensure connection is fully established
      await delay(100);
    });

    afterEach(async () => {
      serverWs?.close();
      await clientConnection?.close();
    });

    it('should send and receive binary data', async () => {
      const testData = Buffer.from('Hello, WebSocket!');

      // Server listens for message
      const messagePromise = new Promise<Buffer>((resolve) => {
        serverWs.on('message', (data) => {
          resolve(Buffer.from(data as any));
        });
      });

      // Client sends data
      await clientConnection.send(testData);

      // Server receives data
      const receivedData = await messagePromise;
      expect(receivedData).toEqual(testData);
    });

    it('should send and receive packets', async () => {
      const { createPacket, encodePacket, TYPE_CALL } = await import('../../../src/netron/packet/index.js');

      // Create a proper packet using the Packet class
      const testPacket = createPacket(
        123, // id (numeric)
        1, // PacketImpulse REQUEST (1 = request, 0 = response)
        TYPE_CALL, // Use TYPE_CALL as the packet type
        { message: 'WebSocket packet', serviceId: 'ws-service' }
      );

      // Client listens for packet
      const packetPromise = waitForEvent(clientConnection, 'packet');

      // Server sends packet to client
      const encoded = encodePacket(testPacket);
      serverWs.send(encoded);

      // Client receives packet
      const receivedPacket = await packetPromise;
      expect(receivedPacket.id).toBe(123);
      expect(receivedPacket.data).toMatchObject({
        message: 'WebSocket packet',
        serviceId: 'ws-service'
      });
    });

    it('should handle bidirectional communication', async () => {
      // Use short buffers that can't be mistaken for packets
      // (packets need at least 5 bytes: 4 for ID + 1 for flags)
      const clientToServer = Buffer.from([0x01, 0x02, 0x03]);
      const serverToClient = Buffer.from([0x04, 0x05, 0x06]);

      // Set up listeners
      const serverMessagePromise = new Promise<Buffer>((resolve) => {
        serverWs.on('message', (data) => {
          resolve(Buffer.from(data as any));
        });
      });

      // Use a manual promise instead of waitForEvent
      const clientDataPromise = new Promise<Buffer>((resolve) => {
        clientConnection.on('data', (data: Buffer) => {
          resolve(data);
        });
      });

      // Client sends to server
      await clientConnection.send(clientToServer);
      const serverReceived = await serverMessagePromise;
      expect(serverReceived).toEqual(clientToServer);

      // Server sends to client
      serverWs.send(serverToClient);
      const clientReceived = await clientDataPromise;
      expect(clientReceived).toEqual(serverToClient);
    });

    it('should handle large data transfers', async () => {
      const largeData = Buffer.alloc(1024 * 1024 * 5, 'x'); // 5MB of 'x'

      const messagePromise = new Promise<Buffer>((resolve) => {
        let chunks: Buffer[] = [];
        serverWs.on('message', (data) => {
          chunks.push(Buffer.from(data as any));
          // WebSocket might fragment large messages
          if (Buffer.concat(chunks).length >= largeData.length) {
            resolve(Buffer.concat(chunks));
          }
        });
      });

      await clientConnection.send(largeData);

      const receivedData = await messagePromise;
      expect(receivedData.length).toBe(largeData.length);
      expect(receivedData.slice(0, 100)).toEqual(largeData.slice(0, 100));
    });

    it('should handle text frames as binary', async () => {
      const textData = 'Text message as binary';
      const binaryData = Buffer.from(textData);

      const messagePromise = new Promise<Buffer>((resolve) => {
        serverWs.on('message', (data) => {
          resolve(Buffer.from(data as any));
        });
      });

      await clientConnection.send(binaryData);

      const receivedData = await messagePromise;
      expect(receivedData.toString()).toBe(textData);
    });

    it('should track connection metrics', async () => {
      const { createPacket, TYPE_GET } = await import('../../../src/netron/packet/index.js');

      const testData = Buffer.from('Metric test');
      const packet = createPacket(1, 1, TYPE_GET, {}); // 1 = REQUEST

      await clientConnection.send(testData);
      await clientConnection.sendPacket(packet);

      const metrics = clientConnection.getMetrics();
      expect(metrics.bytesSent).toBeGreaterThan(0);
      expect(metrics.packetsSent).toBe(1);
      expect(metrics.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Ping/Pong', () => {
    it('should handle native WebSocket ping messages', async () => {
      let serverWs: WebSocket;

      // Set up WebSocket server handler
      const connectionPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => {
          resolve(ws);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverWs = await connectionPromise;

      // Server sends native WebSocket ping
      const pongPromise = new Promise((resolve) => {
        serverWs.on('pong', resolve);
      });

      serverWs.ping();

      // Should receive pong
      await pongPromise;
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
    });
  });

  describe('Unified TYPE_PING Protocol', () => {
    it('should measure round-trip time using TYPE_PING packets', async () => {
      // Create server connection
      let serverConnection: any;
      const connectionPromise = new Promise((resolve) => {
        wsServer.once('connection', async (ws) => {
          const { WebSocketConnection } = await import('../../../src/netron/transport/websocket-transport.js');
          const conn = new WebSocketConnection(ws, {}, true);
          resolve(conn);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverConnection = await connectionPromise;

      // Client sends TYPE_PING packet
      const rtt = await client.ping();

      // RTT should be a non-negative number (can be 0ms on fast systems)
      expect(typeof rtt).toBe('number');
      expect(rtt).toBeGreaterThanOrEqual(0);
      expect(rtt).toBeLessThan(1000); // Should be less than 1 second on localhost

      // Check that metrics were updated
      const metrics = client.getMetrics();
      expect(metrics.rtt).toBe(rtt);

      await client.close();
      await serverConnection.close();
    });

    it('should automatically respond to ping requests', async () => {
      // Create server connection
      let serverConnection: any;
      const connectionPromise = new Promise((resolve) => {
        wsServer.on('connection', async (ws) => {
          const { WebSocketConnection } = await import('../../../src/netron/transport/websocket-transport.js');
          const conn = new WebSocketConnection(ws, {}, true);
          resolve(conn);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverConnection = await connectionPromise;

      // Wait a bit to ensure connection is fully established
      await delay(50);

      // Server sends TYPE_PING packet
      const rtt = await serverConnection.ping();

      // Client should have automatically responded
      expect(typeof rtt).toBe('number');
      expect(rtt).toBeGreaterThan(0);

      await client.close();
      await serverConnection.close();
    });

    it('should handle ping timeout', async () => {
      // Create server connection
      let serverConnection: any;
      const connectionPromise = new Promise((resolve) => {
        wsServer.once('connection', async (ws) => {
          const { WebSocketConnection } = await import('../../../src/netron/transport/websocket-transport.js');
          const conn = new WebSocketConnection(ws, {}, true);
          resolve(conn);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`, {
        requestTimeout: 100
      });
      serverConnection = await connectionPromise;

      // Prevent server from responding to ping
      const originalHandleData = (serverConnection as any).handleData;
      (serverConnection as any).handleData = () => {
        // Drop all incoming data
      };

      // Ping should timeout
      await expect(client.ping()).rejects.toThrow('timeout');

      // Restore original handler for cleanup
      (serverConnection as any).handleData = originalHandleData;

      await client.close();
      await serverConnection.close();
    });

    it('should fail ping when connection not established', async () => {
      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);

      // Close the connection
      await client.close();

      // Wait for disconnect
      await delay(100);

      // Ping should fail
      await expect(client.ping()).rejects.toThrow('not established');
    });

    it('should handle multiple concurrent pings', async () => {
      // Create server connection
      let serverConnection: any;
      const connectionPromise = new Promise((resolve) => {
        wsServer.on('connection', async (ws) => {
          const { WebSocketConnection } = await import('../../../src/netron/transport/websocket-transport.js');
          const conn = new WebSocketConnection(ws, {}, true);
          resolve(conn);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverConnection = await connectionPromise;

      // Send multiple pings concurrently
      const pingPromises = [
        client.ping(),
        client.ping(),
        client.ping()
      ];

      const rtts = await Promise.all(pingPromises);

      // All pings should succeed
      expect(rtts.length).toBe(3);
      rtts.forEach(rtt => {
        expect(typeof rtt).toBe('number');
        expect(rtt).toBeGreaterThan(0);
      });

      await client.close();
      await serverConnection.close();
    });
  });

  describe('Connection Management', () => {
    it('should handle graceful disconnection', async () => {
      let serverWs: WebSocket;

      const connectionPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => {
          resolve(ws);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverWs = await connectionPromise;

      const disconnectPromise = waitForEvent(client, 'disconnect');
      const serverClosePromise = new Promise((resolve) => {
        serverWs.on('close', resolve);
      });

      await client.close(1000, 'Normal closure');

      await Promise.all([disconnectPromise, serverClosePromise]);
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should handle abrupt disconnection', async () => {
      let serverWs: WebSocket;

      const connectionPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => {
          resolve(ws);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverWs = await connectionPromise;

      const disconnectPromise = waitForEvent(client, 'disconnect');

      // Forcefully close from server side
      serverWs.terminate();

      await disconnectPromise;
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit error on connection issues', async () => {
      const connectionPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => {
          resolve(ws);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      const serverWs = await connectionPromise;

      const errorPromise = waitForEvent(client, 'error');

      // Force an error by sending invalid frame
      (serverWs as any)._socket.write(Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]));

      const error = await errorPromise;
      expect(error).toBeDefined();
    });

    it('should handle close with custom codes', async () => {
      let serverWs: WebSocket;
      let closeCode: number | undefined;
      let closeReason: string | undefined;

      const connectionPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => {
          ws.on('close', (code, reason) => {
            closeCode = code;
            closeReason = reason?.toString();
          });
          resolve(ws);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverWs = await connectionPromise;

      await client.close(4001, 'Custom close reason');

      // Wait for close to propagate
      await delay(100);

      expect(closeCode).toBe(4001);
      expect(closeReason).toBe('Custom close reason');
    });
  });

  describe('Server Broadcast', () => {
    it('should broadcast to all connected clients', async () => {
      const serverPort = await getFreePort();
      const server = await transport.createServer({ port: serverPort });

      // Wait for the server to emit 'listening' event
      const listeningPromise = waitForEvent(server, 'listening');
      await server.listen();
      await listeningPromise;

      // Connect multiple clients
      const connPromise1 = waitForEvent(server, 'connection');
      const client1 = await transport.connect(`ws://127.0.0.1:${serverPort}`);
      await connPromise1;

      const connPromise2 = waitForEvent(server, 'connection');
      const client2 = await transport.connect(`ws://127.0.0.1:${serverPort}`);
      await connPromise2;

      const connPromise3 = waitForEvent(server, 'connection');
      const client3 = await transport.connect(`ws://127.0.0.1:${serverPort}`);
      await connPromise3;

      // Set up data listeners
      const data1Promise = waitForEvent(client1, 'data');
      const data2Promise = waitForEvent(client2, 'data');
      const data3Promise = waitForEvent(client3, 'data');

      // Broadcast message - use short data that can't be mistaken for a packet
      const broadcastData = Buffer.from([0xAA, 0xBB, 0xCC]);
      await server.broadcast(broadcastData);

      // All clients should receive the message
      const [data1, data2, data3] = await Promise.all([
        data1Promise,
        data2Promise,
        data3Promise
      ]);

      expect(Buffer.from(data1 as any)).toEqual(broadcastData);
      expect(Buffer.from(data2 as any)).toEqual(broadcastData);
      expect(Buffer.from(data3 as any)).toEqual(broadcastData);

      // Clean up
      await client1.close();
      await client2.close();
      await client3.close();
      await server.close();
    });
  });

  describe('Reconnection', () => {
    it('should attempt reconnection when configured', async () => {
      let serverWs: WebSocket;

      const connectionPromise = new Promise<WebSocket>((resolve) => {
        wsServer.once('connection', (ws) => {
          resolve(ws);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`, {
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          delay: 100,
          maxDelay: 500
        }
      });

      serverWs = await connectionPromise;

      // Listen for reconnect attempt
      const reconnectPromise = waitForEvent(client, 'reconnect');

      // Force disconnect from server
      serverWs.terminate();

      // Should attempt to reconnect
      const attempt = await reconnectPromise;
      expect(attempt).toBe(1);

      await client.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid addresses', async () => {
      try {
        await transport.connect('invalid://address');
        fail('Should have thrown error for invalid address');
      } catch (error: any) {
        expect(error.message).toContain('Invalid WebSocket address');
      }
    });

    it('should handle connection to non-WebSocket server', async () => {
      // Create a regular HTTP server
      const httpOnlyServer = createServer((req, res) => {
        res.writeHead(200);
        res.end('Not a WebSocket');
      });

      const httpPort = await getFreePort();
      await promisify(httpOnlyServer.listen).bind(httpOnlyServer)(httpPort);

      try {
        await transport.connect(`ws://127.0.0.1:${httpPort}`, {
          connectTimeout: 1000
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toMatch(/Unexpected server response|Connection failed/);
      } finally {
        httpOnlyServer.close();
      }
    });
  });

  describe('Connection State Transitions', () => {
    it('should transition through correct states', async () => {
      const states: ConnectionState[] = [];

      let serverWs: WebSocket;
      const connectionPromise = new Promise<WebSocket>((resolve) => {
        wsServer.on('connection', (ws) => {
          resolve(ws);
        });
      });

      const client = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverWs = await connectionPromise;

      client.on('state', (state: ConnectionState) => {
        states.push(state);
      });

      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();

      // Should have transitioned to disconnected
      expect(states).toContain(ConnectionState.DISCONNECTED);
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('WebSocket Subprotocols', () => {
    it('should handle subprotocol negotiation', async () => {
      // Create a new server on a different port
      const subprotocolPort = await getFreePort();
      const subprotocolHttpServer = createServer();
      await promisify(subprotocolHttpServer.listen).bind(subprotocolHttpServer)(subprotocolPort);

      // Configure server to accept specific subprotocol
      const customWsServer = new WebSocketServer({
        server: subprotocolHttpServer,
        handleProtocols: (protocols) => protocols.has('netron') ? 'netron' : false
      });

      let serverWs: WebSocket;
      const connectionPromise = new Promise<WebSocket>((resolve) => {
        customWsServer.on('connection', (ws) => {
          resolve(ws);
        });
      });

      // Connect with subprotocol
      const ws = new WebSocket(`ws://127.0.0.1:${subprotocolPort}`, ['netron']);

      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      serverWs = await connectionPromise;
      expect(ws.protocol).toBe('netron');

      ws.close();
      customWsServer.close();
      await promisify(subprotocolHttpServer.close).bind(subprotocolHttpServer)();
    });
  });
});