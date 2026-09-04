import { delay as delayMs } from '@omnitron-dev/common';
import { it, expect, describe, afterAll, beforeAll } from 'vitest';
import { isRedisInMockMode } from './helpers/test-utils.js';

import type { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestNotificationManager } from './helpers/test-utils.js';

const skipTests = isRedisInMockMode();
if (skipTests) {
  console.log('⏭️ Skipping delay-delivery.spec.ts - requires real Redis');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('NotificationManager - delay delivery', () => {
  let manager: NotificationManager;

  // Test timeout: 10000ms (configured in vitest.config.ts)

  beforeAll(async () => {
    manager = await createTestNotificationManager(1, {
      checkDelayInterval: 100,
      blockInterval: 100,
    });
    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should delay delivery using delayMs', async () => {
    const received: number[] = [];
    const started = Date.now();

    await manager.subscribe('test.delayed', async (msg) => {
      received.push(Date.now() - started);
    });

    await delayMs(100);
    await manager.publish('test.delayed', { value: 42 }, { delayMs: 500 });

    await delayMs(1000);

    expect(received.length).toBe(1);
    expect(received[0]).toBeGreaterThanOrEqual(490);
  });

  it('should delay delivery using deliverAt (absolute timestamp)', async () => {
    const times: number[] = [];
    const started = Date.now();

    await manager.subscribe('test.deliverAt', async (msg) => {
      times.push(Date.now() - started);
    });

    await delayMs(100);
    await manager.publish('test.deliverAt', { value: 43 }, { deliverAt: Date.now() + 500 });

    await delayMs(1200);

    expect(times.length).toBe(1);
    expect(times[0]).toBeGreaterThanOrEqual(500);
  });

  it('should not deliver before delay', async () => {
    // Sampled well inside the delay window, not at its edge. Waiting the full
    // 1000ms and asserting "nothing yet" is a coin flip: the message becomes
    // due at publish+1000 and the assertion runs at publish+1000 too, so any
    // event-loop lag under a parallel run delivers it before the check and the
    // test fails on timing rather than on behaviour. The invariant worth
    // pinning is "held back until due, then delivered" — so check both halves.
    const seen: number[] = [];
    const publishedAt = Date.now();

    await manager.subscribe('test.nodelivery', async (msg) => {
      seen.push(Date.now() - publishedAt);
    });

    await manager.publish('test.nodelivery', { value: 'wait' }, { delayMs: 1000 });

    await delayMs(500);
    expect(seen).toEqual([]);

    await delayMs(1500);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(1000);
  }, 15_000);
});
