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

import { describe, it, expect, afterEach } from 'vitest';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { Netron } from '../../../../src/netron/netron.js';
import { Public, Service } from '../../../../src/decorators/core.js';
import { AuthenticationManager } from '../../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../../src/netron/auth/authorization-manager.js';
import { createMockLogger } from '../../test-utils.js';
import { z } from 'zod';
import { MiddlewareStage } from '../../../../src/netron/transport/http/middleware/types.js';
import { TitanError } from '../../../../src/errors/core.js';
import { ErrorCode } from '../../../../src/errors/codes.js';
import type { HttpRequestMessage } from '../../../../src/netron/transport/http/types.js';

@Service({ name: 'Vault', version: '1.0.0', contract: { ping: { input: z.any(), output: z.any() } } })
class Vault { @Public({ auth: false }) ping() { return { ok: true }; } }

describe('HTTP fast-path — T#35 authz bypass', () => {
  let server: HttpServer;
  let netron: Netron;

  async function setupServer(opts: { withNetronAuth?: boolean; withPreInvokeMiddleware?: boolean } = {}) {
    server = new HttpServer({ port: 0, host: '127.0.0.1' });
    const logger = createMockLogger();
    netron = new Netron(logger);
    if (opts.withNetronAuth) {
      netron.configureAuth(new AuthenticationManager(logger, {
        authenticate: () => ({ userId: 'fixture', roles: [], permissions: [] }),
      }), new AuthorizationManager(logger));
    }
    await netron.peer.exposeService(new Vault());
    server.setPeer(netron.peer);

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
    };
    const r = await fetch(`http://127.0.0.1:${server.port}/netron/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return { status: r.status, body: await r.json() };
  }

  afterEach(async () => {
    if (server) await server.close();
    if (netron) await netron.stop();
  });

  it('allows a declared public method when no auth manager or custom middleware exists', async () => {
    await setupServer({ withNetronAuth: false, withPreInvokeMiddleware: false });
    await server.listen();
    const r = await invokePing();
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toEqual({ ok: true });
  });

  it('skips fast-path when the netron has an authorization manager (even for anon requests)', async () => {
    await setupServer({ withNetronAuth: true, withPreInvokeMiddleware: true });
    await server.listen();
    const r = await invokePing();
    // Slow path ran → our blocker middleware fired → 403.
    expect(r.status).toBe(403);
    expect(r.body.success).toBe(false);
    expect(r.body.error?.message).toMatch(/pipeline-must-run/);
  });

  it('skips fast-path when PRE_INVOKE middleware is registered without an auth manager', async () => {
    await setupServer({ withNetronAuth: false, withPreInvokeMiddleware: true });
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
    await setupServer({ withNetronAuth: false, withPreInvokeMiddleware: true });
    await server.listen();
    const r = await invokePing();
    expect(r.status).toBe(403);
  });
});
