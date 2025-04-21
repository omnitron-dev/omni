import { delay as delayMs } from '@devgrid/common';
import { it, expect, afterAll, describe, beforeAll } from '@jest/globals';

import { NotificationManager } from '../src';

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';
const parsed = new URL(REDIS_URL);

describe('NotificationManager - publish/subscribe', () => {
  let manager: NotificationManager;

  beforeAll(async () => {
    manager = new NotificationManager({
      redis: {
        host: parsed.hostname,
        port: parseInt(parsed.port || '6379'),
        db: 1,
      },
      checkDelayInterval: 100,
      blockInterval: 100,
    });
    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should deliver a published message to the subscriber', async () => {
    const result: any[] = [];

    await manager.subscribe(
      'test.simple',
      async (msg) => {
        result.push({
          id: msg.id,
          payload: msg.payload,
          channel: msg.channel,
        });
      }
    );

    await delayMs(100);

    const payload = { hello: 'world' };
    const id = await manager.publish('test.simple', payload);

    await delayMs(500);

    expect(result.length).toBe(1);
    expect(result[0].payload).toEqual(payload);
    expect(result[0].channel).toBe('test.simple');
    expect(typeof result[0].id).toBe('string');
    expect(result[0].id).toBe(id);
  }, 10000);

  it('should call ack() and allow retry()', async () => {
    const attempts: number[] = [];

    const completed = new Promise<void>((resolve) => {
      manager.subscribe(
        'test.ack',
        async (msg) => {
          console.log('subscribed msg', msg);
          attempts.push(msg.attempt);

          if (msg.attempt === 1) {
            msg.retry(); // ⚠️ без await, не блокируем
          }

          if (msg.attempt === 2) {
            resolve();
          }
        },
        {
          retryDelay: 100,
        }
      );
    });

    await delayMs(100);
    await manager.publish('test.ack', { data: 123 });
    await completed;

    expect(attempts).toEqual([1, 2]);
  }, 10000);
});
