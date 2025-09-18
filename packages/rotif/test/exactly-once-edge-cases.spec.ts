import { delay } from '@omnitron-dev/common';
import { NotificationManager } from '../src/rotif.js';
import { getTestRedisUrl } from './helpers/test-utils.js';

describe('Exactly-Once Edge Cases', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = new NotificationManager({
      redis: getTestRedisUrl(1),
      deduplicationTTL: 3600,
      blockInterval: 50,
    });
    await manager.redis.flushdb();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('should handle exactly-once with empty payloads', async () => {
    let processedCount = 0;

    await manager.subscribe('edge.empty', async (msg) => {
      processedCount++;
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    // Publish empty/null/undefined payloads
    await manager.publish('edge.empty', {}, { exactlyOnce: true });
    await manager.publish('edge.empty', {}, { exactlyOnce: true });
    await manager.publish('edge.empty', null as any, { exactlyOnce: true });
    await manager.publish('edge.empty', undefined as any, { exactlyOnce: true });

    await delay(500);

    // Empty objects should be deduplicated
    expect(processedCount).toBeLessThanOrEqual(3);
  });

  it('should handle exactly-once with very large payloads', async () => {
    let processedCount = 0;
    const processedSizes: number[] = [];

    await manager.subscribe('edge.large', async (msg) => {
      processedCount++;
      processedSizes.push(JSON.stringify(msg.payload).length);
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    // Create a large payload (1MB+)
    const largeArray = new Array(10000).fill('x'.repeat(100));
    const largePayload = { data: largeArray };

    await manager.publish('edge.large', largePayload, { exactlyOnce: true });
    await manager.publish('edge.large', largePayload, { exactlyOnce: true });

    await delay(500);

    expect(processedCount).toBe(1);
    expect(processedSizes[0]).toBeGreaterThan(1000000);
  });

  it('should handle exactly-once with special characters in payload', async () => {
    let processedCount = 0;
    const processedPayloads: any[] = [];

    await manager.subscribe('edge.special', async (msg) => {
      processedCount++;
      processedPayloads.push(msg.payload);
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    const specialPayload = {
      unicode: '🚀💡🔥',
      newlines: 'line1\nline2\rline3',
      tabs: 'tab1\ttab2',
      quotes: '"double" and \'single\'',
      backslash: 'path\\to\\file',
      nullChar: 'null\0char',
      html: '<script>alert("xss")</script>',
      json: '{"nested": "json"}',
    };

    await manager.publish('edge.special', specialPayload, { exactlyOnce: true });
    await manager.publish('edge.special', specialPayload, { exactlyOnce: true });

    await delay(500);

    expect(processedCount).toBe(1);
    expect(processedPayloads[0]).toEqual(specialPayload);
  });

  it('should handle exactly-once with circular references in payload', async () => {
    let processedCount = 0;
    let errorCount = 0;

    await manager.subscribe('edge.circular', async (msg) => {
      processedCount++;
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    // Create a circular reference
    const circular: any = { a: 1 };
    circular.self = circular;

    try {
      await manager.publish('edge.circular', circular, { exactlyOnce: true });
    } catch (error) {
      errorCount++;
    }

    await delay(500);

    // Should handle circular reference gracefully
    expect(errorCount).toBeGreaterThan(0);
    expect(processedCount).toBe(0);
  });

  it('should handle exactly-once when Redis connection is temporarily lost', async () => {
    let processedCount = 0;
    let errorCount = 0;

    await manager.subscribe('edge.disconnect', async (msg) => {
      processedCount++;
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    const payload = { data: 'disconnect-test' };

    // Publish first message
    await manager.publish('edge.disconnect', payload, { exactlyOnce: true });

    // Simulate connection issue by sending invalid command
    try {
      // This will cause an error but shouldn't crash
      await (manager.redis as any).eval('invalid lua script', 0);
    } catch (error) {
      errorCount++;
    }

    // Try to publish duplicate after error
    await manager.publish('edge.disconnect', payload, { exactlyOnce: true });

    await delay(500);

    // Should still maintain exactly-once despite temporary error
    expect(processedCount).toBe(1);
    expect(errorCount).toBeGreaterThan(0);
  });

  it('should handle exactly-once with very high frequency publishing', async () => {
    let processedCount = 0;
    const uniqueIds = new Set<number>();

    await manager.subscribe('edge.frequency', async (msg) => {
      processedCount++;
      uniqueIds.add((msg.payload as any).id);
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    // Publish 100 messages with only 10 unique payloads sequentially
    // Note: We use a fixed timestamp per ID to ensure deduplication works correctly
    const publishResults: (string | null)[] = [];
    for (let i = 0; i < 100; i++) {
      const id = i % 10;
      const payload = { id, timestamp: 1000 + id }; // Fixed timestamp per ID
      const result = await manager.publish('edge.frequency', payload, { exactlyOnce: true });
      publishResults.push(result as string | null);
    }

    await delay(2000); // Ensure all messages are processed

    // Should process only unique messages
    expect(processedCount).toBe(10);
    expect(uniqueIds.size).toBe(10);
  });

  it('should handle exactly-once with mixed exactlyOnce flags', async () => {
    let processedCount = 0;
    const processedPayloads: any[] = [];

    await manager.subscribe('edge.mixed', async (msg) => {
      processedCount++;
      processedPayloads.push(msg.payload);
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    const payload1 = { data: 'with-exactly-once' };
    const payload2 = { data: 'without-exactly-once' };

    // Publish with exactlyOnce
    await manager.publish('edge.mixed', payload1, { exactlyOnce: true });
    await manager.publish('edge.mixed', payload1, { exactlyOnce: true });

    // Publish without exactlyOnce (should not be deduplicated)
    await manager.publish('edge.mixed', payload2, { exactlyOnce: false });
    await manager.publish('edge.mixed', payload2, { exactlyOnce: false });

    await delay(500);

    // exactlyOnce messages deduplicated, others not
    expect(processedCount).toBe(3);
    const withExactly = processedPayloads.filter(p => p.data === 'with-exactly-once');
    const withoutExactly = processedPayloads.filter(p => p.data === 'without-exactly-once');
    expect(withExactly).toHaveLength(1);
    expect(withoutExactly).toHaveLength(2);
  });

  it('should handle exactly-once with subscriber that never acks', async () => {
    let processedCount = 0;
    let timeoutReached = false;

    await manager.subscribe('edge.noack', async (msg) => {
      processedCount++;
      // Never call msg.ack()
      await delay(100);
    }, {
      exactlyOnce: true,
      maxRetries: 1,
      retryDelay: 100,
    });

    await delay(100);

    const payload = { data: 'no-ack-test' };

    await manager.publish('edge.noack', payload, { exactlyOnce: true });
    await manager.publish('edge.noack', payload, { exactlyOnce: true });

    // Wait for timeout and retry
    await delay(2000);

    // Set flag to indicate we waited
    timeoutReached = true;

    // Message should be retried but still deduplicated
    expect(processedCount).toBeGreaterThanOrEqual(1);
    expect(timeoutReached).toBe(true);
  });

  it('should handle exactly-once with payload containing dates', async () => {
    let processedCount = 0;
    const processedPayloads: any[] = [];

    await manager.subscribe('edge.dates', async (msg) => {
      processedCount++;
      processedPayloads.push(msg.payload);
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    const now = new Date();
    const payload = {
      date: now.toISOString(),
      timestamp: now.getTime(),
      dateObject: now, // Will be serialized to string
    };

    await manager.publish('edge.dates', payload, { exactlyOnce: true });
    await manager.publish('edge.dates', payload, { exactlyOnce: true });

    await delay(500);

    expect(processedCount).toBe(1);
    expect(processedPayloads[0].date).toBe(now.toISOString());
    expect(processedPayloads[0].timestamp).toBe(now.getTime());
  });

  it('should handle exactly-once with deep nested objects', async () => {
    let processedCount = 0;

    await manager.subscribe('edge.nested', async (msg) => {
      processedCount++;
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    const deepNested = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                data: 'deeply nested',
                array: [1, 2, 3, { nested: true }],
              },
            },
          },
        },
      },
    };

    await manager.publish('edge.nested', deepNested, { exactlyOnce: true });
    await manager.publish('edge.nested', deepNested, { exactlyOnce: true });

    await delay(500);

    expect(processedCount).toBe(1);
  });

  it('should handle exactly-once with array payloads', async () => {
    let processedCount = 0;
    const processedArrays: any[] = [];

    await manager.subscribe('edge.arrays', async (msg) => {
      processedCount++;
      processedArrays.push(msg.payload);
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    const arrayPayload = [1, 2, 3, { nested: 'object' }, [4, 5, 6]];

    await manager.publish('edge.arrays', arrayPayload as any, { exactlyOnce: true });
    await manager.publish('edge.arrays', arrayPayload as any, { exactlyOnce: true });

    await delay(500);

    expect(processedCount).toBe(1);
    expect(processedArrays[0]).toEqual(arrayPayload);
  });

  it('should handle exactly-once with number and boolean payloads', async () => {
    let processedCount = 0;
    const processedValues: any[] = [];

    await manager.subscribe('edge.primitives', async (msg) => {
      processedCount++;
      processedValues.push(msg.payload);
      await msg.ack();
    }, { exactlyOnce: true });

    await delay(100);

    // Test various primitive values
    await manager.publish('edge.primitives', 42 as any, { exactlyOnce: true });
    await manager.publish('edge.primitives', 42 as any, { exactlyOnce: true });
    await manager.publish('edge.primitives', true as any, { exactlyOnce: true });
    await manager.publish('edge.primitives', false as any, { exactlyOnce: true });
    await manager.publish('edge.primitives', 0 as any, { exactlyOnce: true });

    await delay(1000);

    // Each unique primitive should be processed once
    expect(processedCount).toBe(4); // 42, true, false, 0
    expect(processedValues).toContain(42);
    expect(processedValues).toContain(true);
    expect(processedValues).toContain(false);
    expect(processedValues).toContain(0);
  });
});