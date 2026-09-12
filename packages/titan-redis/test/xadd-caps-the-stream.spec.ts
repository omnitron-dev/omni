/**
 * A stream producer that never caps is writing to unbounded memory.
 *
 * `RedisService.xadd` had no trimming parameter, so every caller appended
 * forever. Measured on a running deployment: six exchange tick streams holding
 * **3.95 GB** of Redis, the largest 41.2 million entries spanning 73 days —
 * the entire life of the deployment — and every one of them already aggregated
 * into 5-minute candles and never read again.
 *
 * Capping at the point of the write is the only place it cannot be forgotten:
 * a separate janitor is one more thing to schedule, and the thing it would be
 * cleaning up grows at the producer's rate whether the janitor runs or not.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { RedisService } from '../src/redis.service.js';

function serviceWith(): { service: RedisService; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const client = {
    xadd: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve('1-0');
    },
  };
  const manager = { getClient: () => client } as never;
  return { service: new RedisService(manager), calls };
}

describe('RedisService.xadd', () => {
  let ctx: ReturnType<typeof serviceWith>;
  beforeEach(() => {
    ctx = serviceWith();
  });

  it('appends without trimming when no cap is asked for', async () => {
    // The existing contract: three positional args then the flattened fields.
    await ctx.service.xadd('s', '*', { a: '1', b: '2' });
    expect(ctx.calls[0]).toEqual(['s', '*', 'a', '1', 'b', '2']);
  });

  it('puts MINID before the id, where Redis expects it', async () => {
    await ctx.service.xadd('s', '*', { a: '1' }, undefined, {
      strategy: 'MINID',
      threshold: '1700000000000-0',
    });
    expect(ctx.calls[0]).toEqual(['s', 'MINID', '~', '1700000000000-0', '*', 'a', '1']);
  });

  it('supports MAXLEN for count-bounded streams', async () => {
    await ctx.service.xadd('s', '*', { a: '1' }, undefined, { strategy: 'MAXLEN', threshold: 1000 });
    expect(ctx.calls[0]).toEqual(['s', 'MAXLEN', '~', '1000', '*', 'a', '1']);
  });

  it('is approximate unless exactness is asked for', async () => {
    // `~` is the point: an exact trim rewrites a radix node per write, which
    // on a hot stream costs more than the memory it saves.
    await ctx.service.xadd('s', '*', { a: '1' }, undefined, { strategy: 'MAXLEN', threshold: 5 });
    expect(ctx.calls[0]![1]).toBe('MAXLEN');
    expect(ctx.calls[0]![2]).toBe('~');

    await ctx.service.xadd('s', '*', { a: '1' }, undefined, {
      strategy: 'MAXLEN',
      threshold: 5,
      exact: true,
    });
    expect(ctx.calls[1]![2]).toBe('=');
  });
});
