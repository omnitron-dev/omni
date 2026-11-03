import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { HttpTransport, type HttpResponseMessage } from '@omnitron-dev/titan/netron/transport/http';
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { createAuthContextWrapper, runWithAuth } from '../../src/services/auth-context.js';

const runner = vi.hoisted(() => vi.fn());
vi.mock('../../src/release/build-run.js', () => ({ runReleaseBuild: runner }));
const { ReleaseService } = await import('../../src/services/release.service.js');
const { ReleaseRpcService } = await import('../../src/services/release.rpc-service.js');
const logger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
  child: () => logger, isLevelEnabled: () => false,
} as unknown as ILogger;
const source = { repository: 'https://forge.example/platform/omni.git', ref: 'refs/heads/stable' };
const request = { project: 'sample', frameworkSource: source };
const actor = (role = 'admin') => ({ userId: 'alice', roles: [role], permissions: [], metadata: { sessionId: 'session' } });

function fixture() {
  const releases = new ReleaseService(logger);
  const auth = { validateSession: vi.fn(async (): Promise<{ id: string; role: string } | null> => ({ id: 'alice', role: 'admin' })) };
  const audit = { record: vi.fn(async () => {}) };
  const rpc = new ReleaseRpcService(releases, audit as never, undefined, auth as never);
  return { releases, auth, audit, rpc };
}

