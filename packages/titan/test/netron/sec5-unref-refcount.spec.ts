/**
 * SEC-5 — `unref_service` must refcount DYNAMIC sub-service stubs PER REMOTE PEER.
 *
 * A nested service returned by a method call is deduped into ONE shared
 * `ServiceStub` (keyed by instance) referenced by potentially many peers. The
 * `unref_service` core-task is intentionally ungated (every well-behaved client
 * calls it during normal interface release). Previously it deleted the shared
 * stub on the FIRST unref — so a malicious peer A could call `unref_service` on
 * a dynamic defId that peer B still uses and evict it out from under B
 * (cross-peer eviction DoS), and an over-eager release by one of B's own
 * interfaces could drop a stub another still referenced.
 *
 * Fix: per-peer refcounts on the stub. A remote unref releases only the calling
 * peer's own reference; the stub is evicted only when no peer references it; and
 * a peer cannot unref a defId it never referenced.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { Service, Public } from '../../src/decorators/core.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';
import { createMockLogger } from './test-utils.js';
import type { RemotePeer } from '../../src/netron/remote-peer.js';

@Service('workspace@1.0.0')
class WorkspaceService {
  @Public()
  async ping(): Promise<string> {
    return 'pong';
  }
}

@Service('directory@1.0.0')
class DirectoryService {
  // A STABLE instance, so every caller's openWorkspace() returns the same object
  // and refService dedups them into ONE shared stub.
  readonly workspace = new WorkspaceService();

  @Public()
  async openWorkspace(): Promise<WorkspaceService> {
    return this.workspace;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 60));

describe('Netron — SEC-5 per-peer unref refcounting of dynamic stubs', () => {
  let server: Netron;
  let clientA: Netron;
  let clientB: Netron;
  let port: number;

  beforeEach(async () => {
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    port = 14200 + (workerId - 1) * 200 + Math.floor(Math.random() * 180);

    server = new Netron(createMockLogger(), { id: 'sec5-server' });
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new DirectoryService());

    clientA = new Netron(createMockLogger(), { id: 'sec5-client-a' });
    clientA.registerTransport('ws', () => new WebSocketTransport());
    clientB = new Netron(createMockLogger(), { id: 'sec5-client-b' });
    clientB.registerTransport('ws', () => new WebSocketTransport());
  });

  afterEach(async () => {
    await tick();
    await clientA?.stop();
    await clientB?.stop();
    await server?.stop();
    await new Promise((r) => setTimeout(r, 120));
  });

  const serverStubs = () => (server as any).peer.stubs as Map<string, { totalRefs(): number }>;

  it('shares one stub across peers; one peer unref does NOT evict it for the other', async () => {
    const peerA = (await clientA.connect(`ws://localhost:${port}`)) as RemotePeer;
    const peerB = (await clientB.connect(`ws://localhost:${port}`)) as RemotePeer;

    const dirA = await peerA.queryInterface<{ openWorkspace(): Promise<any> }>('directory@1.0.0');
    const dirB = await peerB.queryInterface<{ openWorkspace(): Promise<any> }>('directory@1.0.0');

    const wsA = await dirA.openWorkspace();
    const wsB = await dirB.openWorkspace();
    await tick();

    const wsDefId = (wsA as any).$def.id as string;
    // Both peers resolved to the SAME shared dynamic stub...
    expect((wsB as any).$def.id).toBe(wsDefId);
    // ...with two outstanding references (one per peer).
    expect(serverStubs().get(wsDefId)?.totalRefs()).toBe(2);

    // Peer A releases its interface → its reference drops, but the stub SURVIVES
    // because peer B still holds one.
    await peerA.releaseInterface(wsA);
    await tick();
    expect(serverStubs().has(wsDefId)).toBe(true);
    expect(serverStubs().get(wsDefId)?.totalRefs()).toBe(1);
    // B can still use it.
    expect(await wsB.ping()).toBe('pong');

    // Peer B releases → no references remain → the shared stub is finally evicted.
    await peerB.releaseInterface(wsB);
    await tick();
    expect(serverStubs().has(wsDefId)).toBe(false);

    await peerA.disconnect();
    await peerB.disconnect();
  });

  it('a peer CANNOT evict a dynamic stub it never referenced (eviction-DoS closed)', async () => {
    const peerA = (await clientA.connect(`ws://localhost:${port}`)) as RemotePeer;
    const peerB = (await clientB.connect(`ws://localhost:${port}`)) as RemotePeer;

    // Only A references the workspace.
    const dirA = await peerA.queryInterface<{ openWorkspace(): Promise<any> }>('directory@1.0.0');
    const wsA = await dirA.openWorkspace();
    await tick();
    const wsDefId = (wsA as any).$def.id as string;
    expect(serverStubs().get(wsDefId)?.totalRefs()).toBe(1);

    // Peer B — who never referenced the workspace — tries to evict it directly
    // by running the ungated core-task with A's defId.
    await peerB.runTask('unref_service', wsDefId);
    await tick();

    // The stub survives untouched and A can still use it.
    expect(serverStubs().has(wsDefId)).toBe(true);
    expect(serverStubs().get(wsDefId)?.totalRefs()).toBe(1);
    expect(await wsA.ping()).toBe('pong');

    await peerA.disconnect();
    await peerB.disconnect();
  });
});
