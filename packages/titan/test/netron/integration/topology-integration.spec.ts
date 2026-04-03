/**
 * Topology Integration Tests
 *
 * Verifies the full Netron topology pipeline with REAL Netron instances
 * communicating over WebSocket transport. No mocks for networking --
 * two (or more) Netron peers exchange messages via actual WebSocket connections.
 *
 * Architecture under test:
 *   "Daemon" Netron -- server listening on a port, has services exposed via ServiceStub
 *   "Child"  Netron -- client that connects to daemon, calls queryInterface, gets proxy, makes RPC calls
 *   Service cleanup on disconnect
 *   Collision protection for remote services
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import { Service1 } from '../fixtures/service1.js';
import { Service2 } from '../fixtures/service2.js';
import { createMockLogger } from '../test-utils.js';
import { getFreePort, delay, waitForCondition } from '../../utils/transport-test-utils.js';
import { Public, Service } from '../../../src/decorators/core.js';
import type { RemotePeer } from '../../../src/netron/remote-peer.js';

// ---------------------------------------------------------------------------
// Additional test service fixtures
// ---------------------------------------------------------------------------

@Service('serviceA')
class ServiceA {
  @Public()
  ping(): string {
    return 'pong-A';
  }
}

@Service('serviceB')
class ServiceB {
  @Public()
  ping(): string {
    return 'pong-B';
  }
}

@Service('sharedService')
class SharedServiceV1 {
  @Public()
  version(): string {
    return 'v1';
  }
}

@Service('sharedService')
class SharedServiceV2 {
  @Public()
  version(): string {
    return 'v2';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a Netron server instance with WS transport on a free port. */
async function createServer(id: string): Promise<{ netron: Netron; port: number }> {
  const port = await getFreePort();
  const netron = new Netron(createMockLogger(), { id });

  netron.registerTransport('ws', () => new WebSocketTransport());
  netron.registerTransportServer('ws', {
    name: 'ws',
    options: { host: '127.0.0.1', port },
  });

  await netron.start();
  return { netron, port };
}

