/**
 * The fleet that formed no mesh.
 *
 * `SlaveConnector` maintains master→node connections and drains each node's
 * replication buffer on connect and on every heartbeat. It was complete and
 * correct. The only thing that ever called `addSlave` was a remote or
 * cluster STACK starting — so the master connected to the nodes something
 * had been deployed onto, and to no others.
 *
 * A node added through the console, provisioned by omnitron, running its own
 * daemon and collecting its own metrics and logs, was never dialled. It
 * buffers locally when it has no master, which is correct for a node that
 * LOST one, and indistinguishable from a master that was never going to
 * call. Measured on the first such node: 47,407 entries in the write-ahead
 * buffer, none delivered, over eleven hours, reporting healthy throughout.
 *
 * Two more things had to be true before a connection could carry anything,
 * and each was hidden behind the other. Measured against that node:
 *
 *     direct tcp://…:9700                     → connection timeout (ufw: 22/tcp only)
 *     through an ssh tunnel, OmnitronDaemon.ping → answers
 *     OmnitronSync.drainBuffer, no token       → Authentication required
 *     OmnitronSync.drainBuffer, service_role   → entries
 */

import { describe, it, expect, vi } from 'vitest';
import net from 'node:net';

import { startMesh, meshMembers, type MeshNode } from '../../src/cluster/mesh.js';
import { probeTcp, mintServiceToken, createMeshDialer, directLink, stableNodeUuid, uuidV5, READ_DAEMON_SECRET } from '../../src/cluster/mesh-link.js';

const logger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => logger,
};

const node = (over: Partial<MeshNode> = {}): MeshNode => ({
  id: 'n1', name: 'edge-7', host: '10.0.0.7', daemonPort: 9700, isLocal: false, ...over,
});

