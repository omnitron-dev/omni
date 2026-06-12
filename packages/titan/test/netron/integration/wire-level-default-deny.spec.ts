/**
 * SEC-2 — opt-in DEFAULT-DENY authorization.
 *
 * Netron is historically default-ALLOW: a method gated by NEITHER a registered
 * `AuthorizationManager` ACL NOR a `@Public({ auth })` decorator is callable by
 * any peer that holds the service's definition id — including non-`@Public`
 * instance methods, because `ServiceStub.call` dispatches by name with no
 * public-surface whitelist (only `isValidPropertyName` + `enforceMethodAccess`
 * gate it). That is the correct back-compat default, but security-conscious
 * deployments want "deny unless explicitly allowed".
 *
 * The `authDefaultDeny: true` Netron option flips the posture: a method with no
 * access-control decision is DENIED. Methods that DO declare a gate — an ACL, a
 * `@Public({ auth })` decorator (including `auth: false` / `allowAnonymous`) —
 * are evaluated on their own terms and are unaffected.
 *
 * This suite proves both the back-compat default (everything callable) and the
 * opt-in posture (un-gated methods denied, gated methods still work) on the
 * persistent (WebSocket) wire path, plus the `hasACL` predicate the enforcement
 * relies on.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { createMockLogger } from '../test-utils.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import type { RemotePeer } from '../../../src/netron/remote-peer.js';
import type { AuthCredentials } from '../../../src/netron/auth/types.js';

@Service('configsvc@1.0.0')
class ConfigService {
  // Decorator-gated: any authenticated caller. Unaffected by default-deny.
  @Public({ auth: true })
  async getSecret(): Promise<string> {
    return 'the-secret';
  }

  // Explicitly open (`auth: false`) — an intentional opt-out of auth.
  // Unaffected by default-deny (the developer made a decision).
  @Public({ auth: false })
  async ping(): Promise<string> {
    return 'pong';
  }

  // Bare `@Public()`, no `auth` key — exposed for RPC but carries NO access
  // decision. Allowed under default-allow; DENIED under default-deny.
  @Public()
  async listKeys(): Promise<string[]> {
    return ['k1', 'k2'];
  }

  // NOT decorated at all — a non-public instance method. Still wire-reachable
  // via the service's definition id because the stub dispatches by name with no
  // public-surface whitelist. The core SEC-2 hole: callable under default-allow,
  // DENIED under default-deny.
  async internalReset(): Promise<string> {
    return 'reset';
  }
}

const netrons: Netron[] = [];

async function bootServer(authDefaultDeny: boolean): Promise<{ server: Netron; port: number }> {
  const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
  const port = 9400 + (workerId - 1) * 200 + Math.floor(Math.random() * 180);
  const logger = createMockLogger();
  const server = new Netron(logger, { id: `sec2-server-${authDefaultDeny}-${port}`, authDefaultDeny });

  // Authentication only — NO AuthorizationManager / ACL, so the decorator (or
  // the absence of one) is the sole control. This isolates the default-deny
  // behaviour from ACL interactions.
  const authn = new AuthenticationManager(logger, {
    authenticate: async (creds: AuthCredentials) => {
      if (creds.username === 'user' && creds.password === 'pw') {
        return { userId: 'u-user', username: 'user', roles: ['user'], permissions: [] };
      }
      throw new Error('Invalid credentials');
    },
    validateToken: async (token: string) => JSON.parse(Buffer.from(token, 'base64').toString()),
  });
  (server as any).authenticationManager = authn;

  server.registerTransport('ws', () => new WebSocketTransport());
  server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
  await server.start();
  await server.peer.exposeService(new ConfigService());
  netrons.push(server);
  return { server, port };
}

async function connectAuthed(server: Netron, port: number): Promise<{ peer: RemotePeer; defId: string }> {
  const client = new Netron(createMockLogger(), { id: `sec2-client-${port}-${Math.random()}` });
  client.registerTransport('ws', () => new WebSocketTransport());
  netrons.push(client);
  const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
  await peer.runTask('authenticate', { username: 'user', password: 'pw' });

  // Plant the server's REAL definition id on the client peer — simulating a
  // client that holds the defId and tries to call any method by name (the
  // threat `enforceMethodAccess` exists to gate).
  const stub: any = (server as any).services.get('configsvc@1.0.0');
  if (!stub) throw new Error('configsvc@1.0.0 stub not registered on server');
  const def = stub.definition;
  (peer as any).definitions.set(def.id, def);
  return { peer, defId: def.id };
}

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
  for (const n of netrons.splice(0)) {
    await n.stop().catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 100));
});

describe('AuthorizationManager.hasACL (SEC-2 predicate)', () => {
  it('reports false when no ACL covers the service, true for exact and wildcard matches', () => {
    const authz = new AuthorizationManager(createMockLogger());

    expect(authz.hasACL('billing@1.0.0')).toBe(false);

    authz.registerACL({ service: 'billing@1.0.0', allowedRoles: ['admin'] });
    expect(authz.hasACL('billing@1.0.0')).toBe(true);
    expect(authz.hasACL('other@1.0.0')).toBe(false);

    authz.registerACL({ service: 'admin*', allowedRoles: ['admin'] });
    expect(authz.hasACL('adminPanel@2.0.0')).toBe(true);
    expect(authz.hasACL('userPanel@2.0.0')).toBe(false);
  });
});

describe('Netron wire-level — default-ALLOW (back-compat, authDefaultDeny unset)', () => {
  it('allows decorator-gated, explicitly-open, bare-@Public AND undecorated methods', async () => {
    const { server, port } = await bootServer(false);
    const { peer, defId } = await connectAuthed(server, port);

    expect(await peer.call(defId, 'getSecret', [])).toBe('the-secret'); // @Public({auth:true}) + authed
    expect(await peer.call(defId, 'ping', [])).toBe('pong'); // @Public({auth:false})
    expect(await peer.call(defId, 'listKeys', [])).toEqual(['k1', 'k2']); // bare @Public()
    // The hole: an undecorated instance method is reachable by name.
    expect(await peer.call(defId, 'internalReset', [])).toBe('reset');

    await peer.disconnect();
  });
});

describe('Netron wire-level — default-DENY (authDefaultDeny: true)', () => {
  it('still allows methods that declare a gate (decorator auth:true / auth:false)', async () => {
    const { server, port } = await bootServer(true);
    const { peer, defId } = await connectAuthed(server, port);

    // Has a `@Public({ auth })` gate → evaluated on its own terms, NOT denied by
    // the default-deny fallback.
    expect(await peer.call(defId, 'getSecret', [])).toBe('the-secret');
    expect(await peer.call(defId, 'ping', [])).toBe('pong');

    await peer.disconnect();
  });

  it('denies a bare-@Public() method (no auth key → no access decision)', async () => {
    const { server, port } = await bootServer(true);
    const { peer, defId } = await connectAuthed(server, port);

    await expect(peer.call(defId, 'listKeys', [])).rejects.toMatchObject({
      message: expect.stringMatching(/denied|forbidden|access/i),
    });

    await peer.disconnect();
  });

  it('denies an undecorated instance method (closes the call-any-method hole)', async () => {
    const { server, port } = await bootServer(true);
    const { peer, defId } = await connectAuthed(server, port);

    await expect(peer.call(defId, 'internalReset', [])).rejects.toMatchObject({
      message: expect.stringMatching(/denied|forbidden|access/i),
    });

    await peer.disconnect();
  });
});
