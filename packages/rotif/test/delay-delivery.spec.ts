import { delay as delayMs } from '@devgrid/common';
import { it, expect, describe, afterAll, beforeAll } from '@jest/globals';

import { NotificationManager } from '../src';
import { createTestConfig } from './helpers/test-utils';

describe('NotificationManager - delay delivery', () => {
  let manager: NotificationManager;

  jest.setTimeout(10000);

  beforeAll(async () => {
    manager = new NotificationManager(createTestConfig(1, {
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
    const seen: number[] = [];

    await manager.subscribe('test.nodelivery', async (msg) => {
      seen.push(Date.now());
    });

    await manager.publish('test.nodelivery', { value: 'wait' }, { delayMs: 1000 });

    await delayMs(1000);

    expect(seen.length).toBe(0);
  });
});
