/**
 * Regression test for T#34 — method-level authorization enforcement on the
 * wire path (persistent transports: WS, TCP, Unix).
 *
 * Prior behaviour: `query_interface` filtered out methods the caller could
 * not invoke, but the filtering was the *only* gate. A client that knew
 * (or guessed) a restricted method's name could craft a raw TYPE_CALL /
 * TYPE_GET / TYPE_SET packet against the service's definition ID and the
 * server would happily dispatch into the stub — the ACL existed solely
 * for cosmetic display.
 *
 * Fixed by `enforceMethodAccess()` in remote-peer.ts, invoked from the
 * TYPE_SET / TYPE_GET / TYPE_CALL branches before reaching the stub.
 *
 * These tests deliberately bypass `queryInterface`'s filtered view and
 * call the unfiltered service definition directly via `peer.call(defId, …)`,
 * mimicking what a hostile client could do.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { createMockLogger } from '../test-utils.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import type { RemotePeer } from '../../../src/netron/remote-peer.js';
import type { AuthCredentials } from '../../../src/netron/auth/types.js';

@Service('vault@1.0.0')
class VaultService {
  // Anyone authenticated can read.
  @Public({ auth: true })
  async read(key: string): Promise<string> {
    return `value-of-${key}`;
  }

  // Admin only — but `query_interface` would hide it from a non-admin
  // anyway. The point of these tests is that the wire-level guard fires
  // even when the client crafts the call without going through the
  // filtered interface.
  @Public({ auth: { roles: ['admin'] } })
  async rotate(): Promise<string> {
    return 'rotated';
  }

  @Public({ auth: { roles: ['admin'] } })
  async destroy(): Promise<boolean> {
    return true;
  }
}

describe('Netron — wire-level method authorization (T#34)', () => {
  let server: Netron;
  let client: Netron;
  let port: number;

  beforeEach(async () => {
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    port = 9400 + (workerId - 1) * 200 + Math.floor(Math.random() * 180);

    const serverLogger = createMockLogger();
    server = new Netron(serverLogger, { id: 'wire-authz-server' });

    const authn = new AuthenticationManager(serverLogger, {
      authenticate: async (creds: AuthCredentials) => {
        if (creds.username === 'admin' && creds.password === 'pw') {
          return { userId: 'u-admin', username: 'admin', roles: ['admin', 'user'], permissions: [] };
        }
        if (creds.username === 'user' && creds.password === 'pw') {
          return { userId: 'u-user', username: 'user', roles: ['user'], permissions: [] };
        }
        throw new Error('Invalid credentials');
      },
      validateToken: async (token: string) => JSON.parse(Buffer.from(token, 'base64').toString()),
    });

    const authz = new AuthorizationManager(serverLogger);
    authz.registerACL({
      service: 'vault@1.0.0',
      allowedRoles: ['user', 'admin'],
      methods: {
        rotate: { allowedRoles: ['admin'] },
        destroy: { allowedRoles: ['admin'] },
      },
    });

    (server as any).authenticationManager = authn;
    (server as any).authorizationManager = authz;

    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new VaultService());

    client = new Netron(createMockLogger(), { id: 'wire-authz-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await client?.stop();
    await server?.stop();
    await new Promise((r) => setTimeout(r, 200));
  });

  function getServerDef(): any {
    const stub: any = (server as any).services.get('vault@1.0.0');
    if (!stub) throw new Error('vault@1.0.0 stub not registered on server');
    return stub.definition;
  }

  /**
   * Plant the server-side service definition into the client peer's local
   * `definitions` map so `peer.call(defId, …)` will skip its "definition
   * not found" check and put a real TYPE_CALL packet on the wire. This
   * simulates a hostile client that already knows the definition ID
   * (cross-tenant leak, persisted from a privileged session, etc.) and
   * crafts a raw call to bypass the filtered queryInterface view.
   */
  function plantDef(peer: RemotePeer): string {
    const def = getServerDef();
    (peer as any).definitions.set(def.id, def);
    return def.id;
  }

  it('blocks a non-admin from invoking an admin-only method via raw call(defId, …)', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    await peer.runTask('authenticate', { username: 'user', password: 'pw' });

    const realDefId = plantDef(peer);

    // The non-admin can call the permitted method.
    const readOk = await peer.call(realDefId, 'read', ['secret']);
    expect(readOk).toBe('value-of-secret');

    // The non-admin must NOT be able to call admin-only methods, even
    // when bypassing queryInterface and crafting a raw TYPE_CALL.
    await expect(peer.call(realDefId, 'rotate', [])).rejects.toMatchObject({
      message: expect.stringMatching(/Access denied/),
    });
    await expect(peer.call(realDefId, 'destroy', [])).rejects.toMatchObject({
      message: expect.stringMatching(/Access denied/),
    });

    await peer.disconnect();
  });

  it('blocks an entirely unauthenticated peer from invoking any restricted method via raw call', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    // Skip authentication. queryInterface would normally fail at the
    // service-level ACL — we plant the definition directly to simulate
    // a hostile client that already knows the defId.
    const realDefId = plantDef(peer);

    await expect(peer.call(realDefId, 'rotate', [])).rejects.toMatchObject({
      message: expect.stringMatching(/Access denied/),
    });

    await peer.disconnect();
  });

  it('allows admin to invoke admin-only methods through the raw call path', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    await peer.runTask('authenticate', { username: 'admin', password: 'pw' });
    const realDefId = plantDef(peer);

    const result = await peer.call(realDefId, 'rotate', []);
    expect(result).toBe('rotated');

    await peer.disconnect();
  });
});