/** Create a Netron client instance with WS transport (client-only mode). */
async function createClient(id: string): Promise<Netron> {
  const netron = new Netron(createMockLogger(), { id });
  netron.registerTransport('ws', () => new WebSocketTransport());
  // Start in client-only mode so core tasks (query_interface, expose_service, etc.) are registered
  await netron.start();
  return netron;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Netron Topology Integration', () => {
  // Instances to clean up after each test
  let instances: Netron[] = [];

  afterEach(async () => {
    // Allow in-flight WebSocket frames to drain before stopping
    await delay(100);

    for (const n of instances) {
      try {
        await n.stop();
      } catch {
        // Already stopped or failed -- safe to ignore
      }
    }
    instances = [];

    // Extra delay for OS port release
    await delay(200);
  });

  // =========================================================================
  // Group 1: Two-Peer Service Exposure & RPC
  // =========================================================================

  describe('Two-Peer Service Exposure & RPC', () => {
    it('Peer A exposes @Service, Peer B connects, queryInterface, RPC calls succeed', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      // Expose Service1 on the server's local peer
      await server.peer.exposeService(new Service1());

      // Create client and connect
      const client = await createClient('client');
      instances.push(client);

      const peer = (await client.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;

      // queryInterface returns a typed proxy
      const proxy = await peer.queryInterface<any>('service1');
      expect(proxy).toBeDefined();

      // RPC: greet()
      const greeting = await proxy.greet();
      expect(greeting).toBe('Hello, Context1!');

      // RPC: addNumbers(3, 7)
      const sum = await proxy.addNumbers(3, 7);
      expect(sum).toBe(10);

      // RPC: echo('integration-test')
      const echoed = await proxy.echo('integration-test');
      expect(echoed).toBe('integration-test');

      // RPC: concatenateStrings
      const concat = await proxy.concatenateStrings('foo', 'bar');
      expect(concat).toBe('foobar');

      await peer.disconnect();
    }, 30_000);

    it('Remote service exposure: client exposes service ON server via exposeService', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      // Client A connects and exposes Service1 remotely on server
      const clientA = await createClient('clientA');
      instances.push(clientA);
      const peerA = (await clientA.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;

      // exposeService on the RemotePeer sends an expose_service core-task to the server
      await peerA.exposeService(new Service1());

      // Verify server now has the service
      await waitForCondition(
        () => server.services.has('service1'),
        5000,
        50,
      );
      expect(server.services.has('service1')).toBe(true);

      // A second client connects to the server and queries the service
      const clientB = await createClient('clientB');
      instances.push(clientB);
      const peerB = (await clientB.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;

      const proxy = await peerB.queryInterface<any>('service1');
      expect(proxy).toBeDefined();

      const result = await proxy.echo('two-hop');
      expect(result).toBe('two-hop');

      const sum = await proxy.addNumbers(10, 20);
      expect(sum).toBe(30);

      await peerB.disconnect();
      await peerA.disconnect();
    }, 30_000);
  });

  // =========================================================================
  // Group 2: Disconnect Cleanup (Integration)
  // =========================================================================

  describe('Disconnect Cleanup', () => {
    it('Client exposes service on server, disconnects -- service removed from server', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      const client = await createClient('client');
      instances.push(client);
      const peer = (await client.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;

      // Expose Service1 remotely on the server
      await peer.exposeService(new Service1());

      // Verify it is there
      await waitForCondition(
        () => server.services.has('service1'),
        5000,
        50,
      );
      expect(server.services.has('service1')).toBe(true);

      // Disconnect the client
      await peer.disconnect();

      // Wait for the server to clean up the service
      await waitForCondition(
        () => !server.services.has('service1'),
        5000,
        50,
      );
      expect(server.services.has('service1')).toBe(false);
    }, 30_000);

    it('Multiple clients, one disconnects -- only its services are cleaned', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      // Client A exposes ServiceA
      const clientA = await createClient('clientA');
      instances.push(clientA);
      const peerA = (await clientA.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      await peerA.exposeService(new ServiceA());

      await waitForCondition(
        () => server.services.has('serviceA'),
        5000,
        50,
      );

      // Client B exposes ServiceB
      const clientB = await createClient('clientB');
      instances.push(clientB);
      const peerB = (await clientB.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      await peerB.exposeService(new ServiceB());

      await waitForCondition(
        () => server.services.has('serviceB'),
        5000,
        50,
      );

      // Both services present
      expect(server.services.has('serviceA')).toBe(true);
      expect(server.services.has('serviceB')).toBe(true);

      // Client A disconnects
      await peerA.disconnect();

      // Wait for cleanup of ServiceA
      await waitForCondition(
        () => !server.services.has('serviceA'),
        5000,
        50,
      );

      // ServiceA gone, ServiceB still present
      expect(server.services.has('serviceA')).toBe(false);
      expect(server.services.has('serviceB')).toBe(true);

      await peerB.disconnect();
    }, 30_000);
  });

  // =========================================================================
  // Group 3: Collision Protection (Integration)
  // =========================================================================

  describe('Collision Protection', () => {
    it('Two clients expose same service name -- second gets conflict error', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      // Client A exposes SharedService
      const clientA = await createClient('clientA');
      instances.push(clientA);
      const peerA = (await clientA.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      await peerA.exposeService(new SharedServiceV1());

      await waitForCondition(
        () => server.services.has('sharedService'),
        5000,
        50,
      );

      // Client B tries to expose the same service name
      const clientB = await createClient('clientB');
      instances.push(clientB);
      const peerB = (await clientB.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;

      await expect(
        peerB.exposeService(new SharedServiceV2()),
      ).rejects.toThrow(/conflict|already exposed/i);

      // Verify only A's version remains
      expect(server.services.has('sharedService')).toBe(true);

      // Query the service from yet another client to confirm it still works
      const clientC = await createClient('clientC');
      instances.push(clientC);
      const peerC = (await clientC.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      const proxy = await peerC.queryInterface<any>('sharedService');
      const ver = await proxy.version();
      expect(ver).toBe('v1');

      await peerC.disconnect();
      await peerB.disconnect();
      await peerA.disconnect();
    }, 30_000);
  });

  // =========================================================================
  // Group 4: getServiceMetadata()
  // =========================================================================

  describe('getServiceMetadata', () => {
    it('Returns correct metadata for locally exposed services', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      // Expose Service1 on the server's local peer
      await server.peer.exposeService(new Service1());

      const metadata = server.getServiceMetadata();
      expect(metadata.length).toBeGreaterThanOrEqual(1);

      const svc1Meta = metadata.find((m) => m.name === 'service1');
      expect(svc1Meta).toBeDefined();
      expect(svc1Meta!.methods).toContain('greet');
      expect(svc1Meta!.methods).toContain('addNumbers');
      expect(svc1Meta!.methods).toContain('echo');
      expect(svc1Meta!.methods).toContain('concatenateStrings');
      expect(svc1Meta!.methods).toContain('getBooleanValue');
    }, 30_000);

    it('Returns metadata for remotely exposed services', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      const client = await createClient('client');
      instances.push(client);
      const peer = (await client.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;

      // Expose Service1 remotely on the server
      await peer.exposeService(new Service1());

      await waitForCondition(
        () => server.services.has('service1'),
        5000,
        50,
      );

      const metadata = server.getServiceMetadata();
      const svc1Meta = metadata.find((m) => m.name === 'service1');
      expect(svc1Meta).toBeDefined();
      expect(svc1Meta!.methods).toContain('greet');
      expect(svc1Meta!.methods).toContain('addNumbers');

      await peer.disconnect();
    }, 30_000);

    it('Returns metadata for multiple services', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      await server.peer.exposeService(new Service1());
      await server.peer.exposeService(new Service2());

      const metadata = server.getServiceMetadata();
      expect(metadata.length).toBeGreaterThanOrEqual(2);

      const names = metadata.map((m) => m.name);
      expect(names).toContain('service1');
      expect(names).toContain('service2');
    }, 30_000);
  });

  // =========================================================================
  // Group 5: Reconnection
  // =========================================================================

  describe('Reconnection', () => {
    it('Client reconnects after disconnect -- can query services again', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      // Expose Service1 on the server
      await server.peer.exposeService(new Service1());

      // First connection
      const client = await createClient('client');
      instances.push(client);

      const peer1 = (await client.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      const proxy1 = await peer1.queryInterface<any>('service1');
      const greeting1 = await proxy1.greet();
      expect(greeting1).toBe('Hello, Context1!');

      // Disconnect
      await peer1.disconnect();

      // Allow disconnect to settle
      await delay(500);

      // Reconnect
      const peer2 = (await client.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      const proxy2 = await peer2.queryInterface<any>('service1');
      const greeting2 = await proxy2.greet();
      expect(greeting2).toBe('Hello, Context1!');

      const sum = await proxy2.addNumbers(100, 200);
      expect(sum).toBe(300);

      await peer2.disconnect();
    }, 30_000);
  });

  // =========================================================================
  // Group 6: Edge Cases & Robustness
  // =========================================================================

  describe('Edge Cases', () => {
    it('Querying a non-existent service throws an appropriate error', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      const client = await createClient('client');
      instances.push(client);
      const peer = (await client.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;

      await expect(
        peer.queryInterface<any>('nonExistentService'),
      ).rejects.toThrow();

      await peer.disconnect();
    }, 30_000);

    it('Server exposes multiple services -- client can query each independently', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      await server.peer.exposeService(new Service1());
      await server.peer.exposeService(new ServiceA());
      await server.peer.exposeService(new ServiceB());

      const client = await createClient('client');
      instances.push(client);
      const peer = (await client.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;

      const proxy1 = await peer.queryInterface<any>('service1');
      expect(await proxy1.greet()).toBe('Hello, Context1!');

      const proxyA = await peer.queryInterface<any>('serviceA');
      expect(await proxyA.ping()).toBe('pong-A');

      const proxyB = await peer.queryInterface<any>('serviceB');
      expect(await proxyB.ping()).toBe('pong-B');

      await peer.disconnect();
    }, 30_000);

    it('Client exposes service, disconnects, and a new client exposes same service name', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      // Client A exposes service, then disconnects
      const clientA = await createClient('clientA');
      instances.push(clientA);
      const peerA = (await clientA.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      await peerA.exposeService(new SharedServiceV1());

      await waitForCondition(
        () => server.services.has('sharedService'),
        5000,
        50,
      );

      await peerA.disconnect();

      // Wait for cleanup
      await waitForCondition(
        () => !server.services.has('sharedService'),
        5000,
        50,
      );

      // Client B now exposes the same service name -- should succeed
      const clientB = await createClient('clientB');
      instances.push(clientB);
      const peerB = (await clientB.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      await peerB.exposeService(new SharedServiceV2());

      await waitForCondition(
        () => server.services.has('sharedService'),
        5000,
        50,
      );

      // Query from a third client
      const clientC = await createClient('clientC');
      instances.push(clientC);
      const peerC = (await clientC.connect(`ws://127.0.0.1:${port}`, false)) as RemotePeer;
      const proxy = await peerC.queryInterface<any>('sharedService');
      const ver = await proxy.version();
      expect(ver).toBe('v2');

      await peerC.disconnect();
      await peerB.disconnect();
    }, 30_000);

    it('getServiceNames returns all currently registered service names', async () => {
      const { netron: server, port } = await createServer('server');
      instances.push(server);

      await server.peer.exposeService(new Service1());
      await server.peer.exposeService(new ServiceA());

      const names = server.getServiceNames();
      expect(names).toContain('service1');
      expect(names).toContain('serviceA');
    }, 30_000);
  });
});
