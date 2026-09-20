/**
 * What a write to the node registry has to reach.
 *
 * Three of these are the same shape of defect: an operation the console
 * reports as done that only happened in memory, or only to half of what it
 * names. A removal that leaves the row. A password cleared by an edit that
 * never mentioned the password. A setting stored in a field nothing reads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Only the CLASS is replaced — see the note in
// node-manager-worker-integration.test.ts. The module's pure functions are
// called on every write.
vi.mock('../../src/services/remote-ops.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/remote-ops.service.js')>();
  class MockRemoteOpsService {
    ping = vi.fn().mockResolvedValue({ reachable: true, latencyMs: 10 });
    checkSsh = vi.fn().mockResolvedValue({ connected: true, latencyMs: 50 });
    checkRemoteOmnitron = vi.fn().mockResolvedValue({ connected: false });
    dispose = vi.fn();
    constructor(_logger: any) {}
  }
  return { ...actual, RemoteOpsService: MockRemoteOpsService };
});

const { NodeManagerService } = await import('../../src/services/node-manager.service.js');

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
};

/** A DaemonStateStore stand-in that actually remembers rows and KV. */
function makeStore() {
  const rows = new Map<string, any>();
  const kv = new Map<string, unknown>();
  return {
    rows,
    kv,
    selectNodesSync: () => Array.from(rows.values()),
    upsertNodeSync: (row: any) => rows.set(row.id, { ...row, metadata: JSON.stringify(row.metadata) }),
    deleteNodeSync: vi.fn((id: string) => { rows.delete(id); }),
    kvGetSync: (key: string) => kv.get(key) ?? null,
    kvSetSync: (key: string, value: unknown) => { kv.set(key, value); },
  } as any;
}

/** A SecretsService stand-in. */
function makeSecrets() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (k: string) => values.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { values.set(k, v); }),
    delete: vi.fn(async (k: string) => { values.delete(k); }),
  } as any;
}

describe('removing a node', () => {
  it('deletes the row, not just the map entry', async () => {
    const store = makeStore();
    const service = new NodeManagerService(silentLogger, store);
    const node = await service.addNode({ name: 'n1', host: '10.0.0.1' });

    expect(store.rows.has(node.id)).toBe(true);
    await service.removeNode(node.id);

    // `save()` rewrites the nodes still in memory, which is how a
    // file-backed registry expressed a deletion. An UPSERT-per-row store does
    // not: the row stayed, `omnitron node list` reported the node gone, and
    // the next daemon start read it straight back in.
    expect(store.deleteNodeSync).toHaveBeenCalledWith(node.id);
    expect(store.rows.has(node.id)).toBe(false);

    const reloaded = new NodeManagerService(silentLogger, store);
    expect(reloaded.listNodes().map((n) => n.id)).not.toContain(node.id);
  });

  it('removes the node\'s stored secrets, and waits for it', async () => {
    const store = makeStore();
    const secrets = makeSecrets();
    const service = new NodeManagerService(silentLogger, store, secrets);
    const node = await service.addNode({
      name: 'n1', host: '10.0.0.1', sshAuthMethod: 'password', sshPassword: 'hunter2',
    });
    expect(secrets.values.get(`node:${node.id}:password`)).toBe('hunter2');

    await service.removeNode(node.id);

    // Fired and forgotten, a failure here leaves an SSH password in the vault
    // under the id of a node nothing can name any more.
    expect(secrets.values.has(`node:${node.id}:password`)).toBe(false);
  });

  it('refuses to remove the local node', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    await expect(service.removeNode('local')).rejects.toThrow(/Cannot remove local node/);
  });
});

