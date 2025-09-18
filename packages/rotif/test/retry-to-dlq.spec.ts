import { delay as delayMs } from '@omnitron-dev/common';

import { NotificationManager } from '../src/rotif.js';
import { createTestConfig } from './helpers/test-utils.js';
import { RotifMessage } from '../src/types.js';

describe('NotificationManager - retry to DLQ', () => {
  let manager: NotificationManager;

  beforeAll(async () => {
    manager = new NotificationManager(createTestConfig(1, {
      checkDelayInterval: 50,
      maxRetries: 3,
      blockInterval: 10,
    }));
    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should move message to DLQ after exceeding max retries', async () => {
    const attempts: number[] = [];
    let dlqMessage: RotifMessage | undefined;

    await manager.subscribe(
      'test.retry-dlq',
      async (msg) => {
        attempts.push(msg.attempt);
        throw new Error('Handler failure');
      },
      { startFrom: '0', retryDelay: 100, }
    );

    manager.subscribeToDLQ(async (msg) => {
      dlqMessage = msg;
    });

    await delayMs(100);

    await manager.publish('test.retry-dlq', { data: 'test' });

    // Wait for all retries to complete - need extra time for the third retry
    // to be scheduled, moved, and processed
    // Adding extra time to ensure the consumer has time to read from retry stream
    await delayMs(8000);

    expect(attempts).toEqual([1, 2, 3]);
    expect(dlqMessage).toBeDefined();
    expect(dlqMessage?.channel).toBe('test.retry-dlq');
    expect(dlqMessage?.payload).toEqual({ data: 'test' });
  }, 15000);
});