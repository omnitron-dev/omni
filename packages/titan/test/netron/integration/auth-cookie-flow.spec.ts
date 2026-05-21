/**
 * Integration test for the cookie-based token transport.
 *
 * Spins up a real HTTP server with CookieTokenTransport configured,
 * exposes a small auth service that calls issueTokens()/clearTokens(),
 * and hits it with raw fetch() to verify the wire-level Set-Cookie /
 * body-strip behaviour.
 *
 * Companion of:
 *  - packages/titan/src/netron/auth/token-transport.ts
 *  - packages/titan/src/netron/auth/token-issuance.ts
 *  - packages/titan/src/netron/transport/http/server.ts (applyTokenTransport)
 *
 * @module @omnitron-dev/titan/test/netron/integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { HttpTransport } from '../../../src/netron/transport/http/http-transport.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import { CookieTokenTransport } from '../../../src/netron/auth/token-transports/cookie.js';
import { BearerTokenTransport } from '../../../src/netron/auth/token-transports/bearer.js';
import { CompositeTokenTransport } from '../../../src/netron/auth/token-transports/composite.js';
import { issueTokens, clearTokens } from '../../../src/netron/auth/token-issuance.js';
import { CsrfManager } from '../../../src/netron/auth/csrf.js';
import { createCsrfMiddleware } from '../../../src/netron/auth/csrf-middleware.js';
import { MiddlewareStage } from '../../../src/netron/transport/http/middleware/index.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { createMockLogger } from '../test-utils.js';
import type { AuthContext, AuthCredentials } from '../../../src/netron/auth/types.js';

/**
 * Service under test — signin/signout that ride the transport-issuance hook.
 */
@Service('cookieAuthService@1.0.0')
class CookieAuthService {
  @Public()
  async signin(input: { username: string; password: string }): Promise<{ user: string; accessToken: string; refreshToken: string }> {
    const accessToken = `access-${input.username}`;
    const refreshToken = `refresh-${input.username}`;
    // Ambient-context form: the framework wraps every @Public method
    // in runWithTokenIssuanceContext so we don't need to receive ctx.
    issueTokens({ access: accessToken, refresh: refreshToken });
    return { user: input.username, accessToken, refreshToken };
  }

  @Public()
  async signout(): Promise<{ ok: boolean }> {
    clearTokens();
    return { ok: true };
  }

  @Public()
  async ping(): Promise<string> {
    return 'pong';
  }
}

async function findAvailablePort(start = 19000): Promise<number> {
  const max = start + 200;
  for (let port = start; port < max; port++) {
    try {
      const probe = new Netron(createMockLogger(), { id: `port-probe-${port}` });
      probe.registerTransport('http', () => new HttpTransport());
      await probe.registerTransportServer('http', { name: 'http', options: { host: 'localhost', port } });
      await probe.start();
      await probe.stop();
      return port;
    } catch {
      continue;
    }
  }
  throw new Error('No available ports');
}

/**
 * Helper: invoke a netron HTTP RPC method via raw fetch. Lets us
 * inspect the wire response (status, headers, body) directly.
 */
