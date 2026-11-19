import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { Public, Service } from '@omnitron-dev/titan/decorators';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import { directLink, mintServiceToken } from '../../src/cluster/mesh-link.js';
import { SlaveConnector } from '../../src/cluster/slave-connector.js';
import { createDaemonTokenValidator } from '../../src/services/daemon-authority.js';
import { FlowLedger } from '../../src/flows/flow-ledger.js';
import { FlowRuntime } from '../../src/flows/flow-runtime.js';
import { FlowsRpcService } from '../../src/flows/flows.rpc-service.js';
import { flowWorkspaceReader } from '../../src/flows/host-flow-runtime.js';
import { diskSpaceFlow, defaultFlowRegistry } from '../../src/shared/dto/flows.js';
import { SystemInfoRpcService } from '../../src/services/system-info.rpc-service.js';
import type { SystemInfoService } from '../../src/services/system-info.service.js';
import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import type { OmnitronAuthUser } from '../../src/shared/dto/services.js';

@Service('OmnitronDaemon@1.0.0')
class Liveness {
  pings = 0;

  @Public({ auth: { allowAnonymous: true } })
  ping() { this.pings++; return { version: 'untrusted-peer' }; }
}

// Every method is deliberately exposed, even without credentials. The controller
// must guard the boundary when a misconfigured or hostile peer does not.
@Service('OmnitronSync@1.0.0')
class OpenSync {
  reads = 0;
  drains = 0;
  released: string[] = [];

  @Public({ auth: { allowAnonymous: true } })
  getSyncStatus() { this.reads++; return { pendingItems: 777 }; }

  @Public({ auth: { allowAnonymous: true } })
  drainBuffer() {
    this.drains++;
    return { nodeId: 'another-registered-node', entries: this.released.length ? [] : [{ id: 'sample' }] };
  }

  @Public({ auth: { allowAnonymous: true } })
  ackDrained({ ids }: { ids: string[] }) { this.released.push(...ids); }
}

