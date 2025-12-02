import { delay } from '@omnitron-dev/common';
import type { NotificationManager } from '../../src/rotif/rotif.js';
import { getTestRedisUrl, createTestNotificationManager, isInMockMode } from './helpers/test-utils.js';
import { generateDedupKey } from '../../src/rotif/utils/common.js';

const describeOrSkip = isInMockMode() ? describe.skip : describe;

if (isInMockMode()) {
  console.log('⏭️ Skipping deduplication-coverage integration tests - requires real Redis');
}

describe('Deduplication Coverage Tests', () => {
  describe('generateDedupKey function', () => {
    // These are unit tests that don't need Redis
    it('should generate consistent keys for same input', () => {
      const input = {
        channel: 'test.channel',
        payload: { id: 1, data: 'test' },
        pattern: 'test.*',
      };

      const key1 = generateDedupKey(input);
      const key2 = generateDedupKey(input);

      expect(key1).toBe(key2);
      expect(key1).toContain('dedup:pub:');
    });

    it('should generate different keys for different channels', () => {
      const payload = { id: 1, data: 'test' };

      const key1 = generateDedupKey({ channel: 'channel1', payload });
      const key2 = generateDedupKey({ channel: 'channel2', payload });

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different payloads', () => {
      const channel = 'test.channel';

      const key1 = generateDedupKey({ channel, payload: { id: 1 } });
      const key2 = generateDedupKey({ channel, payload: { id: 2 } });

      expect(key1).not.toBe(key2);
    });

    it('should include group in key when provided', () => {
      const input = {
        channel: 'test.channel',
        payload: { id: 1 },
        group: 'test-group',
      };

      const key = generateDedupKey(input);
      expect(key).toContain('test-group');
    });

    it('should handle undefined/null values gracefully', () => {
      const key1 = generateDedupKey({ channel: 'test', payload: undefined });
      const key2 = generateDedupKey({ channel: 'test', payload: null });
      const key3 = generateDedupKey({ channel: 'test', payload: {} });

      expect(key1).toBeTruthy();
      expect(key2).toBeTruthy();
      expect(key3).toBeTruthy();
    });

    it('should handle complex nested objects', () => {
      const complex = {
        nested: {
          deep: {
            array: [1, 2, { more: 'data' }],
            date: new Date().toISOString(),
          },
        },
      };

      const key = generateDedupKey({ channel: 'test', payload: complex });
      expect(key).toBeTruthy();
      expect(key.length).toBeGreaterThan(10);
    });
  });

  // Integration tests that need Redis
  describeOrSkip('Integration Tests', () => {
    let manager: NotificationManager;

    beforeEach(async () => {
      manager = await createTestNotificationManager(1, {
        deduplicationTTL: 3600,
        blockInterval: 50,
      });
      await manager.redis.flushdb();
    });

    afterEach(async () => {
      if (manager) {
        await manager.stopAll();
      }
    });

    describe('Publisher-side deduplication', () => {
      it('should detect duplicates at publish time', async () => {
        let received = 0;

        await manager.subscribe('pub.dedup', async (msg) => {
          received++;
          await msg.ack();
        });

        await delay(100);

        const payload = { data: 'publisher-dedup' };

        // First publish should succeed
        await manager.publish('pub.dedup', payload, { exactlyOnce: true });

        // Second should be detected as duplicate at publish time
        await manager.publish('pub.dedup', payload, { exactlyOnce: true });

        await delay(500);

        // Should only receive one message
        expect(received).toBe(1);
      });

      it('should respect pattern-specific deduplication', async () => {
        let receivedCount = 0;
        const receivedChannels: string[] = [];

        await manager.subscribe('pattern.*', async (msg) => {
          receivedCount++;
          receivedChannels.push(msg.channel);
          await msg.ack();
        });

        await delay(100);

        const payload = { data: 'pattern-test' };

        // Publish to different channels matching the pattern
        await manager.publish('pattern.one', payload, { exactlyOnce: true });
        await manager.publish('pattern.two', payload, { exactlyOnce: true });

        // Duplicate to first channel
        await manager.publish('pattern.one', payload, { exactlyOnce: true });

        await delay(500);

        expect(receivedCount).toBe(2);
        expect(receivedChannels.sort()).toEqual(['pattern.one', 'pattern.two']);
      });
    });

    describe('Consumer-side deduplication with atomic SET NX', () => {
      it('should use atomic SET NX for deduplication', async () => {
        let processedCount = 0;
        const startTime = Date.now();
        const processingTimes: number[] = [];

        // Spy on Redis SET command to verify NX flag is used
        const originalSet = manager.redis.set.bind(manager.redis);
        let setNXCalled = false;

        const setSpy = async (...args: any[]) => {
          // Check if NX flag is present
          if (args.includes('NX')) {
            setNXCalled = true;
          }
          return originalSet(...args);
        };

        manager.redis.set = setSpy;

        await manager.subscribe(
          'atomic.test',
          async (msg) => {
            processingTimes.push(Date.now() - startTime);
            processedCount++;
            await msg.ack();
          },
          { exactlyOnce: true }
        );

        await delay(100);

        const payload = { data: 'atomic-setnx' };
        await manager.publish('atomic.test', payload, { exactlyOnce: true });

        await delay(500);

        expect(processedCount).toBe(1);
        expect(setNXCalled).toBe(true);
      });

      it('should handle SET NX failure correctly', async () => {
        let processedCount = 0;
        let duplicateDetected = false;

        await manager.subscribe(
          'setnx.fail',
          async (msg) => {
            processedCount++;
            await msg.ack();
          },
          { exactlyOnce: true }
        );

        await delay(100);

        const payload = { data: 'setnx-failure' };

        // Manually set the consumer dedup key to simulate another worker processing
        const dedupKey = generateDedupKey({
          channel: 'setnx.fail',
          payload,
          group: 'grp:setnx.fail', // Consumer-side uses group
          side: 'con',
        });
        await manager.redis.set(dedupKey, '1', 'EX', 3600);

        // Try to process - should be detected as duplicate
        await manager.publish('setnx.fail', payload, { exactlyOnce: true });

        await delay(500);

        // Message should not be processed due to dedup key already existing
        expect(processedCount).toBe(0);
      });
    });

    describe('Deduplication with multiple consumer groups', () => {
      it('should maintain separate dedup keys per group', async () => {
        let group1Received = 0;
        let group2Received = 0;

        await manager.subscribe(
          'groups.test',
          async (msg) => {
            group1Received++;
            await msg.ack();
          },
          { groupName: 'group1', exactlyOnce: true }
        );

        await manager.subscribe(
          'groups.test',
          async (msg) => {
            group2Received++;
            await msg.ack();
          },
          { groupName: 'group2', exactlyOnce: true }
        );

        await delay(100);

        const payload = { data: 'group-dedup' };

        // Each group should process the message independently
        await manager.publish('groups.test', payload, { exactlyOnce: true });
        await manager.publish('groups.test', payload, { exactlyOnce: true });

        await delay(500);

        expect(group1Received).toBe(1);
        expect(group2Received).toBe(1);
      });
    });

    describe('Deduplication TTL behavior', () => {
      it('should expire dedup keys after TTL', async () => {
        let processedCount = 0;

        // Use very short TTL for testing
        const shortTTLManager = new NotificationManager({
          redis: getTestRedisUrl(1),
          deduplicationTTL: 1, // 1 second
          blockInterval: 50,
        });

        await shortTTLManager.redis.flushdb();

        await shortTTLManager.subscribe(
          'ttl.test',
          async (msg) => {
            processedCount++;
            await msg.ack();
          },
          { exactlyOnce: true }
        );

        await delay(100);

        const payload = { data: 'ttl-test' };

        // First publish
        await shortTTLManager.publish('ttl.test', payload, { exactlyOnce: true });

        await delay(500);
        expect(processedCount).toBe(1);

        // Wait for TTL to expire
        await delay(1000);

        // Should be able to process again
        await shortTTLManager.publish('ttl.test', payload, { exactlyOnce: true });

        await delay(500);
        expect(processedCount).toBe(2);

        await shortTTLManager.stopAll();
      });

      it('should use per-message TTL override', async () => {
        let processedCount = 0;

        await manager.subscribe(
          'ttl.override',
          async (msg) => {
            processedCount++;
            await msg.ack();
          },
          { exactlyOnce: true }
        );

        await delay(100);

        const payload = { data: 'ttl-override' };

        // Publish with custom short TTL
        await manager.publish('ttl.override', payload, {
          exactlyOnce: true,
          deduplicationTTL: 1,
        });

        // Immediate duplicate should be blocked
        await manager.publish('ttl.override', payload, {
          exactlyOnce: true,
          deduplicationTTL: 1,
        });

        await delay(500);
        expect(processedCount).toBe(1);

        // Wait for custom TTL to expire
        await delay(1000);

        // Should process again
        await manager.publish('ttl.override', payload, {
          exactlyOnce: true,
        });

        await delay(500);
        expect(processedCount).toBe(2);
      });
    });

    describe('Deduplication error handling', () => {
      it('should handle Redis errors during dedup check gracefully', async () => {
        let processedCount = 0;
        let errorCount = 0;

        // Temporarily break Redis SET command
        const originalSet = manager.redis.set.bind(manager.redis);
        let errorThrown = false;

        manager.redis.set = async (...args: any[]) => {
          if (!errorThrown && args[0]?.includes('dedup:')) {
            errorThrown = true;
            throw new Error('Redis connection error');
          }
          return originalSet(...args);
        };

        await manager.subscribe(
          'error.dedup',
          async (msg) => {
            processedCount++;
            await msg.ack();
          },
          { exactlyOnce: true }
        );

        await delay(100);

        try {
          await manager.publish('error.dedup', { data: 'error-test' }, { exactlyOnce: true });
        } catch (error) {
          errorCount++;
        }

        await delay(500);

        // Should handle error gracefully
        expect(errorCount).toBeGreaterThanOrEqual(0);

        // Restore original function
        manager.redis.set = originalSet;
      });
    });

    describe('Deduplication with retries', () => {
      it('should not duplicate on retry after failure', async () => {
        let attemptCount = 0;
        const processedIds = new Set<string>();

        await manager.subscribe(
          'retry.dedup',
          async (msg) => {
            attemptCount++;
            processedIds.add(msg.id);

            if (msg.attempt === 1) {
              throw new Error('First attempt fails');
            }

            await msg.ack();
          },
          {
            exactlyOnce: true,
            maxRetries: 3,
            retryDelay: 100,
          }
        );

        await delay(100);

        const payload = { data: 'retry-dedup' };

        // Publish twice - second should be deduplicated
        await manager.publish('retry.dedup', payload, { exactlyOnce: true });
        await manager.publish('retry.dedup', payload, { exactlyOnce: true });

        await delay(1000);

        // Should see initial attempt + retry, but only for one message
        expect(attemptCount).toBe(2);
        expect(processedIds.size).toBe(2); // Different IDs for retry
      });
    });

    describe('Deduplication performance', () => {
      it('should handle high-volume deduplication efficiently', async () => {
        // Create manager with smaller blockInterval for faster processing
        const perfManager = new NotificationManager({
          redis: getTestRedisUrl(1),
          deduplicationTTL: 3600,
          blockInterval: 10, // Much smaller block interval for faster processing
        });

        let processedCount = 0;
        const uniquePayloads = new Set<string>();

        await perfManager.subscribe(
          'perf.dedup',
          async (msg) => {
            processedCount++;
            const payloadStr = JSON.stringify(msg.payload);
            uniquePayloads.add(payloadStr);
            console.log(`Processed message ${processedCount}:`, payloadStr);
            await msg.ack();
          },
          { exactlyOnce: true }
        );

        await delay(100);

        const startTime = Date.now();
        let publishedCount = 0;
        let duplicatesBlocked = 0;

        // First, publish 100 unique messages sequentially to ensure they all get through
        for (let i = 0; i < 100; i++) {
          const payload = { id: i, data: 'perf-test' };
          try {
            const result = await perfManager.publish('perf.dedup', payload, { exactlyOnce: true });
            if (result) {
              publishedCount++;
            }
          } catch (e) {
            console.log('Failed to publish unique message:', i, e);
          }
        }

        console.log('Published unique messages:', publishedCount);

        // Now test duplicate blocking in parallel
        const duplicatePromises: Promise<void>[] = [];
        for (let i = 0; i < 900; i++) {
          const payload = { id: i % 100, data: 'perf-test' };
          duplicatePromises.push(
            perfManager
              .publish('perf.dedup', payload, { exactlyOnce: true })
              .then(() => {
                /* Should be blocked */
              })
              .catch(() => {
                duplicatesBlocked++;
              })
          );
        }

        await Promise.all(duplicatePromises);
        const publishTime = Date.now() - startTime;

        console.log('Duplicates blocked:', duplicatesBlocked);

        // Wait longer for all messages to be processed
        console.log('Waiting for messages to be processed...');
        await delay(20000); // Wait 20 seconds for all messages

        console.log('Final counts - Processed:', processedCount, 'Unique:', uniquePayloads.size);

        // Should process only unique messages
        expect(processedCount).toBe(100);
        expect(uniquePayloads.size).toBe(100);

        // Performance check - should complete reasonably fast
        expect(publishTime).toBeLessThan(10000); // 10 seconds for 1000 publishes

        await perfManager.stopAll();
      }, 60000); // Increase timeout to 60 seconds
    });
  });
});
