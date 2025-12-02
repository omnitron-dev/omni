import { delay } from '@omnitron-dev/common';
import type { NotificationManager } from '../../src/rotif/rotif.js';
import { getTestRedisUrl, createTestNotificationManager, isInMockMode } from './helpers/test-utils.js';

const describeOrSkip = isInMockMode() ? describe.skip : describe;

if (isInMockMode()) {
  console.log('⏭️ Skipping race-condition.spec.ts - requires real Redis');
}

describeOrSkip('Race Condition Tests', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = await createTestNotificationManager(1, {
      deduplicationTTL: 3600,
      blockInterval: 50,
      maxConcurrency: 10,
    });
    await manager.redis.flushdb();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('should handle concurrent processing of same message correctly', async () => {
    let processedCount = 0;
    const processedIds = new Set<string>();

    // Create two consumers in the same group to simulate concurrent processing
    await manager.subscribe(
      'race.test',
      async (msg) => {
        // Simulate some processing time
        await delay(100);
        processedCount++;
        processedIds.add(msg.id);
        await msg.ack();
      },
      { groupName: 'concurrent-group', exactlyOnce: true }
    );

    await manager.subscribe(
      'race.test',
      async (msg) => {
        // Simulate some processing time
        await delay(100);
        processedCount++;
        processedIds.add(msg.id);
        await msg.ack();
      },
      { groupName: 'concurrent-group', exactlyOnce: true }
    );

    await delay(200);

    // Publish the same message with exactly-once semantics
    const payload = { data: 'concurrent-test', timestamp: Date.now() };
    await manager.publish('race.test', payload, { exactlyOnce: true });

    await delay(500);

    // Should only be processed once despite having two consumers
    expect(processedCount).toBe(1);
    expect(processedIds.size).toBe(1);
  });

  it('should handle rapid duplicate publications correctly', async () => {
    let processedCount = 0;
    const processedPayloads: any[] = [];

    await manager.subscribe(
      'race.rapid',
      async (msg) => {
        processedCount++;
        processedPayloads.push(msg.payload);
        await msg.ack();
      },
      { exactlyOnce: true }
    );

    await delay(100);

    const payload = { data: 'rapid-test', id: 1 };

    // Publish the same message rapidly in parallel
    const publishPromises = Array(10)
      .fill(null)
      .map(() => manager.publish('race.rapid', payload, { exactlyOnce: true }));

    await Promise.all(publishPromises);
    await delay(500);

    // Should only process once
    expect(processedCount).toBe(1);
    expect(processedPayloads).toHaveLength(1);
    expect(processedPayloads[0]).toEqual(payload);
  });

  it('should handle interleaved duplicate messages correctly', async () => {
    let processedCount = 0;
    const processedPayloads: any[] = [];

    await manager.subscribe(
      'race.interleaved',
      async (msg) => {
        await delay(50); // Simulate processing time
        processedCount++;
        processedPayloads.push(msg.payload);
        await msg.ack();
      },
      { exactlyOnce: true }
    );

    await delay(100);

    const payload1 = { data: 'interleaved-1' };
    const payload2 = { data: 'interleaved-2' };

    // Publish interleaved duplicates
    await Promise.all([
      manager.publish('race.interleaved', payload1, { exactlyOnce: true }),
      manager.publish('race.interleaved', payload2, { exactlyOnce: true }),
      manager.publish('race.interleaved', payload1, { exactlyOnce: true }), // duplicate
      manager.publish('race.interleaved', payload2, { exactlyOnce: true }), // duplicate
    ]);

    await delay(500);

    // Should process each unique payload only once
    expect(processedCount).toBe(2);
    expect(processedPayloads).toHaveLength(2);
    expect(processedPayloads.map((p) => p.data).sort()).toEqual(['interleaved-1', 'interleaved-2']);
  });

  it('should handle exactly-once with message failures and retries', async () => {
    let attemptCount = 0;
    let successCount = 0;
    const processedAttempts = new Map<string, number[]>();

    await manager.subscribe(
      'race.retry',
      async (msg) => {
        attemptCount++;

        // Track attempts for each unique payload
        const payloadKey = JSON.stringify(msg.payload);
        if (!processedAttempts.has(payloadKey)) {
          processedAttempts.set(payloadKey, []);
        }
        processedAttempts.get(payloadKey)!.push(msg.attempt);

        // Fail on first attempt, succeed on retry
        if (msg.attempt === 1) {
          throw new Error('Simulated failure');
        }

        successCount++;
        await msg.ack();
      },
      {
        exactlyOnce: true,
        maxRetries: 3,
        retryDelay: 100,
      }
    );

    await delay(100);

    const payload = { data: 'retry-test', id: 1 };

    // Publish twice with exactly-once
    await manager.publish('race.retry', payload, { exactlyOnce: true });
    await manager.publish('race.retry', payload, { exactlyOnce: true }); // duplicate

    await delay(1000);

    // Should process only one message, with retry
    expect(successCount).toBe(1);
    expect(attemptCount).toBe(2); // First attempt + retry
    expect(processedAttempts.size).toBe(1);

    const attempts = processedAttempts.get(JSON.stringify(payload));
    expect(attempts).toEqual([1, 2]);
  });

  it('should handle exactly-once across different channels with wildcards', async () => {
    let processedCount = 0;
    const processedChannels: string[] = [];

    await manager.subscribe(
      'race.wildcard.*',
      async (msg) => {
        processedCount++;
        processedChannels.push(msg.channel);
        await msg.ack();
      },
      { exactlyOnce: true }
    );

    await delay(100);

    const payload = { data: 'wildcard-test' };

    // Publish to different channels that match the pattern
    await manager.publish('race.wildcard.one', payload, { exactlyOnce: true });
    await manager.publish('race.wildcard.two', payload, { exactlyOnce: true });
    await manager.publish('race.wildcard.one', payload, { exactlyOnce: true }); // duplicate

    await delay(500);

    // Should process each channel's message once
    expect(processedCount).toBe(2);
    expect(processedChannels.sort()).toEqual(['race.wildcard.one', 'race.wildcard.two']);
  });

  it('should handle exactly-once with DLQ movement', async () => {
    let attemptCount = 0;
    let dlqMessages: any[] = [];
    let dlqSubscribed = false;

    // Subscribe to DLQ first (don't await - starts in background)
    manager.subscribeToDLQ(async (msg) => {
      dlqMessages.push(msg.payload);
      await msg.ack();
    });
    dlqSubscribed = true;

    // Give DLQ subscription time to initialize
    await delay(100);

    await manager.subscribe(
      'race.dlq',
      async (msg) => {
        attemptCount++;
        throw new Error('Always fail');
      },
      {
        exactlyOnce: true,
        maxRetries: 2,
        retryDelay: 200,
      }
    );

    await delay(200);

    const payload = { data: 'dlq-test' };

    // Publish once with exactly-once
    await manager.publish('race.dlq', payload, { exactlyOnce: true });

    // Duplicate should be blocked by dedup
    await manager.publish('race.dlq', payload, { exactlyOnce: true });

    // Wait for initial attempt + retries + DLQ movement with timeout check
    const maxWait = 15000;
    const startTime = Date.now();

    while (dlqMessages.length === 0 && Date.now() - startTime < maxWait) {
      await delay(100);
    }

    // Give a bit more time after DLQ message appears
    await delay(500);

    // Should process only one message through retries to DLQ
    // maxRetries=2 means initial attempt + 2 retries = 3 total attempts
    expect(attemptCount).toBe(3); // Initial + 2 retries (maxRetries = 2)
    expect(dlqMessages).toHaveLength(1);
    expect(dlqMessages[0]).toEqual(payload);
  }, 30000); // Increase timeout for CI/CD environments

  it('should handle high-concurrency exactly-once deduplication', async () => {
    let processedCount = 0;
    const uniquePayloads = new Set<string>();

    await manager.subscribe(
      'race.stress',
      async (msg) => {
        processedCount++;
        uniquePayloads.add(JSON.stringify(msg.payload));
        await msg.ack();
      },
      { exactlyOnce: true }
    );

    await delay(100);

    // Create many duplicate and unique messages
    const publishPromises: Promise<void>[] = [];

    for (let i = 0; i < 10; i++) {
      const payload = { data: 'stress-test', id: i % 3 }; // Only 3 unique payloads
      for (let j = 0; j < 5; j++) {
        publishPromises.push(manager.publish('race.stress', payload, { exactlyOnce: true }));
      }
    }

    await Promise.all(publishPromises);
    await delay(1000);

    // Should process only 3 unique messages
    expect(processedCount).toBe(3);
    expect(uniquePayloads.size).toBe(3);
  });

  it('should handle exactly-once with custom deduplication key', async () => {
    let processedCount = 0;
    const processedIds: string[] = [];

    // Create manager with custom dedup key generator
    const customManager = new NotificationManager({
      redis: getTestRedisUrl(1),
      deduplicationTTL: 3600,
      blockInterval: 50,
      generateDedupKey: ({ payload }) =>
        // Use only the 'id' field for deduplication
        `custom:${(payload as any).id}`,
    });

    await customManager.redis.flushdb();

    await customManager.subscribe(
      'race.custom',
      async (msg) => {
        processedCount++;
        processedIds.push((msg.payload as any).id);
        await msg.ack();
      },
      { exactlyOnce: true }
    );

    await delay(100);

    // Different payloads with same ID should be deduplicated
    await customManager.publish('race.custom', { id: '1', data: 'first' }, { exactlyOnce: true });
    await customManager.publish('race.custom', { id: '1', data: 'second' }, { exactlyOnce: true });
    await customManager.publish('race.custom', { id: '2', data: 'third' }, { exactlyOnce: true });

    await delay(500);

    // Should process only unique IDs
    expect(processedCount).toBe(2);
    expect(processedIds.sort()).toEqual(['1', '2']);

    await customManager.stopAll();
  });

  it('should handle exactly-once with per-message TTL override', async () => {
    let processedCount = 0;

    await manager.subscribe(
      'race.ttl',
      async (msg) => {
        processedCount++;
        await msg.ack();
      },
      { exactlyOnce: true }
    );

    await delay(100);

    const payload = { data: 'ttl-override' };

    // Publish with custom TTL
    await manager.publish('race.ttl', payload, {
      exactlyOnce: true,
      deduplicationTTL: 1, // 1 second TTL
    });

    // Immediate duplicate should be blocked
    await manager.publish('race.ttl', payload, { exactlyOnce: true });

    await delay(500);
    expect(processedCount).toBe(1);

    // After TTL expires, should process again
    await delay(600);
    await manager.publish('race.ttl', payload, { exactlyOnce: true });

    await delay(500);
    expect(processedCount).toBe(2);
  });
});
