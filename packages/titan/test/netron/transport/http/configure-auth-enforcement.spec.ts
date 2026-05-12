/**
 * Regression test for T#100 — HTTP transport must enforce
 * `@Public({ auth: { ... } })` decorations when authentication is
 * wired via `Netron.configureAuth(...)` instead of being passed as
 * HTTP transport options.
 *
 * Background
 * ----------
 * Before the fix, `HttpServer.setPeer()` only registered
 * `NetronAuthMiddleware` when BOTH `policyEngine` and
 * `authorizationManager` were supplied via the HttpServer constructor
 * options. Platforms following the documented public API —
 *
 *     app.netron.configureAuth(authnManager, authzManager?);
 *
 * — got no authz middleware on the HTTP transport. Every method
 * decorated with `@Public({ auth: { roles: [...] } })` was effectively
 * `allowAnonymous`: the request went through `createHttpAuthMiddleware`
 * (which extracts and validates the Bearer token, populating
 * `ctx.metadata.authContext` on success), but no downstream middleware
 * read the method's @Public metadata to gate access.
 *
 * The fix in `HttpServer.setPeer()`:
 *   - Resolves `policyEngine`/`authorizationManager` from constructor
 *     options first, then falls through to `peer.netron.*`.
 *   - Auto-instantiates an `AuthorizationManager` when only an
 *     authentication manager is configured (mirrors how the WebSocket
 *     transport handles the same case in `netron.ts:581-591`).
 *   - Makes `policyEngine` optional in `NetronAuthMiddleware` so the
 *     middleware registers even on platforms that don't use policies.
 *     Methods that declare `policies` without an engine wired fail
 *     closed inside the middleware.
 *
 * What we assert
 * --------------
 * 1. Anonymous HTTP POST to a method decorated `@Public({ auth: { roles: [...] } })`
 *    is rejected (401), proving the middleware is registered and runs.
 * 2. A method decorated `@Public({ auth: { allowAnonymous: true } })`
 *    succeeds without a token, proving the middleware isn't a blanket
 *    block.
 * 3. A method with no `@Public` decoration is reachable (no metadata
 *    to enforce — the middleware is a no-op for those).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import { contract } from '../../../../src/validation/contract.js';
import { z } from 'zod';
import { AuthorizationManager } from '../../../../src/netron/auth/authorization-manager.js';
import { METADATA_KEYS } from '../../../../src/decorators/core.js';
import { createMockLogger } from '../../test-utils.js';
import type { HttpRequestMessage } from '../../../../src/netron/transport/http/types.js';

describe('HTTP — T#100: configureAuth wires NetronAuthMiddleware', () => {
  let server: HttpServer;
  let mockPeer: LocalPeer;
  let baseUrl: string;
  let testPort: number;

  /**
   * Wire up a service stub whose `@Public` metadata is set directly on
   * the method via Reflect — bypasses the decorator machinery so the
   * test stays isolated from decorator-runtime concerns. The middleware
   * reads via `Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, proto, name)`.
   */
  function makeService() {
    const instance = {
      restricted: vi.fn(async () => ({ ok: 'restricted-ran' })),
      anon: vi.fn(async () => ({ ok: 'anon-ran' })),
      undecorated: vi.fn(async () => ({ ok: 'undecorated-ran' })),
    };
    const proto = Object.getPrototypeOf(instance);
    Reflect.defineMetadata(
      METADATA_KEYS.METHOD_AUTH,
      { roles: ['admin'] },
      proto,
      'restricted',
    );
    Reflect.defineMetadata(
      METADATA_KEYS.METHOD_AUTH,
      { allowAnonymous: true },
      proto,
      'anon',
    );
    // `undecorated` has no METHOD_AUTH metadata at all.
    return instance;
  }

  function setupServer(opts: {
    configureAuthOnNetron?: boolean;
    optionsAuthorizationManager?: boolean;
  } = {}) {
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    const basePort = 18000 + (workerId - 1) * 500;
    testPort = basePort + Math.floor(Math.random() * 450);
    baseUrl = `http://localhost:${testPort}`;

    const constructorOptions: any = { port: testPort, host: 'localhost' };
    if (opts.optionsAuthorizationManager) {
      constructorOptions.authorizationManager = new AuthorizationManager(
        createMockLogger() as any,
      );
    }
    server = new HttpServer(constructorOptions);

    const logger = createMockLogger();
    const fakeNetron: any = { id: 'test-netron' };
    if (opts.configureAuthOnNetron) {
      fakeNetron.authenticationManager = { validateToken: vi.fn() };
      // Intentionally NO authorizationManager — the fix must
      // auto-instantiate one. Setting both would test a different path.
    }

    const serviceInstance = makeService();
    const c = contract({
      restricted: { input: z.any(), output: z.any() },
      anon: { input: z.any(), output: z.any() },
      undecorated: { input: z.any(), output: z.any() },
    });
    const def = new Definition('svc-id', 'peer-id', {
      name: 'Vault',
      version: '1.0.0',
      description: 'Vault',
      contract: c,
      methods: {
        restricted: { description: 'admin-only' },
        anon: { description: 'public' },
        undecorated: { description: 'no metadata' },
      },
      properties: {},
    });
    const stub: any = {
      definition: def,
      instance: serviceInstance,
      call: vi.fn(async (method: string) => {
        return (serviceInstance as any)[method]();
      }),
    };

    mockPeer = {
      stubs: new Map([['svc-id', stub]]),
      netron: fakeNetron,
      logger,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as any;

    server.setPeer(mockPeer);
  }

  async function invoke(
    method: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: any }> {
    const req: HttpRequestMessage = {
      id: `r-${method}`,
      service: 'Vault@1.0.0',
      method,
      input: {},
      timestamp: Date.now(),
    };
    const r = await fetch(`${baseUrl}/netron/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(req),
    });
    return { status: r.status, body: await r.json() };
  }

  afterEach(async () => {
    if (server) await server.close();
  });

  it('rejects anonymous call to @Public({ auth: { roles: [...] } }) when auth is wired via configureAuth (no constructor options)', async () => {
    setupServer({ configureAuthOnNetron: true });
    await server.listen();
    const r = await invoke('restricted');
    // Middleware ran → method-level auth required, no authContext → 401.
    expect(r.status).toBe(401);
    expect(r.body.success).toBe(false);
    expect(r.body.error?.message).toMatch(/Authentication required/i);
  });

  it('still allows anonymous call to @Public({ allowAnonymous: true }) under the same wiring', async () => {
    setupServer({ configureAuthOnNetron: true });
    await server.listen();
    const r = await invoke('anon');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toEqual({ ok: 'anon-ran' });
  });

  it('still allows methods with NO @Public metadata (middleware is a no-op for those)', async () => {
    setupServer({ configureAuthOnNetron: true });
    await server.listen();
    const r = await invoke('undecorated');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toEqual({ ok: 'undecorated-ran' });
  });

  it('also enforces when authorizationManager is supplied via constructor options instead', async () => {
    // Power-user path: pass the manager via HTTP options. Must still
    // produce the same enforcement so the two wiring paths converge.
    setupServer({ optionsAuthorizationManager: true });
    await server.listen();
    const r = await invoke('restricted');
    expect(r.status).toBe(401);
    expect(r.body.error?.message).toMatch(/Authentication required/i);
  });

  it('leaves all methods open when NO auth is configured at all (no managers in options OR on netron)', async () => {
    // Regression guard: the fix must not register the middleware on
    // platforms that haven't configured auth — otherwise it would
    // break tests/apps that intentionally run without auth.
    setupServer({});
    await server.listen();
    const r = await invoke('restricted');
    // No middleware registered → reaches the handler → succeeds.
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toEqual({ ok: 'restricted-ran' });
  });
});
