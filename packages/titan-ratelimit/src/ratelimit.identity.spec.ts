/**
 * A rate limit answers "how often may THIS CALLER do this". The caller was not
 * in the key.
 *
 * `@RateLimit`'s documented default identifier is `String(args[0])` — the
 * method's first ARGUMENT. On an RPC surface that is wrong in both directions,
 * and both were measured on a live daos stand before this was fixed:
 *
 *   - A first argument that does not vary — `undefined`, or an options object
 *     that stringifies to `[object Object]` — puts EVERY caller in one bucket.
 *     A declared 30/min is then 30/min for the whole platform: one account
 *     made 29 calls and a different user, who had spent nothing, was refused.
 *     On a platform whose whole point is that banning accounts is hard, that
 *     is a denial-of-service lever costing one signed-in account.
 *   - A first argument that DOES vary — an id from the request — gives each
 *     value its own bucket, so rotating it is unbounded: 200 calls with a
 *     fresh uuid each and no limit, against a refusal at 121 for the same
 *     uuid repeated.
 *
 * Hosts publish an identity resolver once at boot and every `@RateLimit` in
 * the process keys on the caller. daos had 325 call sites and not one supplied
 * a `keyGenerator`, so one line fixes all of them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RateLimit,
  setAmbientRateLimitService,
  setRateLimitIdentityResolver,
} from './ratelimit.decorators.js';
import type { IRateLimitService } from './ratelimit.types.js';

/** Records the key every check was made against, and always allows. */
function recordingService() {
  const keys: string[] = [];
  const svc = {
    // `enforce` is what the decorator calls; the other two are here so the
    // double is a plausible service rather than a hole shaped like one.
    enforce: async (key: string) => {
      keys.push(key);
    },
    check: async (o: { key: string }) => {
      keys.push(o.key);
      return { allowed: true, remaining: 1, limit: 1, resetAt: 0 };
    },
    consume: async (key: string) => {
      keys.push(key);
      return { allowed: true, remaining: 1, limit: 1, resetAt: 0 };
    },
  } as unknown as IRateLimitService;
  return { svc, keys };
}

class Rooms {
  @RateLimit({ limit: 30, windowMs: 60_000 })
  async getMyRoomsBundle(_options?: { limit?: number }): Promise<string> {
    return 'ok';
  }

  @RateLimit({ limit: 100, windowMs: 60_000 })
  async getRoom(roomId: string): Promise<string> {
    return roomId;
  }

  @RateLimit({ limit: 5, windowMs: 60_000, keyGenerator: (...a: unknown[]) => `custom:${String(a[0])}` })
  async explicit(x: string): Promise<string> {
    return x;
  }
}

let recorded: ReturnType<typeof recordingService>;

beforeEach(() => {
  recorded = recordingService();
  setAmbientRateLimitService(recorded.svc);
});

afterEach(() => {
  setAmbientRateLimitService(undefined);
  setRateLimitIdentityResolver(undefined);
});

describe('with no identity resolver (the historical default)', () => {
  it('keys on the first argument, so callers share a bucket when it does not vary', async () => {
    const rooms = new Rooms();
    await rooms.getMyRoomsBundle();
    await rooms.getMyRoomsBundle({ limit: 10 });

    // Nothing here distinguishes one caller from another.
    expect(recorded.keys.every((k) => !k.includes('user-'))).toBe(true);
  });
});

describe('with an identity resolver', () => {
  it('keys on the caller, so two users get two buckets', async () => {
    const rooms = new Rooms();
    let who = 'user-a';
    setRateLimitIdentityResolver(() => who);

    await rooms.getMyRoomsBundle();
    who = 'user-b';
    await rooms.getMyRoomsBundle();

    expect(recorded.keys).toEqual(['Rooms:getMyRoomsBundle:user-a', 'Rooms:getMyRoomsBundle:user-b']);
  });

  it('keys the same caller identically however the argument varies', async () => {
    const rooms = new Rooms();
    setRateLimitIdentityResolver(() => 'user-a');

    await rooms.getRoom('room-1');
    await rooms.getRoom('room-2');
    await rooms.getRoom('room-3');

    // The evasion: three different arguments used to be three buckets.
    expect(new Set(recorded.keys).size, 'one caller, one bucket').toBe(1);
    expect(recorded.keys[0]).toBe('Rooms:getRoom:user-a');
  });

  it('still lets an explicit keyGenerator win', async () => {
    const rooms = new Rooms();
    setRateLimitIdentityResolver(() => 'user-a');

    await rooms.explicit('thing');

    // The call site knows best; the resolver must not override it.
    expect(recorded.keys[0]).toBe('Rooms:explicit:custom:thing');
  });

  it('falls back to one shared anon bucket when the caller is unknown', async () => {
    const rooms = new Rooms();
    setRateLimitIdentityResolver(() => undefined);

    await rooms.getMyRoomsBundle();

    // Honest: with nothing to distinguish anonymous callers by, they share.
    // A decision, not an accident.
    expect(recorded.keys[0]).toBe('Rooms:getMyRoomsBundle:anon');
  });

  it('does not let a throwing resolver fail the request', async () => {
    const rooms = new Rooms();
    setRateLimitIdentityResolver(() => {
      throw new Error('no ALS frame');
    });

    await expect(rooms.getMyRoomsBundle()).resolves.toBe('ok');
    expect(recorded.keys[0]).toBe('Rooms:getMyRoomsBundle:anon');
  });
});

describe('the declared limit is also recorded', () => {
  it('writes the same reflect key titan\'s declarative decorator uses', () => {
    // The enforcing decorator wrapped the descriptor and wrote nothing, so
    // `readMethodMetadata()` reported no rate limit for a method that plainly
    // had one — invisible to an OpenAPI dump, a dashboard, or a middleware
    // asking "did this method declare its own bound?".
    const declared = Reflect.getMetadata('method:rateLimit', Rooms.prototype, 'getMyRoomsBundle');

    expect(declared).toEqual({ limit: 30, windowMs: 60_000 });
  });

  it('records nothing for a method that declares nothing', () => {
    class Plain {
      async open(): Promise<void> {}
    }
    expect(Reflect.getMetadata('method:rateLimit', Plain.prototype, 'open')).toBeUndefined();
  });

  it('keys on the literal titan uses, so the two cannot drift apart', async () => {
    // If titan renames METADATA_KEYS.METHOD_RATE_LIMIT, this fails here rather
    // than silently making every declared limit invisible again.
    const { METADATA_KEYS } = await import('@omnitron-dev/titan/decorators');
    expect(METADATA_KEYS.METHOD_RATE_LIMIT).toBe('method:rateLimit');
  });
});
