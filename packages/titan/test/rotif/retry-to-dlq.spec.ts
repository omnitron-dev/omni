import { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestConfig } from './helpers/test-utils.js';

// Use a local delay function to avoid any import issues
const delayMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('NotificationManager - retry to DLQ', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = new NotificationManager(
      createTestConfig(1, {
        checkDelayInterval: 50,
        maxRetries: 3,
        blockInterval: 10,
      })
    );
    await manager.redis.flushdb();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('should move message to DLQ after exceeding max retries (4 total attempts with maxRetries: 3)', async () => {
    const attempts: number[] = [];

    // Subscribe to the channel
    await manager.subscribe(
      'test.retry-dlq',
      async (msg) => {
        attempts.push(msg.attempt);
        throw new Error('Handler failure');
      },
      { startFrom: '0', retryDelay: 100 }
    );

    // Wait a bit to ensure subscription is ready
    await delayMs(1000);

    await manager.publish('test.retry-dlq', { data: 'test' });

    // Wait for all 4 attempts (initial + 3 retries)
    // Each retry has 100ms delay, so 4 attempts = ~400ms minimum
    await delayMs(2000); // Give plenty of time for all retries and DLQ processing

    // With maxRetries: 3, we expect 4 total attempts (1 initial + 3 retries)
    expect(attempts).toEqual([1, 2, 3, 4]);

    // Check if message was moved to DLQ by reading the DLQ stream directly
    const dlqMessages = (await manager.redis.xrange('rotif:dlq', '-', '+')) as any[];
    expect(dlqMessages.length).toBeGreaterThan(0);

    if (dlqMessages.length > 0) {
      const [messageId, fields] = dlqMessages[0];
      const dlqData: any = {};
      for (let i = 0; i < fields.length; i += 2) {
        dlqData[fields[i]] = fields[i + 1];
      }

      expect(dlqData.channel).toBe('test.retry-dlq');
      expect(JSON.parse(dlqData.payload)).toEqual({ data: 'test' });
      expect(dlqData.error).toBe('Handler failure');
      expect(dlqData.attempt).toBe('4');
    }
  }, 30000);
});
