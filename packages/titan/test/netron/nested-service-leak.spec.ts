/**
 * Regression test for T#49 — `ServiceStub.call` leaked nested
 * service definitions to anonymous callers.
 *
 * When a method returned ANOTHER service instance, `processResult`
 * unconditionally called `peer.refService(...)` and forwarded the
 * resulting Definition to the caller. The wire-level `T#34` guard
 * would then block subsequent calls to the leaked nested service
 * IF an ACL was registered for it — but the definition (interface
 * shape, method list) had already crossed the wire. An unauth'd
 * caller could enumerate the entire nested-service surface even
 * when blocked from invoking any of its methods.
 *
 * Fix: `processResult` consults `AuthorizationManager.canAccessService`
 * for the nested service's qualified name BEFORE the ref. On denial,
 * we throw `Errors.forbidden` so the leaked definition never reaches
 * the wire.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { Service, Public } from '../../src/decorators/core.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';
import { AuthorizationManager } from '../../src/netron/auth/authorization-manager.js';
import { AuthenticationManager } from '../../src/netron/auth/authentication-manager.js';
import { createMockLogger } from './test-utils.js';
import type { RemotePeer } from '../../src/netron/remote-peer.js';
import type { AuthCredentials } from '../../src/netron/auth/types.js';

@Service('secrets@1.0.0')
class SecretsService {
  @Public()
  async get(): Promise<string> {
    return 'classified';
  }
}

@Service('directory@1.0.0')
class DirectoryService {
  private readonly secrets = new SecretsService();

  // Anyone may call this method. Pre-T#49, the returned SecretsService
  // would leak through processResult even when the caller is not
  // authorised for secrets@1.0.0.
  @Public()
  async openSecrets(): Promise<SecretsService> {
    return this.secrets;
  }
}

describe('Netron — nested-service leak (T#49)', () => {
  let server: Netron;
  let client: Netron;
  let port: number;

  beforeEach(async () => {
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    port = 13000 + (workerId - 1) * 200 + Math.floor(Math.random() * 180);

    const serverLogger = createMockLogger();
    server = new Netron(serverLogger, { id: 't49-server' });

    const authn = new AuthenticationManager(serverLogger, {
      authenticate: async (creds: AuthCredentials) => {
        if (creds.username === 'admin' && creds.password === 'pw') {
          return { userId: 'admin', username: 'admin', roles: ['admin'], permissions: [] };
        }
        if (creds.username === 'user' && creds.password === 'pw') {
          return { userId: 'user', username: 'user', roles: ['user'], permissions: [] };
        }
        throw new Error('Invalid credentials');
      },
      validateToken: async (token: string) => JSON.parse(Buffer.from(token, 'base64').toString()),
    });
    const authz = new AuthorizationManager(serverLogger);
    // Service `secrets@1.0.0` is admin-only; `directory@1.0.0` is open.
    authz.registerACL({ service: 'secrets@1.0.0', allowedRoles: ['admin'] });

    (server as any).authenticationManager = authn;
    (server as any).authorizationManager = authz;

    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new DirectoryService());
    await server.peer.exposeService(new SecretsService());

    client = new Netron(createMockLogger(), { id: 't49-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 80));
    await client?.stop();
    await server?.stop();
    await new Promise((r) => setTimeout(r, 150));
  });

  it('refuses to leak a nested service definition to a non-admin caller', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    await peer.runTask('authenticate', { username: 'user', password: 'pw' });

    const directory = await peer.queryInterface<{ openSecrets(): Promise<unknown> }>('directory@1.0.0');

    await expect(directory.openSecrets()).rejects.toMatchObject({
      message: expect.stringMatching(/Access denied to nested service/i),
    });

    await peer.disconnect();
  });

  it('lets the admin caller through to the nested service', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    await peer.runTask('authenticate', { username: 'admin', password: 'pw' });

    const directory = await peer.queryInterface<{ openSecrets(): Promise<{ get(): Promise<string> }> }>(
      'directory@1.0.0',
    );

    const secrets = await directory.openSecrets();
    expect(typeof secrets).toBe('object');

    await peer.disconnect();
  });
});
