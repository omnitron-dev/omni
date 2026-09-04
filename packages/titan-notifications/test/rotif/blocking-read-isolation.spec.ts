/**
 * Blocking reads must not sit on the shared command connection.
 *
 * Every consumer loop reads its stream with `XREADGROUP ... BLOCK
 * <blockInterval>`. A blocking command owns its connection for the whole
 * window, so while those reads ran on `this.redis` — the same connection
 * `publish`, `ack`, `zincrby`, `xpending` and the health ping use — ordinary
 * commands queued behind them. Cost per command grew with the number of
 * running loops:
 *
 *   subscribe('error.test.*')   35_200 ms   ->  2 ms
 *   publish('error.test.channel') 15_100 ms ->  1 ms
 *
 * measured against a manager with a single prior subscription and the default
 * 5 s blockInterval. In production this is unbounded: a service with a dozen
 * subscriptions makes every publish wait behind a dozen blocking reads, and
 * `notifications-service.docker.spec.ts` was already hitting a 120 s test
 * timeout because of it.
 *
 * The manager already applied this rule to the DLQ ("separate Redis connection
 * for DLQ subscription to avoid blocking"); these tests pin it for the main
 * consumer loops, where it actually matters.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Redis } from 'ioredis';

import type { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestNotificationManager, isRedisInMockMode } from './helpers/test-utils.js';

const describeOrSkip = isRedisInMockMode() ? describe.skip : describe;

describeOrSkip('consumer loops and the shared command connection', () => {
  let manager: NotificationManager | undefined;

  afterEach(async () => {
    await manager?.stopAll().catch(() => {});
    manager = undefined;
  });

  it('keeps publish fast while several loops sit in a long BLOCK', async () => {
    // A deliberately long block window: if the read shares the command
    // connection, one publish cannot return in less than this.
    const blockInterval = 5_000;
    manager = await createTestNotificationManager(0, { blockInterval, disableDelayed: true });
    await manager.waitUntilReady();
    await manager.redis.flushdb();

    for (const pattern of ['slow.a.*', 'slow.b.*', 'slow.c.*']) {
      await manager.subscribe(pattern, async (msg) => {
        await msg.ack();
      });
    }

    // Let every loop settle into its blocking read before timing anything.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const started = Date.now();
    await manager.publish('slow.a.one', { n: 1 });
    await manager.publish('slow.b.one', { n: 2 });
    await manager.publish('slow.c.one', { n: 3 });
    const elapsed = Date.now() - started;

    // Three publishes behind six blocking reads used to cost tens of seconds.
    // A generous ceiling here still fails hard on the shared-connection bug.
    expect(elapsed).toBeLessThan(blockInterval);
  }, 60_000);

  it('subscribing again stays fast once a loop is blocked', async () => {
    const blockInterval = 5_000;
    manager = await createTestNotificationManager(0, { blockInterval, disableDelayed: true });
    await manager.waitUntilReady();
    await manager.redis.flushdb();

    await manager.subscribe('first.*', async (msg) => {
      await msg.ack();
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const started = Date.now();
    await manager.subscribe('second.*', async (msg) => {
      await msg.ack();
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(blockInterval);
  }, 60_000);

  it('delivers to a handler registered after other loops are already blocked', async () => {
    // The end-to-end shape of the same defect: the message reached the stream,
    // but the ack and the follow-up commands were stuck behind blocking reads,
    // so nothing appeared to be delivered.
    const blockInterval = 5_000;
    manager = await createTestNotificationManager(0, { blockInterval, disableDelayed: true });
    await manager.waitUntilReady();
    await manager.redis.flushdb();

    await manager.subscribe('noise.*', async (msg) => {
      await msg.ack();
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const received: unknown[] = [];
    await manager.subscribe('late.*', async (msg) => {
      received.push(msg.payload);
      await msg.ack();
    });

    await manager.publish('late.one', { hello: 'world' });

    const deadline = Date.now() + 3_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(received).toEqual([{ hello: 'world' }]);
  }, 60_000);

  it('releases every blocking connection on stopAll', async () => {
    // The per-loop connections must not outlive the manager. A loop parked in
    // BLOCK does not notice `active = false` until its window expires, so
    // stopAll drops those sockets itself instead of leaving them open for
    // another blockInterval.
    //
    // Counted by connection name rather than by `connected_clients`: that
    // number is server-wide, and the other suites sharing this Redis open and
    // close clients throughout, so an exact comparison against it fails on
    // someone else's traffic.
    const { getTestRedisConfig } = await import('./helpers/test-utils.js');
    const config = getTestRedisConfig(0);
    const probe = new Redis({ host: config.host, port: config.port, db: config.db });
    await probe.ping();

    // Scoped to this worker's database as well as to the connection name: the
    // Redis server is shared with the other workers, and CLIENT LIST reports
    // every connection on it, not just ours.
    const countReadClients = async () =>
      ((await probe.client('LIST')) as string)
        .split('\n')
        .filter((line) => line.includes('name=rotif-read:') && line.includes(` db=${config.db} `))
        .length;

    expect(await countReadClients()).toBe(0);

    manager = await createTestNotificationManager(0, { blockInterval: 5_000, disableDelayed: true });
    await manager.waitUntilReady();

    for (const pattern of ['leak.a.*', 'leak.b.*', 'leak.c.*']) {
      await manager.subscribe(pattern, async (msg) => {
        await msg.ack();
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Each pattern runs a main loop and a retry loop.
    expect(await countReadClients()).toBe(6);

    await manager.stopAll();
    manager = undefined;

    expect(await countReadClients()).toBe(0);
    probe.disconnect();
  }, 60_000);
});
