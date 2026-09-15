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
