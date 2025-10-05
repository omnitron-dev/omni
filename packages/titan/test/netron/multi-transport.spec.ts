/**
 * Comprehensive multi-transport integration tests
 * Tests all available transports running simultaneously
 */

import type { Netron } from '../../src/netron/netron.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket-transport.js';
import { TcpTransport } from '../../src/netron/transport/tcp-transport.js';
import { HttpTransport } from '../../src/netron/transport/http/http-transport.js';
import { Service, Method } from '../../src/decorators/core.js';
import { createMockLogger } from './test-utils.js';
import { getAvailablePort } from '../../src/netron/transport/utils.js';
import { delay } from '@omnitron-dev/common';

describe('Multi-Transport Integration', () => {
  let server: Netron;
  let wsPort: number;
  let tcpPort: number;

  beforeEach(async () => {
    const { Netron: NetronClass } = await import('../../src/netron/netron.js');

    // Get available ports for transports (WebSocket and TCP only)
    // Note: HTTP transport is excluded as it uses a different service discovery mechanism
    wsPort = await getAvailablePort();
    tcpPort = await getAvailablePort();

    // Create server with WebSocket and TCP transports
    server = new NetronClass(createMockLogger(), {});

    // Register transports
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransport('tcp', () => new TcpTransport());

    // Register transport servers
    server.registerTransportServer('ws', {
      name: 'ws',
      options: { host: 'localhost', port: wsPort }
    });
    server.registerTransportServer('tcp', {
      name: 'tcp',
      options: { host: 'localhost', port: tcpPort }
    });

    await server.start();
  });

  afterEach(async () => {
    await server?.stop();
  });

  describe('All Transports Simultaneously', () => {
    interface IMathService {
      add(a: number, b: number): Promise<number>;
      multiply(a: number, b: number): Promise<number>;
    }

    @Service('mathService@1.0.0')
    class MathService {
      @Method()
      async add(a: number, b: number): Promise<number> {
        return a + b;
      }

      @Method()
      async multiply(a: number, b: number): Promise<number> {
        return a * b;
      }
    }

    it('should serve same service via all transports', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      const mathService = new MathService();
      server.peer.exposeService(mathService);

      // Create clients for each transport
      const wsClient = new NetronClass(createMockLogger(), {});
      wsClient.registerTransport('ws', () => new WebSocketTransport());
      await wsClient.start();

      const tcpClient = new NetronClass(createMockLogger(), {});
      tcpClient.registerTransport('tcp', () => new TcpTransport());
      await tcpClient.start();

      try {
        // Connect via all transports
        const wsPeer = await wsClient.connect(`ws://localhost:${wsPort}`);
        const tcpPeer = await tcpClient.connect(`tcp://localhost:${tcpPort}`);

        // Query interface via all transports
        const wsInterface = await wsPeer.queryInterface<IMathService>('mathService');
        const tcpInterface = await tcpPeer.queryInterface<IMathService>('mathService');

        // Test all transports work
        expect(await wsInterface.add(2, 3)).toBe(5);
        expect(await tcpInterface.add(4, 6)).toBe(10);

        expect(await wsInterface.multiply(3, 4)).toBe(12);
        expect(await tcpInterface.multiply(5, 6)).toBe(30);

        // Cleanup
        await wsPeer.releaseInterface(wsInterface);
        await tcpPeer.releaseInterface(tcpInterface);

        await wsPeer.disconnect();
        await tcpPeer.disconnect();
      } finally {
        await wsClient.stop();
        await tcpClient.stop();
      }
    });

    it('should handle concurrent requests from all transports', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      const mathService = new MathService();
      server.peer.exposeService(mathService);

      // Create clients for each transport
      const clients = [];
      const peers = [];

      for (const [transport, port] of [
        ['ws', wsPort],
        ['tcp', tcpPort]
      ] as const) {
        const client = new NetronClass(createMockLogger(), {});
        if (transport === 'ws') client.registerTransport('ws', () => new WebSocketTransport());
        if (transport === 'tcp') client.registerTransport('tcp', () => new TcpTransport());
        await client.start();
        clients.push(client);

        const peer = await client.connect(`${transport}://localhost:${port}`);
        peers.push(peer);
      }

      try {
        // Get interfaces
        const interfaces = await Promise.all(
          peers.map(peer => peer.queryInterface<IMathService>('mathService'))
        );

        // Make concurrent requests
        const results = await Promise.all([
          interfaces[0].add(1, 1),
          interfaces[1].add(2, 2),
          interfaces[0].multiply(2, 3),
          interfaces[1].multiply(4, 5)
        ]);

        expect(results).toEqual([2, 4, 6, 20]);

        // Cleanup
        for (let i = 0; i < interfaces.length; i++) {
          await peers[i].releaseInterface(interfaces[i]);
          await peers[i].disconnect();
        }
      } finally {
        for (const client of clients) {
          await client.stop();
        }
      }
    });

    it('should maintain independent state per transport', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      interface ICounterService {
        increment(): Promise<number>;
        getCount(): Promise<number>;
      }

      @Service('counterService@1.0.0')
      class CounterService {
        private count = 0;

        @Method()
        async increment(): Promise<number> {
          return ++this.count;
        }

        @Method()
        async getCount(): Promise<number> {
          return this.count;
        }
      }

      const counterService = new CounterService();
      server.peer.exposeService(counterService);

      // Create clients for each transport
      const wsClient = new NetronClass(createMockLogger(), {});
      wsClient.registerTransport('ws', () => new WebSocketTransport());
      await wsClient.start();

      const tcpClient = new NetronClass(createMockLogger(), {});
      tcpClient.registerTransport('tcp', () => new TcpTransport());
      await tcpClient.start();

      try {
        const wsPeer = await wsClient.connect(`ws://localhost:${wsPort}`);
        const tcpPeer = await tcpClient.connect(`tcp://localhost:${tcpPort}`);

        const wsInterface = await wsPeer.queryInterface<ICounterService>('counterService');
        const tcpInterface = await tcpPeer.queryInterface<ICounterService>('counterService');

        // All clients share the same service instance
        expect(await wsInterface.increment()).toBe(1);
        expect(await tcpInterface.increment()).toBe(2);
        expect(await wsInterface.getCount()).toBe(2);
        expect(await tcpInterface.getCount()).toBe(2);

        await wsPeer.releaseInterface(wsInterface);
        await tcpPeer.releaseInterface(tcpInterface);

        await wsPeer.disconnect();
        await tcpPeer.disconnect();
      } finally {
        await wsClient.stop();
        await tcpClient.stop();
      }
    });
  });

  describe('Transport Server Management', () => {
    it('should start and stop all transport servers independently', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      const testServer = new NetronClass(createMockLogger(), {});

      testServer.registerTransport('ws', () => new WebSocketTransport());
      testServer.registerTransport('tcp', () => new TcpTransport());

      const wsTestPort = await getAvailablePort();
      const tcpTestPort = await getAvailablePort();

      testServer.registerTransportServer('ws', {
        name: 'ws',
        options: { host: 'localhost', port: wsTestPort }
      });
      testServer.registerTransportServer('tcp', {
        name: 'tcp',
        options: { host: 'localhost', port: tcpTestPort }
      });

      // Start server - should start both transports
      await testServer.start();

      // Verify both transports are running
      expect(testServer.transportServers.size).toBe(2);

      // Stop server - should stop both transports
      await testServer.stop();

      expect(testServer.transportServers.size).toBe(0);
    });
  });
});
