/**
 * Regression tests for T#37 — Netron token cache lacked invalidation
 * on session revocation.
 *
 * Until this fix, every successful `validateToken` call cached the
 * resolved AuthResult for the configured TTL (default 5 minutes).
 * When the application revoked the corresponding session — logout,
 * forced sign-out, password rotation, role demotion — the cache had
 * no API surface to drop those entries, so a revoked token would
 * continue to authorize requests for up to a full TTL window.
 *
 * The fix adds three operations:
 *
 *   - `AuthenticationManager.invalidateToken(token)`  — drop one entry
 *   - `AuthenticationManager.invalidateUser(userId)`  — drop all entries
 *     belonging to a user (used after role/permission changes)
 *   - `Netron.revokeToken` / `Netron.revokeUserSessions` — convenience
 *     wrappers exposed on the netron instance so application code
 *     doesn't reach through to the manager directly.
 *
 * These tests exercise the manager directly because the cache itself
 * is what we need to assert behaviour on; the netron facade is just a
 * passthrough.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { createMockLogger } from '../test-utils.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';

const PASS: AuthContext = {
  userId: 'u-1',
  username: 'alice',
  roles: ['user'],
  permissions: [],
};
const PASS_USER2: AuthContext = {
  userId: 'u-2',
  username: 'bob',
  roles: ['user'],
  permissions: [],
};

describe('AuthenticationManager — T#37 token cache invalidation', () => {
  let validateToken: ReturnType<typeof vi.fn>;
  let manager: AuthenticationManager;

  beforeEach(() => {
    validateToken = vi.fn(async (token: string): Promise<AuthContext> => {
      if (token === 'tok-alice') return { ...PASS };
      if (token === 'tok-bob') return { ...PASS_USER2 };
      if (token === 'tok-alice-2') return { ...PASS }; // second alice device
      throw new Error('unknown token');
    });
    manager = new AuthenticationManager(createMockLogger(), {
      authenticate: async () => ({ ...PASS }),
      validateToken,
      tokenCache: { enabled: true, ttl: 60_000, maxSize: 100 },
    });
  });

  it('caches a successful validation so repeated calls do not re-validate', async () => {
    expect(validateToken).not.toHaveBeenCalled();
    const r1 = await manager.validateToken('tok-alice');
    const r2 = await manager.validateToken('tok-alice');
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(validateToken).toHaveBeenCalledTimes(1);
    expect(manager.getCacheStats().hits).toBe(1);
  });

  it('invalidateToken(token) evicts that one entry and forces revalidation', async () => {
    await manager.validateToken('tok-alice');
    await manager.validateToken('tok-bob');
    expect(validateToken).toHaveBeenCalledTimes(2);

    expect(manager.invalidateToken('tok-alice')).toBe(true);

    // bob is still cached
    await manager.validateToken('tok-bob');
    expect(validateToken).toHaveBeenCalledTimes(2);

    // alice now re-validates
    await manager.validateToken('tok-alice');
    expect(validateToken).toHaveBeenCalledTimes(3);
  });

  it('invalidateToken(token) returns false when the token was never cached', () => {
    expect(manager.invalidateToken('never-cached')).toBe(false);
  });

  it('invalidateToken handles malformed input gracefully', () => {
    expect(manager.invalidateToken('')).toBe(false);
    expect(manager.invalidateToken(null as unknown as string)).toBe(false);
    expect(manager.invalidateToken(undefined as unknown as string)).toBe(false);
  });

  it('invalidateUser(userId) evicts EVERY cache entry for that user', async () => {
    // Alice has two cached tokens (e.g. two devices); Bob has one.
    await manager.validateToken('tok-alice');
    await manager.validateToken('tok-alice-2');
    await manager.validateToken('tok-bob');
    expect(validateToken).toHaveBeenCalledTimes(3);

    const removed = manager.invalidateUser('u-1');
    expect(removed).toBe(2);

    // Both alice tokens re-validate; bob remains cached.
    await manager.validateToken('tok-bob');
    expect(validateToken).toHaveBeenCalledTimes(3);
    await manager.validateToken('tok-alice');
    await manager.validateToken('tok-alice-2');
    expect(validateToken).toHaveBeenCalledTimes(5);
  });

  it('invalidateUser returns 0 when no entries match', () => {
    expect(manager.invalidateUser('nonexistent')).toBe(0);
  });

  it('invalidate APIs are safe no-ops when the cache is disabled', () => {
    const noCacheManager = new AuthenticationManager(createMockLogger(), {
      authenticate: async () => ({ ...PASS }),
      validateToken: async () => ({ ...PASS }),
      tokenCache: { enabled: false },
    });
    expect(noCacheManager.invalidateToken('any')).toBe(false);
    expect(noCacheManager.invalidateUser('any')).toBe(0);
    expect(() => noCacheManager.clearCache()).not.toThrow();
  });
});
