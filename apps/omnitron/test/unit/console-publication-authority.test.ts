import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { HttpTransport, type HttpResponseMessage } from '@omnitron-dev/titan/netron/transport/http';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { BackendRpcService } from '../../src/daemon/backend.rpc-service.js';
import type { OmnitronDaemon } from '../../src/daemon/daemon.js';

// Only ephemeral Netron listeners and synthetic methods; no daemon or Docker operations.
const connections: Netron[] = [];
const directories: string[] = [];
const logger = createNullLogger();
const result = { running: true, healthy: true, port: 19800, url: 'http://127.0.0.1:19800', autoStart: true };
function fixture() {
  const start = vi.fn<OmnitronDaemon['startConsole']>().mockResolvedValue(result);
  const rpc = new BackendRpcService({ startConsole: start,
    backendRuntimeStatus: vi.fn<OmnitronDaemon['backendRuntimeStatus']>(),
    backendControlAddress: vi.fn<OmnitronDaemon['backendControlAddress']>(),
  });
  const server = new Netron(logger, { id: crypto.randomUUID() });
  connections.push(server);
  return { server, rpc, start };
}
afterEach(async () => {
  for (const connection of connections.splice(0).reverse()) await connection.stop();
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

it('rejects Console publication over HTTP even for an authenticated administrator', async () => {
  const { server, rpc, start } = fixture();
  server.configureAuth(new AuthenticationManager(logger, {
    authenticate: async () => { throw Error('Token required'); },
    validateToken: async role => {
      if (!['admin', 'operator', 'viewer'].includes(role)) throw Error('Invalid role');
      return { userId: 'human', roles: [role], permissions: [], metadata: { sessionId: 'fixture-session' } };
    },
  }), new AuthorizationManager(logger));
  server.registerTransport('http', () => new HttpTransport());
  server.registerTransportServer('http', { name: 'console-authority', options: {
    host: '127.0.0.1', port: 0, invocationWrapper: createAuthContextWrapper(),
  } });
  await server.start();
  await server.peer.exposeService(rpc);
  const port = server.transportServers.get('http')!.port!;
  for (const role of ['admin', 'operator', 'viewer']) {
    const response = await fetch(`http://127.0.0.1:${port}/netron/invoke`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${role}` },
      body: JSON.stringify({ id: crypto.randomUUID(), service: 'OmnitronBackend', method: 'startConsole', input: [{ force: true }] }),
    });
    const body = await response.json() as HttpResponseMessage;
    expect(body.success).toBe(false);
    expect(start).not.toHaveBeenCalled();
  }
});

it('uses the private Unix socket authority and rejects malformed options before publication', async () => {
  const { server, rpc, start } = fixture();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'console-authority-'));
  directories.push(directory);
  const socket = path.join(directory, 'console.sock');
  server.registerTransport('unix', () => new UnixSocketTransport());
  server.registerTransportServer('unix', { name: 'local', options: {
    path: socket, mode: 0o600, invocationWrapper: createAuthContextWrapper(),
  } });
  server.setTransportAuthContext('unix', {
    userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' },
  });
  await server.start();
  await server.peer.exposeService(rpc);
  const client = new Netron(logger, { id: crypto.randomUUID() });
  connections.push(client);
  client.registerTransport('unix', () => new UnixSocketTransport());
  await client.start();
  const peer = await client.connect(`unix://${socket}`);
  const service = await peer.queryInterface<Pick<BackendRpcService, 'startConsole'>>('OmnitronBackend');
  for (const input of [null, [], 'force', 1, { force: 'yes' }, { unknown: true }, new Date(0)]) {
    await expect(service.startConsole(input as never)).rejects.toThrow();
    expect(start).not.toHaveBeenCalled();
  }
  await expect(service.startConsole({ force: true, temporary: false })).resolves.toEqual(result);
  expect(start).toHaveBeenCalledExactlyOnceWith({ force: true, temporary: false });
  await expect(service.startConsole()).resolves.toEqual(result);
  expect(start).toHaveBeenLastCalledWith({});
});
