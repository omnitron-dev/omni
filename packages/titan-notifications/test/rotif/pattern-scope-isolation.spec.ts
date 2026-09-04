/**
 * Pattern registrations must not cross a database boundary.
 *
 * Redis Pub/Sub is not database-scoped: a PUBLISH reaches every subscriber on
 * the server regardless of which database each one selected. The manager
 * announced every new subscription on one fixed channel,
 * `rotif:subscriptions:updates`, so a manager on db 9 learned about patterns
 * whose streams live on db 10 and added them to its own `activePatterns`.
 *
 * `publish()` writes one stream per matching pattern, so the consequences land
 * on the publisher:
 *
 *   - it writes to `rotif:stream:<foreign pattern>` in its OWN database, where
 *     no consumer group exists — an unread, untrimmed stream that grows for as
 *     long as the process runs;
 *   - it returns an array of ids where the single-pattern contract promises a
 *     string, which is what surfaced this ("expected 'object' to be 'string'").
 *
 * `rotif:patterns` is a key and therefore already db-scoped, which is why
 * reconnecting repaired the set: the divergence only ever arrived over Pub/Sub.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { NotificationManager } from '../../src/rotif/rotif.js';
import { getTestRedisConfig, isRedisInMockMode } from './helpers/test-utils.js';

const describeOrSkip = isRedisInMockMode() ? describe.skip : describe;

describeOrSkip('pattern registrations are scoped to their database', () => {
  const managers: NotificationManager[] = [];

  afterEach(async () => {
    for (const manager of managers.splice(0)) {
      await manager.stopAll().catch(() => {});
    }
  });

  async function managerOnDb(db: number): Promise<NotificationManager> {
    const { host, port } = getTestRedisConfig(0);
    const manager = new NotificationManager({
      redis: { host, port, db, lazyConnect: false } as never,
      blockInterval: 100,
      disableDelayed: true,
    });
    managers.push(manager);
    await manager.waitUntilReady();
    await manager.redis.flushdb();
    return manager;
  }

  // Two databases this package's worker slots (5-12) never touch, so the test
  // is independent of which worker runs it.
  const DB_A = 14;
  const DB_B = 15;

  it('does not adopt a pattern registered on another database', async () => {
    const a = await managerOnDb(DB_A);
    const b = await managerOnDb(DB_B);

    await b.subscribe('test.*', async (msg) => {
      await msg.ack();
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect([...(a as unknown as { activePatterns: Set<string> }).activePatterns]).toEqual([]);
  }, 60_000);

  it('publishes to its own pattern only, and returns a single id', async () => {
    const a = await managerOnDb(DB_A);
    const b = await managerOnDb(DB_B);

    await b.subscribe('test.*', async (msg) => {
      await msg.ack();
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    await a.subscribe('test.channel', async (msg) => {
      await msg.ack();
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const id = await a.publish('test.channel', { from: 'a' });

    expect(typeof id).toBe('string');

    // The decisive check: no stream keyed by the other database's pattern.
    const streams = await a.redis.keys('rotif:stream:*');
    expect(streams).not.toContain('rotif:stream:test.*');
  }, 60_000);

  it('still shares patterns between managers on the same database', async () => {
    // The channel is narrowed, not disabled — this is how a rotif cluster
    // learns that a peer started consuming a new pattern.
    const first = await managerOnDb(DB_A);
    const second = await managerOnDb(DB_A);

    await second.subscribe('shared.*', async (msg) => {
      await msg.ack();
    });

    const deadline = Date.now() + 5_000;
    const active = () => (first as unknown as { activePatterns: Set<string> }).activePatterns;
    while (!active().has('shared.*') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect([...active()]).toContain('shared.*');
  }, 60_000);
});
