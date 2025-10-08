/**
 * Unix Domain Socket Transport Tests
 *
 * Tests Unix domain socket transport implementation with real connections.
 * Also tests named pipes on Windows.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { UnixSocketTransport, NamedPipeTransport } from '../../../src/netron/transport/unix-transport.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import { Packet } from '../../../src/netron/packet/index.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Socket } from 'node:net';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Helper to generate unique socket path
function getSocketPath(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);

  if (process.platform === 'win32') {
    // Windows named pipe
    return `\\\\.\\pipe\\test-${timestamp}-${random}`;
  } else {
    // Unix domain socket
    return join(tmpdir(), `test-${timestamp}-${random}.sock`);
  }
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

describe('Unix Domain Socket Transport', () => {
  let transport: UnixSocketTransport | NamedPipeTransport;
  let socketPath: string;
  const isWindows = process.platform === 'win32';

  beforeEach(() => {
    transport = isWindows ? new NamedPipeTransport() : new UnixSocketTransport();
    socketPath = getSocketPath();
  });

  afterEach(async () => {
    await cleanupSocketFile(socketPath);
  });

  describe('Basic Functionality', () => {
    it('should have correct capabilities', () => {
      expect(transport.name).toBe(isWindows ? 'pipe' : 'unix');
      expect(transport.capabilities).toEqual({
        streaming: true,
        bidirectional: true,
        binary: true,
        reconnection: true,
        multiplexing: false,
        server: true
      });
    });

    it('should validate Unix socket addresses correctly', () => {
      if (isWindows) {
        expect(transport.isValidAddress('\\\\.\\pipe\\test')).toBe(true);
        expect(transport.isValidAddress('pipe://test')).toBe(true);
        expect(transport.isValidAddress('tcp://localhost:8080')).toBe(false);
      } else {
        expect(transport.isValidAddress('unix:///tmp/socket')).toBe(true);
        expect(transport.isValidAddress('/tmp/socket')).toBe(true);
        expect(transport.isValidAddress('tcp://localhost:8080')).toBe(false);
      }
    });

    it('should parse Unix socket addresses correctly', () => {
      if (isWindows) {
        const addr1 = transport.parseAddress('\\\\.\\pipe\\test');
        expect(addr1).toEqual({
          protocol: 'pipe',
          path: '\\\\.\\pipe\\test',
          params: {}
        });

        const addr2 = transport.parseAddress('pipe://test');
        expect(addr2).toEqual({
          protocol: 'pipe',
          path: '\\\\.\\pipe\\test',
          params: {}
        });
      } else {
        const addr1 = transport.parseAddress('unix:///tmp/socket');
        expect(addr1).toEqual({
          protocol: 'unix',
          path: '/tmp/socket',
          params: {}
        });

        const addr2 = transport.parseAddress('/tmp/socket');
        expect(addr2).toEqual({
          protocol: 'unix',
          path: '/tmp/socket',
          params: {}
        });
      }
    });
  });

  describe('Server Creation and Listening', () => {
    it('should create and start a Unix socket server', async () => {
      const server = await transport.createServer(socketPath);
      expect(server).toBeDefined();

      await server.listen();

      // Verify socket file exists (Unix only)
      if (!isWindows) {
        const stats = await fs.stat(socketPath);
        expect(stats.isSocket()).toBe(true);
      }

      await server.close();
    });

    it('should emit listening event when server starts', async () => {
      const server = await transport.createServer(socketPath);

      const listeningPromise = waitForEvent(server, 'listening');
      await server.listen();
      await listeningPromise;

      await server.close();
    });

    it('should handle multiple connections', async () => {
      const server = await transport.createServer(socketPath);
      await server.listen();

      // Accept connections
      const conn1Promise = waitForEvent(server, 'connection');
      const conn2Promise = conn1Promise.then(() => waitForEvent(server, 'connection'));

      // Create two client connections
      const client1 = await transport.connect(socketPath);
      const connection1 = await conn1Promise;

      const client2 = await transport.connect(socketPath);
      const connection2 = await conn2Promise;

      expect(server.connections.size).toBe(2);

      await client1.close();
      await client2.close();
      await server.close();
    });

    it('should clean up socket file on close', async () => {
      if (isWindows) {
        // Skip for Windows - named pipes don't have files
        return;
      }

      const server = await transport.createServer(socketPath);
      await server.listen();

      // Socket file should exist
      const statsBeforeClose = await fs.stat(socketPath);
      expect(statsBeforeClose.isSocket()).toBe(true);

      await server.close();

      // Socket file should be removed
      await expect(fs.stat(socketPath)).rejects.toThrow();
    });
  });

  describe('Client Connection', () => {
    let server: any;

    beforeEach(async () => {
      server = await transport.createServer(socketPath);
      await server.listen();
    });

    afterEach(async () => {
      await server.close();
    });

    it('should connect to Unix socket server', async () => {
      const client = await transport.connect(socketPath);

      expect(client).toBeDefined();
      expect(client.state).toBe(ConnectionState.CONNECTED);
      expect(client.remoteAddress).toBe(socketPath);

      await client.close();
    });

    it('should emit connect event on successful connection', async () => {
      const connectionPromise = transport.connect(socketPath);
      const client = await connectionPromise;

      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
    });

    it('should handle connection failure', async () => {
      const fakePath = getSocketPath();

      try {
        await transport.connect(fakePath, {
          connectTimeout: 1000
        });
        fail('Should have thrown connection error');
      } catch (error: any) {
        expect(error.message).toMatch(/ENOENT|ECONNREFUSED|cannot find/i);
      }
    });

    it('should handle reconnection', async () => {
      const client = await transport.connect(socketPath);
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
      expect(client.state).toBe(ConnectionState.DISCONNECTED);

      // Create new connection to same server
      const client2 = await transport.connect(socketPath);
      expect(client2.state).toBe(ConnectionState.CONNECTED);

      await client2.close();
    });
  });

  describe('Data Transmission', () => {
    let server: any;
    let serverConnection: any;
    let clientConnection: any;

    beforeEach(async () => {
      server = await transport.createServer(socketPath);
      await server.listen();

      // Set up server connection handler
      const connectionPromise = waitForEvent(server, 'connection');

      // Connect client
      clientConnection = await transport.connect(socketPath);
      serverConnection = await connectionPromise;
    });

    afterEach(async () => {
      await clientConnection?.close();
      await serverConnection?.close();
      await server?.close();
    });

    it('should send and receive raw data', async () => {
      const testData = Buffer.from('Hello, Unix Socket!');

      // Server listens for data event (raw text is emitted as 'data', not 'packet')
      const dataPromise = waitForEvent(serverConnection, 'data');

      // Client sends data
      await clientConnection.send(testData);

      // Server receives data
      const receivedData = await dataPromise;
      // The received data is the raw buffer after length prefix is stripped
      expect(receivedData).toBeDefined();
      expect(Buffer.isBuffer(receivedData)).toBe(true);
      expect(receivedData.toString()).toBe('Hello, Unix Socket!');
    });

    it('should send and receive packets', async () => {
      const testPacket = new Packet(1);
      testPacket.setType(1);
      testPacket.data = { message: 'Unix packet' };

      // Server listens for packet
      const packetPromise = waitForEvent(serverConnection, 'packet');

      // Client sends packet
      await clientConnection.sendPacket(testPacket);

      // Server receives packet
      const receivedPacket = await packetPromise;
      expect(receivedPacket).toBeDefined();
      expect(receivedPacket.getType()).toBe(testPacket.getType());
      expect(receivedPacket.data).toEqual(testPacket.data);
    });

    it('should handle bidirectional communication', async () => {
      const clientData = Buffer.from('Client message');
      const serverData = Buffer.from('Server response');

      // Set up listeners (raw text data emits 'data' events)
      const serverDataPromise = waitForEvent(serverConnection, 'data');
      const clientDataPromise = waitForEvent(clientConnection, 'data');

      // Client sends to server
      await clientConnection.send(clientData);
      const serverReceived = await serverDataPromise;
      expect(serverReceived).toBeDefined();
      expect(serverReceived.toString()).toBe('Client message');

      // Server responds to client
      await serverConnection.send(serverData);
      const clientReceived = await clientDataPromise;
      expect(clientReceived).toBeDefined();
      expect(clientReceived.toString()).toBe('Server response');
    });

    it('should handle rapid data exchange', async () => {
      const messageCount = 100;
      const messages: any[] = [];

      serverConnection.on('data', (data: any) => {
        messages.push(data);
      });

      // Send many messages rapidly
      for (let i = 0; i < messageCount; i++) {
        await clientConnection.send(Buffer.from(`Message ${i}`));
      }

      // Give some time for all messages to arrive
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBe(messageCount);
    });

    it('should handle large data transfers', async () => {
      const largeData = Buffer.alloc(1024 * 1024 * 5, 'x'); // 5MB of 'x'

      const dataPromise = waitForEvent(serverConnection, 'data', 10000);

      await clientConnection.send(largeData);

      const receivedData = await dataPromise;
      expect(receivedData).toBeDefined();
      expect(receivedData.length).toBe(largeData.length);
    });

    it('should track connection metrics', async () => {
      const testData = Buffer.from('Metric test');
      const packet = new Packet(1);
      packet.setType(1);
      packet.data = {};

      await clientConnection.send(testData);
      await clientConnection.sendPacket(packet);

      const metrics = clientConnection.getMetrics();
      expect(metrics.bytesSent).toBeGreaterThan(0);
      expect(metrics.packetsSent).toBe(1);
      expect(metrics.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Connection Management', () => {
    let server: any;

    beforeEach(async () => {
      server = await transport.createServer(socketPath);
      await server.listen();
    });

    afterEach(async () => {
      await server?.close();
    });

    it('should handle graceful disconnection', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(socketPath);
      const serverConn = await serverConnPromise;

      const disconnectPromise = waitForEvent(client, 'disconnect');

      await client.close();

      await disconnectPromise;
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should handle abrupt disconnection', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(socketPath);
      const serverConn = await serverConnPromise;

      const disconnectPromise = waitForEvent(client, 'disconnect');

      // Forcefully close from server side
      await serverConn.close();

      await disconnectPromise;
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit error on connection issues', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(socketPath);
      const serverConn = await serverConnPromise;

      const errorPromise = waitForEvent(client, 'error');

      // Force an error by destroying the underlying socket
      const socket = (client as any).socket as Socket;
      socket.destroy(new Error('Forced error'));

      const error = await errorPromise;
      expect(error).toBeDefined();
      expect(client.state).toBe(ConnectionState.ERROR);
    });

    it('should clean up resources on close', async () => {
      const client = await transport.connect(socketPath);

      await client.close();

      // Try to send after close should fail
      try {
        await client.send(Buffer.from('test'));
        fail('Should not be able to send after close');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Server Broadcast', () => {
    it('should broadcast to all connected clients', async () => {
      const server = await transport.createServer(socketPath);
      await server.listen();

      // Connect multiple clients
      const connPromise1 = waitForEvent(server, 'connection');
      const client1 = await transport.connect(socketPath);
      await connPromise1;

      const connPromise2 = waitForEvent(server, 'connection');
      const client2 = await transport.connect(socketPath);
      await connPromise2;

      const connPromise3 = waitForEvent(server, 'connection');
      const client3 = await transport.connect(socketPath);
      await connPromise3;

      // Set up data listeners (raw text data emits 'data' events)
      const data1Promise = waitForEvent(client1, 'data');
      const data2Promise = waitForEvent(client2, 'data');
      const data3Promise = waitForEvent(client3, 'data');

      // Broadcast message
      const broadcastData = Buffer.from('Broadcast message');
      await server.broadcast(broadcastData);

      // All clients should receive the message
      const [data1, data2, data3] = await Promise.all([
        data1Promise,
        data2Promise,
        data3Promise
      ]);

      expect(data1).toBeDefined();
      expect(data2).toBeDefined();
      expect(data3).toBeDefined();
      expect(data1.toString()).toBe('Broadcast message');
      expect(data2.toString()).toBe('Broadcast message');
      expect(data3.toString()).toBe('Broadcast message');

      // Clean up
      await client1.close();
      await client2.close();
      await client3.close();
      await server.close();
    });
  });

  describe('Unified TYPE_PING Protocol', () => {
    let server: any;
    let serverConnection: any;
    let clientConnection: any;

    beforeEach(async () => {
      server = await transport.createServer(socketPath);
      await server.listen();

      // Set up server connection handler
      const connectionPromise = waitForEvent(server, 'connection');

      // Connect client
      clientConnection = await transport.connect(socketPath);
      serverConnection = await connectionPromise;
    });

    afterEach(async () => {
      await clientConnection?.close();
      await serverConnection?.close();
      await server?.close();
    });

    it('should measure round-trip time using TYPE_PING packets', async () => {
      // Client sends TYPE_PING packet
      const rtt = await clientConnection.ping();

      // RTT should be a non-negative number (Unix sockets can be 0ms on fast systems)
      expect(typeof rtt).toBe('number');
      expect(rtt).toBeGreaterThanOrEqual(0);
      expect(rtt).toBeLessThan(1000); // Should be less than 1 second on localhost

      // Check that metrics were updated
      const metrics = clientConnection.getMetrics();
      expect(metrics.rtt).toBe(rtt);
    });

    it('should automatically respond to ping requests', async () => {
      // Server sends TYPE_PING packet
      const rtt = await serverConnection.ping();

      // Client should have automatically responded (Unix sockets can be 0ms on fast systems)
      expect(typeof rtt).toBe('number');
      expect(rtt).toBeGreaterThanOrEqual(0);
    });

    it('should handle ping timeout', async () => {
      // Wait for new server connection
      const newConnPromise = waitForEvent(server, 'connection');

      // Create connection with short timeout
      const shortTimeoutClient = await transport.connect(socketPath, {
        requestTimeout: 100
      });

      const newServerConn = await newConnPromise;

      // Prevent server from responding to ping by blocking handleData
      const originalHandleData = (newServerConn as any).handleData;
      (newServerConn as any).handleData = () => {
        // Drop all incoming data
      };

      // Ping should timeout
      await expect(shortTimeoutClient.ping()).rejects.toThrow('timeout');

      // Restore original handler for cleanup
      (newServerConn as any).handleData = originalHandleData;

      await shortTimeoutClient.close();
    });

    it('should fail ping when connection not established', async () => {
      // Close the connection
      await clientConnection.close();

      // Wait for disconnect
      await new Promise(resolve => setTimeout(resolve, 100));

      // Ping should fail
      await expect(clientConnection.ping()).rejects.toThrow('not established');
    });

    it('should handle multiple concurrent pings', async () => {
      // Send multiple pings concurrently
      const pingPromises = [
        clientConnection.ping(),
        clientConnection.ping(),
        clientConnection.ping()
      ];

      const rtts = await Promise.all(pingPromises);

      // All pings should succeed (Unix sockets can be 0ms on fast systems)
      expect(rtts.length).toBe(3);
      rtts.forEach(rtt => {
        expect(typeof rtt).toBe('number');
        expect(rtt).toBeGreaterThanOrEqual(0);
      });
    });

    it('should handle bidirectional pings', async () => {
      // Both client and server send pings simultaneously
      const [clientRtt, serverRtt] = await Promise.all([
        clientConnection.ping(),
        serverConnection.ping()
      ]);

      // Unix sockets can be 0ms on fast systems
      expect(typeof clientRtt).toBe('number');
      expect(clientRtt).toBeGreaterThanOrEqual(0);
      expect(typeof serverRtt).toBe('number');
      expect(serverRtt).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid addresses', async () => {
      try {
        await transport.connect('tcp://invalid:8080');
        fail('Should have thrown error for invalid address');
      } catch (error: any) {
        expect(error.message).toContain('Invalid');
      }
    });

    it('should handle permission errors', async () => {
      if (isWindows) {
        // Skip on Windows - different permission model
        return;
      }

      // Try to create socket in restricted directory
      const restrictedPath = '/socket.sock';

      try {
        const server = await transport.createServer(restrictedPath);
        await server.listen();
        fail('Should have thrown permission error');
      } catch (error: any) {
        expect(error.message).toMatch(/EACCES|permission|EROFS|read-only/i);
      }
    });

    it('should handle socket file conflicts', async () => {
      if (isWindows) {
        // Skip on Windows - named pipes handle this differently
        return;
      }

      const server1 = await transport.createServer(socketPath);
      await server1.listen();

      try {
        const server2 = await transport.createServer(socketPath);
        await server2.listen();
        fail('Should have thrown address in use error');
      } catch (error: any) {
        expect(error.message).toMatch(/EADDRINUSE|in use/i);
      } finally {
        await server1.close();
      }
    });
  });

  describe('Connection State Transitions', () => {
    it('should transition through correct states', async () => {
      const server = await transport.createServer(socketPath);
      await server.listen();

      const states: ConnectionState[] = [];

      const client = await transport.connect(socketPath);

      client.on('state', (state: ConnectionState) => {
        states.push(state);
      });

      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();

      // Should have transitioned to disconnected
      expect(states).toContain(ConnectionState.DISCONNECTED);
      expect(client.state).toBe(ConnectionState.DISCONNECTED);

      await server.close();
    });
  });

  describe('Platform-specific Tests', () => {
    if (isWindows) {
      describe('Windows Named Pipes', () => {
        it('should use correct pipe path format', () => {
          const pipeName = 'test-pipe';
          const addr = transport.parseAddress(`pipe://${pipeName}`);
          expect(addr.path).toBe(`\\\\.\\pipe\\${pipeName}`);
        });

        it('should handle pipe names with special characters', () => {
          const pipeName = 'test-pipe-123_abc';
          const addr = transport.parseAddress(`pipe://${pipeName}`);
          expect(addr.path).toBe(`\\\\.\\pipe\\${pipeName}`);
        });
      });
    } else {
      describe('Unix Domain Sockets', () => {
        it('should handle relative paths', () => {
          const relativePath = './test.sock';
          const addr = transport.parseAddress(relativePath);
          expect(addr.path).toBe(relativePath);
        });

        it('should handle abstract sockets (Linux)', () => {
          if (process.platform !== 'linux') {
            // Skip on non-Linux platforms
            return;
          }

          const abstractPath = '\0abstract-socket';
          const addr = transport.parseAddress(abstractPath);
          expect(addr.path).toBe(abstractPath);
        });
      });
    }
  });
});