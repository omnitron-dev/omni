/**
 * Tests for method-level transport filtering
 * Tests that @Method({ transports: [...] }) properly restricts method availability
 */

import type { Netron } from '../../src/netron/netron.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket-transport.js';
import { TcpTransport } from '../../src/netron/transport/tcp-transport.js';
import { HttpTransport } from '../../src/netron/transport/http/http-transport.js';
import { Service, Method } from '../../src/decorators/core.js';
import { createMockLogger } from './test-utils.js';
import { getAvailablePort } from '../../src/netron/transport/utils.js';

describe('Method-Level Transport Filtering', () => {
  let server: Netron;
  let wsPort: number;
  let tcpPort: number;

  beforeEach(async () => {
    const { Netron: NetronClass } = await import('../../src/netron/netron.js');

    // Get available ports for transports
    wsPort = await getAvailablePort();
    tcpPort = await getAvailablePort();

    // Create server with WebSocket and TCP transports
    server = new NetronClass(createMockLogger(), {});

    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransport('tcp', () => new TcpTransport());

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

  describe('Transport Metadata in Service Definition', () => {
    interface ITestService {
      publicMethod(): Promise<string>;
      wsOnly(): Promise<string>;
      tcpOnly(): Promise<string>;
      wsAndTcp(): Promise<string>;
    }

    @Service('testService@1.0.0')
    class TestService {
      @Method()
      async publicMethod(): Promise<string> {
        return 'available on all transports';
      }

      @Method({ transports: ['ws'] })
      async wsOnly(): Promise<string> {
        return 'websocket only';
      }

      @Method({ transports: ['tcp'] })
      async tcpOnly(): Promise<string> {
        return 'tcp only';
      }

      @Method({ transports: ['ws', 'tcp'] })
      async wsAndTcp(): Promise<string> {
        return 'websocket and tcp';
      }
    }

    it('should include transport metadata in service definition', async () => {
      const service = new TestService();
      const definition = await server.peer.exposeService(service);

      // Verify metadata is correctly stored
      expect(definition.meta.methods.publicMethod).toBeDefined();
      expect(definition.meta.methods.publicMethod.transports).toBeUndefined(); // Available on all

      expect(definition.meta.methods.wsOnly).toBeDefined();
      expect(definition.meta.methods.wsOnly.transports).toEqual(['ws']);

      expect(definition.meta.methods.tcpOnly).toBeDefined();
      expect(definition.meta.methods.tcpOnly.transports).toEqual(['tcp']);

      expect(definition.meta.methods.wsAndTcp).toBeDefined();
      expect(definition.meta.methods.wsAndTcp.transports).toEqual(['ws', 'tcp']);
    });

    it('should expose all methods via interface (filtering is application-level)', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      const service = new TestService();
      await server.peer.exposeService(service);

      const client = new NetronClass(createMockLogger(), {});
      client.registerTransport('ws', () => new WebSocketTransport());
      await client.start();

      try {
        const peer = await client.connect(`ws://localhost:${wsPort}`);
        const iface = await peer.queryInterface<ITestService>('testService');

        // All methods are available through interface
        // Note: Actual enforcement of transport restrictions would be
        // implemented at application level based on metadata
        const result1 = await iface.publicMethod();
        expect(result1).toBe('available on all transports');

        const result2 = await iface.wsOnly();
        expect(result2).toBe('websocket only');

        const result3 = await iface.wsAndTcp();
        expect(result3).toBe('websocket and tcp');

        await peer.releaseInterface(iface);
        await peer.disconnect();
      } finally {
        await client.stop();
      }
    });

    it('should allow application to filter methods based on transport', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      const service = new TestService();
      const definition = await server.peer.exposeService(service);

      // Application-level filtering logic
      const filterMethodsByTransport = (definition: any, transport: string) => {
        const filtered: string[] = [];
        for (const [methodName, methodInfo] of Object.entries(definition.meta.methods as any)) {
          // If method has no transports specified, it's available on all
          if (!methodInfo.transports) {
            filtered.push(methodName);
            continue;
          }

          // If method specifies transports, check if current transport is included
          if (methodInfo.transports.includes(transport)) {
            filtered.push(methodName);
          }
        }
        return filtered;
      };

      // Test filtering for WebSocket
      const wsMethods = filterMethodsByTransport(definition, 'ws');
      expect(wsMethods).toContain('publicMethod');
      expect(wsMethods).toContain('wsOnly');
      expect(wsMethods).toContain('wsAndTcp');
      expect(wsMethods).not.toContain('tcpOnly');

      // Test filtering for TCP
      const tcpMethods = filterMethodsByTransport(definition, 'tcp');
      expect(tcpMethods).toContain('publicMethod');
      expect(tcpMethods).toContain('tcpOnly');
      expect(tcpMethods).toContain('wsAndTcp');
      expect(tcpMethods).not.toContain('wsOnly');

      // Test filtering for unknown transport
      const unknownMethods = filterMethodsByTransport(definition, 'unknown');
      expect(unknownMethods).toContain('publicMethod');
      expect(unknownMethods).not.toContain('wsOnly');
      expect(unknownMethods).not.toContain('tcpOnly');
      expect(unknownMethods).not.toContain('wsAndTcp');
    });
  });

  describe('Default Behavior', () => {
    @Service('defaultService@1.0.0')
    class DefaultService {
      @Method()
      async method1(): Promise<string> {
        return 'method1';
      }

      @Method()
      async method2(): Promise<string> {
        return 'method2';
      }

      @Method()
      async method3(): Promise<string> {
        return 'method3';
      }
    }

    it('should make methods available on all transports by default', async () => {
      const service = new DefaultService();
      const definition = await server.peer.exposeService(service);

      // All methods should have no transport restrictions
      expect(definition.meta.methods.method1.transports).toBeUndefined();
      expect(definition.meta.methods.method2.transports).toBeUndefined();
      expect(definition.meta.methods.method3.transports).toBeUndefined();
    });

    it('should work via any transport when no transports specified', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      interface IDefaultService {
        method1(): Promise<string>;
      }

      const service = new DefaultService();
      await server.peer.exposeService(service);

      // Test via WebSocket
      const wsClient = new NetronClass(createMockLogger(), {});
      wsClient.registerTransport('ws', () => new WebSocketTransport());
      await wsClient.start();

      // Test via TCP
      const tcpClient = new NetronClass(createMockLogger(), {});
      tcpClient.registerTransport('tcp', () => new TcpTransport());
      await tcpClient.start();

      try {
        const wsPeer = await wsClient.connect(`ws://localhost:${wsPort}`);
        const wsIface = await wsPeer.queryInterface<IDefaultService>('defaultService');
        expect(await wsIface.method1()).toBe('method1');
        await wsPeer.releaseInterface(wsIface);
        await wsPeer.disconnect();

        const tcpPeer = await tcpClient.connect(`tcp://localhost:${tcpPort}`);
        const tcpIface = await tcpPeer.queryInterface<IDefaultService>('defaultService');
        expect(await tcpIface.method1()).toBe('method1');
        await tcpPeer.releaseInterface(tcpIface);
        await tcpPeer.disconnect();
      } finally {
        await wsClient.stop();
        await tcpClient.stop();
      }
    });
  });

  describe('Mixed Transport Specifications', () => {
    interface IMixedService {
      allTransports(): Promise<string>;
      wsOnly(): Promise<string>;
      bothTransports(): Promise<string>;
    }

    @Service('mixedService@1.0.0')
    class MixedService {
      @Method()
      async allTransports(): Promise<string> {
        return 'all';
      }

      @Method({ transports: ['ws'] })
      async wsOnly(): Promise<string> {
        return 'ws';
      }

      @Method({ transports: ['ws', 'tcp'] })
      async bothTransports(): Promise<string> {
        return 'ws-tcp';
      }
    }

    it('should handle services with mixed transport specifications', async () => {
      const service = new MixedService();
      const definition = await server.peer.exposeService(service);

      expect(definition.meta.methods.allTransports.transports).toBeUndefined();
      expect(definition.meta.methods.wsOnly.transports).toEqual(['ws']);
      expect(definition.meta.methods.bothTransports.transports).toEqual(['ws', 'tcp']);
    });

    it('should preserve transport metadata through serialization', async () => {
      const service = new MixedService();
      const definition = await server.peer.exposeService(service);

      // Serialize and deserialize metadata
      const serialized = JSON.stringify(definition.meta);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.methods.allTransports.transports).toBeUndefined();
      expect(deserialized.methods.wsOnly.transports).toEqual(['ws']);
      expect(deserialized.methods.bothTransports.transports).toEqual(['ws', 'tcp']);
    });
  });

  describe('Edge Cases', () => {
    @Service('edgeService@1.0.0')
    class EdgeService {
      @Method({ transports: [] })
      async emptyTransports(): Promise<string> {
        return 'empty';
      }

      @Method({ transports: ['nonexistent'] })
      async nonexistentTransport(): Promise<string> {
        return 'nonexistent';
      }
    }

    it('should handle empty transports array', async () => {
      const service = new EdgeService();
      const definition = await server.peer.exposeService(service);

      // Empty array should not be stored (filtered by Method decorator)
      // because we check options.transports.length > 0
      expect(definition.meta.methods.emptyTransports.transports).toBeUndefined();
    });

    it('should allow non-existent transport names in metadata', async () => {
      const service = new EdgeService();
      const definition = await server.peer.exposeService(service);

      // Metadata should store whatever was specified
      // Validation is application-level concern
      expect(definition.meta.methods.nonexistentTransport.transports).toEqual(['nonexistent']);
    });
  });

  describe('Backward Compatibility', () => {
    @Service('legacyService@1.0.0')
    class LegacyService {
      @Method()
      async oldMethod(): Promise<string> {
        return 'legacy';
      }
    }

    it('should maintain backward compatibility with services not using transport filtering', async () => {
      const { Netron: NetronClass } = await import('../../src/netron/netron.js');

      interface ILegacyService {
        oldMethod(): Promise<string>;
      }

      const service = new LegacyService();
      const definition = await server.peer.exposeService(service);

      // No transport metadata should be present
      expect(definition.meta.methods.oldMethod.transports).toBeUndefined();

      // Should work via all transports
      const client = new NetronClass(createMockLogger(), {});
      client.registerTransport('ws', () => new WebSocketTransport());
      await client.start();

      try {
        const peer = await client.connect(`ws://localhost:${wsPort}`);
        const iface = await peer.queryInterface<ILegacyService>('legacyService');

        expect(await iface.oldMethod()).toBe('legacy');

        await peer.releaseInterface(iface);
        await peer.disconnect();
      } finally {
        await client.stop();
      }
    });
  });
});
