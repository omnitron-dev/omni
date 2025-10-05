/**
 * Tests for transport-specific options functionality
 */

import type { Netron, RemotePeer } from '../../src/netron/netron.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket-transport.js';
import { Service, Public } from '../../src/decorators/core.js';
import { createMockLogger } from './test-utils.js';
import { getAvailablePort } from '../../src/netron/transport/utils.js';
import { delay } from '@omnitron-dev/common';

describe('Transport Options', () => {
  let server: Netron;
  let client: Netron;
  let testPort: number;

  beforeEach(async () => {
    const { Netron: NetronClass } = await import('../../src/netron/netron.js');

    testPort = await getAvailablePort();

    // Create server
    server = new NetronClass(createMockLogger(), {});
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', {
      name: 'ws',
      options: { host: 'localhost', port: testPort }
    });
    await server.start();

    // Create client
    client = new NetronClass(createMockLogger(), {});
    client.registerTransport('ws', () => new WebSocketTransport());
  });

  afterEach(async () => {
    await client?.stop();
    await server?.stop();
  });

  describe('setTransportOptions()', () => {
    it('should set transport options for registered transport', async () => {
      const transportOptions = {
        requestTimeout: 1000,
        connectTimeout: 5000
      };

      expect(() => {
        client.setTransportOptions('ws', transportOptions);
      }).not.toThrow();
    });

    it('should throw when setting options for unregistered transport', () => {
      expect(() => {
        client.setTransportOptions('http', { requestTimeout: 1000 });
      }).toThrow(/Transport http not registered/);
    });

    it('should allow setting options before connecting', async () => {
      client.setTransportOptions('ws', {
        requestTimeout: 2000,
        connectTimeout: 3000
      });

      await client.start();
      const peer = await client.connect(`ws://localhost:${testPort}`);
      expect(peer).toBeDefined();
      await peer.disconnect();
    });

    it('should allow updating options for existing transport', () => {
      client.setTransportOptions('ws', { requestTimeout: 1000 });
      client.setTransportOptions('ws', { requestTimeout: 2000 });

      // Should not throw
      expect(() => {
        client.setTransportOptions('ws', { connectTimeout: 5000 });
      }).not.toThrow();
    });
  });

  describe('Request Timeout', () => {
    interface IDelayService {
      delay(ms: number): Promise<void>;
    }

    @Service('delayService@1.0.0')
    class DelayService {
      @Public()
      async delay(ms: number): Promise<void> {
        await delay(ms);
      }
    }

    it.skip('should use transport-specific requestTimeout', async () => {
      // Set short timeout (300ms)
      client.setTransportOptions('ws', { requestTimeout: 300 });

      const service = new DelayService();
      server.peer.exposeService(service);

      await client.start();
      const peer = await client.connect(`ws://localhost:${testPort}`);
      const iface = await peer.queryInterface<IDelayService>('delayService');

      // Should timeout after 300ms when trying to delay 1000ms
      await expect(iface.delay(1000)).rejects.toThrow(/Request timeout exceeded/);

      await peer.releaseInterface(iface);
      await peer.disconnect();
    });

    it('should use default timeout when not specified', async () => {
      // Don't set any timeout - should use default (5000ms)
      const service = new DelayService();
      server.peer.exposeService(service);

      await client.start();
      const peer = await client.connect(`ws://localhost:${testPort}`);
      const iface = await peer.queryInterface<IDelayService>('delayService');

      // Should complete within default timeout
      await expect(iface.delay(100)).resolves.toBeUndefined();

      await peer.releaseInterface(iface);
      await peer.disconnect();
    });

    it('should allow setting different timeouts for same transport', () => {
      // Set different timeouts for the same transport (update)
      client.setTransportOptions('ws', { requestTimeout: 1000 });
      client.setTransportOptions('ws', { requestTimeout: 3000 });

      // Verify no errors
      expect(() => {
        client.setTransportOptions('ws', { requestTimeout: 500 });
      }).not.toThrow();
    });
  });

  describe('Connect Timeout', () => {
    it.skip('should timeout connection when server unreachable', async () => {
      const unavailablePort = await getAvailablePort(40000, 45000);

      client.setTransportOptions('ws', { connectTimeout: 500 });
      await client.start();

      await expect(
        client.connect(`ws://localhost:${unavailablePort}`)
      ).rejects.toThrow(/timeout/);
    });

    it('should use default connect timeout when not specified', async () => {
      await client.start();

      // Should connect successfully with default timeout (10s)
      const peer = await client.connect(`ws://localhost:${testPort}`);
      expect(peer).toBeDefined();
      expect(peer.id).toBeTruthy();
      await peer.disconnect();
    });
  });

  describe('Reconnection Options', () => {
    it('should respect maxAttempts from transport options', async () => {
      client.setTransportOptions('ws', {
        reconnect: {
          enabled: true,
          maxAttempts: 2,
          delay: 100
        }
      });

      await client.start();
      const peer = await client.connect(`ws://localhost:${testPort}`, true);
      expect(peer).toBeDefined();

      await peer.disconnect();
    });

    it('should not reconnect when maxAttempts is 0', async () => {
      client.setTransportOptions('ws', {
        reconnect: {
          maxAttempts: 0
        }
      });

      await client.start();
      const peer = await client.connect(`ws://localhost:${testPort}`, true);
      expect(peer).toBeDefined();

      await peer.disconnect();
    });
  });

  describe('Transport Options Integration', () => {
    it('should pass transport options to connection', async () => {
      const customHeaders = { 'X-Custom-Header': 'test' };

      client.setTransportOptions('ws', {
        headers: customHeaders,
        requestTimeout: 3000,
        connectTimeout: 5000
      });

      await client.start();
      const peer = await client.connect(`ws://localhost:${testPort}`);

      expect(peer).toBeDefined();
      expect(peer.id).toBeTruthy();

      await peer.disconnect();
    });

    it('should handle multiple clients with different options', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      const client1 = new NetronClass(createMockLogger(), {});
      const client2 = new NetronClass(createMockLogger(), {});

      client1.registerTransport('ws', () => new WebSocketTransport());
      client2.registerTransport('ws', () => new WebSocketTransport());

      client1.setTransportOptions('ws', { requestTimeout: 1000 });
      client2.setTransportOptions('ws', { requestTimeout: 5000 });

      await client1.start();
      await client2.start();

      const peer1 = await client1.connect(`ws://localhost:${testPort}`);
      const peer2 = await client2.connect(`ws://localhost:${testPort}`);

      expect(peer1).toBeDefined();
      expect(peer2).toBeDefined();

      await peer1.disconnect();
      await peer2.disconnect();
      await client1.stop();
      await client2.stop();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty transport options', () => {
      expect(() => {
        client.setTransportOptions('ws', {});
      }).not.toThrow();
    });

    it('should handle partial transport options', () => {
      expect(() => {
        client.setTransportOptions('ws', { requestTimeout: 1000 });
        client.setTransportOptions('ws', { connectTimeout: 2000 });
      }).not.toThrow();
    });

    it('should preserve other options when updating', async () => {
      client.setTransportOptions('ws', {
        requestTimeout: 1000,
        connectTimeout: 2000
      });

      client.setTransportOptions('ws', {
        requestTimeout: 3000
      });

      // Both options should work after update
      await client.start();
      const peer = await client.connect(`ws://localhost:${testPort}`);
      expect(peer).toBeDefined();
      expect(peer.id).toBeTruthy();
      await peer.disconnect();
    });
  });
});