describe('editing a node', () => {
  let store: any;
  let secrets: any;
  let service: InstanceType<typeof NodeManagerService>;

  beforeEach(() => {
    store = makeStore();
    secrets = makeSecrets();
    service = new NodeManagerService(silentLogger, store, secrets);
  });

  it('an edit that does not mention the password keeps it', async () => {
    const node = await service.addNode({
      name: 'n1', host: '10.0.0.1', sshAuthMethod: 'password', sshPassword: 'hunter2',
    });

    const updated = await service.updateNode(node.id, { name: 'renamed' });

    expect(updated.hasPassword).toBe(true);
    expect(secrets.values.get(`node:${node.id}:password`)).toBe('hunter2');
  });

  it('an explicit empty password clears it', async () => {
    const node = await service.addNode({
      name: 'n1', host: '10.0.0.1', sshAuthMethod: 'password', sshPassword: 'hunter2',
    });

    const updated = await service.updateNode(node.id, { sshPassword: '' });

    // The console must never send this by accident — the form initialises the
    // field to '' because it cannot show a stored secret, and it used to send
    // that on every save. The daemon's reading of '' is still "clear it";
    // what changed is that only a deliberate clear produces one.
    expect(updated.hasPassword).toBe(false);
    expect(secrets.values.has(`node:${node.id}:password`)).toBe(false);
  });

  it('switching to key auth drops the password it can no longer mean', async () => {
    const node = await service.addNode({
      name: 'n1', host: '10.0.0.1', sshAuthMethod: 'password', sshPassword: 'hunter2',
    });

    const updated = await service.updateNode(node.id, { sshAuthMethod: 'key', sshPrivateKey: '/tmp/id_ed25519' });

    // Otherwise the console shows "SSH Key" while a usable password sits in
    // the vault and the daemon may still log in with it.
    expect(updated.hasPassword).toBe(false);
    expect(secrets.values.has(`node:${node.id}:password`)).toBe(false);
  });

  it('switching to password auth drops the key and its passphrase', async () => {
    const node = await service.addNode({
      name: 'n1', host: '10.0.0.1', sshPrivateKey: '/tmp/id_ed25519', sshPassphrase: 'secret',
    });

    const updated = await service.updateNode(node.id, { sshAuthMethod: 'password', sshPassword: 'pw' });

    expect(updated.sshPrivateKey).toBeUndefined();
    expect(updated.hasPassphrase).toBe(false);
    expect(secrets.values.has(`node:${node.id}:passphrase`)).toBe(false);
  });

  it('validates the host on the way in, not on the way out', async () => {
    const node = await service.addNode({ name: 'n1', host: '10.0.0.1' });
    await expect(service.updateNode(node.id, { host: "x'; id; '" })).rejects.toThrow(/Invalid host/);
    await expect(service.addNode({ name: 'n2', host: 'good.example', sshPort: 0 })).rejects.toThrow(/SSH port/);
    await expect(service.addNode({ name: 'n3', host: 'good.example', daemonPort: 99_999 })).rejects.toThrow(/daemon port/);
  });
});

describe('check configuration', () => {
  it('is persisted, so a restart does not lose it', async () => {
    const store = makeStore();
    const service = new NodeManagerService(silentLogger, store);

    service.setCheckConfig({ pingEnabled: false, sshTimeout: 20_000 });

    // It lived in a field and nowhere else: every daemon restart silently
    // reverted the operator's decision.
    const restarted = new NodeManagerService(silentLogger, store);
    expect(restarted.getCheckConfig()).toMatchObject({ pingEnabled: false, sshTimeout: 20_000 });
  });

  it('announces a change so the worker can be told', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    const heard: any[] = [];
    service.on('checkConfig:changed', (cfg) => heard.push(cfg));

    service.setCheckConfig({ pingTimeout: 7_000 });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ pingTimeout: 7_000 });

    // A write that changes nothing is not a change — re-pushing the same
    // config to the worker restarts its check loop for no reason.
    service.setCheckConfig({ pingTimeout: 7_000 });
    expect(heard).toHaveLength(1);
  });

  it('clamps what it stores', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    service.setCheckConfig({ pingTimeout: 0, concurrency: 10_000 });
    expect(service.getCheckConfig().pingTimeout).toBe(250);
    expect(service.getCheckConfig().concurrency).toBe(100);
  });
});

// =============================================================================
// A stored secret must not be a returned one
// =============================================================================

