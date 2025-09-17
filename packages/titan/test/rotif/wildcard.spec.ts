
import { delay } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/index.js';
import { getTestRedisUrl } from './helpers/test-utils.js';

describe('Rotif Wildcard Subscriptions', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = new NotificationManager({
      redis: getTestRedisUrl(1),
      maxRetries: 2,
      checkDelayInterval: 400,
      blockInterval: 100,
    });

    await manager.redis.flushdb();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('Dynamic Channel Addition', () => {
    it('should automatically subscribe to new channels matching wildcard', async () => {
      const received: string[] = [];

      await manager.subscribe('orders.*', async (msg) => {
        received.push(msg.channel);
      }, { startFrom: '0' });

      await delay(500);

      await manager.publish('orders.created', { id: 1 });
      await manager.publish('orders.updated', { id: 1 });
      await manager.publish('orders.deleted', { id: 1 });

      await delay(2000);

      expect(received).toEqual(['orders.created', 'orders.updated', 'orders.deleted']);
    });
  });

  describe('Wildcard Retry Handling', () => {
    it('should process retries correctly for wildcard subscriptions', async () => {
      let attempts = 0;

      await manager.subscribe('events.*', async (msg) => {
        attempts++;
        if (attempts < 2) throw new Error('Forced retry');
      }, { maxRetries: 2 });

      await delay(100);

      await manager.publish('events.retryTest', { id: 42 });

      await delay(3000);

      expect(attempts).toBe(2);
    });
  });

  describe('Wildcard Delayed Delivery', () => {
    it('should deliver delayed messages correctly to wildcard subscriptions', async () => {
      const messages: string[] = [];

      await manager.subscribe('tasks.*', async (msg) => {
        messages.push(msg.channel);
        await msg.ack();
      });

      await delay(100);

      await manager.publish('tasks.cleanup', {}, { delayMs: 1000 });

      expect(messages).toHaveLength(0);

      await delay(2000);

      expect(messages).toEqual(['tasks.cleanup']);
    });
  });

  describe('Wildcard High Channel Count Stability', () => {
    it('should handle wildcard subscriptions efficiently with many channels', async () => {
      const receivedChannels = new Set<string>();
      const BATCH_SIZE = 10;

      await manager.subscribe('metrics.*', async (msg) => {
        receivedChannels.add(msg.channel);
      });

      await delay(100);

      const publishPromises: Promise<any>[] = [];

      for (let i = 0; i < 100; i++) {
        publishPromises.push(manager.publish(`metrics.channel${i}`, { value: i }));

        if (publishPromises.length >= BATCH_SIZE) {
          await Promise.all(publishPromises);
          publishPromises.length = 0;
        }
      }

      if (publishPromises.length > 0) {
        await Promise.all(publishPromises);
      }

      // Ждем пока все сообщения будут обработаны
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (receivedChannels.size === 100) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      expect(receivedChannels.size).toBe(100);
    }, 20000);
  });

  describe('Wildcard Unsubscribe Handling', () => {
    it('should correctly unsubscribe from wildcard subscriptions', async () => {
      const messages: string[] = [];

      const sub = await manager.subscribe('logs.*', async (msg) => {
        messages.push(msg.channel);
        await msg.ack();
      });

      await delay(100);

      await manager.publish('logs.info', {});
      await delay(1000);

      await sub.unsubscribe(true);

      await manager.publish('logs.error', {});
      await delay(1000);

      expect(messages).toEqual(['logs.info']);

      await delay(100);
    });
  });


  describe('Wildcard DLQ Handling', () => {
    it('should correctly move failed wildcard subscription messages to DLQ', async () => {
      const dlqMessages: string[] = [];

      await manager.subscribe('alerts.*', async (msg) => {
        throw new Error('Force DLQ');
      }, { maxRetries: 1 });

      await delay(100);

      manager.subscribeToDLQ(async (msg) => {
        dlqMessages.push(msg.channel);
        await msg.ack();
      });

      await manager.publish('alerts.critical', {});

      await delay(3000);

      expect(dlqMessages).toEqual(['alerts.critical']);
    });
  });


  describe('DLQ - Requeue from DLQ', () => {
    it('should requeue messages from DLQ back to the original stream', async () => {
      const received: any[] = [];

      let failOnce = true;

      // Subscribe to channel and fail once to put msg in DLQ
      await manager.subscribe('dlq.*', async (msg) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('forced failure');
        }
        received.push(msg.payload);
      }, { maxRetries: 0 });

      await delay(100);

      // Publish message that will fail and go to DLQ
      await manager.publish('dlq.test', { data: 'important' });

      await delay(1000);

      expect(received.length).toBe(0); // msg initially not processed (in DLQ)

      // Now, requeue message from DLQ
      await manager.requeueFromDLQ();

      await delay(1000);

      expect(received.length).toBe(1);
      expect(received[0]).toEqual({ data: 'important' });
    }, 10000);
  });

  describe('Wildcard Resilience on Restart', () => {
    it('should restore wildcard subscriptions correctly after restart', async () => {
      const received: string[] = [];

      await manager.subscribe('sessions.*', async (msg) => {
        received.push(msg.channel);
        await msg.ack();
      });

      await delay(100);

      await manager.publish('sessions.start', {});
      await delay(1000);

      await manager.stopAll();

      // Создание нового manager'а
      manager = new NotificationManager({ redis: 'redis://localhost:6379/1', blockInterval: 100 });

      await manager.subscribe('sessions.*', async (msg) => {
        received.push(msg.channel);
        await msg.ack();
      });

      await delay(100);

      await manager.publish('sessions.end', {});
      await delay(1000);

      expect(received).toEqual(['sessions.start', 'sessions.end']);
    });
  });


  describe('Wildcard Exactly-Once Deduplication', () => {
    it('should deduplicate exactly-once messages across wildcard subscriptions', async () => {
      const messages: number[] = [];

      await manager.subscribe('notifications.*', async (msg) => {
        messages.push(msg.payload.id);
        await msg.ack();
      });

      await delay(100);

      const payload = { id: 123 };

      await manager.publish('notifications.push', payload, { exactlyOnce: true });
      await manager.publish('notifications.push', payload, { exactlyOnce: true });

      await delay(1500);

      expect(messages).toEqual([123]); // только одно сообщение принято
    });
  });
});
