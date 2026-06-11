/**
 * SEC-1 regression — `@Public({ auth })` decorator authorization MUST be
 * enforced on the persistent transports (WS / TCP / Unix) even when NO
 * `AuthorizationManager` ACL is registered for the service.
 *
 * Prior behaviour (the bug): `RemotePeer.enforceMethodAccess` consulted ONLY
 * `AuthorizationManager.canAccessMethod()`, which returns *default-allow* when
 * no ACL matches the service. The `@Public({ auth: { roles: [...] } })`
 * metadata — the documented authorization model — was never read on the wire
 * path. So a method protected purely by the decorator was admin-gated on HTTP
 * but callable by ANY (or no) authenticated peer over WS/TCP/Unix.
 *
 * The companion test `wire-level-authz.spec.ts` only ever passed because it
 * registered a redundant ACL that duplicated the decorator — masking this gap.
 * This suite intentionally registers NO ACL (and no AuthorizationManager at
 * all) so the decorator is the SOLE control.
 *
 * Fixed by routing the wire path through the shared `enforceMethodAuthorization`
 * (auth/method-authorization.ts), the same enforcement the HTTP middleware uses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { createMockLogger } from '../test-utils.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import type { RemotePeer } from '../../../src/netron/remote-peer.js';
import type { AuthCredentials } from '../../../src/netron/auth/types.js';

@Service('vault@1.0.0')
class VaultService {
  // Any authenticated caller may read.
  @Public({ auth: true })
  async read(key: string): Promise<string> {
    return `value-of-${key}`;
  }

  // Admin-only — protected SOLELY by the decorator (no ACL anywhere).
  @Public({ auth: { roles: ['admin'] } })
  async rotate(): Promise<string> {
    return 'rotated';
  }
}

describe('Netron — wire-level DECORATOR authorization without ACL (SEC-1)', () => {
  let server: Netron;
  let client: Netron;
  let port: number;

  beforeEach(async () => {
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    port = 9800 + (workerId - 1) * 200 + Math.floor(Math.random() * 180);

    const serverLogger = createMockLogger();
    server = new Netron(serverLogger, { id: 'sec1-server' });

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

    // Authentication only. Intentionally NO AuthorizationManager and NO ACL —
    // the decorator must be the sole, sufficient control on the wire.
    (server as any).authenticationManager = authn;

    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new VaultService());

    client = new Netron(createMockLogger(), { id: 'sec1-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await client?.stop();
    await server?.stop();
    await new Promise((r) => setTimeout(r, 200));
  });

  function plantDef(peer: RemotePeer): string {
    const stub: any = (server as any).services.get('vault@1.0.0');
    if (!stub) throw new Error('vault@1.0.0 stub not registered on server');
    const def = stub.definition;
    (peer as any).definitions.set(def.id, def);
    return def.id;
  }

  it('denies a non-admin from a decorator-only admin method (no ACL registered)', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    await peer.runTask('authenticate', { username: 'user', password: 'pw' });
    const defId = plantDef(peer);

    // auth:true + authenticated → permitted.
    expect(await peer.call(defId, 'read', ['secret'])).toBe('value-of-secret');

    // roles:['admin'] + role 'user' → MUST be denied (decorator-only).
    await expect(peer.call(defId, 'rotate', [])).rejects.toMatchObject({
      message: expect.stringMatching(/role|denied|forbidden|access/i),
    });

    await peer.disconnect();
  });

  it('denies an unauthenticated peer from a decorator auth:true method (no ACL registered)', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    const defId = plantDef(peer);

    await expect(peer.call(defId, 'read', ['x'])).rejects.toMatchObject({
      message: expect.stringMatching(/auth|denied|forbidden|required/i),
    });
    await expect(peer.call(defId, 'rotate', [])).rejects.toMatchObject({
      message: expect.stringMatching(/auth|role|denied|forbidden|required/i),
    });

    await peer.disconnect();
  });

  it('allows admin to call the decorator-only admin method (no ACL registered)', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    await peer.runTask('authenticate', { username: 'admin', password: 'pw' });
    const defId = plantDef(peer);

    expect(await peer.call(defId, 'rotate', [])).toBe('rotated');

    await peer.disconnect();
  });
});
