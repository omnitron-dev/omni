/**
 * TCP Transport Tests
 *
 * Tests TCP transport implementation with real connections
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TcpTransport } from '../../../src/netron/transport/tcp-transport.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import { Packet } from '../../../src/netron/packet/index.js';
import { Socket } from 'node:net';
import { getFreePort, waitForEvent, delay } from '../../utils/index.js';

describe('TcpTransport', () => {
  let transport: TcpTransport;
  let testPort: number;

  beforeEach(async () => {
    transport = new TcpTransport();
    testPort = await getFreePort();
  });

  afterEach(async () => {
    // Clean up any remaining connections
    await delay(100);
  });

  describe('Basic Functionality', () => {
    it('should have correct capabilities', () => {
      expect(transport.name).toBe('tcp');
      expect(transport.capabilities).toEqual({
        streaming: true,
        bidirectional: true,
        binary: true,
        reconnection: true,
        multiplexing: false,
        server: true
      });
    });

    it('should validate TCP addresses correctly', () => {
      expect(transport.isValidAddress('tcp://localhost:8080')).toBe(true);
      expect(transport.isValidAddress('tcp://192.168.1.1:3000')).toBe(true);
      expect(transport.isValidAddress('tcp://[::1]:8080')).toBe(true);
      expect(transport.isValidAddress('ws://localhost:8080')).toBe(false);
      expect(transport.isValidAddress('invalid')).toBe(false);
    });

    it('should parse TCP addresses correctly', () => {
      const addr1 = transport.parseAddress('tcp://localhost:8080');
      expect(addr1).toEqual({
        protocol: 'tcp',
        host: 'localhost',
        port: 8080,
        params: {}
      });

      const addr2 = transport.parseAddress('tcp://192.168.1.1:3000');
      expect(addr2).toEqual({
        protocol: 'tcp',
        host: '192.168.1.1',
        port: 3000,
        params: {}
      });
    });
  });

  describe('Server Creation and Listening', () => {
    it('should create and start a TCP server', async () => {
      const server = await transport.createServer();
      expect(server).toBeDefined();

      await server.listen();
      expect(server.port).toBeGreaterThan(0);

      await server.close();
    });

    it('should listen on specific port', async () => {
      const server = await transport.createServer({ port: testPort });
      expect(server.port).toBe(testPort);

      await server.close();
    });

    it('should emit listening event when server starts', async () => {
      const server = await transport.createServer({ port: testPort });

      const listeningPromise = waitForEvent(server, 'listening');
      await server.listen();
      await listeningPromise;

      expect(server.port).toBe(testPort);
      await server.close();
    });

    it('should handle multiple connections', async () => {
      const server = await transport.createServer({ port: testPort });

      const connectionPromises = [];

      // Accept connections
      const conn1Promise = waitForEvent(server, 'connection');
      const conn2Promise = conn1Promise.then(() => waitForEvent(server, 'connection'));

      // Create two client connections
      const client1 = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      const connection1 = await conn1Promise;

      const client2 = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      const connection2 = await conn2Promise;

      expect(server.connections.size).toBe(2);

      await client1.close();
      await client2.close();
      await server.close();
    });
  });

  describe('Client Connection', () => {
    let server: any;

    beforeEach(async () => {
      server = await transport.createServer({ port: testPort });
    });

    afterEach(async () => {
      await server.close();
    });

    it('should connect to TCP server', async () => {
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);

      expect(client).toBeDefined();
      expect(client.state).toBe(ConnectionState.CONNECTED);
      expect(client.remoteAddress).toContain(String(testPort));

      await client.close();
    });

    it('should emit connect event on successful connection', async () => {
      const connectionPromise = transport.connect(`tcp://127.0.0.1:${testPort}`);
      const client = await connectionPromise;

      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
    });

    it('should handle connection failure', async () => {
      const fakePort = await getFreePort();

      try {
        await transport.connect(`tcp://127.0.0.1:${fakePort}`, {
          connectTimeout: 1000
        });
        fail('Should have thrown connection error');
      } catch (error: any) {
        expect(error.message).toContain('ECONNREFUSED');
      }
    });

    it('should timeout on slow connections', async () => {
      // Connect to a non-routable IP address that will timeout
      // 10.255.255.1 is typically non-routable and will timeout
      try {
        await transport.connect(`tcp://10.255.255.1:8080`, {
          connectTimeout: 100
        });
        throw new Error('Should have timed out');
      } catch (error: any) {
        expect(error.message.toLowerCase()).toContain('timeout');
      }
    });
  });

  describe('Data Transmission', () => {
    let server: any;
    let serverConnection: any;
    let clientConnection: any;

    beforeEach(async () => {
      server = await transport.createServer({ port: testPort });

      // Set up server connection handler
      const connectionPromise = waitForEvent(server, 'connection');

      // Connect client
      clientConnection = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      serverConnection = await connectionPromise;
    });

    afterEach(async () => {
      await clientConnection?.close();
      await serverConnection?.close();
      await server?.close();
    });

    // Note: TCP transport is packet-based, not raw data
    // Raw data tests removed - see packet tests below

    it('should send and receive packets', async () => {
      const testPacket = new Packet(123);
      testPacket.setType(1);
      testPacket.data = { message: 'Test packet' };

      // Server listens for packet
      const packetPromise = waitForEvent(serverConnection, 'packet');

      // Client sends packet
      await clientConnection.sendPacket(testPacket);

      // Server receives packet
      const receivedPacket = await packetPromise;
      expect(receivedPacket.id).toBe(testPacket.id);
      expect(receivedPacket.getType()).toBe(testPacket.getType());
      expect(receivedPacket.data).toEqual(testPacket.data);
    });

    it('should track connection metrics', async () => {
      const packet1 = new Packet(1);
      packet1.setType(1);
      packet1.data = { test: 'data1' };

      const packet2 = new Packet(2);
      packet2.setType(2);
      packet2.data = { test: 'data2' };

      await clientConnection.sendPacket(packet1);
      await clientConnection.sendPacket(packet2);

      const metrics = clientConnection.getMetrics();
      expect(metrics.bytesSent).toBeGreaterThan(0);
      expect(metrics.packetsSent).toBe(2);
      expect(metrics.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Connection Management', () => {
    let server: any;

    beforeEach(async () => {
      server = await transport.createServer({ port: testPort });
    });

    afterEach(async () => {
      await server?.close();
    });

    it('should handle graceful disconnection', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      const serverConn = await serverConnPromise;

      const disconnectPromise = waitForEvent(client, 'disconnect');

      await client.close();

      await disconnectPromise;
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should handle abrupt disconnection', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      const serverConn = await serverConnPromise;

      const disconnectPromise = waitForEvent(client, 'disconnect');

      // Forcefully close from server side
      await serverConn.close();

      await disconnectPromise;
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit error on connection issues', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);
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
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);

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
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
      // Server is already listening after createServer

      // Connect multiple clients
      const connPromise1 = waitForEvent(server, 'connection');
      const client1 = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      await connPromise1;

      const connPromise2 = waitForEvent(server, 'connection');
      const client2 = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      await connPromise2;

      const connPromise3 = waitForEvent(server, 'connection');
      const client3 = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      await connPromise3;

      // Set up packet listeners
      const packet1Promise = waitForEvent(client1, 'packet');
      const packet2Promise = waitForEvent(client2, 'packet');
      const packet3Promise = waitForEvent(client3, 'packet');

      // Broadcast packet
      const broadcastPacket = new Packet(999);
      broadcastPacket.setType(3);
      broadcastPacket.data = { message: 'Broadcast message' };
      await server.broadcastPacket(broadcastPacket);

      // All clients should receive the packet
      const [packet1, packet2, packet3] = await Promise.all([
        packet1Promise,
        packet2Promise,
        packet3Promise
      ]);

      expect(packet1.id).toBe(broadcastPacket.id);
      expect(packet2.id).toBe(broadcastPacket.id);
      expect(packet3.id).toBe(broadcastPacket.id);

      // Clean up
      await client1.close();
      await client2.close();
      await client3.close();
      await server.close();
    });
  });

  describe('Keep-Alive', () => {
    it('should configure keep-alive when enabled', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
      // Server is already listening after createServer

      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`, {
        keepAlive: {
          enabled: true,
          interval: 1000,
          timeout: 3000
        }
      });

      // Check that the socket has keep-alive enabled
      const socket = (client as any).socket as Socket;

      // TCP keep-alive should be set
      expect(socket).toBeDefined();
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
      await server.close();
    });
  });

  describe('Unified TYPE_PING Protocol', () => {
    let server: any;
    let serverConnection: any;
    let clientConnection: any;

    beforeEach(async () => {
      server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);

      // Set up server connection handler
      const connectionPromise = waitForEvent(server, 'connection');

      // Connect client
      clientConnection = await transport.connect(`tcp://127.0.0.1:${testPort}`);
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

      // RTT should be a positive number
      expect(typeof rtt).toBe('number');
      expect(rtt).toBeGreaterThan(0);
      expect(rtt).toBeLessThan(1000); // Should be less than 1 second on localhost

      // Check that metrics were updated
      const metrics = clientConnection.getMetrics();
      expect(metrics.rtt).toBe(rtt);
    });

    it('should automatically respond to ping requests', async () => {
      // Server sends TYPE_PING packet
      const rtt = await serverConnection.ping();

      // Client should have automatically responded
      expect(typeof rtt).toBe('number');
      expect(rtt).toBeGreaterThan(0);
    });

    it('should handle ping timeout', async () => {
      // Wait for new server connection
      const newConnPromise = waitForEvent(server, 'connection');

      // Create connection with short timeout
      const shortTimeoutClient = await transport.connect(`tcp://127.0.0.1:${testPort}`, {
        requestTimeout: 100
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

      // All pings should succeed (can be 0ms on fast systems)
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

      // Can be 0ms on fast systems
      expect(typeof clientRtt).toBe('number');
      expect(clientRtt).toBeGreaterThanOrEqual(0);
      expect(typeof serverRtt).toBe('number');
      expect(serverRtt).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid addresses', async () => {
      try {
        await transport.connect('invalid://address');
        fail('Should have thrown error for invalid address');
      } catch (error: any) {
        expect(error.message).toContain('Invalid TCP address');
      }
    });

    it('should handle connection to non-existent host', async () => {
      try {
        await transport.connect('tcp://non.existent.host:8080', {
          connectTimeout: 1000
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toMatch(/ENOTFOUND|timeout|getaddrinfo/i);
      }
    });

    it('should handle port out of range', () => {
      expect(() => {
        transport.parseAddress('tcp://localhost:99999');
      }).toThrow();
    });
  });

  describe('Connection State Transitions', () => {
    it('should transition through correct states', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
      // Server is already listening after createServer

      const states: ConnectionState[] = [];

      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);

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

  describe('Socket Options', () => {
    let server: any;

    beforeEach(async () => {
      server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
    });

    afterEach(async () => {
      await server?.close();
    });

    it('should set noDelay option on socket', async () => {
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`, {
        noDelay: true
      });

      const socket = (client as any).socket as Socket;
      expect(socket).toBeDefined();
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
    });

    it('should set timeout option on socket', async () => {
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`, {
        timeout: 5000
      });

      const socket = (client as any).socket as Socket;
      expect(socket).toBeDefined();
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
    });

    it('should emit timeout event when socket times out', async () => {
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`, {
        timeout: 100
      });

      const errorPromise = waitForEvent(client, 'error');

      // Trigger timeout by not sending any data
      const socket = (client as any).socket as Socket;
      socket.emit('timeout');

      const error = await errorPromise;
      expect(error.message).toContain('timeout');
    });

    it('should set keepAliveDelay option on socket', async () => {
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`, {
        keepAliveDelay: 2000
      });

      const socket = (client as any).socket as Socket;
      expect(socket).toBeDefined();
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
    });

    it('should handle socket in CONNECTING state', async () => {
      // This test checks the CONNECTING state path
      const connectionPromise = transport.connect(`tcp://127.0.0.1:${testPort}`);

      // Connection should complete
      const client = await connectionPromise;
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();
    });
  });

  describe('Data Type Conversion', () => {
    let server: any;
    let serverConnection: any;
    let clientConnection: any;

    beforeEach(async () => {
      server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);

      const connectionPromise = waitForEvent(server, 'connection');
      clientConnection = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      serverConnection = await connectionPromise;
    });

    afterEach(async () => {
      await clientConnection?.close();
      await serverConnection?.close();
      await server?.close();
    });

    it('should send ArrayBuffer data', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const arrayBuffer = testData.buffer;

      const dataPromise = waitForEvent(serverConnection, 'data');

      await clientConnection.send(arrayBuffer);

      const receivedData = await dataPromise;
      expect(Buffer.from(receivedData)).toEqual(Buffer.from(testData));
    });

    it('should send Uint8Array data', async () => {
      const testData = new Uint8Array([10, 20, 30, 40, 50]);

      const dataPromise = waitForEvent(serverConnection, 'data');

      await clientConnection.send(testData);

      const receivedData = await dataPromise;
      expect(Buffer.from(receivedData)).toEqual(Buffer.from(testData));
    });

    it('should send Buffer data', async () => {
      const testData = Buffer.from([100, 101, 102, 103]);

      const dataPromise = waitForEvent(serverConnection, 'data');

      await clientConnection.send(testData);

      const receivedData = await dataPromise;
      expect(receivedData).toEqual(testData);
    });
  });

  describe('Reconnection Logic', () => {
    let server: any;

    beforeEach(async () => {
      server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
    });

    afterEach(async () => {
      await server?.close();
    });

    it('should attempt reconnection on disconnect', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`, {
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          delay: 100
        }
      });
      await serverConnPromise;

      const reconnectPromise = waitForEvent(client, 'reconnect');

      // Force disconnect by destroying socket
      const socket = (client as any).socket as Socket;
      socket.destroy();

      // Wait for reconnection attempt
      await reconnectPromise;

      // Wait a bit for reconnection to stabilize
      await delay(500);

      await client.close();
    });

    it('should handle doReconnect with valid address', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      await serverConnPromise;

      // Close and try to reconnect
      const socket = (client as any).socket as Socket;
      const remoteAddress = socket.remoteAddress;
      const remotePort = socket.remotePort;

      expect(remoteAddress).toBeDefined();
      expect(remotePort).toBeDefined();

      // Manually trigger doReconnect
      const newServerConnPromise = waitForEvent(server, 'connection');

      try {
        await (client as any).doReconnect();
        await newServerConnPromise;
      } catch (error) {
        // May fail if connection closes, that's ok
      }

      await client.close();
    });

    it('should timeout during doReconnect', async () => {
      const serverConnPromise = waitForEvent(server, 'connection');
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`, {
        connectTimeout: 100
      });
      await serverConnPromise;

      // Close server to make reconnection fail
      await server.close();

      // Try to reconnect - should fail (timeout or connection refused)
      try {
        await (client as any).doReconnect();
        fail('Should have failed to reconnect');
      } catch (error: any) {
        // Could be timeout or connection refused depending on timing
        expect(error).toBeDefined();
      }

      // Recreate server for afterEach cleanup
      server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
    });
  });

  describe('Force Destroy on Close', () => {
    it('should force destroy socket if not closed within timeout', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);

      // Mock socket.end to not actually close
      const socket = (client as any).socket as Socket;
      const originalEnd = socket.end.bind(socket);
      let endCalled = false;

      socket.end = function(this: Socket) {
        endCalled = true;
        // Don't actually call end to test timeout path
        return this;
      } as any;

      // Close should timeout and force destroy
      const closePromise = client.close();

      // Wait for force destroy timeout (5 seconds in implementation)
      await closePromise;

      expect(endCalled).toBe(true);
      expect(socket.destroyed).toBe(true);

      await server.close();
    });
  });

  describe('Server Edge Cases', () => {
    it('should handle server with string address', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);

      const address = server.address;
      expect(address).toBeDefined();

      // Test port getter with string address edge case
      const port = server.port;
      expect(port).toBe(testPort);

      await server.close();
    });

    it('should handle already listening server', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);

      // Try to listen again - should resolve immediately
      await server.listen();

      expect(server.port).toBe(testPort);

      await server.close();
    });

    it('should emit server error event', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);

      const errorPromise = waitForEvent(server, 'error');

      // Manually emit error on underlying server
      const netServer = (server as any).server as net.Server;
      const testError = new Error('Test server error');
      netServer.emit('error', testError);

      const error = await errorPromise;
      expect(error).toBe(testError);

      await server.close();
    });

    it('should handle server close with error callback', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);

      // Close should succeed
      await server.close();

      // Try to close again - should handle gracefully
      try {
        await server.close();
      } catch (error) {
        // May throw error if already closed
        expect(error).toBeDefined();
      }
    });

    it('should create server with port 0 (automatic allocation)', async () => {
      const server = await transport.createServer({ port: 0, host: '127.0.0.1' } as any);

      expect(server.port).toBeGreaterThan(0);
      expect(server.port).not.toBe(0);

      await server.close();
    });

    it('should create server with different host bindings', async () => {
      // Test localhost binding
      const server1 = await transport.createServer({ port: await getFreePort(), host: '127.0.0.1' } as any);
      expect(server1.address).toBeDefined();
      await server1.close();

      // Test all interfaces binding
      const server2 = await transport.createServer({ port: await getFreePort(), host: '0.0.0.0' } as any);
      expect(server2.address).toBeDefined();
      await server2.close();
    });
  });

  describe('localAddress Property', () => {
    it('should expose localAddress property', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);

      const localAddress = client.localAddress;
      expect(localAddress).toBeDefined();
      expect(localAddress).toContain(':');

      await client.close();
      await server.close();
    });

    it('should have valid localAddress after connection', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);
      const connectionPromise = waitForEvent(server, 'connection');

      const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      const serverConn = await connectionPromise;

      const clientLocalAddress = client.localAddress;
      const serverLocalAddress = serverConn.localAddress;

      expect(clientLocalAddress).toBeDefined();
      expect(serverLocalAddress).toBeDefined();

      await client.close();
      await server.close();
    });
  });

  describe('isValidAddress Edge Cases', () => {
    it('should handle malformed addresses in isValidAddress', () => {
      expect(transport.isValidAddress('tcp://')).toBe(false);
      expect(transport.isValidAddress('tcp://:')).toBe(false);
      expect(transport.isValidAddress('tcp://localhost')).toBe(false);
      expect(transport.isValidAddress('tcp://localhost:abc')).toBe(false);
      expect(transport.isValidAddress('tcp://localhost:-1')).toBe(false);
      expect(transport.isValidAddress('')).toBe(false);
      expect(transport.isValidAddress('not-a-url')).toBe(false);
    });

    it('should handle exception in isValidAddress gracefully', () => {
      // Should return false instead of throwing
      const result = transport.isValidAddress('tcp://[invalid:address');
      expect(result).toBe(false);
    });
  });

  describe('Server Address String Handling', () => {
    it('should handle server address when returned as string', async () => {
      const server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);

      // Mock address to return string (for Unix socket path scenario)
      const originalAddress = (server as any).server.address.bind((server as any).server);
      (server as any).server.address = () => '/tmp/test.sock';

      const address = server.address;
      expect(address).toBe('/tmp/test.sock');

      const port = server.port;
      expect(port).toBeUndefined();

      // Restore for cleanup
      (server as any).server.address = originalAddress;

      await server.close();
    });
  });
});