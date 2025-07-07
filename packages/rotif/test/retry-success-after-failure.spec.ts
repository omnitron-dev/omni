
import { delay } from '@devgrid/common';

import { NotificationManager } from '../src';
import { createTestConfig } from './helpers/test-utils';

describe('NotificationManager - retry after failure', () => {
  let manager: NotificationManager;

  beforeAll(async () => {
    manager = new NotificationManager(createTestConfig(1, {
      checkDelayInterval: 100,
      maxRetries: 3,
      blockInterval: 100,
    });

    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should retry a failed message processing and succeed afterwards', async () => {
    const attempts: number[] = [];
    let processedPayload: any;

    const completed = new Promise<void>((resolve) => {
      manager.subscribe(
        'retry.test',
        async (msg) => {
          attempts.push(msg.attempt);
          if (msg.attempt < 2) {
            throw new Error('temporary failure');
          } else {
            processedPayload = msg.payload;
            resolve();
          }
        },
        {
          startFrom: '0',
          retryDelay: 100,
        }
      );
    });

    await delay(200);

    const payload = { data: 'important' };
    await manager.publish('retry.test', payload);

    await completed;

    expect(attempts).toEqual([1, 2]);
    expect(processedPayload).toEqual(payload);
  }, 10000);
});