describe('controller authority on the TCP mesh', () => {
  const logger = createNullLogger();
  const secret = randomBytes(32).toString('hex');
  const receiveBatch = vi.fn(async () => ({ acceptedIds: ['sample'], committedIds: ['sample'], receiptVersion: 1 }));
  let host: Netron, controller: SlaveConnector, port: number, liveness: Liveness, sync: OpenSync;
  beforeEach(async () => {
    receiveBatch.mockClear();
    host = new Netron(logger);
    host.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw new Error('Token required'); },
      validateToken: createDaemonTokenValidator(async token => (
        await jwtVerify(token, new TextEncoder().encode(secret), { issuer: 'omnitron', algorithms: ['HS256'] })
      ).payload, null),
    }), new AuthorizationManager(logger));
    host.registerTransport('tcp', () => new TcpTransport());
    host.registerTransportServer('tcp', { name: 'tcp', options: { host: '127.0.0.1', port: 0 } });
    await host.start();
    port = (host.transportServers.get('tcp') as { port: number }).port;
    liveness = new Liveness();
    sync = new OpenSync();
    await host.peer.exposeService(liveness);
    await host.peer.exposeService(sync);
  });
  afterEach(async () => { await controller?.dispose(); await host?.stop(); });

  async function join(token?: string, nodeId = 'registered-node') {
    controller = new SlaveConnector(logger, { receiveBatch } as never, {
      dial: async target => ({ ...await directLink(target), token }),
    });
    await controller.addSlave({ host: '127.0.0.1', port, nodeId });
    expect(await controller.waitUntilConnected('127.0.0.1', port, 2_000)).toBe(true);
  }

  it('routes disk observations to the enrolled peer, retains original receipts across disconnect and refuses a replacement at the same address', async () => {
    const nodeId = randomUUID();
    let pin = 'first-enrollment';
    let now = Date.now();
    let free = 20;
    const disk = vi.fn(async () => ({
      timestamp: Date.now(), daemon: { pid: 54 }, unanswered: {},
      disks: [{ mount: '/data', size: 200, available: free }],
    }));
    await host.peer.exposeService(new SystemInfoRpcService({ getSnapshot: disk } as unknown as SystemInfoService));
    await join(await mintServiceToken(secret, 'controller'), nodeId);
    const registry = {
      getNode: (id: string) => id === nodeId ? { id, isLocal: false, host: '127.0.0.1', daemonPort: port } : null,
      setSlaveConnector() {},
    };
    const nodes = new NodeManagerRpcService(registry as never);
    nodes.setSlaveConnector(controller);
    const mesh = { identity: (id: string) => { if (id !== nodeId) throw Error('Unknown node'); return pin; },
      snapshot: (id: string) => nodes.getNodeSystemSnapshot({ nodeId: id }) };
    const scope = flowWorkspaceReader({} as never, mesh);
    const folder = await mkdtemp(joinPath(tmpdir(), 'mesh-flow-'));
    const file = joinPath(folder, 'controller.sqlite');
    const db = new Database(file);
    const ledger = new FlowLedger(db, defaultFlowRegistry, () => now);
    const readLocal = vi.fn(async () => ({ freeBytes: 0, totalBytes: 1 }));
    const runtime = new FlowRuntime(ledger, { scope, mesh, readDisk: readLocal, admit: async () => {}, deliver: vi.fn(), report: vi.fn() });
    const rpc = new FlowsRpcService(runtime, { validateSession: async () => ({id:'operator',role:'admin'} as OmnitronAuthUser) }, { record: async () => {} }, scope, async () => {});
    const workspace = { project: null };
    const ref = { workspace, id: randomUUID() };
    try {
      await runWithAuth({ userId:'operator',roles:['admin'],permissions:[],metadata:{sessionId:'test'} }, async () => {
        const definition = diskSpaceFlow('/', 40, 70);
        definition.nodes[0] = { id:'disk', type:'mesh.disk@1', config:{ nodeId, mount:'/data', intervalMs:5000 } };
        const draft = await rpc.save({ ...ref, definition, expectedRevision:null });
        const change = { ...ref, revision:draft.revision, activation:null };
        const active = (await rpc.activate(change)).active!;
        await Promise.all([runtime.tick(), runtime.tick()]);
        const [receipt] = await rpc.history(ref);
        expect(receipt?.event.data).toMatchObject({ nodeId, nodeIdentity:pin, mount:'/data', freeBytes:20 });
        expect(receipt?.deliveries).toMatchObject([{ title:'Disk space is low', status:'delivered' }]);
        const firstDelivery = receipt!.deliveries[0]!.id;
        await expect(rpc.submit({ ...ref, activation:active.id, event:{ ...receipt!.event, id:'manual-copy' } })).rejects.toThrow('registered provider');
        await controller.removeSlave('127.0.0.1', port);
        await controller.addSlave({ host:'127.0.0.1', port, nodeId:randomUUID() });
        expect(await controller.waitUntilConnected('127.0.0.1', port, 2000)).toBe(true);
        now += 5000;
        free = 100;
        await runtime.tick();
        expect(disk).toHaveBeenCalledTimes(1);
        expect(ledger.get(ref).sources[0]?.error).toMatch(/identity changed/);
        expect((await rpc.history(ref))).toHaveLength(1);
        await controller.removeSlave('127.0.0.1', port);
        await controller.addSlave({ host:'127.0.0.1', port, nodeId });
        expect(await controller.waitUntilConnected('127.0.0.1', port, 2000)).toBe(true);
        now += 5000;
        await runtime.tick();
        expect((await rpc.history(ref))[0]?.deliveries).toMatchObject([{ title:'Disk space recovered' }]);
        pin = 'replacement-enrollment';
        now += 5000;
        await runtime.tick();
        expect(disk).toHaveBeenCalledTimes(2);
        expect(ledger.get(ref).sources[0]?.error).toMatch(/changed|replaced/);
        expect(readLocal).not.toHaveBeenCalled();
        await rpc.deactivate({ ...change, activation:active.id });
        await expect(rpc.activate(change)).rejects.toThrow(/changed/);
        await runtime.dispose();
        db.close();
        const reopened = new Database(file);
        try {
          const old = new FlowLedger(reopened).history(ref).find(x => x.deliveries[0]?.id === firstDelivery);
          expect(old?.event.data).toMatchObject({ nodeId, nodeIdentity:'first-enrollment', freeBytes:20 });
        } finally { reopened.close(); }
      });
    } finally {
      await runtime.dispose();
      if (db.open) db.close();
      await rm(folder,{ recursive:true, force:true });
    }
  });

  it('allows public liveness but refuses unsolicited status, data, and mutations from an open daemon', async () => {
    await join();
    await expect(controller.invokeOnSlave('127.0.0.1', port, 'OmnitronDaemon', 'ping', [])).resolves.toBeTruthy();
    for (const [service, method, args] of [
      ['OmnitronSync', 'getSyncStatus', []], ['OmnitronSync', 'drainBuffer', []],
      ['OmnitronSync', 'ackDrained', [{ ids: ['sample'] }]], ['OmnitronDaemon', 'ping', ['unexpected']],
    ] as const) {
      await expect(controller.invokeOnSlave('127.0.0.1', port, service, method, [...args])).rejects.toThrow(/verified service credential/);
    }
    await expect(controller.invokeOnSlave('127.0.0.1', port, 'OmnitronDaemon', 'ping', [], { requireCredential: true }))
      .rejects.toThrow(/verified service credential/);
    expect(liveness.pings).toBeGreaterThan(1);
    expect(sync.reads).toBe(0);
    expect(sync.drains).toBe(0);
    expect(sync.released).toEqual([]);
    expect(receiveBatch).not.toHaveBeenCalled();
    expect(controller.getConnections()[0]).toMatchObject({ status: 'connected', authenticated: false, syncStatus: null,
      lastCredentialError: expect.stringContaining('SSH'), lastPullError: expect.stringContaining('verified service credential') });
  });

  it('accepts a verified service credential, stores a real pull under the registered identity, and returns its receipt', async () => {
    await join(await mintServiceToken(secret, 'controller'));
    await vi.waitFor(() => expect(sync.released).toEqual(['sample']));
    expect(receiveBatch).toHaveBeenCalledExactlyOnceWith({ nodeId: 'registered-node', entries: [{ id: 'sample' }] });
    expect(controller.getConnections()[0]).toMatchObject({ authenticated: true, credentialExpiresAt: expect.any(Number),
      syncStatus: { pendingItems: 777 }, lastPullError: null, lastCredentialError: null });
  });
});
