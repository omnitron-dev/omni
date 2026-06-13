/**
 * NT-2: the InAppChannel was auto-registered in the module as `new InAppChannel()`
 * with no argument. Its `@Optional() @Inject(REDIS_CLIENT)` constructor param
 * only resolves when the DI container instantiates the class — a manual `new`
 * leaves `this.redis` undefined, so in-app delivery was permanently inert. The
 * module now passes a resolved Redis client (managed titan-redis client or the
 * explicit `options.redis`) to the constructor.
 *
 * This guards the channel-level contract the module fix relies on: a client
 * passed via the constructor makes the channel functional; none leaves it inert.
 */

import { describe, it, expect } from 'vitest';
import { InAppChannel } from '../src/channel/channels/inapp.channel.js';
import type { IRedisClient } from '@omnitron-dev/titan-redis';

const fakeRedis = (): IRedisClient =>
  ({
    ping: async () => 'PONG',
  }) as unknown as IRedisClient;

describe('InAppChannel redis wiring (NT-2)', () => {
  it('is inert (unavailable) when constructed with no client — the old module bug', async () => {
    const channel = new InAppChannel();
    expect(await channel.isAvailable()).toBe(false);
  });

  it('is functional when a redis client is passed to the constructor — the fix', async () => {
    const channel = new InAppChannel(fakeRedis());
    expect(await channel.isAvailable()).toBe(true);
  });

  it('reports an unavailable client (ping rejects) as not available', async () => {
    const brokenRedis = {
      ping: async () => {
        throw new Error('connection refused');
      },
    } as unknown as IRedisClient;
    const channel = new InAppChannel(brokenRedis);
    expect(await channel.isAvailable()).toBe(false);
  });
});
