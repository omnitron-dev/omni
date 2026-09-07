/**
 * Whether a Redis client is allowed to give up for good.
 *
 * ioredis stops reconnecting permanently the moment `retryStrategy` returns
 * anything that is not a number — its `event_handler` calls `close()` and the
 * client's status becomes 'end'. Every command after that rejects with
 * "Connection is closed.", forever, with no further reconnection attempt.
 *
 * RedisManager installed `createRetryStrategy()` with no arguments as the
 * default for every client it creates. That defaults to `retries: 10` and
 * returns `null` on the eleventh attempt. The ten delays are
 * 100·2^(n-1) capped at 10s — 100, 200, 400, 800, 1600, 3200, 6400, 10000,
 * 10000, 10000 — so roughly 43 seconds.
 *
 * A Redis outage longer than that killed every client in the process
 * permanently. Nothing recreated them: the manager's 'end' handler logs at
 * DEBUG and does nothing else, so at any normal log level the death was
 * invisible too.
 *
 * Observed consequence, not hypothesis. Two episodes on the daos dev stack,
 * 15-16 July and again today, 16,612 "Connection is closed." in priceverse's
 * error log alone — thrown out of `calculateVwap` on every cycle — while the
 * Redis server itself answers PING.
 *
 * The shape is what identifies the mechanism. Between the episodes the logs are
 * nearly silent, because a killed client burns only until its process is next
 * restarted; the July processes were restarted at some point and went quiet,
 * and today's have not been. Today's outage is visible to the hour in the
 * daemon's log table: 6 errors in the 02:00Z hour, 1367 in the 05:00Z hour when
 * Redis went away, and ~6100/hour continuing after the container came back at
 * 07:32:34Z — because by then the clients were already past giving up, and
 * nothing brings them back.
 *
 * These assert on the strategy the manager actually installs, reached through
 * the client it actually creates. `lazyConnect` keeps them offline; the
 * question is the policy, not the traffic.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { RedisManager } from '../src/redis.manager.js';

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child() {
    return this;
  },
};

type Strategy = (times: number) => unknown;

describe('reconnect policy', () => {
  let manager: RedisManager | undefined;

  afterEach(async () => {
    await manager?.destroy?.().catch?.(() => {});
    manager = undefined;
  });

  async function strategyOfManagedClient(): Promise<Strategy> {
    manager = new RedisManager(
      {
        clients: [{ namespace: 'default', host: '127.0.0.1', port: 6399, lazyConnect: true }],
      } as never,
      silent as never
    );
    await manager.init();

    const client = manager.getClient('default') as unknown as {
      options: { retryStrategy?: Strategy };
    };
    const strategy = client.options.retryStrategy;
    expect(strategy, 'the manager installed no retry strategy at all').toBeTypeOf('function');
    return strategy!;
  }

  it('never tells ioredis to stop reconnecting', async () => {
    const strategy = await strategyOfManagedClient();

    // A long outage is the ordinary case this must survive: a Redis restart, a
    // container recreate, a host that swapped. Each of these is a number of
    // milliseconds to wait, and anything else means "never reconnect".
    for (const attempt of [1, 5, 10, 11, 50, 1_000, 100_000]) {
      expect(
        strategy(attempt),
        `attempt ${attempt} returned a non-number, which makes ioredis close the client for good`
      ).toBeTypeOf('number');
    }
  });

  it('says so out loud when a caller-supplied strategy does give up', async () => {
    // Bounding the retries stays possible — a short-lived caller may want it.
    // What is not acceptable is that the client becomes permanently unusable
    // without anything saying why, which is how 53 days of
    // "Connection is closed." went unexplained.
    const errors: Array<[unknown, string]> = [];
    const recording = { ...silent, error: (ctx: unknown, msg: string) => errors.push([ctx, msg]) };
    recording.child = () => recording as never;

    manager = new RedisManager(
      {
        clients: [
          {
            namespace: 'default',
            host: '127.0.0.1',
            port: 6399,
            lazyConnect: true,
            retryStrategy: (times: number) => (times > 2 ? null : 10),
          },
        ],
      } as never,
      recording as never
    );
    await manager.init();

    const client = manager.getClient('default') as unknown as {
      options: { retryStrategy?: Strategy };
    };
    const strategy = client.options.retryStrategy!;

    expect(strategy(1), "a caller's own bound was not honoured").toBe(10);
    expect(errors, 'an ordinary retry logged an error').toHaveLength(0);

    expect(strategy(3), "the caller's decision to give up was overridden").toBeNull();
    expect(errors, 'the client became permanently unusable in silence').toHaveLength(1);
    expect(errors[0]![1]).toMatch(/stopped reconnecting|Connection is closed/);
  });

  it('waits longer between attempts but stops growing', async () => {
    const strategy = await strategyOfManagedClient();

    // Retrying forever must not mean hammering forever.
    expect(strategy(1) as number).toBeLessThan(strategy(4) as number);
    for (const attempt of [20, 500, 100_000]) {
      const delay = strategy(attempt) as number;
      expect(delay, `attempt ${attempt} waited ${delay}ms`).toBeLessThanOrEqual(30_000);
      expect(delay).toBeGreaterThan(0);
    }
  });
});
