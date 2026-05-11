/**
 * Regression tests for T#35 — HTTP fast-path bypassing the middleware
 * pipeline (and `NetronAuthMiddleware`) entirely.
 *
 * Background
 * ----------
 * The original fast-path predicate was:
 *
 *     const hasAuth = request.headers.has('Authorization');
 *     const hasOrigin = request.headers.has('Origin');
 *     const needsCors = this.options.cors && hasOrigin;
 *     const hasCustomMiddleware =
 *       this.globalPipeline.getMetrics().executions > 0;
 *     if (!hasAuth && !needsCors && !hasCustomMiddleware) { fast-path }
 *
 * All three signals fail open in attacker-favoring ways:
 *
 *   - `executions > 0` is a lagging counter; the very first request a
 *     server sees always took the fast path (executions === 0 → bypass),
 *     and so long as every subsequent request also took the fast path,
 *     the counter never moved and the slow path remained unreachable.
 *   - Trusting "no Authorization header" as proof of "no auth required"
 *     inverts the threat model — anonymous callers (the exact case
 *     authn middleware exists to reject) skip every middleware.
 *
 * These tests verify the new predicate: when the netron has any auth
 * manager wired, or any PRE_INVOKE / POST_INVOKE middleware is
 * registered, the fast path is never taken. The slow path runs the
 * pipeline and our test middleware throws — proving the pipeline was
 * reached.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import { contract } from '../../../../src/validation/contract.js';
import { z } from 'zod';
import { MiddlewareStage } from '../../../../src/netron/transport/http/middleware/types.js';
import { TitanError } from '../../../../src/errors/core.js';
import { ErrorCode } from '../../../../src/errors/codes.js';
import type { HttpRequestMessage } from '../../../../src/netron/transport/http/types.js';

describe('HTTP fast-path — T#35 authz bypass', () => {
  let server: HttpServer;
  let mockPeer: LocalPeer;
  let baseUrl: string;
  let testPort: number;

  function setupServer(opts: { withNetronAuth?: boolean; withPreInvokeMiddleware?: boolean } = {}) {
    testPort = 3500 + Math.floor(Math.random() * 1500);
    baseUrl = `http://localhost:${testPort}`;
    server = new HttpServer({ port: testPort, host: 'localhost' });

    const fakeNetron: any = {};
    if (opts.withNetronAuth) {
      fakeNetron.authenticationManager = { validateToken: vi.fn() };
      fakeNetron.authorizationManager = { canAccessService: () => true, canAccessMethod: () => true, filterDefinition: (_n: string, m: any) => m };
    }

    mockPeer = {
      stubs: new Map(),
      netron: fakeNetron,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as any;

    const c = contract({
      ping: { input: z.any(), output: z.any() },
    });
    const def = new Definition('svc-id', 'peer-id', {
      name: 'Vault',
      version: '1.0.0',
      description: 'Vault',
      contract: c,
      methods: { ping: { description: 'ping' } },
      properties: {},
    });
    const stub: any = {
      definition: def,
      call: vi.fn(async () => ({ ok: true })),
    };
    mockPeer.stubs.set('svc-id', stub);

    server.setPeer(mockPeer);

    if (opts.withPreInvokeMiddleware) {
      // A blocker middleware that proves the pipeline ran. If the
      // fast path is taken we never see this error — the request
      // succeeds and the test fails.
      (server as any).globalPipeline.use(
        async () => {
          throw new TitanError({
            code: ErrorCode.FORBIDDEN,
            message: 'pipeline-must-run',
          });
        },
        { name: 'blocker', priority: 5 },
        MiddlewareStage.PRE_INVOKE,
      );
    }
  }

  async function invokePing(): Promise<{ status: number; body: any }> {
    const req: HttpRequestMessage = {
      id: 'r1',
      service: 'Vault@1.0.0',
      method: 'ping',
      input: {},
      timestamp: Date.now(),
    };
    const r = await fetch(`${baseUrl}/netron/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return { status: r.status, body: await r.json() };
  }

  afterEach(async () => {
    if (server) await server.close();
  });

  it('takes fast-path when no auth manager and no PRE_INVOKE middleware exist', async () => {
    setupServer({ withNetronAuth: false, withPreInvokeMiddleware: false });
    await server.listen();
    const r = await invokePing();
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toEqual({ ok: true });
  });

  it('skips fast-path when the netron has an authorization manager (even for anon requests)', async () => {
    setupServer({ withNetronAuth: true, withPreInvokeMiddleware: true });
    await server.listen();
    const r = await invokePing();
    // Slow path ran → our blocker middleware fired → 403.
    expect(r.status).toBe(403);
    expect(r.body.success).toBe(false);
    expect(r.body.error?.message).toMatch(/pipeline-must-run/);
  });

  it('skips fast-path when PRE_INVOKE middleware is registered without an auth manager', async () => {
    setupServer({ withNetronAuth: false, withPreInvokeMiddleware: true });
    await server.listen();
    const r = await invokePing();
    expect(r.status).toBe(403);
    expect(r.body.error?.message).toMatch(/pipeline-must-run/);
  });

  it('skips fast-path on the FIRST request when middleware is present (lagging-counter bug)', async () => {
    // Pre-T#35 the predicate relied on `getMetrics().executions > 0`,
    // so the very first request to a fresh server bypassed even
    // explicitly-registered middleware. We register PRE_INVOKE
    // middleware and verify request #1 already sees it.
    setupServer({ withNetronAuth: false, withPreInvokeMiddleware: true });
    await server.listen();
    const r = await invokePing();
    expect(r.status).toBe(403);
  });
});