/** A registry that is an EventEmitter with a list, which is all the mesh reads. */
function registry(initial: MeshNode[]) {
  const listeners = new Map<string, Array<(...a: any[]) => void>>();
  return {
    nodes: [...initial],
    listNodes() { return this.nodes; },
    on(event: string, listener: (...a: any[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    off(event: string, listener: (...a: any[]) => void) {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
      return this;
    },
    emit(event: string, ...args: any[]) {
      for (const l of listeners.get(event) ?? []) l(...args);
    },
  };
}

function connector() {
  const added: Array<{ host: string; port: number; label?: string }> = [];
  const removed: Array<{ host: string; port: number }> = [];
  return {
    added,
    removed,
    addSlave: vi.fn(async (c: any) => { added.push({ host: c.host, port: c.port, label: c.label }); }),
    removeSlave: vi.fn(async (host: string, port: number) => { removed.push({ host, port }); }),
  } as never as import('../../src/cluster/slave-connector.js').SlaveConnector & {
    added: Array<{ host: string; port: number; label?: string }>;
    removed: Array<{ host: string; port: number }>;
  };
}

describe('the mesh follows the node registry', () => {
  it('joins every registered node at startup', () => {
    const reg = registry([node(), node({ id: 'n2', name: 'edge-8', host: '10.0.0.8' })]);
    const c = connector();

    startMesh({ registry: reg as never, connector: c, logger });

    // Not "the nodes a stack was deployed onto" — every node the operator
    // put in the registry.
    expect(c.added).toEqual([
      { host: '10.0.0.7', port: 9700, label: 'edge-7' },
      { host: '10.0.0.8', port: 9700, label: 'edge-8' },
    ]);
  });

  it('never dials the master itself', () => {
    const reg = registry([node({ id: 'local', name: 'this machine', isLocal: true }), node({ id: 'n2', host: '10.0.0.8' })]);
    const c = connector();

    startMesh({ registry: reg as never, connector: c, logger });

    // The master pulling its own buffer ingests every entry under its own
    // node id — one machine's readings arriving as a second node.
    expect(c.added.map((a) => a.host)).toEqual(['10.0.0.8']);
    expect(meshMembers(reg.nodes).map((n) => n.id)).toEqual(['n2']);
  });

  it('joins a node the moment it is registered', () => {
    const reg = registry([]);
    const c = connector();
    startMesh({ registry: reg as never, connector: c, logger });

    reg.emit('node:added', node({ id: 'n9', host: '10.0.0.9' }));

    expect(c.added.map((a) => a.host)).toEqual(['10.0.0.9']);
  });

  it('drops a node that is removed, at the address it was joined at', () => {
    const reg = registry([node()]);
    const c = connector();
    startMesh({ registry: reg as never, connector: c, logger });

    // `node:removed` carries the id and fires AFTER the row is deleted, so
    // asking the registry where that node lived answers nothing. The address
    // has to have been remembered.
    reg.nodes = [];
    reg.emit('node:removed', 'n1');

    expect(c.removed).toEqual([{ host: '10.0.0.7', port: 9700 }]);
  });

  it('keeps the connection when another registry row still points at it', () => {
    // The registry holds two rows for one machine here — that is how a
    // single node once drew two health checks an hour on the same socket.
    // The connector is keyed on host:port, so removing one row must not
    // disconnect the other's connection: nothing would re-add it, and the
    // survivor would sit in the map, joined, with nothing behind it.
    const reg = registry([node({ id: 'a' }), node({ id: 'b' })]);
    const c = connector();
    startMesh({ registry: reg as never, connector: c, logger });

    reg.emit('node:removed', 'b');
    expect(c.removed).toEqual([]);

    // ...and the last one out does disconnect it.
    reg.emit('node:removed', 'a');
    expect(c.removed).toEqual([{ host: '10.0.0.7', port: 9700 }]);
  });

  it('follows an edited address', () => {
    const reg = registry([node()]);
    const c = connector();
    startMesh({ registry: reg as never, connector: c, logger });

    reg.emit('node:updated', node({ host: '10.0.0.77', daemonPort: 9800 }));

    // Editing the host in the console is how an operator corrects a typo.
    // Keeping the old connection makes the correction appear to do nothing.
    expect(c.removed).toEqual([{ host: '10.0.0.7', port: 9700 }]);
    expect(c.added.at(-1)).toEqual({ host: '10.0.0.77', port: 9800, label: 'edge-7' });
  });

  it('does not churn a connection when something else about a node changes', () => {
    const reg = registry([node()]);
    const c = connector();
    startMesh({ registry: reg as never, connector: c, logger });

    reg.emit('node:updated', node({ name: 'renamed' }));

    expect(c.removed).toEqual([]);
    expect(c.added).toHaveLength(1);
  });

  it('stops following when stopped', () => {
    const reg = registry([]);
    const c = connector();
    const mesh = startMesh({ registry: reg as never, connector: c, logger });

    mesh.stop();
    reg.emit('node:added', node({ id: 'late' }));

    expect(c.added).toEqual([]);
  });
});

describe('reaching a node', () => {
  it('sees an open port as open', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    expect(await probeTcp('127.0.0.1', port, 1_000)).toBe(true);

    server.close();
  });

  it('sees a closed port as closed, inside the budget', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));

    const started = Date.now();
    expect(await probeTcp('127.0.0.1', port, 1_000)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('dials directly when the daemon port answers', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    const execution = { ssh: vi.fn(async () => ({ stdout: 'a-secret', stderr: '', exitCode: 0, duration: 1 })), tunnel: vi.fn() } as never;
    const dial = createMeshDialer({
      logger, execution, subject: 'mesh:test',
      sshTargetFor: async () => ({ host: '127.0.0.1', username: 'root', password: 'x' }),
    });

    const link = await dial({ host: '127.0.0.1', port });

    expect(link.via).toBe('direct');
    expect(link.url).toBe(`tcp://127.0.0.1:${port}`);
    expect(link.token).toBeTruthy();
    expect((execution as any).tunnel).not.toHaveBeenCalled();

    server.close();
  });

  it('goes through SSH when it does not', async () => {
    const close = vi.fn(async () => {});
    const execution = {
      ssh: vi.fn(async () => ({ stdout: 'a-secret', stderr: '', exitCode: 0, duration: 1 })),
      tunnel: vi.fn(async () => ({ host: '127.0.0.1', port: 55_555, close })),
    } as never;
    const dial = createMeshDialer({
      logger, execution, subject: 'mesh:test', directProbeTimeoutMs: 200,
      sshTargetFor: async () => ({ host: '203.0.113.9', username: 'root', password: 'x' }),
    });

    // 203.0.113.0/24 is reserved for documentation and routes nowhere.
    const link = await dial({ host: '203.0.113.9', port: 9700 });

    expect(link.via).toBe('ssh-tunnel');
    expect(link.url).toBe('tcp://127.0.0.1:55555');
    expect(link.close).toBe(close);
    // The tunnel's far end is the node's OWN loopback, or it would forward
    // back to the master.
    expect((execution as any).tunnel).toHaveBeenCalledWith(expect.objectContaining({ host: '203.0.113.9' }), 9700);
  });

  it('says which door was tried when there is no way in', async () => {
    const execution = { ssh: vi.fn(), tunnel: vi.fn() } as never;
    const dial = createMeshDialer({
      logger, execution, subject: 'mesh:test', directProbeTimeoutMs: 200,
      sshTargetFor: async () => null,
    });

    // "Connection refused" against a node that is plainly up sends an
    // operator to the daemon. The answer is the firewall, or a credential
    // this master does not hold.
    await expect(dial({ host: '203.0.113.9', port: 9700 })).rejects.toThrow(/daemon port.*no SSH credentials/i);
  });

  it('reads a node secret once, however many times it is dialled', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    const ssh = vi.fn(async () => ({ stdout: 'a-secret', stderr: '', exitCode: 0, duration: 1 }));
    const dial = createMeshDialer({
      logger, execution: { ssh, tunnel: vi.fn() } as never, subject: 'mesh:test',
      sshTargetFor: async () => ({ host: '127.0.0.1', username: 'root', password: 'x' }),
    });

    await dial({ host: '127.0.0.1', port });
    await dial({ host: '127.0.0.1', port });

    // Every reconnect would otherwise open an SSH session to read a file
    // that does not change.
    expect(ssh).toHaveBeenCalledTimes(1);
    expect(ssh.mock.calls[0]![1]).toBe(READ_DAEMON_SECRET);

    server.close();
  });

  it('reads a node secret again after the node refuses it', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    const ssh = vi.fn(async () => ({ stdout: 'a-secret', stderr: '', exitCode: 0, duration: 1 }));
    const dial = createMeshDialer({
      logger, execution: { ssh, tunnel: vi.fn() } as never, subject: 'mesh:test',
      sshTargetFor: async () => ({ host: '127.0.0.1', username: 'root', password: 'x' }),
    });

    const first = await dial({ host: '127.0.0.1', port });
    expect(ssh).toHaveBeenCalledTimes(1);

    // A daemon's secret does not change — until the node is reinstalled,
    // which writes a new one. Without this the master presents the old one
    // on every reconnect for as long as it runs, and the node refuses every
    // time; a rejected credential and an unreachable node fail at the same
    // place, so the retry loop cannot tell them apart.
    first.onRejected?.();
    await dial({ host: '127.0.0.1', port });

    expect(ssh).toHaveBeenCalledTimes(2);

    server.close();
  });

  it('connects unauthenticated rather than not at all, and says so', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    const warned: string[] = [];
    const noisy: any = { ...logger, warn: (_o: unknown, m?: string) => warned.push(String(m)), child: () => noisy };
    const dial = createMeshDialer({
      logger: noisy,
      execution: { ssh: vi.fn(async () => ({ stdout: '', stderr: 'no such file', exitCode: 1, duration: 1 })), tunnel: vi.fn() } as never,
      subject: 'mesh:test',
      sshTargetFor: async () => ({ host: '127.0.0.1', username: 'root', password: 'x' }),
    });

    const link = await dial({ host: '127.0.0.1', port });

    // The connection is still worth having for `ping` and the fleet view.
    // What it cannot do is replicate, and that has to be said — a node that
    // is refusing looks exactly like a node with nothing to say.
    expect(link.token).toBeUndefined();
    expect(warned.join(' ')).toMatch(/cannot replicate/i);

    server.close();
  });

  it('needs nothing arranged for a plain direct link', async () => {
    expect(await directLink({ host: '10.0.0.7', port: 9700 })).toEqual({
      url: 'tcp://10.0.0.7:9700',
      via: 'direct',
    });
  });
});

