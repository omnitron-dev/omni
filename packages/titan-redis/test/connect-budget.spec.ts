/**
 * How long a Redis client gets to become ready at startup, and what happens
 * when it never does.
 *
 * Two faults, both on the path that decides whether an APPLICATION BOOTS.
 *
 * The budget was read from `healthCheck.timeout` and nowhere else, so
 * tightening a liveness probe silently shortened boot, while `connectTimeout`
 * — the option whose name says exactly this — reached ioredis and had no say
 * in the wait. The default of 5 s was also too short for a cold start: every
 * restart of a six-backend stack cost at least one failed start where Redis
 * was up and not yet answering, hidden by the supervisor's retry until boot
 * logs became readable at all.
 *
 * And the budget did not bind. `await client.connect()` ran UNBOUNDED before
 * the timed wait below it, so against a server that accepts the TCP connection
 * and never completes the handshake — a container that is up but not serving,
 * a port forwarded to nothing, a TLS mismatch — ioredis retried forever and
 * that promise never settled. The timeout never got a chance to run. An
 * application that hangs during boot is the hardest failure here to diagnose;
 * it must at least fail.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';

import { RedisManager } from '../src/redis.manager.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

const silentLogger = (): ILogger => {
  const noop = () => {};
  const logger: Record<string, unknown> = {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  };
  logger['child'] = () => logger;
  return logger as unknown as ILogger;
};

/**
 * A client that never becomes ready.
 *
 * `status: 'wait'` on purpose: `isClientConnecting` treats 'connecting' as
 * already in flight and skips `connect()` entirely, which is the one call that
 * used to run unbounded. A fake that starts 'connecting' exercises the timed
 * wait and never touches the fault.
 */
const neverReadyClient = () => {
  const client = new EventEmitter() as EventEmitter & Record<string, unknown>;
  client['status'] = 'wait';
  client['options'] = { lazyConnect: false };
  client['connect'] = () => new Promise(() => {});
  client['disconnect'] = () => {
    client['status'] = 'end';
  };
  return client;
};

const manager = (options: Record<string, unknown>) =>
  new RedisManager(options as never, silentLogger()) as unknown as {
    connectClient(client: unknown, namespace: string, options: unknown): Promise<void>;
  };

describe('startup connect budget', () => {
  it('fails rather than hanging when the client never becomes ready', async () => {
    const client = neverReadyClient();
    const started = Date.now();

    await expect(
      manager({}).connectClient(client, 'default', { lazyConnect: false, connectTimeout: 200 })
    ).rejects.toThrow(/timed out/);

    const elapsed = Date.now() - started;
    expect(elapsed, `waited ${elapsed}ms — the unbounded connect() is back`).toBeLessThan(2000);
  });

  it('takes its budget from connectTimeout', async () => {
    const client = neverReadyClient();
    const started = Date.now();

    await expect(
      manager({ healthCheck: { timeout: 30_000 } }).connectClient(client, 'default', {
        lazyConnect: false,
        connectTimeout: 200,
      })
    ).rejects.toThrow(/timed out/);

    // healthCheck.timeout is 30s here; only connectTimeout can end this fast.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('still honours healthCheck.timeout when nothing else is set', async () => {
    // Back-compat: the coupling was undocumented but real, and someone may
    // have raised it precisely to survive a slow start.
    const client = neverReadyClient();
    const started = Date.now();

    await expect(
      manager({ healthCheck: { timeout: 200 } }).connectClient(client, 'default', { lazyConnect: false })
    ).rejects.toThrow(/timed out/);

    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('disconnects the client it failed to connect', async () => {
    // `createClient` registers the client before connecting and rethrows on
    // failure; without this an ioredis instance goes on reconnecting for the
    // life of the process, against the host that just failed to answer.
    const client = neverReadyClient();

    await expect(
      manager({}).connectClient(client, 'default', { lazyConnect: false, connectTimeout: 200 })
    ).rejects.toThrow();

    expect(client['status'], 'the failed client was left retrying').toBe('end');
  });
});
