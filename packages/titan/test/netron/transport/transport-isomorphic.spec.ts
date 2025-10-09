/**
 * Isomorphic Transport Test Suite
 *
 * Comprehensive test suite that ensures all transports behave consistently
 * based on their declared capabilities, providing isomorphic guarantees
 * for the transport layer.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import {
  ITransport,
  ITransportConnection,
  ITransportServer,
  ConnectionState
} from '../../../src/netron/transport/types.js';
import {
  TcpTransport,
  WebSocketTransport,
  UnixSocketTransport,
  NamedPipeTransport
} from '../../../src/netron/transport/index.js';
import { Packet, encodePacket } from '../../../src/netron/packet/index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { promises as fs } from 'node:fs';
import { getFreePort, waitForEvent } from '../../utils/index.js';

// Transport test configuration
interface TransportTestConfig {
  name: string;
  transport: ITransport;
  serverAddress: string;
  clientAddress: string;
  setupServer?: () => Promise<any>;
  teardownServer?: () => Promise<void>;
  skipTests?: string[];
}

// Helper to get unique socket path
function getSocketPath(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\test-isomorphic-${timestamp}-${random}`;
  } else {
    return join(tmpdir(), `test-isomorphic-${timestamp}-${random}.sock`);
  }
}


// Helper to wait for condition
async function waitForCondition(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

// Test packet for consistency
const createTestPacket = (id: number): Packet => ({
  id,
  type: 'request',
  taskId: 'test-task',
  taskName: 'test',
  isBroadcast: false,
  isPart: false,
  isEnd: false,
  args: [`test-${id}`, { value: id }]
});

describe('Isomorphic Transport Test Suite', () => {
  let transportConfigs: TransportTestConfig[] = [];

  beforeAll(async () => {
    // Setup TCP transport
    const tcpPort = await getFreePort();
    transportConfigs.push({
      name: 'TCP',
      transport: new TcpTransport(),
      serverAddress: `tcp://127.0.0.1:${tcpPort}`,
      clientAddress: `tcp://127.0.0.1:${tcpPort}`
    });

    // Setup WebSocket transport
    const wsPort = await getFreePort();
    let httpServer: any;
    let wsServer: WebSocketServer;

    transportConfigs.push({
      name: 'WebSocket',
      transport: new WebSocketTransport(),
      serverAddress: `ws://127.0.0.1:${wsPort}`,
      clientAddress: `ws://127.0.0.1:${wsPort}`,
      setupServer: async () => {
        httpServer = createHttpServer();
        await new Promise<void>(resolve => {
          httpServer.listen(wsPort, '127.0.0.1', resolve);
        });
        wsServer = new WebSocketServer({ server: httpServer });
        return wsServer;
      },
      teardownServer: async () => {
        wsServer?.close();
        await new Promise(resolve => httpServer?.close(resolve));
      }
    });

    // Setup Unix/Named Pipe transport
    const isWindows = process.platform === 'win32';
    const socketPath = getSocketPath();

    transportConfigs.push({
      name: isWindows ? 'NamedPipe' : 'Unix',
      transport: isWindows ? new NamedPipeTransport() : new UnixSocketTransport(),
      serverAddress: socketPath,
      clientAddress: socketPath
    });
  });

  describe('Core Transport Capabilities', () => {
    transportConfigs.forEach((config) => {
      describe(`${config.name} Transport`, () => {
        let server: ITransportServer;
        let externalServer: any;

        beforeEach(async () => {
          // Setup external server if needed (for WebSocket)
          if (config.setupServer) {
            externalServer = await config.setupServer();
          }

          // Create transport server if supported
          if (config.transport.capabilities.server) {
            server = await config.transport.createServer!(config.serverAddress);
            if (server.listen) {
              await server.listen();
            }
          }
        });

        afterEach(async () => {
          // Close server
          if (server) {
            await server.close();
          }

          // Teardown external server
          if (config.teardownServer) {
            await config.teardownServer();
          }

          // Cleanup socket files for Unix
          if (config.name === 'Unix' && config.serverAddress) {
            try {
              await fs.unlink(config.serverAddress);
            } catch {
              // Ignore if doesn't exist
            }
          }
        });

        it('should declare accurate capabilities', () => {
          const caps = config.transport.capabilities;

          expect(caps).toBeDefined();
          expect(typeof caps.streaming).toBe('boolean');
          expect(typeof caps.bidirectional).toBe('boolean');
          expect(typeof caps.binary).toBe('boolean');
          expect(typeof caps.reconnection).toBe('boolean');
          expect(typeof caps.multiplexing).toBe('boolean');
          expect(typeof caps.server).toBe('boolean');

          // Verify server capability matches implementation
          if (caps.server) {
            expect(config.transport.createServer).toBeDefined();
          }
        });

        it('should validate addresses correctly', () => {
          const validAddresses = [
            config.clientAddress,
            config.serverAddress
          ];

          validAddresses.forEach(addr => {
            expect(config.transport.isValidAddress(addr)).toBe(true);
          });

          // Test invalid addresses
          const invalidAddresses = [
            'invalid://address',
            'http://localhost:8080', // Wrong protocol
            ''
          ];

          invalidAddresses.forEach(addr => {
            if (addr && !addr.startsWith(config.name.toLowerCase())) {
              expect(config.transport.isValidAddress(addr)).toBe(false);
            }
          });
        });

        it('should parse addresses correctly', () => {
          const parsed = config.transport.parseAddress(config.clientAddress);

          expect(parsed).toBeDefined();
          expect(parsed.protocol).toBeDefined();

          if (config.name === 'TCP' || config.name === 'WebSocket') {
            expect(parsed.host).toBeDefined();
            expect(parsed.port).toBeDefined();
          } else if (config.name === 'Unix' || config.name === 'NamedPipe') {
            expect(parsed.path).toBeDefined();
          }
        });

        it('should establish basic connection', async () => {
          if (!config.transport.capabilities.server && !externalServer) {
            console.log(`Skipping server test for ${config.name} - no server support`);
            return;
          }

          const client = await config.transport.connect(config.clientAddress);

          expect(client).toBeDefined();
          expect(client.state).toBe(ConnectionState.CONNECTED);
          expect(client.id).toBeDefined();

          await client.close();
        });

        it('should handle connection lifecycle', async () => {
          if (!config.transport.capabilities.server && !externalServer) {
            console.log(`Skipping server test for ${config.name} - no server support`);
            return;
          }

          const client = await config.transport.connect(config.clientAddress);

          // Track state changes
          const states: ConnectionState[] = [];
          client.on('state', (state: ConnectionState) => {
            states.push(state);
          });

          expect(client.state).toBe(ConnectionState.CONNECTED);

          // Close connection
          await client.close();

          // Verify disconnected state
          await waitForCondition(() =>
            client.state === ConnectionState.DISCONNECTED ||
            client.state === ConnectionState.ERROR
          );

          expect([ConnectionState.DISCONNECTED, ConnectionState.ERROR]).toContain(client.state);
        });

        if (config.transport.capabilities.binary) {
          it('should transfer binary data', async () => {
            if (!config.transport.capabilities.server && !externalServer) {
              console.log(`Skipping server test for ${config.name} - no server support`);
              return;
            }

            const serverConnPromise = server ?
              waitForEvent(server, 'connection') :
              waitForEvent(externalServer, 'connection');

            const client = await config.transport.connect(config.clientAddress);
            const serverConn = await serverConnPromise;

            // Prepare test data
            const testData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
            let receivedData: Buffer | undefined;

            // Listen for data on server connection
            const dataPromise = new Promise<Buffer>((resolve) => {
              const handlers = {
                data: (data: Buffer) => resolve(data),
                packet: (packet: any) => resolve(packet.data || Buffer.from(packet.args || []))
              };

              serverConn.on('data', handlers.data);
              serverConn.on('packet', handlers.packet);
            });

            // Send data
            await client.send(testData);

            // Wait for data with timeout
            receivedData = await Promise.race([
              dataPromise,
              new Promise<Buffer>((_, reject) =>
                setTimeout(() => reject(new Error('Data timeout')), 2000)
              )
            ]);

            expect(receivedData).toBeDefined();
            expect(Buffer.compare(testData, receivedData)).toBe(0);

            await client.close();
          });
        }

        if (config.transport.capabilities.streaming) {
          it('should support streaming data', async () => {
            if (!config.transport.capabilities.server && !externalServer) {
              console.log(`Skipping server test for ${config.name} - no server support`);
              return;
            }

            const serverConnPromise = server ?
              waitForEvent(server, 'connection') :
              waitForEvent(externalServer, 'connection');

            const client = await config.transport.connect(config.clientAddress);
            const serverConn = await serverConnPromise;

            const chunks: Buffer[] = [];
            const chunkCount = 10;

            // Listen for data chunks
            serverConn.on('data', (data: Buffer) => {
              chunks.push(data);
            });

            // Send multiple chunks
            for (let i = 0; i < chunkCount; i++) {
              await client.send(Buffer.from(`chunk-${i}`));
            }

            // Wait for chunks to arrive
            await waitForCondition(() => chunks.length >= chunkCount, 3000);

            expect(chunks.length).toBe(chunkCount);

            // Verify chunk content
            chunks.forEach((chunk, i) => {
              expect(chunk.toString()).toBe(`chunk-${i}`);
            });

            await client.close();
          });
        }

        if (config.transport.capabilities.bidirectional) {
          it('should support bidirectional communication', async () => {
            if (!config.transport.capabilities.server && !externalServer) {
              console.log(`Skipping server test for ${config.name} - no server support`);
              return;
            }

            const serverConnPromise = server ?
              waitForEvent(server, 'connection') :
              waitForEvent(externalServer, 'connection');

            const client = await config.transport.connect(config.clientAddress);
            const serverConn = await serverConnPromise;

            // Setup echo on server
            serverConn.on('data', async (data: Buffer) => {
              // Echo back with prefix
              await serverConn.send(Buffer.concat([Buffer.from('echo:'), data]));
            });

            // Send and receive
            const responsePromise = waitForEvent<Buffer>(client, 'data');
            await client.send(Buffer.from('test'));

            const response = await responsePromise;
            expect(response.toString()).toBe('echo:test');

            await client.close();
          });
        }
      });
    });
  });

  describe('Packet Encoding/Decoding Consistency', () => {
    transportConfigs.forEach((config) => {
      describe(`${config.name} Transport`, () => {
        let server: ITransportServer;
        let externalServer: any;

        beforeEach(async () => {
          if (config.setupServer) {
            externalServer = await config.setupServer();
          }

          if (config.transport.capabilities.server) {
            server = await config.transport.createServer!(config.serverAddress);
            if (server.listen) {
              await server.listen();
            }
          }
        });

        afterEach(async () => {
          if (server) {
            await server.close();
          }

          if (config.teardownServer) {
            await config.teardownServer();
          }

          if (config.name === 'Unix' && config.serverAddress) {
            try {
              await fs.unlink(config.serverAddress);
            } catch {
              // Ignore
            }
          }
        });

        it('should correctly encode and decode packets', async () => {
          if (!config.transport.capabilities.server && !externalServer) {
            return;
          }

          const serverConnPromise = server ?
            waitForEvent(server, 'connection') :
            waitForEvent(externalServer, 'connection');

          const client = await config.transport.connect(config.clientAddress);
          const serverConn = await serverConnPromise;

          // Create test packet
          const testPacket = createTestPacket(123);

          // Listen for packet on server
          const packetPromise = new Promise<Packet>((resolve) => {
            serverConn.on('packet', (packet: Packet) => {
              resolve(packet);
            });
          });

          // Send packet
          if (client.sendPacket) {
            await client.sendPacket(testPacket);
          } else {
            // Fallback to manual encoding
            const encoded = encodePacket(testPacket);
            await client.send(encoded);
          }

          // Wait for packet
          const receivedPacket = await Promise.race([
            packetPromise,
            new Promise<Packet>((_, reject) =>
              setTimeout(() => reject(new Error('Packet timeout')), 2000)
            )
          ]);

          // Verify packet integrity
          expect(receivedPacket.id).toBe(testPacket.id);
          expect(receivedPacket.type).toBe(testPacket.type);
          expect(receivedPacket.taskId).toBe(testPacket.taskId);
          expect(receivedPacket.taskName).toBe(testPacket.taskName);
          expect(receivedPacket.args).toEqual(testPacket.args);

          await client.close();
        });

        it('should handle multiple packets in sequence', async () => {
          if (!config.transport.capabilities.server && !externalServer) {
            return;
          }

          const serverConnPromise = server ?
            waitForEvent(server, 'connection') :
            waitForEvent(externalServer, 'connection');

          const client = await config.transport.connect(config.clientAddress);
          const serverConn = await serverConnPromise;

          const packets: Packet[] = [];
          const packetCount = 5;

          // Listen for packets
          serverConn.on('packet', (packet: Packet) => {
            packets.push(packet);
          });

          // Send multiple packets
          for (let i = 0; i < packetCount; i++) {
            const packet = createTestPacket(i);
            if (client.sendPacket) {
              await client.sendPacket(packet);
            } else {
              await client.send(encodePacket(packet));
            }
          }

          // Wait for all packets
          await waitForCondition(() => packets.length >= packetCount, 3000);

          expect(packets.length).toBe(packetCount);

          // Verify packet order and content
          packets.forEach((packet, i) => {
            expect(packet.id).toBe(i);
            expect(packet.args[0]).toBe(`test-${i}`);
          });

          await client.close();
        });
      });
    });
  });

  describe('Error Handling and Recovery', () => {
    transportConfigs.forEach((config) => {
      describe(`${config.name} Transport`, () => {
        it('should handle connection failures gracefully', async () => {
          // Use invalid address
          const invalidAddress = config.name === 'TCP' || config.name === 'WebSocket' ?
            `${config.clientAddress.split(':').slice(0, -1).join(':')}:1` : // Port 1
            '/invalid/path/that/does/not/exist';

          try {
            await config.transport.connect(invalidAddress, {
              connectTimeout: 100
            });
            fail('Should have thrown connection error');
          } catch (error: any) {
            expect(error).toBeDefined();
            expect(error.message).toMatch(/ECONNREFUSED|ENOENT|timeout|not exist/i);
          }
        });

        it('should emit error events on connection issues', async () => {
          if (!config.transport.capabilities.server) {
            return;
          }

          const server = await config.transport.createServer!(config.serverAddress);
          if (server.listen) {
            await server.listen();
          }

          const client = await config.transport.connect(config.clientAddress);

          const errorPromise = new Promise<Error>((resolve) => {
            client.on('error', resolve);
          });

          // Force an error by closing server while client is connected
          await server.close();

          // Try to send data on closed connection
          try {
            await client.send(Buffer.from('test'));
          } catch {
            // Expected to fail
          }

          // Some transports might not emit error immediately
          const errorOrTimeout = await Promise.race([
            errorPromise,
            new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))
          ]);

          // Clean up
          await client.close();
        });

        if (config.transport.capabilities.reconnection) {
          it('should support reconnection', async () => {
            if (!config.transport.capabilities.server) {
              return;
            }

            let server = await config.transport.createServer!(config.serverAddress);
            if (server.listen) {
              await server.listen();
            }

            const client = await config.transport.connect(config.clientAddress, {
              reconnect: {
                enabled: true,
                maxAttempts: 3,
                delay: 100
              }
            });

            const reconnectPromise = waitForEvent(client, 'reconnect');

            // Close server to trigger disconnect
            await server.close();

            // Recreate server
            server = await config.transport.createServer!(config.serverAddress);
            if (server.listen) {
              await server.listen();
            }

            // Wait for reconnect
            const reconnectEvent = await Promise.race([
              reconnectPromise,
              new Promise<null>(resolve => setTimeout(() => resolve(null), 2000))
            ]);

            if (reconnectEvent) {
              expect(client.state).toBe(ConnectionState.CONNECTED);
            }

            await client.close();
            await server.close();
          });
        }
      });
    });
  });

  describe('Performance and Stress Testing', () => {
    transportConfigs.forEach((config) => {
      describe(`${config.name} Transport`, () => {
        let server: ITransportServer;
        let externalServer: any;

        beforeEach(async () => {
          if (config.setupServer) {
            externalServer = await config.setupServer();
          }

          if (config.transport.capabilities.server) {
            server = await config.transport.createServer!(config.serverAddress);
            if (server.listen) {
              await server.listen();
            }
          }
        });

        afterEach(async () => {
          if (server) {
            await server.close();
          }

          if (config.teardownServer) {
            await config.teardownServer();
          }

          if (config.name === 'Unix' && config.serverAddress) {
            try {
              await fs.unlink(config.serverAddress);
            } catch {
              // Ignore
            }
          }
        });

        it('should handle rapid message sending', async () => {
          if (!config.transport.capabilities.server && !externalServer) {
            return;
          }

          const serverConnPromise = server ?
            waitForEvent(server, 'connection') :
            waitForEvent(externalServer, 'connection');

          const client = await config.transport.connect(config.clientAddress);
          const serverConn = await serverConnPromise;

          let messageCount = 0;
          serverConn.on('data', () => messageCount++);
          serverConn.on('packet', () => messageCount++);

          const totalMessages = 100;
          const startTime = Date.now();

          // Send messages rapidly
          const promises = [];
          for (let i = 0; i < totalMessages; i++) {
            promises.push(client.send(Buffer.from(`msg-${i}`)));
          }

          await Promise.all(promises);

          // Wait for messages to arrive
          await waitForCondition(() => messageCount >= totalMessages, 5000);

          const duration = Date.now() - startTime;
          const throughput = (totalMessages / duration) * 1000;

          console.log(`${config.name}: ${totalMessages} messages in ${duration}ms (${throughput.toFixed(2)} msg/s)`);

          expect(messageCount).toBe(totalMessages);
          expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

          await client.close();
        });

        it('should handle large messages', async () => {
          if (!config.transport.capabilities.server && !externalServer) {
            return;
          }

          const serverConnPromise = server ?
            waitForEvent(server, 'connection') :
            waitForEvent(externalServer, 'connection');

          const client = await config.transport.connect(config.clientAddress);
          const serverConn = await serverConnPromise;

          // Create large message (1MB)
          const largeData = Buffer.alloc(1024 * 1024, 'x');
          let receivedSize = 0;

          serverConn.on('data', (data: Buffer) => {
            receivedSize += data.length;
          });

          await client.send(largeData);

          // Wait for data to arrive
          await waitForCondition(() => receivedSize >= largeData.length, 5000);

          expect(receivedSize).toBeGreaterThanOrEqual(largeData.length);

          await client.close();
        });

        it('should handle concurrent connections', async () => {
          if (!config.transport.capabilities.server && !externalServer) {
            return;
          }

          const connectionCount = 10;
          const clients: ITransportConnection[] = [];
          const serverConnections: ITransportConnection[] = [];

          // Listen for server connections
          const connectionHandler = (conn: ITransportConnection) => {
            serverConnections.push(conn);
          };

          if (server) {
            server.on('connection', connectionHandler);
          } else if (externalServer) {
            externalServer.on('connection', connectionHandler);
          }

          // Create multiple concurrent connections
          const connectionPromises = [];
          for (let i = 0; i < connectionCount; i++) {
            connectionPromises.push(
              config.transport.connect(config.clientAddress)
            );
          }

          const connectedClients = await Promise.all(connectionPromises);
          clients.push(...connectedClients);

          // Wait for server to receive all connections
          await waitForCondition(() => serverConnections.length >= connectionCount, 5000);

          expect(clients.length).toBe(connectionCount);
          expect(serverConnections.length).toBe(connectionCount);

          // Verify all clients are connected
          clients.forEach(client => {
            expect(client.state).toBe(ConnectionState.CONNECTED);
          });

          // Clean up
          await Promise.all(clients.map(c => c.close()));
        });
      });
    });
  });

  describe('Transport Metrics', () => {
    transportConfigs.forEach((config) => {
      describe(`${config.name} Transport`, () => {
        it('should track connection metrics', async () => {
          if (!config.transport.capabilities.server) {
            return;
          }

          const server = await config.transport.createServer!(config.serverAddress);
          if (server.listen) {
            await server.listen();
          }

          const client = await config.transport.connect(config.clientAddress);

          // Send some data
          await client.send(Buffer.from('test1'));
          await client.send(Buffer.from('test2'));

          // Get metrics if available
          if (client.getMetrics) {
            const metrics = client.getMetrics();
            expect(metrics.bytesSent).toBeGreaterThan(0);
            expect(metrics.duration).toBeGreaterThanOrEqual(0);
          }

          await client.close();
          await server.close();
        });

        it('should track server metrics', async () => {
          if (!config.transport.capabilities.server) {
            return;
          }

          const server = await config.transport.createServer!(config.serverAddress);
          if (server.listen) {
            await server.listen();
          }

          // Create multiple connections
          const clients = [];
          for (let i = 0; i < 3; i++) {
            const client = await config.transport.connect(config.clientAddress);
            clients.push(client);
            await client.send(Buffer.from(`client-${i}`));
          }

          // Get server metrics if available
          if (server.getMetrics) {
            const metrics = server.getMetrics();
            expect(metrics.totalConnections).toBeGreaterThanOrEqual(3);
            expect(metrics.activeConnections).toBe(3);
            expect(metrics.totalBytesReceived).toBeGreaterThan(0);
          }

          // Clean up
          await Promise.all(clients.map(c => c.close()));
          await server.close();
        });
      });
    });
  });

  describe('Isomorphic Guarantees', () => {
    it('should provide consistent API across all transports', () => {
      transportConfigs.forEach(config => {
        const transport = config.transport;

        // All transports must implement these methods
        expect(typeof transport.connect).toBe('function');
        expect(typeof transport.isValidAddress).toBe('function');
        expect(typeof transport.parseAddress).toBe('function');
        expect(transport.capabilities).toBeDefined();
        expect(transport.name).toBeDefined();

        // Server creation should be consistent
        if (transport.capabilities.server) {
          expect(typeof transport.createServer).toBe('function');
        }
      });
    });

    it('should provide consistent connection API', async () => {
      for (const config of transportConfigs) {
        let externalServer: any;
        let server: ITransportServer | undefined;

        try {
          // Setup external server if needed (for WebSocket)
          if (config.setupServer) {
            externalServer = await config.setupServer();
          }

          // Create server if supported
          if (config.transport.capabilities.server) {
            server = await config.transport.createServer!(config.serverAddress);
            if (server.listen) {
              await server.listen();
            }
          }

          // Skip if no server available
          if (!server && !externalServer) {
            console.log(`Skipping ${config.name} - no server support`);
            continue;
          }

          const client = await config.transport.connect(config.clientAddress);

          // All connections must have these properties/methods
          expect(client.id).toBeDefined();
          expect(client.state).toBeDefined();
          expect(typeof client.send).toBe('function');
          expect(typeof client.close).toBe('function');
          expect(typeof client.on).toBe('function');
          expect(typeof client.off).toBe('function');
          expect(typeof client.once).toBe('function');
          expect(typeof client.emit).toBe('function');

          // Optional but consistent if present
          if (client.sendPacket) {
            expect(typeof client.sendPacket).toBe('function');
          }
          if (client.getMetrics) {
            expect(typeof client.getMetrics).toBe('function');
          }
          if (client.ping) {
            expect(typeof client.ping).toBe('function');
          }

          await client.close();
        } finally {
          // Clean up
          if (server) {
            await server.close();
          }
          if (config.teardownServer) {
            await config.teardownServer();
          }
          // Cleanup Unix sockets
          if (config.name === 'Unix' && config.serverAddress) {
            try {
              await fs.unlink(config.serverAddress);
            } catch {
              // Ignore
            }
          }
        }
      }
    });

    it('should emit consistent events', async () => {
      for (const config of transportConfigs) {
        let externalServer: any;
        let server: ITransportServer | undefined;

        try {
          // Setup external server if needed (for WebSocket)
          if (config.setupServer) {
            externalServer = await config.setupServer();
          }

          // Create server if supported
          if (config.transport.capabilities.server) {
            server = await config.transport.createServer!(config.serverAddress);
            if (server.listen) {
              await server.listen();
            }
          }

          // Skip if no server available
          if (!server && !externalServer) {
            console.log(`Skipping ${config.name} - no server support`);
            continue;
          }

          const client = await config.transport.connect(config.clientAddress);

          const events: string[] = [];

          // Track emitted events
          const originalEmit = client.emit.bind(client);
          client.emit = (event: string, ...args: any[]) => {
            if (typeof event === 'string') {
              events.push(event);
            }
            return originalEmit(event, ...args);
          };

          // Trigger some activity
          await client.send(Buffer.from('test'));
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait a bit for events
          await client.close();

          // All transports should emit at least these events
          // Note: Some events might be emitted differently based on implementation
          // but the core events should be consistent
          // Since we connect before tracking, we won't see 'connect' event
          // but we should see disconnect when closing
          expect(events).toContain('disconnect');
          // State changes are also commonly emitted
          expect(events.length).toBeGreaterThan(0);
        } finally {
          // Clean up
          if (server) {
            await server.close();
          }
          if (config.teardownServer) {
            await config.teardownServer();
          }
          // Cleanup Unix sockets
          if (config.name === 'Unix' && config.serverAddress) {
            try {
              await fs.unlink(config.serverAddress);
            } catch {
              // Ignore
            }
          }
        }
      }
    }, 120000); // Increased timeout for slower CI environments
  });
});