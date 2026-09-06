/**
 * One consumer group acknowledging a message must not remove it from the
 * stream, because the stream is shared by every group reading it.
 *
 * `RotifMessage.ack()` called the `ack-message` script with its delete flag set,
 * and that script runs `XDEL` after `XACK`. `XACK` is per-group; `XDEL` is not.
 * So in a fan-out topology — several consumer groups on one channel, which is
 * what consumer groups are for — the first group to acknowledge deleted the
 * message, and any group that had not yet read it never would.
 *
 * This is what `distributed-consumer-groups.spec.ts` had been catching
 * intermittently for a long time: two messages published, group B receives both,
 * group A receives one. It reads as a delivery delay, and was treated as one —
 * that file already carries a ten-second wait added on the assumption that Redis
 * was being slow. It was not slow; the message was gone. Measured at the moment
 * of failure: the stream held zero entries and nothing was pending.
 *
 * The test below removes the race instead of waiting on it: group B consumes and
 * acknowledges first, and group A subscribes afterwards from the start of the
 * stream. If the entry survived, A must see it.
 */
import { describe, it, expect } from 'vitest';
import { Redis } from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/rotif.js';
import { getTestRedisUrl, getTestRedisConfig, isRedisInMockMode } from './helpers/test-utils.js';

const describeOrSkip = isRedisInMockMode() ? describe.skip : describe;

describeOrSkip('rotif — ack scope', () => {
  it('leaves the message readable by a group that has not consumed it yet', async () => {
    const channel = `ack-scope.${Date.now()}`;
    const streamKey = `rotif:stream:${channel}`;
    const cfg = getTestRedisConfig(1);
    const raw = new Redis({ host: cfg.host, port: cfg.port, db: cfg.db });

    const first = new NotificationManager({ redis: getTestRedisUrl(1), blockInterval: 50 });
    const second = new NotificationManager({ redis: getTestRedisUrl(1), blockInterval: 50 });

    try {
      const seenByFirst: string[] = [];
      await first.subscribe(channel, async (msg) => {
        seenByFirst.push(msg.id);
      }, { groupName: 'first-group' });

      await delay(150);
      await first.publish(channel, { hello: 'world' });

      const deadline = Date.now() + 5_000;
      while (seenByFirst.length === 0 && Date.now() < deadline) await delay(25);
      expect(seenByFirst, 'the first group never received it').toHaveLength(1);

      // Its ack has now run. The entry must still be in the stream, because a
      // second group has not seen it.
      const entries = await raw.xrange(streamKey, '-', '+');
      expect(entries.map((e) => e[0]), 'the ack deleted the entry from the shared stream').toEqual(
        seenByFirst
      );

      // And a group created afterwards, reading from the start, must get it.
      const seenBySecond: string[] = [];
      await second.subscribe(channel, async (msg) => {
        seenBySecond.push(msg.id);
      }, { groupName: 'second-group' });

      const deadline2 = Date.now() + 5_000;
      while (seenBySecond.length === 0 && Date.now() < deadline2) await delay(25);
      expect(seenBySecond).toEqual(seenByFirst);
    } finally {
      await first.stopAll();
      await second.stopAll();
      await raw.del(streamKey).catch(() => undefined);
      await raw.quit();
    }
  }, 60_000);
});
