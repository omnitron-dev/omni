/**
 * A cache error is a miss, not a denial.
 *
 * The session fast path reads Redis; the canonical store behind it exists for
 * the case where Redis cannot confirm a session. That `get` was unguarded, so
 * a Redis error — `Connection is closed` during a restart, a timeout under
 * load — propagated out of `validateToken` and the caller answered 401
 * «Authentication required».
 *
 * The cost is not the rejection but where it happens: the exception jumps
 * PAST the fallback, so the authoritative source is never consulted at the
 * one moment it is needed. Observed on the daos stand while Redis was
 * flapping — two calls seconds apart with the same valid token, one served
 * and one rejected.
 *
 * The fallback's own policy (fail closed, client refreshes) is a deliberate
 * decision recorded beside it and is left alone. These cases pin the
 * difference between the two: a cache that cannot answer must defer to the
 * authority, and a deployment with no authority must still refuse.
 */

import { describe, it, expect } from 'vitest';
import { createSharedSessionAuthManager } from './shared-session.js';

const SESSION_ID = 'sess-1';
const SESSION_KEY = `omni:session:${SESSION_ID}`;
const USER_ID = 'user-uuid-1';

function mkLogger() {
  const noop = () => {};
  return {
    debug: noop, info: noop, warn: noop, error: noop, trace: noop, fatal: noop,
    child: () => mkLogger(),
  } as never;
}

const mkJwt = (payload: Record<string, unknown>) => ({ verify: async () => payload }) as never;

const claims = { sub: USER_ID, iss: 'omnitron', roles: ['user'], sid: SESSION_ID };

/** Redis that is up and holds the session. */
const liveRedis = {
  get: async (key: string) => (key === SESSION_KEY ? USER_ID : null),
  set: async () => undefined,
};

/** Redis that is down, the way ioredis reports it mid-restart. */
const brokenRedis = {
  get: async () => {
    throw new Error('Connection is closed.');
  },
  set: async () => undefined,
};

const liveLookup = async () => ({
  userId: USER_ID,
  isRevoked: false,
  expiresAt: new Date(Date.now() + 3_600_000),
});

const mk = (opts: Record<string, unknown>) =>
  createSharedSessionAuthManager({
    logger: mkLogger(),
    jwtService: mkJwt(claims),
    ...opts,
  } as never);

describe('a session fast path that cannot answer', () => {
  it('defers to the canonical store instead of rejecting the request', async () => {
    const res = await mk({ sessionRedis: brokenRedis, sessionLookup: liveLookup }).validateToken('t');

    expect(res.success).toBe(true);
    expect(res.context?.userId).toBe(USER_ID);
  });

  it('still refuses when there is no canonical store to defer to', async () => {
    // Nothing to degrade to: the only source of truth is the one that failed,
    // so the request is refused exactly as it was before.
    const res = await mk({ sessionRedis: brokenRedis }).validateToken('t');

    expect(res.success).toBe(false);
  });

  it('still refuses when the canonical store is down as well', async () => {
    // The fallback's own decision — fail closed, the client refreshes — and
    // this must not become fail-open by way of the fast path's catch.
    const res = await mk({
      sessionRedis: brokenRedis,
      sessionLookup: async () => {
        throw new Error('canonical store unreachable');
      },
    }).validateToken('t');

    expect(res.success).toBe(false);
  });

  it('still refuses a session the canonical store says is revoked', async () => {
    const res = await mk({
      sessionRedis: brokenRedis,
      sessionLookup: async () => ({ userId: USER_ID, isRevoked: true, expiresAt: new Date(Date.now() + 3_600_000) }),
    }).validateToken('t');

    expect(res.success).toBe(false);
  });

  it('serves from the fast path when Redis is healthy, without consulting the store', async () => {
    let consulted = false;
    const res = await mk({
      sessionRedis: liveRedis,
      sessionLookup: async () => {
        consulted = true;
        return { userId: USER_ID, isRevoked: false, expiresAt: new Date(Date.now() + 3_600_000) };
      },
    }).validateToken('t');

    expect(res.success).toBe(true);
    expect(consulted, 'a healthy cache must not add a round trip to the store').toBe(false);
  });
});
