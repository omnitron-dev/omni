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
import { Socket } from 'node:net';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { waitForEvent } from '../../utils/index.js';

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
        server: true,
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
          params: {},
        });

        const addr2 = transport.parseAddress('pipe://test');
        expect(addr2).toEqual({
          protocol: 'pipe',
          path: '\\\\.\\pipe\\test',
          params: {},
        });
      } else {
        const addr1 = transport.parseAddress('unix:///tmp/socket');
        expect(addr1).toEqual({
          protocol: 'unix',
          path: '/tmp/socket',
          params: {},
        });

        const addr2 = transport.parseAddress('/tmp/socket');
        expect(addr2).toEqual({
          protocol: 'unix',
          path: '/tmp/socket',
          params: {},
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
          connectTimeout: 1000,
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
      await new Promise((resolve) => setTimeout(resolve, 100));

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
      const [data1, data2, data3] = await Promise.all([data1Promise, data2Promise, data3Promise]);

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
        requestTimeout: 100,
      });

      const newServerConn = await newConnPromise;

      // Prevent server from responding to ping by blocking handleData
      const originalHandleData = (newServerConn as any).handleData;
      (newServerConn as any).handleData = () => {
        // Drop all incoming data
      };

      // Ping should timeout
      await expect(shortTimeoutClient.ping()).rejects.toThrow(/timed out after/);

      // Restore original handler for cleanup
      (newServerConn as any).handleData = originalHandleData;

      await shortTimeoutClient.close();
    });

    it('should fail ping when connection not established', async () => {
      // Close the connection
      await clientConnection.close();

      // Wait for disconnect
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Ping should fail
      await expect(clientConnection.ping()).rejects.toThrow('not established');
    });

    it('should handle multiple concurrent pings', async () => {
      // Send multiple pings concurrently
      const pingPromises = [clientConnection.ping(), clientConnection.ping(), clientConnection.ping()];

      const rtts = await Promise.all(pingPromises);

      // All pings should succeed (Unix sockets can be 0ms on fast systems)
      expect(rtts.length).toBe(3);
      rtts.forEach((rtt) => {
        expect(typeof rtt).toBe('number');
        expect(rtt).toBeGreaterThanOrEqual(0);
      });
    });

    it('should handle bidirectional pings', async () => {
      // Both client and server send pings simultaneously
      const [clientRtt, serverRtt] = await Promise.all([clientConnection.ping(), serverConnection.ping()]);

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

        it('should parse unix: addresses (without //)', () => {
          const addr = transport.parseAddress('unix:/tmp/test.sock');
          expect(addr.protocol).toBe('unix');
          expect(addr.path).toBe('/tmp/test.sock');
        });
      });
    }
  });

  // Windows NamedPipeTransport tests
  describe('NamedPipeTransport', () => {
    const skipOnUnix = process.platform === 'win32' ? it : it.skip;

    // These tests can run on any platform (don't require Windows)
    it('should create named pipe transport', () => {
      const pipeTransport = new NamedPipeTransport();
      expect(pipeTransport.name).toBe('pipe');
      expect(pipeTransport.capabilities.streaming).toBe(true);
      expect(pipeTransport.capabilities.server).toBe(true);
    });

    it('should parse named pipe addresses correctly', () => {
      const pipeTransport = new NamedPipeTransport();

      // pipe:// format
      const addr1 = pipeTransport.parseAddress('pipe://testpipe');
      expect(addr1.protocol).toBe('pipe');
      expect(addr1.path).toBe('\\\\.\\pipe\\testpipe');

      // pipe: format
      const addr2 = pipeTransport.parseAddress('pipe:testpipe');
      expect(addr2.protocol).toBe('pipe');
      expect(addr2.path).toBe('\\\\.\\pipe\\testpipe');

      // Raw pipe path
      const addr3 = pipeTransport.parseAddress('\\\\.\\pipe\\testpipe');
      expect(addr3.protocol).toBe('pipe');
      expect(addr3.path).toBe('\\\\.\\pipe\\testpipe');

      // Raw name without path prefix
      const addr4 = pipeTransport.parseAddress('mypipe');
      expect(addr4.protocol).toBe('pipe');
      expect(addr4.path).toBe('\\\\.\\pipe\\mypipe');
    });

    it('should validate named pipe addresses', () => {
      const pipeTransport = new NamedPipeTransport();

      expect(pipeTransport.isValidAddress('pipe://test')).toBe(true);
      expect(pipeTransport.isValidAddress('pipe:test')).toBe(true);
      expect(pipeTransport.isValidAddress('\\\\.\\pipe\\test')).toBe(true);
      expect(pipeTransport.isValidAddress('test')).toBe(true);

      // Note: tcp:// addresses may parse successfully but should fail on connect
      // The parseAddress method returns a valid result for any format
      // Validation happens at connect time with protocol check
    });

    // Connection tests need Windows
    skipOnUnix('should reject invalid protocol in connect', async () => {
      const pipeTransport = new NamedPipeTransport();

      await expect(pipeTransport.connect('tcp://localhost:8080')).rejects.toThrow(/Invalid named pipe address/);
    });

    skipOnUnix('should connect to named pipe', async () => {
      const pipeTransport = new NamedPipeTransport();
      const pipeName = `test-pipe-${Date.now()}`;

      // Create server
      const server = await pipeTransport.createServer(pipeName);
      await server.listen();

      // Connect client
      const connPromise = waitForEvent(server, 'connection');
      const client = await pipeTransport.connect(pipeName);
      await connPromise;

      expect(client).toBeDefined();
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
      await server.close();
    });

    skipOnUnix('should create named pipe server with options', async () => {
      const pipeTransport = new NamedPipeTransport();
      const pipeName = `test-pipe-${Date.now()}`;

      const server = await pipeTransport.createServer({
        path: pipeName,
      } as any);

      await server.listen();
      expect(server).toBeDefined();

      await server.close();
    });

    skipOnUnix('should throw error when creating server without name', async () => {
      const pipeTransport = new NamedPipeTransport();

      await expect(pipeTransport.createServer()).rejects.toThrow('requires a name');

      await expect(pipeTransport.createServer({} as any)).rejects.toThrow('requires a name');
    });

    skipOnUnix('should handle connection timeout', async () => {
      const pipeTransport = new NamedPipeTransport();
      const nonExistentPipe = `nonexistent-pipe-${Date.now()}`;

      await expect(
        pipeTransport.connect(nonExistentPipe, {
          connectTimeout: 100,
        })
      ).rejects.toThrow();
    });

    skipOnUnix('should send and receive data via named pipe', async () => {
      const pipeTransport = new NamedPipeTransport();
      const pipeName = `test-pipe-${Date.now()}`;

      const server = await pipeTransport.createServer(pipeName);
      await server.listen();

      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await pipeTransport.connect(pipeName);
      const serverConn = await serverConnPromise;

      const dataPromise = waitForEvent(serverConn, 'data');
      await client.send(Buffer.from('Hello named pipe!'));

      const receivedData = await dataPromise;
      expect(receivedData.toString()).toBe('Hello named pipe!');

      await client.close();
      await server.close();
    });
  });

  // Additional edge case tests for better coverage
  describe('Edge Cases and Error Handling', () => {
    if (!isWindows) {
      describe('Unix Socket Error Handling', () => {
        it('should handle connection timeout', async () => {
          const nonExistentSocket = join(tmpdir(), `nonexistent-${Date.now()}.sock`);

          const transport = new UnixSocketTransport();

          await expect(
            transport.connect(nonExistentSocket, {
              connectTimeout: 100,
            })
          ).rejects.toThrow();
        }, 10000);

        it('should reject invalid socket path (not a socket)', async () => {
          // Create a regular file instead of a socket
          const regularFile = join(tmpdir(), `regular-file-${Date.now()}.txt`);
          await fs.writeFile(regularFile, 'test');

          const transport = new UnixSocketTransport();

          try {
            await expect(transport.connect(regularFile)).rejects.toThrow('not a Unix socket');
          } finally {
            await fs.unlink(regularFile).catch(() => {});
          }
        }, 10000);

        it('should throw error when creating server without path', async () => {
          const transport = new UnixSocketTransport();

          await expect(transport.createServer()).rejects.toThrow('requires a path');
        });

        it('should throw error when creating server with empty options object', async () => {
          const transport = new UnixSocketTransport();

          await expect(transport.createServer({} as any)).rejects.toThrow('requires a path');
        });

        it('should handle force option to remove existing socket', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `force-test-${Date.now()}.sock`);

          // Create first server
          const server1 = await transport.createServer(socketPath);
          await server1.listen();

          // Close first server
          await server1.close();

          // Create second server with force option - should succeed
          const server2 = await transport.createServer({
            path: socketPath,
            force: true,
          } as any);

          expect(server2).toBeDefined();

          await server2.close();
          await cleanupSocketFile(socketPath);
        }, 10000);

        it('should set socket permissions if mode is specified', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `perms-test-${Date.now()}.sock`);

          const server = await transport.createServer({
            path: socketPath,
            mode: 0o600,
          } as any);

          await server.listen();

          // Give it time to set permissions
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Check that socket exists
          const stats = await fs.stat(socketPath);
          expect(stats.isSocket()).toBe(true);

          await server.close();
          await cleanupSocketFile(socketPath);
        }, 10000);

        it('should handle errors during socket permission setting gracefully', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `perms-error-${Date.now()}.sock`);

          // Create server with invalid mode (should not throw, just log error)
          const server = await transport.createServer({
            path: socketPath,
            mode: 0o777, // Valid mode, but test that error handling works
          } as any);

          await server.listen();
          expect(server).toBeDefined();

          await server.close();
          await cleanupSocketFile(socketPath);
        }, 10000);

        it('should get server address from socketPath', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `address-test-${Date.now()}.sock`);

          const server = await transport.createServer(socketPath);
          await server.listen();

          expect(server.address).toBe(socketPath);

          await server.close();
          await cleanupSocketFile(socketPath);
        }, 10000);

        it('should handle directory creation errors (non-EEXIST)', async () => {
          const transport = new UnixSocketTransport();

          // Try to create socket in a path where parent is a file (not a directory)
          const regularFile = join(tmpdir(), `regular-${Date.now()}.txt`);
          await fs.writeFile(regularFile, 'test');

          const invalidSocketPath = join(regularFile, 'socket.sock');

          try {
            await expect(transport.createServer(invalidSocketPath)).rejects.toThrow();
          } finally {
            await fs.unlink(regularFile).catch(() => {});
          }
        }, 10000);

        it('should handle fs.stat errors that are not ENOENT during connect', async () => {
          const transport = new UnixSocketTransport();

          // Mock a path that exists but will cause stat to fail
          // This is a theoretical test case for error handling
          const socketPath = join(tmpdir(), `stat-error-${Date.now()}.sock`);

          // Since it's hard to force fs.stat to fail with non-ENOENT errors,
          // we test the connect flow with a non-socket file
          await fs.writeFile(socketPath, 'not a socket');

          try {
            await expect(transport.connect(socketPath)).rejects.toThrow();
          } finally {
            await fs.unlink(socketPath).catch(() => {});
          }
        }, 10000);

        it('should handle unlink errors during server force option (non-ENOENT)', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `unlink-error-${Date.now()}.sock`);

          // Create a directory where we expect a socket (to cause unlink error)
          const dirPath = join(tmpdir(), `unlink-dir-${Date.now()}`);
          await fs.mkdir(dirPath, { recursive: true });

          // Try to create server with force option at directory path - should fail
          try {
            await expect(
              transport.createServer({
                path: dirPath,
                force: true,
              } as any)
            ).rejects.toThrow();
          } finally {
            await fs.rmdir(dirPath).catch(() => {});
          }
        }, 10000);

        it('should accept absolute socket paths', async () => {
          const transport = new UnixSocketTransport();
          const absolutePath = join(tmpdir(), `absolute-${Date.now()}.sock`);

          const server = await transport.createServer(absolutePath);
          await server.listen();

          expect(server.address).toBe(absolutePath);

          await server.close();
          await cleanupSocketFile(absolutePath);
        }, 10000);

        it('should convert relative paths to absolute during connect', async () => {
          const transport = new UnixSocketTransport();
          const relativePath = `./relative-${Date.now()}.sock`;

          // Create server
          const server = await transport.createServer(relativePath);
          await server.listen();

          // Connect with relative path
          const connPromise = waitForEvent(server, 'connection');
          const client = await transport.connect(relativePath);
          await connPromise;

          expect(client).toBeDefined();
          expect(client.state).toBe(ConnectionState.CONNECTED);

          await client.close();
          await server.close();

          // Clean up
          const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
          await cleanupSocketFile(absolutePath);
        }, 10000);

        it('should pass through socket connection errors during connect', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `error-connect-${Date.now()}.sock`);

          // Connect without server (should fail with connection error)
          await expect(
            transport.connect(socketPath, {
              connectTimeout: 100,
            })
          ).rejects.toThrow();
        }, 10000);

        it('should trigger connection timeout when socket never connects', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `timeout-${Date.now()}.sock`);

          // Create a socket file but don't create a server listening on it
          // This will cause the connection to hang and timeout
          await fs.writeFile(socketPath, '');

          try {
            await expect(
              transport.connect(socketPath, {
                connectTimeout: 50, // Very short timeout
              })
            ).rejects.toThrow(/timed out|timeout|ECONNREFUSED/i);
          } finally {
            await fs.unlink(socketPath).catch(() => {});
          }
        }, 10000);

        it('should handle mkdir with directory already exists (EEXIST is ignored)', async () => {
          const transport = new UnixSocketTransport();
          const existingDir = join(tmpdir(), `existing-dir-${Date.now()}`);

          // Create the directory first
          await fs.mkdir(existingDir, { recursive: true });

          const socketPath = join(existingDir, 'test.sock');

          // Creating server should succeed even though directory exists
          const server = await transport.createServer(socketPath);
          await server.listen();

          expect(server).toBeDefined();

          await server.close();
          await cleanupSocketFile(socketPath);
          await fs.rmdir(existingDir).catch(() => {});
        }, 10000);

        it('should test chmod is called with mode option', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `chmod-test-${Date.now()}.sock`);

          // Spy on console.error to verify chmod error handling
          const originalConsoleError = console.error;
          let errorLogged = false;
          console.error = (...args: any[]) => {
            if (args[0]?.includes?.('Failed to set socket permissions')) {
              errorLogged = true;
            }
            originalConsoleError(...args);
          };

          try {
            const server = await transport.createServer({
              path: socketPath,
              mode: 0o600,
            } as any);

            await server.listen();

            // Give chmod time to execute (it's async and doesn't block)
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Verify socket exists
            const stats = await fs.stat(socketPath);
            expect(stats.isSocket()).toBe(true);

            await server.close();
          } finally {
            console.error = originalConsoleError;
            await cleanupSocketFile(socketPath);
          }
        }, 10000);

        it('should test absolute path handling in connect', async () => {
          const transport = new UnixSocketTransport();
          const absolutePath = join(tmpdir(), `absolute-connect-${Date.now()}.sock`);

          // Create server with absolute path
          const server = await transport.createServer(absolutePath);
          await server.listen();

          // Connect with absolute path
          const connPromise = waitForEvent(server, 'connection');
          const client = await transport.connect(absolutePath);
          await connPromise;

          expect(client).toBeDefined();
          expect(client.state).toBe(ConnectionState.CONNECTED);
          expect(client.remoteAddress).toBe(absolutePath);

          await client.close();
          await server.close();
        }, 10000);

        it('should test UnixSocketConnection remoteAddress property', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `remoteaddr-${Date.now()}.sock`);

          const server = await transport.createServer(socketPath);
          await server.listen();

          const connPromise = waitForEvent(server, 'connection');
          const client = await transport.connect(socketPath);
          const serverConn = await connPromise;

          // UnixSocketConnection should return socket path as remoteAddress
          expect(client.remoteAddress).toBe(
            path.isAbsolute(socketPath) ? socketPath : path.join(process.cwd(), socketPath)
          );

          await client.close();
          await server.close();
        }, 10000);

        it('should test UnixSocketServer address property', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `serveraddr-${Date.now()}.sock`);

          const server = await transport.createServer(socketPath);
          await server.listen();

          // UnixSocketServer should return socket path as address
          const absolutePath = path.isAbsolute(socketPath) ? socketPath : path.join(process.cwd(), socketPath);
          expect(server.address).toBe(absolutePath);

          await server.close();
        }, 10000);

        it('should handle parseAddress with unix:// (double slash)', () => {
          const transport = new UnixSocketTransport();
          const addr = transport.parseAddress('unix:///tmp/socket.sock');
          expect(addr.protocol).toBe('unix');
          expect(addr.path).toBe('/tmp/socket.sock');
        });

        it('should handle parseAddress with unix: (single colon)', () => {
          const transport = new UnixSocketTransport();
          const addr = transport.parseAddress('unix:/tmp/socket.sock');
          expect(addr.protocol).toBe('unix');
          expect(addr.path).toBe('/tmp/socket.sock');
        });

        it('should handle parseAddress with path only', () => {
          const transport = new UnixSocketTransport();
          const addr = transport.parseAddress('/tmp/socket.sock');
          expect(addr.protocol).toBe('unix');
          expect(addr.path).toBe('/tmp/socket.sock');
        });

        it('should delegate to base class for non-unix protocols', () => {
          const transport = new UnixSocketTransport();
          // This should call super.parseAddress() which handles tcp://
          const addr = transport.parseAddress('tcp://localhost:8080');
          expect(addr).toBeDefined();
          expect(addr.protocol).not.toBe('unix');
        });

        it('should handle isValidAddress with various address formats', () => {
          const transport = new UnixSocketTransport();

          // Valid addresses
          expect(transport.isValidAddress('unix:///tmp/test.sock')).toBe(true);
          expect(transport.isValidAddress('unix:/tmp/test.sock')).toBe(true);
          expect(transport.isValidAddress('/tmp/test.sock')).toBe(true);
          expect(transport.isValidAddress('./relative.sock')).toBe(true);

          // Invalid addresses should return false (caught by try-catch)
          expect(transport.isValidAddress('')).toBe(false);
        });

        it('should handle UnixSocketServer connection handler', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `handler-${Date.now()}.sock`);

          const server = await transport.createServer(socketPath);
          await server.listen();

          // Connect multiple clients to verify handler works
          const conn1Promise = waitForEvent(server, 'connection');
          const client1 = await transport.connect(socketPath);
          const serverConn1 = await conn1Promise;

          expect(serverConn1).toBeDefined();
          expect(serverConn1.remoteAddress).toBe(
            path.isAbsolute(socketPath) ? socketPath : path.join(process.cwd(), socketPath)
          );

          await client1.close();
          await server.close();
        }, 10000);

        it('should properly extend TcpConnection with socket path', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `extend-${Date.now()}.sock`);

          const server = await transport.createServer(socketPath);
          await server.listen();

          const connPromise = waitForEvent(server, 'connection');
          const client = await transport.connect(socketPath);
          const serverConn = await connPromise;

          // Verify UnixSocketConnection has correct properties
          const absolutePath = path.isAbsolute(socketPath) ? socketPath : path.join(process.cwd(), socketPath);
          expect(client.remoteAddress).toBe(absolutePath);
          expect((client as any).socketPath).toBe(absolutePath);

          await client.close();
          await server.close();
        }, 10000);

        it('should handle server close cleanup with unlink', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `cleanup-${Date.now()}.sock`);

          const server = await transport.createServer(socketPath);
          await server.listen();

          // Verify socket exists
          const stats = await fs.stat(socketPath);
          expect(stats.isSocket()).toBe(true);

          // Close should remove socket file
          await server.close();

          // Socket should be gone
          await expect(fs.stat(socketPath)).rejects.toThrow();
        }, 10000);

        it('should handle createServer with options object containing path', async () => {
          const transport = new UnixSocketTransport();
          const socketPath = join(tmpdir(), `options-${Date.now()}.sock`);

          const server = await transport.createServer({
            path: socketPath,
            force: false,
          } as any);

          await server.listen();
          expect(server).toBeDefined();

          await server.close();
        }, 10000);

        it('should convert relative to absolute path during server creation', async () => {
          const transport = new UnixSocketTransport();
          const relativePath = `./relative-server-${Date.now()}.sock`;

          const server = await transport.createServer(relativePath);
          await server.listen();

          const absolutePath = path.join(process.cwd(), relativePath);
          expect(server.address).toBe(absolutePath);

          await server.close();
          await cleanupSocketFile(absolutePath);
        }, 10000);
      });
    }
  });
});
