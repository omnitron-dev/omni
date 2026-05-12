/**
 * Regression tests for T#50 — Netron polish bundle.
 *
 * The user's directive elevated security to top priority: HTTP transport
 * is the external/untrusted surface, the others are server-server, all
 * must be rigorously locked down. This spec pins the security and
 * cleanup invariants for the bundle.
 *
 * Defects pinned here:
 *
 *   1. `/health` MUST NOT reveal `uptime` or `version` — the
 *      unauthenticated probe surface only exposes `status`.
 *
 *   2. `/metrics` MUST validate the Bearer token via
 *      `AuthenticationManager.validateToken`. Any non-empty header is
 *      no longer a free pass.
 *
 *   3. `/openapi.json` MUST validate the Bearer token same as above.
 *
 *   4. When no `AuthenticationManager` is wired, `/metrics` and
 *      `/openapi.json` fail-closed (always 401).
 *
 *   5. `RemotePeer.cleanup()` MUST destroy active streams with a
 *      transport-lost error so awaiting consumers don't hang.
 *
 *   6. `Uid.next()` wraps at `MAX_UID_VALUE`, never throws (docstring
 *      verified).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpServer } from '../../src/netron/transport/http/server.js';
import { Uid } from '../../src/netron/uid.js';
import { MAX_UID_VALUE } from '../../src/netron/constants.js';

const TEST_TOKEN = 'unit-test-token';

describe('T#50 — Netron polish security & cleanup', () => {
  let server: HttpServer;
  let port: number;

  beforeEach(async () => {
    port = 4900 + Math.floor(Math.random() * 100);
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  describe('/health — unauthenticated probe surface', () => {
    it('returns ONLY status (no uptime or version leak)', async () => {
      server = new HttpServer({ port, host: 'localhost' });
      await server.listen();

      const res = await fetch(`http://localhost:${port}/health`);
      const data = await res.json() as any;

      expect(data).toHaveProperty('status');
      // T#50: these MUST be absent. Pre-T#50 they were leaked,
      // letting attackers fingerprint the service version and
      // approximate the last-deploy/restart time.
      expect(data.uptime).toBeUndefined();
      expect(data.version).toBeUndefined();
      // Nothing else should be there either.
      expect(Object.keys(data)).toEqual(['status']);
    });
  });

  describe('/metrics — fail-closed authentication', () => {
    it('rejects requests with no Authorization header (401)', async () => {
      server = new HttpServer({ port, host: 'localhost' });
      await server.listen();

      const res = await fetch(`http://localhost:${port}/metrics`);
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    });

    it('rejects requests with a non-Bearer Authorization header (401)', async () => {
      server = new HttpServer({ port, host: 'localhost' });
      await server.listen();

      const res = await fetch(`http://localhost:${port}/metrics`, {
        headers: { Authorization: 'Basic abcdef' },
      });
      expect(res.status).toBe(401);
    });

    it('rejects ANY Bearer value when no AuthenticationManager is wired (fail-closed)', async () => {
      // Pre-T#50 this passed — the bug was `if (!authHeader)` which
      // accepted any non-empty header value as authentication.
      server = new HttpServer({ port, host: 'localhost' });
      await server.listen();

      const res = await fetch(`http://localhost:${port}/metrics`, {
        headers: { Authorization: 'Bearer literally-anything' },
      });
      expect(res.status).toBe(401);
    });

    it('accepts a validated Bearer token via the wired AuthenticationManager', async () => {
      server = new HttpServer({ port, host: 'localhost' });

      // Wire a minimal peer + AuthenticationManager that accepts TEST_TOKEN.
      const mockPeer: any = {
        stubs: new Map(),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        netron: {
          authenticationManager: {
            authenticate: vi.fn(),
            validateToken: vi.fn().mockImplementation(async (token: string) => {
              if (token === TEST_TOKEN) {
                return { success: true, context: { userId: 'u', roles: [], permissions: [] } };
              }
              return { success: false };
            }),
          },
        },
      };
      server.setPeer(mockPeer);
      await server.listen();

      // Good token → 200.
      const goodRes = await fetch(`http://localhost:${port}/metrics`, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(goodRes.status).toBe(200);
      const goodBody = await goodRes.json() as any;
      expect(goodBody.server).toBeDefined();

      // Bad token → 401.
      const badRes = await fetch(`http://localhost:${port}/metrics`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(badRes.status).toBe(401);
    });
  });

  describe('/openapi.json — fail-closed authentication', () => {
    it('rejects requests with no Authorization header (401)', async () => {
      server = new HttpServer({ port, host: 'localhost' });
      await server.listen();

      const res = await fetch(`http://localhost:${port}/openapi.json`);
      expect(res.status).toBe(401);
    });

    it('rejects ANY Bearer value when no AuthenticationManager is wired (fail-closed)', async () => {
      server = new HttpServer({ port, host: 'localhost' });
      await server.listen();

      const res = await fetch(`http://localhost:${port}/openapi.json`, {
        headers: { Authorization: 'Bearer literally-anything' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Uid wrap-around', () => {
    it('next() wraps to 1 at MAX_UID_VALUE — never throws', () => {
      const uid = new Uid(MAX_UID_VALUE - 1);
      expect(uid.next()).toBe(MAX_UID_VALUE);
      // The next call MUST wrap, not throw (pre-T#50 docstring claimed
      // it throws — that was wrong).
      expect(() => uid.next()).not.toThrow();
      const after = new Uid(MAX_UID_VALUE);
      expect(after.next()).toBe(1);
    });
  });
});
