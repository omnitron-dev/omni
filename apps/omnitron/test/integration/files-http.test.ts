import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import type { IOmnitronFileNodeService } from '../../src/shared/dto/files.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { FileNode } from '../../src/files/file-node.js';
import { FileNodeRpcService } from '../../src/files/file-node.rpc-service.js';
import { FilesRpcService } from '../../src/files/files.rpc-service.js';
import { MemoryFileStore } from '../helpers/memory-file-store.js';
import type { FileEntry, FileTransfer } from '../../src/shared/dto/files.js';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';

/** Exercise the daemon's actual transport wiring, not a more permissive test stand. */
async function fleetOptions() {
  const servers = new Map<string, { options: Record<string, unknown> }>();
  const dependencies = { logger: createNullLogger(), verify: async () => ({}), validateToken: async () => null };
  const daemon = Object.create(OmnitronDaemon.prototype) as {
    app: unknown;
    registerTransports(config: unknown): Promise<void>;
  };
  daemon.app = {
    netron: {
      registerTransport() {},
      registerTransportServer: (name: string, config: { options: Record<string, unknown> }) => servers.set(name, config),
      setTransportAuthContext() {},
      configureAuth() {},
    },
    container: { resolveAsync: async () => dependencies },
  };
  await daemon.registerTransports({ socketPath: '/unused/daemon.sock', host: '127.0.0.1', port: 9700, role: 'slave' });
  return servers.get('tcp')!.options;
}

let directory: string,
  master: string,
  remote: string,
  role = 'admin',
  auditAvailable = true,
  gate: (() => Promise<void>) | undefined;
let service: FilesRpcService;
const servers: HttpNativeServer[] = [],
  netrons: Netron[] = [],
  audit: string[] = [];
const masterStore = new MemoryFileStore(),
  remoteStore = new MemoryFileStore();