describe('a node row that holds a plaintext secret', () => {
  /**
   * Found on a live daemon, not imagined: the `metadata` JSON of a registered
   * node contained
   *
   *   "sshPassphrase": "<the operator's actual passphrase>",
   *   "hasPassphrase": true
   *
   * An older `updateNode` spread its entire input into the node. The
   * destructure that stops that was added later and fixed only new writes;
   * rows already written kept the value. `listNodes` then spread the parsed
   * row onto the wire — so the passphrase reached every VIEWER-role caller of
   * the console and every `omnitron node list`.
   */
  function storeHoldingLeak() {
    const store = makeStore();
    store.rows.set('leaky', {
      id: 'leaky', name: 'leaky', host: '10.0.0.9', port: 9700, role: 'slave',
      status: 'unknown', last_heartbeat: null,
      metadata: JSON.stringify({
        id: 'leaky', name: 'leaky', host: '10.0.0.9', sshPort: 22, sshUser: 'root',
        sshAuthMethod: 'key', sshPrivateKey: '/home/op/.ssh/id_ed25519',
        runtime: 'node', daemonPort: 9700, tags: [], isLocal: false,
        createdAt: '2026-03-17T19:29:25.026Z', updatedAt: '2026-03-18T10:08:39.490Z',
        sshPassphrase: 'Mer-Ka-Bah#789!',
        hasPassphrase: true,
      }),
    });
    return store;
  }

  it('never puts it on the wire', async () => {
    const service = new NodeManagerService(silentLogger, storeHoldingLeak(), makeSecrets());

    const listed = service.listNodes().find((n) => n.id === 'leaky')!;
    const fetched = service.getNode('leaky')!;

    expect(listed).not.toHaveProperty('sshPassphrase');
    expect(fetched).not.toHaveProperty('sshPassphrase');
    expect(JSON.stringify(service.listNodes())).not.toContain('Mer-Ka-Bah');
    // What a caller IS allowed to know is that a secret exists.
    expect(listed.hasPassphrase).toBe(true);
    // The key path is the operator's own choice, not a secret.
    expect(listed.sshPrivateKey).toBe('/home/op/.ssh/id_ed25519');
  });

  it('moves it into the secret store and rewrites the row without it', async () => {
    const store = storeHoldingLeak();
    const secrets = makeSecrets();
    const service = new NodeManagerService(silentLogger, store, secrets);

    // The migration is async, started from the constructor.
    await vi.waitFor(() => expect(secrets.values.get('node:leaky:passphrase')).toBe('Mer-Ka-Bah#789!'));
    await vi.waitFor(() => expect(store.rows.get('leaky')!.metadata).not.toContain('Mer-Ka-Bah'));

    // And the node still authenticates: the value is reachable by the path
    // the checker uses.
    const targets = await service.getNodeCheckTargets();
    expect(targets.find((t) => t.id === 'leaky')?.sshPassphrase).toBe('Mer-Ka-Bah#789!');
  });

  it('does not overwrite a vault value that is already there', async () => {
    const store = storeHoldingLeak();
    const secrets = makeSecrets();
    secrets.values.set('node:leaky:passphrase', 'the-current-one');
    const service = new NodeManagerService(silentLogger, store, secrets);

    await vi.waitFor(() => expect(store.rows.get('leaky')!.metadata).not.toContain('Mer-Ka-Bah'));
    // The row's copy may be older than the vault's; the vault is the authority.
    expect(secrets.values.get('node:leaky:passphrase')).toBe('the-current-one');
    expect(service.listNodes().find((n) => n.id === 'leaky')?.hasPassphrase).toBe(true);
  });

  it('serves the secret during the window before the migration finishes', async () => {
    const secrets = makeSecrets();
    // A vault that takes its time — the daemon runs its first check round
    // within milliseconds of construction.
    secrets.set = vi.fn(async (k: string, v: string) => {
      await new Promise((r) => setTimeout(r, 50));
      secrets.values.set(k, v);
    });
    const service = new NodeManagerService(silentLogger, storeHoldingLeak(), secrets);

    const targets = await service.getNodeCheckTargets();
    // Without the bridge this is `undefined`, and the check reports a
    // perfectly reachable node as unreachable for one round after every boot.
    expect(targets.find((t) => t.id === 'leaky')?.sshPassphrase).toBe('Mer-Ka-Bah#789!');
  });
});