describe('a refusal is not a broken connection', () => {
  const link = (onRejected: (reason?: string) => void) => ({
    url: 'tcp://127.0.0.1:1', via: 'ssh-tunnel' as const, token: 'a-token', onRejected,
  });

  it('drops the cached secret when the node says no, and says why', async () => {
    const { authenticatePeer } = await import('../../src/cluster/slave-connector.js');
    const dropped: Array<string | undefined> = [];

    // netron's `authenticate` core-task catches everything a credential can
    // do wrong and RESOLVES with `{ success: false, error }`.
    const refusing = { runTask: async () => ({ success: false, error: 'signature mismatch' }) };

    await expect(authenticatePeer(refusing, link((r) => dropped.push(r)) as never)).rejects.toThrow(/signature mismatch/);
    expect(dropped).toEqual(['signature mismatch']);
  });

  it('keeps the secret when the CONNECTION broke', async () => {
    const { authenticatePeer } = await import('../../src/cluster/slave-connector.js');
    const dropped: string[] = [];

    // It throws only when the call did not complete. Measured on a live
    // master while it was starting six applications: two "Node refused the
    // master credential" lines, and the same credential authenticated first
    // try a minute later — `success: true, roles: [service_role]`. The node
    // had refused nothing; the tunnel had not survived a busy moment, and an
    // operator reading that line goes looking at authentication, which is
    // the one thing that was working.
    const broken = { runTask: async () => { throw new Error('RPC request timed out after 5000ms'); } };

    await expect(authenticatePeer(broken, link((r) => dropped.push(r!)) as never)).rejects.toThrow(/timed out/);
    expect(dropped).toEqual([]);
  });

  it('accepts a node that accepts the credential', async () => {
    const { authenticatePeer } = await import('../../src/cluster/slave-connector.js');
    const ok = { runTask: async () => ({ success: true }) };

    await expect(authenticatePeer(ok, link(() => {}) as never)).resolves.toBeUndefined();
  });

  it('refuses a transport with no authenticate task rather than connecting unauthenticated', async () => {
    const { authenticatePeer } = await import('../../src/cluster/slave-connector.js');

    await expect(authenticatePeer({}, link(() => {}) as never)).rejects.toThrow(/no authenticate task/);
  });

  it('carries the node s own words into the log line', async () => {
    const { createMeshDialer } = await import('../../src/cluster/mesh-link.js');
    const net = await import('node:net');
    const warned: Array<Record<string, unknown>> = [];
    const noisy: any = { ...logger, warn: (o: Record<string, unknown>) => warned.push(o), child: () => noisy };

    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as import('node:net').AddressInfo).port;

    const dial = createMeshDialer({
      logger: noisy,
      execution: { ssh: vi.fn(async () => ({ stdout: 'a-secret', stderr: '', exitCode: 0, duration: 1 })), tunnel: vi.fn() } as never,
      subject: 'mesh:test',
      sshTargetFor: async () => ({ host: '127.0.0.1', username: 'root', password: 'x' }),
    });

    const dialled = await dial({ host: '127.0.0.1', port });
    dialled.onRejected?.('signature mismatch');

    // Without the reason the line names a conclusion and withholds the
    // evidence for it, and the next question — why — has nowhere to go.
    expect(warned[0]?.['reason']).toBe('signature mismatch');

    server.close();
  });
});