async function rpcCall(
  port: number,
  service: string,
  method: string,
  input: unknown,
  init?: { headers?: Record<string, string> }
): Promise<Response> {
  return await fetch(`http://localhost:${port}/netron/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify({
      id: `req-${Math.random().toString(36).slice(2)}`,
      version: '2.0',
      timestamp: Date.now(),
      service,
      method,
      input,
    }),
  });
}

function parseSetCookies(res: Response): string[] {
  // Web Fetch's Headers can have multiple Set-Cookie values; getSetCookie()
  // is the standardized accessor (Node 20+ / undici).
  const headersAny = res.headers as any;
  if (typeof headersAny.getSetCookie === 'function') {
    return headersAny.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

describe('Netron auth — cookie token transport (integration)', () => {
  let serverNetron: Netron;
  let port: number;

  async function bootServer(transport: 'cookie' | 'composite' | 'bearer'): Promise<void> {
    port = await findAvailablePort();
    const logger = createMockLogger();
    serverNetron = new Netron(logger, { id: 'cookie-auth-server' });

    const authManager = new AuthenticationManager(logger, {
      authenticate: async (_c: AuthCredentials): Promise<AuthContext> => ({
        userId: 'u1',
        roles: ['user'],
        permissions: [],
      }),
      validateToken: async (token: string): Promise<AuthContext> => ({
        userId: 'u1',
        roles: ['user'],
        permissions: [],
        metadata: { tokenSeen: token },
      }),
    });
    const authzManager = new AuthorizationManager(logger);

    let tokenTransport;
    if (transport === 'cookie') {
      tokenTransport = new CookieTokenTransport({
        accessCookie: { name: 'omni_access', maxAgeSec: 900, secure: false, path: '/' },
        refreshCookie: { name: 'omni_refresh', maxAgeSec: 7 * 24 * 3600, secure: false, path: '/' },
      });
    } else if (transport === 'composite') {
      tokenTransport = new CompositeTokenTransport([
        new CookieTokenTransport({
          accessCookie: { name: 'omni_access', secure: false, path: '/' },
        }),
        new BearerTokenTransport(),
      ]);
    } else {
      tokenTransport = new BearerTokenTransport();
    }
    serverNetron.configureAuth(authManager, authzManager, { tokenTransport });

    serverNetron.registerTransport('http', () => new HttpTransport());
    await serverNetron.registerTransportServer('http', { name: 'http', options: { host: 'localhost', port } });
    await serverNetron.start();
    await serverNetron.peer.exposeService(new CookieAuthService());
  }

  afterEach(async () => {
    await serverNetron?.stop();
  });

  describe('cookie transport', () => {
    beforeEach(async () => {
      await bootServer('cookie');
    });

    it('signin emits Set-Cookie and strips tokens from body', async () => {
      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'alice', password: 'x' });
      expect(res.status).toBe(200);
      const setCookies = parseSetCookies(res);
      expect(setCookies.length).toBe(2);
      expect(setCookies.some((c) => c.startsWith('omni_access=access-alice'))).toBe(true);
      expect(setCookies.some((c) => c.startsWith('omni_refresh=refresh-alice'))).toBe(true);
      expect(setCookies.every((c) => c.includes('HttpOnly'))).toBe(true);
      // SameSite=Strict by default
      expect(setCookies.every((c) => c.includes('SameSite=Strict'))).toBe(true);

      // Body must NOT contain the tokens (cookie mode strip)
      const body = await res.json();
      expect(body.data.user).toBe('alice');
      expect(body.data.accessToken).toBeUndefined();
      expect(body.data.refreshToken).toBeUndefined();
    });

    it('subsequent request authenticates via Cookie header', async () => {
      const signin = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'bob', password: 'x' });
      const setCookies = parseSetCookies(signin);
      const accessCookie = setCookies.find((c) => c.startsWith('omni_access='))!;
      const cookieValue = accessCookie.split(';')[0]!; // 'omni_access=access-bob'

      const protectedRes = await rpcCall(port, 'cookieAuthService@1.0.0', 'ping', null, {
        headers: { Cookie: cookieValue },
      });
      expect(protectedRes.status).toBe(200);
      const body = await protectedRes.json();
      expect(body.data).toBe('pong');
    });

    it('signout emits Max-Age=0 Set-Cookie for both cookies', async () => {
      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'signout', null);
      expect(res.status).toBe(200);
      const setCookies = parseSetCookies(res);
      expect(setCookies.length).toBe(2);
      expect(setCookies.every((c) => c.includes('Max-Age=0'))).toBe(true);
      expect(setCookies.some((c) => c.startsWith('omni_access='))).toBe(true);
      expect(setCookies.some((c) => c.startsWith('omni_refresh='))).toBe(true);
    });

    it('no Set-Cookie emitted by methods that do not issue tokens', async () => {
      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'ping', null);
      expect(res.status).toBe(200);
      expect(parseSetCookies(res)).toEqual([]);
    });
  });

  describe('composite transport (cookie + bearer)', () => {
    beforeEach(async () => {
      await bootServer('composite');
    });

    it('signin emits Set-Cookie AND keeps tokens in body (composite serves both clients)', async () => {
      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'carol', password: 'x' });
      const setCookies = parseSetCookies(res);
      expect(setCookies.length).toBe(1);
      expect(setCookies[0]).toContain('omni_access=access-carol');
      // Composite deliberately does NOT strip body — bearer-header
      // clients still need the tokens in the JSON response.
      const body = await res.json();
      expect(body.data.accessToken).toBe('access-carol');
    });

    it('Cookie header authenticates (cookie delegate wins extract)', async () => {
      const signin = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'dave', password: 'x' });
      const cookieValue = parseSetCookies(signin)[0]!.split(';')[0]!;
      const protectedRes = await rpcCall(port, 'cookieAuthService@1.0.0', 'ping', null, {
        headers: { Cookie: cookieValue },
      });
      expect(protectedRes.status).toBe(200);
    });

    it('Bearer header authenticates (bearer delegate falls through)', async () => {
      const protectedRes = await rpcCall(port, 'cookieAuthService@1.0.0', 'ping', null, {
        headers: { Authorization: 'Bearer some-token' },
      });
      expect(protectedRes.status).toBe(200);
    });
  });

  describe('cookie transport + CSRF', () => {
    let csrf: CsrfManager;

    beforeEach(async () => {
      port = await findAvailablePort();
      const logger = createMockLogger();
      serverNetron = new Netron(logger, { id: 'csrf-server' });

      const authManager = new AuthenticationManager(logger, {
        authenticate: async (_c: AuthCredentials): Promise<AuthContext> => ({ userId: 'u1', roles: ['user'], permissions: [] }),
        validateToken: async (_t: string): Promise<AuthContext> => ({ userId: 'u1', roles: ['user'], permissions: [] }),
      });
      const authzManager = new AuthorizationManager(logger);
      csrf = new CsrfManager({ cookie: { name: 'omni_csrf', maxAgeSec: 900, secure: false } });
      const tokenTransport = new CookieTokenTransport({
        accessCookie: { name: 'omni_access', secure: false, path: '/' },
        csrf,
      });
      serverNetron.configureAuth(authManager, authzManager, { tokenTransport });

      serverNetron.registerTransport('http', () => new HttpTransport());
      await serverNetron.registerTransportServer('http', { name: 'http', options: { host: 'localhost', port } });
      await serverNetron.start();
      await serverNetron.peer.exposeService(new CookieAuthService());

      // Wire CSRF middleware into the HTTP server pipeline. Signin
      // is exempt (no CSRF cookie exists yet at boot).
      const httpServer = serverNetron.transportServers.get('http') as any;
      httpServer.globalPipeline.use(
        createCsrfMiddleware({
          csrf,
          exempt: ['cookieAuthService@1.0.0.signin'],
        }),
        { name: 'csrf', priority: 20 },
        MiddlewareStage.PRE_INVOKE
      );
    });

    it('signin emits omni_access AND omni_csrf cookies', async () => {
      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'f', password: 'x' });
      const cookies = parseSetCookies(res);
      expect(cookies.some((c) => c.startsWith('omni_access='))).toBe(true);
      const csrfCookie = cookies.find((c) => c.startsWith('omni_csrf='));
      expect(csrfCookie).toBeDefined();
      // CSRF cookie MUST be readable by JS (no HttpOnly)
      expect(csrfCookie).not.toContain('HttpOnly');
    });

    it('protected RPC succeeds when X-CSRF-Token matches cookie', async () => {
      const signin = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'f', password: 'x' });
      const setCookies = parseSetCookies(signin);
      const accessKv = setCookies.find((c) => c.startsWith('omni_access='))!.split(';')[0];
      const csrfKv = setCookies.find((c) => c.startsWith('omni_csrf='))!.split(';')[0];
      const csrfToken = csrfKv!.split('=')[1];

      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'ping', null, {
        headers: { Cookie: `${accessKv}; ${csrfKv}`, 'X-CSRF-Token': csrfToken! },
      });
      expect(res.status).toBe(200);
    });

    it('protected RPC fails with 403 when X-CSRF-Token is missing', async () => {
      const signin = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'f', password: 'x' });
      const setCookies = parseSetCookies(signin);
      const accessKv = setCookies.find((c) => c.startsWith('omni_access='))!.split(';')[0];
      const csrfKv = setCookies.find((c) => c.startsWith('omni_csrf='))!.split(';')[0];

      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'ping', null, {
        headers: { Cookie: `${accessKv}; ${csrfKv}` },
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toMatch(/csrf/i);
    });

    it('protected RPC fails with 403 when X-CSRF-Token mismatches cookie', async () => {
      const signin = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'f', password: 'x' });
      const setCookies = parseSetCookies(signin);
      const accessKv = setCookies.find((c) => c.startsWith('omni_access='))!.split(';')[0];
      const csrfKv = setCookies.find((c) => c.startsWith('omni_csrf='))!.split(';')[0];

      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'ping', null, {
        headers: {
          Cookie: `${accessKv}; ${csrfKv}`,
          'X-CSRF-Token': 'wrong-value-that-does-not-match',
        },
      });
      expect(res.status).toBe(403);
    });

    it('exempt method (signin) does not require CSRF — boot path works', async () => {
      // Fresh signin without any CSRF — should succeed despite middleware.
      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'g', password: 'x' });
      expect(res.status).toBe(200);
    });
  });

  describe('bearer transport (default, backwards-compat)', () => {
    beforeEach(async () => {
      await bootServer('bearer');
    });

    it('signin returns tokens in body, no Set-Cookie', async () => {
      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'signin', { username: 'eve', password: 'x' });
      expect(res.status).toBe(200);
      expect(parseSetCookies(res)).toEqual([]);
      const body = await res.json();
      expect(body.data.accessToken).toBe('access-eve');
      expect(body.data.refreshToken).toBe('refresh-eve');
    });

    it('Authorization header authenticates', async () => {
      const protectedRes = await rpcCall(port, 'cookieAuthService@1.0.0', 'ping', null, {
        headers: { Authorization: 'Bearer access-eve' },
      });
      expect(protectedRes.status).toBe(200);
    });

    it('signout is a no-op (no Set-Cookie)', async () => {
      const res = await rpcCall(port, 'cookieAuthService@1.0.0', 'signout', null);
      expect(res.status).toBe(200);
      expect(parseSetCookies(res)).toEqual([]);
    });
  });
});