describe('one row per daemon', () => {
  it('refuses a second row for an address already registered', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    await service.addNode({ name: 'daos-test', host: '10.0.0.1', daemonPort: 9700 });

    // Measured on a machine registered twice: the health monitor checked it
    // on both rows — 120 connections an hour to one socket — `fleet upgrade`
    // transferred and installed the bundle to it twice, and the mesh holds
    // one connection per ADDRESS, so exactly one of the two rows ever
    // receives the node's data while the other reads "not joined" forever.
    await expect(service.addNode({ name: 'acme-deploy-test', host: '10.0.0.1', daemonPort: 9700 }))
      .rejects.toThrow(/already registered as "daos-test"/);
  });

  it('names the row that holds the address, so the operator can find it', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    await service.addNode({ name: 'edge-7', host: '10.0.0.1' });

    await expect(service.addNode({ name: 'edge-7-again', host: '10.0.0.1' }))
      .rejects.toThrow(/edit that node/i);
  });

  it('allows a second daemon on the same machine', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    await service.addNode({ name: 'first', host: '10.0.0.1', daemonPort: 9700 });

    // Two daemons on one machine are two ports, and two rows for them are
    // two real things to manage.
    const second = await service.addNode({ name: 'second', host: '10.0.0.1', daemonPort: 9800 });
    expect(second.daemonPort).toBe(9800);
  });

  it('refuses an edit that moves a node onto another s address', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    await service.addNode({ name: 'first', host: '10.0.0.1', daemonPort: 9700 });
    const second = await service.addNode({ name: 'second', host: '10.0.0.2', daemonPort: 9700 });

    // Correcting one node's host to the address another already holds is
    // exactly how a duplicate gets made.
    await expect(service.updateNode(second.id, { host: '10.0.0.1' })).rejects.toThrow(/already registered/);
  });

  it('lets a node keep its own address through an unrelated edit', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    const node = await service.addNode({ name: 'first', host: '10.0.0.1', daemonPort: 9700 });

    const renamed = await service.updateNode(node.id, { name: 'renamed' });
    expect(renamed.name).toBe('renamed');
    expect(renamed.host).toBe('10.0.0.1');
  });

  it('can still mend a registry that was duplicated before the rule existed', async () => {
    // Two rows for one daemon, made before this guard. Measured on this
    // console: `omnitron node update <id> --ssh-auth password` — an edit
    // that moves nothing — was refused with `37.27.130.185:9700 is already
    // registered as "acme-deploy-test"`, so the row whose SSH key no longer
    // authenticates could not be given the password that would fix it.
    //
    // The guard exists to stop a duplicate being CREATED. An edit that
    // changes neither host nor port cannot create one, and refusing it
    // leaves an operator with a registry they can neither use nor mend.
    const store = makeStore();
    const service = new NodeManagerService(silentLogger, store, makeSecrets());
    const first = await service.addNode({ name: 'daos-test', host: '10.0.0.1', daemonPort: 9700 });
    // The state that predates the rule, written straight into the store.
    store.rows.set('legacy', {
      id: 'legacy',
      name: 'acme-deploy-test',
      host: '10.0.0.1',
      port: 9700,
      role: 'slave',
      status: 'unknown',
      metadata: JSON.stringify({ id: 'legacy', name: 'acme-deploy-test', host: '10.0.0.1', daemonPort: 9700, sshPort: 22, sshUser: 'root', sshAuthMethod: 'password', runtime: 'node', tags: [], isLocal: false, createdAt: '', updatedAt: '' }),
    });
    const reloaded = new NodeManagerService(silentLogger, store, makeSecrets());

    const mended = await reloaded.updateNode(first.id, { sshAuthMethod: 'password' });

    expect(mended.sshAuthMethod).toBe('password');
    expect(mended.host).toBe('10.0.0.1');
    expect(mended.daemonPort).toBe(9700);
  });

  it('still refuses to move a row onto an address held twice', async () => {
    const service = new NodeManagerService(silentLogger, makeStore());
    await service.addNode({ name: 'first', host: '10.0.0.1', daemonPort: 9700 });
    const other = await service.addNode({ name: 'other', host: '10.0.0.9', daemonPort: 9700 });

    await expect(service.updateNode(other.id, { host: '10.0.0.1' })).rejects.toThrow(/already registered/);
  });

  it('refuses before it writes a secret', async () => {
    const store = makeStore();
    const secrets = makeSecrets();
    const service = new NodeManagerService(silentLogger, store, secrets);
    await service.addNode({ name: 'first', host: '10.0.0.1' });

    await expect(
      service.addNode({ name: 'second', host: '10.0.0.1', sshAuthMethod: 'password', sshPassword: 'hunter2' }),
    ).rejects.toThrow(/already registered/);

    // A refused write must leave nothing behind — a password stored against
    // an id no row carries is a secret nothing can ever delete.
    expect([...secrets.values.values()]).not.toContain('hunter2');
  });
});