const identity = (token: string) => {
  if (!['alice', 'bob', 'viewer', 'operator', 'mesh'].includes(token)) throw new Error('Invalid token');
  return {
    userId: token === 'mesh' ? 'mesh:test-master' : token,
    roles: [token === 'mesh' ? 'service_role' : ['alice', 'bob'].includes(token) ? 'admin' : token],
    permissions: [],
    metadata: { sessionId: token, isServiceRole: token === 'mesh' },
  };
};
async function host(expose: (n: Netron) => Promise<void>) {
  const logger = createNullLogger(),
    n = new Netron(logger);
  n.configureAuth(
    new AuthenticationManager(logger, {
      authenticate: (c) => identity(c.token ?? ''),
      validateToken: identity,
      tokenCache: { enabled: true, ttl: 10000 },
    }),
    new AuthorizationManager(logger)
  );
  n.registerTransport('tcp', () => new TcpTransport());
  n.registerTransportServer('tcp', {
    name: 'tcp',
    options: { ...(await fleetOptions()), host: '127.0.0.1', port: 0 },
  });
  await n.start();
  await expose(n);
  netrons.push(n);
  const s = new HttpNativeServer({
    host: '127.0.0.1',
    port: 0,
    cors: false,
    invocationWrapper: createAuthContextWrapper(),
  });
  s.setPeer(n.peer);
  await s.listen();
  servers.push(s);
  return `http://127.0.0.1:${s.port}`;
}
async function rpc(url: string, token: string, target: string, method: string, input: unknown[] = []) {
  const response = await fetch(`${url}/netron/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: crypto.randomUUID(), service: target, method, input }),
  });
  return response.json();
}
const invoke = (method: string, data?: unknown, token = 'alice') =>
  rpc(master, token, 'OmnitronFiles', method, data === undefined ? [] : [data]);
async function waitJob(id: string, predicate: (j: FileTransfer) => boolean) {
  let last: FileTransfer | undefined;
  for (let i = 0; i < 200; i++) {
    const result = await invoke('transfers');
    last = result.data?.find((j: FileTransfer) => j.id === id);
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Transfer did not settle: ${JSON.stringify(last)}`);
}
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'files-netron-'));
  await fs.mkdir(path.join(directory, 'local'));
  await fs.mkdir(path.join(directory, 'remote'));
  const local = new FileNode([{ id: 'work', label: 'Local', path: path.join(directory, 'local') }], masterStore);
  const node = new FileNode([{ id: 'work', label: 'Remote', path: path.join(directory, 'remote') }], remoteStore);
  remote = await host(async (n) => {
    await n.peer.exposeService(new FileNodeRpcService(node));
  });
  const meshClient = new Netron(createNullLogger());
  meshClient.registerTransport('tcp', () => new TcpTransport());
  await meshClient.start();
  netrons.push(meshClient);
  const remotePort = (netrons[0]!.transportServers.get('tcp') as unknown as { port: number }).port;
  const peer = await meshClient.connect(`tcp://127.0.0.1:${remotePort}`);
  expect((await peer.runTask('authenticate', { token: 'mesh' })).success).toBe(true);
  const filePeer = await peer.queryInterface<IOmnitronFileNodeService>('OmnitronFileNode');
  service = new FilesRpcService(
    local,
    async (_node, actor, request) => {
      if (request.op === 'writeChunk') await gate?.();
      return filePeer.invoke({ actor, request });
    },
    { validateSession: async (id: string) => ({ id, role }) } as never,
    {
      record: async (entry) => {
        if (!auditAvailable) throw new Error('audit unavailable');
        audit.push(entry.action);
      },
    },
    masterStore
  );
  master = await host(async (n) => {
    await n.peer.exposeService(service);
    await n.peer.exposeService(new FileNodeRpcService(local));
  });
});
afterAll(async () => {
  await service?.dispose();
  for (const s of servers) await s.close();
  for (const n of netrons) await n.stop();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('files through real Netron HTTP admission and TCP mesh', () => {
  it('rejects lower roles and human calls to the internal mesh service', async () => {
    for (const token of ['viewer', 'operator', 'mesh'])
      expect((await invoke('roots', { nodeId: 'local' }, token)).success).toBe(false);
    for (const token of ['alice', 'viewer', 'operator'])
      expect(
        (await rpc(remote, token, 'OmnitronFileNode', 'invoke', [{ actor: 'alice', request: { op: 'roots' } }])).success
      ).toBe(false);
  });
  it('copies a directory without routing file bytes through the browser and scopes transfer ownership', async () => {
    await fs.mkdir(path.join(directory, 'local/project'));
    await fs.writeFile(path.join(directory, 'local/project/config.json'), '{"version":1}\n');
    const listing = await invoke('list', { nodeId: 'local', rootId: 'work', path: '' });
    const entry: FileEntry = listing.data.entries.find((e: FileEntry) => e.name === 'project');
    const copy = await invoke('copy', {
      sources: [{ nodeId: 'local', rootId: 'work', path: entry.path, version: entry.version }],
      destination: { nodeId: 'remote', rootId: 'work', path: '' },
    });
    expect(copy.success).toBe(true);
    const done = await waitJob(copy.data.id, (j) => !['running', 'planning'].includes(j.state));
    expect(done.state).toBe('completed');
    expect(done.completedFiles).toBe(1);
    expect(await fs.readFile(path.join(directory, 'remote/project/config.json'), 'utf8')).toBe('{"version":1}\n');
    expect((await invoke('transfers', undefined, 'bob')).data).toEqual([]);
    expect((await invoke('controlTransfer', { id: done.id, action: 'resume' }, 'bob')).success).toBe(false);
    expect(audit).toContain('files.copy.completed');
  });
  it('pauses after an acknowledged block and resumes without publishing a partial destination', async () => {
    const data = Buffer.alloc(1024 * 1024, 73);
    await fs.writeFile(path.join(directory, 'local/large.bin'), data);
    const listing = await invoke('list', { nodeId: 'local', rootId: 'work', path: '' });
    const entry: FileEntry = listing.data.entries.find((e: FileEntry) => e.name === 'large.bin');
    let release!: () => void, entered!: () => void;
    const enteredPromise = new Promise<void>((r) => {
      entered = r;
    });
    gate = () => {
      entered();
      return new Promise<void>((r) => {
        release = r;
      });
    };
    const copy = await invoke('copy', {
      sources: [{ nodeId: 'local', rootId: 'work', path: entry.path, version: entry.version }],
      destination: { nodeId: 'remote', rootId: 'work', path: '' },
    });
    await enteredPromise;
    const paused = invoke('controlTransfer', { id: copy.data.id, action: 'pause' });
    // Let the HTTP control call reach the coordinator before acknowledging the in-flight frame.
    await new Promise((r) => setTimeout(r, 30));
    gate = undefined;
    release();
    expect((await paused).data.state).toBe('paused');
    await expect(fs.stat(path.join(directory, 'remote/large.bin'))).rejects.toThrow();
    expect((await invoke('controlTransfer', { id: copy.data.id, action: 'resume' })).success).toBe(true);
    expect((await waitJob(copy.data.id, (j) => j.state === 'completed')).bytes).toBe(data.length);
    expect(await fs.readFile(path.join(directory, 'remote/large.bin'))).toEqual(data);
  });
  it('fails closed if audit persistence fails or the cached admin session loses its role', async () => {
    auditAvailable = false;
    expect(
      (await invoke('saveText', { nodeId: 'local', rootId: 'work', path: 'blocked', content: 'x', version: null }))
        .success
    ).toBe(false);
    await expect(fs.stat(path.join(directory, 'local/blocked'))).rejects.toThrow();
    auditAvailable = true;
    role = 'viewer';
    expect((await invoke('list', { nodeId: 'local', rootId: 'work', path: '' })).success).toBe(false);
    role = 'admin';
  });
});