beforeEach(() => { vi.clearAllMocks(); runner.mockImplementation(() => new Promise(() => {})); });
const connections: Netron[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const connection of connections.splice(0).reverse()) await connection.stop();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function transportFixture(protocol: 'http' | 'ws') {
  const f = fixture();
  const server = new Netron(logger, { id: `source-server-${crypto.randomUUID()}` });
  connections.push(server);
  server.configureAuth(new AuthenticationManager(logger, {
    authenticate: async () => { throw Error('token required'); },
    validateToken: async (token) => {
      if (!['admin', 'operator', 'viewer'].includes(token)) throw Error('invalid token');
      return actor(token);
    },
  }), new AuthorizationManager(logger));
  const transport = () => protocol === 'http' ? new HttpTransport() : new WebSocketTransport();
  server.registerTransport(protocol, transport);
  server.registerTransportServer(protocol, { name: 'source-test', options: {
    host: '127.0.0.1', port: 0, invocationWrapper: createAuthContextWrapper(),
  } });
  await server.start();
  await server.peer.exposeService(f.rpc);
  const port = server.transportServers.get(protocol)!.port!;
  expect(port).toBeGreaterThan(0);
  const invoke = async (role: string, input = request) => {
    if (protocol === 'http') {
      const response = await fetch(`http://127.0.0.1:${port}/netron/invoke`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${role}` },
        body: JSON.stringify({ id: crypto.randomUUID(), service: 'OmnitronRelease', method: 'build', input: [input] }),
      });
      const body = await response.json() as HttpResponseMessage;
      if (!response.ok || !body.success) throw Error(body.error?.message ?? 'RPC refused');
      return body.data;
    }
    const client = new Netron(logger, { id: `source-client-${crypto.randomUUID()}` });
    connections.push(client);
    client.registerTransport('ws', () => new WebSocketTransport());
    await client.start();
    const peer = await client.connect(`ws://127.0.0.1:${port}`);
    if (!('runTask' in peer)) throw Error('Expected the Netron WebSocket peer');
    await peer.runTask('authenticate', { token: role });
    const service = await peer.queryInterface<Pick<InstanceType<typeof ReleaseRpcService>, 'build'>>('OmnitronRelease');
    return service.build(input);
  };
  return { ...f, invoke };
}

describe('release source authority before build admission', () => {
  it.each(['viewer', 'operator'])('refuses an override from %s before records, audit or execution', async (role) => {
    const f = fixture();
    await expect(runWithAuth(actor(role), () => f.rpc.build(request))).rejects.toThrow(/admin/i);
    expect(f.releases.builds()).toEqual([]);
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([null, { id: 'alice', role: 'operator' }, { id: 'other', role: 'admin' }])('revalidates current human authority (%j)', async (user) => {
    const f = fixture();
    f.auth.validateSession.mockResolvedValue(user);
    await expect(runWithAuth(actor(), () => f.rpc.build(request))).rejects.toThrow();
    expect(f.releases.builds()).toEqual([]);
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it('refuses missing authentication and missing authority service', async () => {
    const f = fixture();
    await expect(f.rpc.build(request)).rejects.toThrow();
    const missingAuth = new ReleaseRpcService(f.releases, f.audit as never);
    await expect(runWithAuth(actor(), () => missingAuth.build(request))).rejects.toThrow(/administrator/);
    expect(f.releases.builds()).toEqual([]);
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it('preserves an operator build using the project source selection', async () => {
    const f = fixture();
    const record = await runWithAuth(actor('operator'), () => f.rpc.build({ project: 'sample' }));
    expect(record.request).toEqual({ project: 'sample' });
    expect(record.requestedBy).toBe('alice');
    expect(runner).toHaveBeenCalledOnce();
    expect(f.auth.validateSession).not.toHaveBeenCalled();
    expect(f.audit.record).toHaveBeenCalledOnce();
  });

  it('records a required normalized intent before admitting an administrator build', async () => {
    const f = fixture();
    f.audit.record.mockImplementation(async () => {
      if (f.audit.record.mock.calls.length === 1) {
        expect(f.releases.builds()).toEqual([]);
        expect(runner).not.toHaveBeenCalled();
      }
    });
    const record = await runWithAuth(actor(), () => f.rpc.build(request));
    expect(f.audit.record).toHaveBeenNthCalledWith(1, {
      action: 'release.build.requested', resourceType: 'release', details: { project: 'sample', frameworkSource: source },
    }, true);
    expect(f.auth.validateSession).toHaveBeenCalledWith('session');
    expect(record.request.frameworkSource).toEqual(source);
    expect(Object.isFrozen(record.request.frameworkSource)).toBe(true);
    expect(runner).toHaveBeenCalledOnce();
  });

  it('accepts the existing trusted Unix administrator identity contract', async () => {
    const f = fixture();
    const local = { userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' } };
    const record = await runWithAuth(local, () => f.rpc.build(request));
    expect(record.requestedBy).toBe('omnitron-local');
    expect(f.auth.validateSession).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledOnce();
  });

  it('does not start when administrator access is revoked during the audit write', async () => {
    const f = fixture();
    f.audit.record.mockImplementationOnce(async () => {
      f.auth.validateSession.mockResolvedValue({ id: 'alice', role: 'operator' });
    });
    await expect(runWithAuth(actor(), () => f.rpc.build(request))).rejects.toThrow();
    expect(f.audit.record).toHaveBeenCalledOnce();
    expect(f.releases.builds()).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it('refuses an override if the required audit cannot be stored', async () => {
    const f = fixture();
    f.audit.record.mockRejectedValueOnce(Error('audit unavailable'));
    await expect(runWithAuth(actor(), () => f.rpc.build(request))).rejects.toThrow('audit unavailable');
    expect(f.releases.builds()).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
    const withoutAudit = new ReleaseRpcService(f.releases, undefined, undefined, f.auth as never);
    await expect(runWithAuth(actor(), () => withoutAudit.build(request))).rejects.toThrow(/Audit storage/);
    expect(f.releases.builds()).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects credentials before any audit or build record without echoing them', async () => {
    const f = fixture();
    await expect(runWithAuth(actor(), () => f.rpc.build({ project: 'sample', frameworkSource: { repository: 'https://private-token@forge.example/omni.git' } })))
      .rejects.not.toThrow('private-token');
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(f.auth.validateSession).not.toHaveBeenCalled();
    expect(f.releases.builds()).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });
});

it('carries the local administrator over an actual private Netron Unix socket', async () => {
  const f = fixture();
  const directory = await mkdtemp(path.join(tmpdir(), 'release-source-'));
  directories.push(directory);
  const socket = path.join(directory, 'console.sock');
  const server = new Netron(logger, { id: 'source-unix-server' });
  connections.push(server);
  server.registerTransport('unix', () => new UnixSocketTransport());
  server.registerTransportServer('unix', { name: 'local', options: {
    path: socket, mode: 0o600, invocationWrapper: createAuthContextWrapper(),
  } });
  server.setTransportAuthContext('unix', {
    userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' },
  });
  await server.start();
  await server.peer.exposeService(f.rpc);
  const client = new Netron(logger, { id: 'source-unix-client' });
  connections.push(client);
  client.registerTransport('unix', () => new UnixSocketTransport());
  await client.start();
  const peer = await client.connect(`unix://${socket}`);
  const service = await peer.queryInterface<Pick<InstanceType<typeof ReleaseRpcService>, 'build'>>('OmnitronRelease');
  const record = await service.build(request);
  expect(record.requestedBy).toBe('omnitron-local');
  expect(f.auth.validateSession).not.toHaveBeenCalled();
  expect(runner).toHaveBeenCalledOnce();
});

describe.each(['http', 'ws'] as const)('release source authority over real Netron %s', (protocol) => {
  it('denies viewer/operator overrides and permits a validated administrator', async () => {
    const f = await transportFixture(protocol);
    for (const role of ['viewer', 'operator']) {
      await expect(f.invoke(role)).rejects.toThrow();
      expect(f.releases.builds()).toEqual([]);
      expect(f.audit.record).not.toHaveBeenCalled();
      expect(runner).not.toHaveBeenCalled();
    }
    const record = await f.invoke('admin');
    expect(record.request.frameworkSource).toEqual(source);
    expect(runner).toHaveBeenCalledOnce();
  });

  it('refuses an admitted admin transport token after session demotion', async () => {
    const f = await transportFixture(protocol);
    f.auth.validateSession.mockResolvedValue({ id: 'alice', role: 'operator' });
    await expect(f.invoke('admin')).rejects.toThrow();
    expect(f.releases.builds()).toEqual([]);
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it('refuses an administrator when the required audit write fails', async () => {
    const f = await transportFixture(protocol);
    f.audit.record.mockRejectedValueOnce(Error('audit unavailable'));
    await expect(f.invoke('admin')).rejects.toThrow(/audit unavailable/);
    expect(f.releases.builds()).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });
});