describe('the credential a node accepts', () => {
  it('is a service_role token issued by omnitron, and expires', async () => {
    const { jwtVerify } = await import('jose');
    const secret = new TextEncoder().encode('a'.repeat(64));

    const token = await mintServiceToken('a'.repeat(64), 'mesh:master-1', '5m');
    const { payload } = await jwtVerify(token, secret, { issuer: 'omnitron' });

    expect(payload.role).toBe('service_role');
    expect(payload.sub).toBe('mesh:master-1');
    // No `sid`: a master validates one against its session table and a slave
    // has no session store to validate it against, so a session id that
    // exists nowhere would work on one and be refused by the other.
    expect(payload['sid']).toBeUndefined();
    expect(payload.exp! - payload.iat!).toBe(300);
  });

  it('is refused by a node with a different secret', async () => {
    const { jwtVerify } = await import('jose');
    const token = await mintServiceToken('a'.repeat(64), 'mesh:master-1');

    await expect(
      jwtVerify(token, new TextEncoder().encode('b'.repeat(64)), { issuer: 'omnitron' }),
    ).rejects.toThrow();
  });
});

describe('the id a replicated row is stored under', () => {
  it('is a real uuid v5, not something shaped like one', () => {
    // The published RFC 4122 vector, computed by the same code path: v5 of
    // "www.example.com" in the DNS namespace.
    const dns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(uuidV5(dns, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('is stable for an address, and different between addresses', () => {
    // `logs.nodeId` is a `uuid` column and a slave calls itself
    // `${hostname}-${port}` — every ingest failed with `invalid input syntax
    // for type uuid: "daos-cpp-9700"` until the master labelled the rows
    // with an id of its own.
    expect(stableNodeUuid('10.0.0.7', 9700)).toBe(stableNodeUuid('10.0.0.7', 9700));
    expect(stableNodeUuid('10.0.0.7', 9700)).not.toBe(stableNodeUuid('10.0.0.7', 9701));
    expect(stableNodeUuid('10.0.0.7', 9700)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('what the console is told about the mesh', () => {
  async function rpc(nodes: Array<{ id: string; host: string; daemonPort: number }>, connections: unknown[]) {
    const { NodeManagerRpcService } = await import('../../src/services/node-manager.rpc-service.js');
    const service = new NodeManagerRpcService({ listNodes: () => nodes } as never);
    service.setSlaveConnector({ getConnections: () => connections } as never);
    return service.getMeshStatus();
  }

  const registered = [{ id: 'n1', host: '10.0.0.7', daemonPort: 9700 }];

  it('reports a registered node the master never dialled', async () => {
    const [row] = await rpc(registered, []);

    // The state every node was in: in the registry, shown healthy, connected
    // to by nothing.
    expect(row).toMatchObject({ nodeId: 'n1', inMesh: false, status: 'disconnected', authenticated: false, via: null });
  });

  it('reports how a joined node is reached', async () => {
    const [row] = await rpc(registered, [
      { host: '10.0.0.7', port: 9700, status: 'connected', via: 'ssh-tunnel', authenticated: true, lastHeartbeat: 1700, lastError: null },
    ]);

    expect(row).toMatchObject({ inMesh: true, status: 'connected', via: 'ssh-tunnel', authenticated: true, lastHeartbeat: 1700 });
  });

  it('matches a connection to a node on the daemon port, not the host alone', async () => {
    // Two daemons on one machine are two nodes. Keyed on the host alone,
    // each would be shown the other's membership.
    const rows = await rpc(
      [{ id: 'a', host: '10.0.0.7', daemonPort: 9700 }, { id: 'b', host: '10.0.0.7', daemonPort: 9800 }],
      [{ host: '10.0.0.7', port: 9800, status: 'connected', via: 'direct', authenticated: true, lastHeartbeat: 1, lastError: null }],
    );

    expect(rows.find((r) => r.nodeId === 'a')!.inMesh).toBe(false);
    expect(rows.find((r) => r.nodeId === 'b')!.inMesh).toBe(true);
  });

  it('answers without a connector at all', async () => {
    const { NodeManagerRpcService } = await import('../../src/services/node-manager.rpc-service.js');
    const service = new NodeManagerRpcService({ listNodes: () => registered } as never);

    // A daemon whose mesh failed to start still serves this page, and the
    // honest answer there is "not joined" — which is exactly true.
    await expect(service.getMeshStatus()).resolves.toMatchObject([{ nodeId: 'n1', inMesh: false }]);
  });
});

describe('the fleet table is told which node answered', () => {
  async function connectorWith(fleet: { heartbeat: (id: string) => Promise<void> } | undefined) {
    const { SlaveConnector } = await import('../../src/cluster/slave-connector.js');
    return new SlaveConnector(logger, fleet as never, null);
  }

  const beat = (c: unknown, config: Record<string, unknown>) =>
    (c as unknown as { recordFleetHeartbeat(conn: unknown): Promise<void> })
      .recordFleetHeartbeat({ config });

  it('passes the registry id, not the connector map key', async () => {
    const seen: string[] = [];
    const c = await connectorWith({ heartbeat: async (id) => { seen.push(id); } });

    await beat(c, { host: '10.0.0.7', port: 9700, nodeId: '16f3dd5a-2727-49e5-90a2-d762b57073f6' });

    // `nodes.id` is a `uuid`. Both call sites passed `${host}:${port}`, which
    // Postgres answers with `invalid input syntax for type uuid` — into a
    // bare catch that discarded it, so every heartbeat since this class was
    // written was a write that could not succeed and could not report it.
    expect(seen).toEqual(['16f3dd5a-2727-49e5-90a2-d762b57073f6']);
    expect(seen[0]).not.toContain(':');
  });

  it('does not write at all for a node the fleet cannot know', async () => {
    let called = 0;
    const c = await connectorWith({ heartbeat: async () => { called += 1; } });

    // A node that reached the connector through a stack has no fleet row, and
    // an UPDATE matching nothing is not an error — it would be silent for a
    // second reason.
    await beat(c, { host: '10.0.0.7', port: 9700 });

    expect(called).toBe(0);
  });

  it('survives a fleet database that refuses', async () => {
    const c = await connectorWith({ heartbeat: async () => { throw new Error('database is down'); } });

    await expect(beat(c, { host: '10.0.0.7', port: 9700, nodeId: 'n1' })).resolves.toBeUndefined();
  });

  it('does nothing when there is no fleet service', async () => {
    const c = await connectorWith(undefined);
    await expect(beat(c, { host: '10.0.0.7', port: 9700, nodeId: 'n1' })).resolves.toBeUndefined();
  });
});

describe('what a starting slave says about replication', () => {
  it('does not claim it dials the master', async () => {
    const { describeSlaveSync } = await import('../../src/commands/up.js');

    const said = describeSlaveSync({ host: '192.0.2.10', port: 9700 });

    // `Sync: slave → master at …` pointed the arrow the wrong way. The master
    // opens the connection and pulls; a slave dials nothing.
    expect(said).not.toMatch(/slave\s*→\s*master/);
    expect(said).toMatch(/192\.0\.2\.10:9700/);
    expect(said).toMatch(/pulls/);
  });

  it('says what it is doing when no master address was configured', async () => {
    const { describeSlaveSync } = await import('../../src/commands/up.js');

    expect(describeSlaveSync(undefined)).toMatch(/buffering locally/);
    expect(describeSlaveSync(undefined)).not.toMatch(/undefined/);
  });
});

describe('a reconnect gives back what the last attempt held', () => {
  /** A dialer that hands out a distinct, closeable link each time. */
  function countingDialer() {
    const opened: number[] = [];
    const closed: number[] = [];
    let n = 0;
    return {
      opened,
      closed,
      dial: async () => {
        const id = ++n;
        opened.push(id);
        return {
          url: `tcp://127.0.0.1:${50_000 + id}`,
          via: 'ssh-tunnel' as const,
          close: async () => { closed.push(id); },
        };
      },
    };
  }

  async function connector(dial: () => Promise<any>) {
    const { SlaveConnector } = await import('../../src/cluster/slave-connector.js');
    return new SlaveConnector(logger, undefined, null, { dial });
  }

  it('closes the previous link before dialling again', async () => {
    const d = countingDialer();
    const c = await connector(d.dial);

    // `connectSlave` fails after the dial (nothing is listening on the URL),
    // which is the path a node on a poor link takes over and over.
    await (c as unknown as { connectSlave(key: string, conn: unknown): Promise<void> })
      .connectSlave('h:9700', { config: { host: 'h', port: 9700 }, status: 'disconnected', link: null, reconnectAttempt: 0, reconnectTimer: null });

    expect(d.opened).toEqual([1]);
    // Every dial that does not end in a live connection must give its link
    // back, or the tunnel outlives the attempt that made it.
    expect(d.closed).toEqual([1]);

    await c.dispose();
  });

  it('never holds more than one link for a node across attempts', async () => {
    const d = countingDialer();
    const c = await connector(d.dial);
    const conn: any = { config: { host: 'h', port: 9700 }, status: 'disconnected', link: null, reconnectAttempt: 0, reconnectTimer: null };
    const connect = (c as unknown as { connectSlave(key: string, conn: unknown): Promise<void> }).connectSlave.bind(c);

    for (let i = 0; i < 3; i += 1) {
      conn.status = 'disconnected';
      await connect('h:9700', conn);
    }

    // Three attempts, three links, three closes. A node that flaps is
    // exactly the node that reconnects, so a leak here grows fastest where
    // it hurts most — and ends at sshd's session limit, with the master
    // locked out of the machine it deploys to.
    expect(d.opened).toHaveLength(3);
    expect(d.closed).toHaveLength(3);
    expect(conn.link).toBeNull();

    await c.dispose();
  });
});

describe('waiting for a node to join', () => {
  async function connector() {
    const { SlaveConnector } = await import('../../src/cluster/slave-connector.js');
    return new SlaveConnector(logger, undefined, null, { dial: async () => { throw new Error('nothing listens'); } });
  }

  it('answers true once the connection is established', async () => {
    const c = await connector();
    const conns = (c as unknown as { connections: Map<string, { status: string }> }).connections;
    conns.set('h:9700', { status: 'connecting' } as never);

    const waiting = c.waitUntilConnected('h', 9700, 5_000);
    setTimeout(() => conns.set('h:9700', { status: 'connected' } as never), 300);

    await expect(waiting).resolves.toBe(true);
    await c.dispose();
  });

  it('answers immediately for a node that is already connected', async () => {
    const c = await connector();
    (c as unknown as { connections: Map<string, { status: string }> }).connections.set('h:9700', { status: 'connected' } as never);

    // Polling rather than an event, because the connection may already be
    // established when this is called — a subscriber would wait for a
    // transition that has already happened, which is the same race wearing a
    // different hat.
    const started = Date.now();
    await expect(c.waitUntilConnected('h', 9700, 5_000)).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    await c.dispose();
  });

  it('gives up rather than hanging, for a node that never joins', async () => {
    const c = await connector();

    // The caller deploys applications after this. Waiting forever would make
    // an unreachable node stop a deployment to every other node behind it.
    await expect(c.waitUntilConnected('h', 9700, 600)).resolves.toBe(false);
    await c.dispose();
  });
});
