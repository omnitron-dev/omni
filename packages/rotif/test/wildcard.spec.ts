import { NotificationManager } from '../src/rotif';

describe('Rotif Wildcard Subscriptions', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = new NotificationManager({
      redis: 'redis://localhost:6379/1',
      enableDelayed: true,
      maxRetries: 2,
      checkDelayInterval: 500,
      blockInterval: 500,
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
        await msg.ack();
      }, { startFrom: '0' });

      await new Promise(resolve => setTimeout(resolve, 500));

      await manager.publish('orders.created', { id: 1 });
      await manager.publish('orders.updated', { id: 1 });

      await manager.publish('orders.deleted', { id: 1 });

      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(received).toEqual(['orders.created', 'orders.updated', 'orders.deleted']);
    });
  });

  // describe('Wildcard Retry Handling', () => {
  //   it('should process retries correctly for wildcard subscriptions', async () => {
  //     let attempts = 0;

  //     await manager.subscribe('events.*', async (msg) => {
  //       attempts++;
  //       if (attempts < 2) throw new Error('Forced retry');
  //       await msg.ack();
  //     }, { maxRetries: 2 });

  //     await manager.publish('events.retryTest', { id: 42 });

  //     await new Promise(resolve => setTimeout(resolve, 3000));

  //     expect(attempts).toBe(2);
  //   });
  // });

  // describe('Wildcard Exactly-Once Deduplication', () => {
  //   it('should deduplicate exactly-once messages across wildcard subscriptions', async () => {
  //     const messages: number[] = [];

  //     await manager.subscribe('notifications.*', async (msg) => {
  //       messages.push(msg.payload.id);
  //       await msg.ack();
  //     });

  //     const payload = { id: 123 };

  //     await manager.publish('notifications.push', payload, { exactlyOnce: true });
  //     await manager.publish('notifications.push', payload, { exactlyOnce: true });

  //     await new Promise(resolve => setTimeout(resolve, 1500));

  //     expect(messages).toEqual([123]); // только одно сообщение принято
  //   });
  // });

  // describe('Wildcard Delayed Delivery', () => {
  //   it('should deliver delayed messages correctly to wildcard subscriptions', async () => {
  //     const messages: string[] = [];

  //     await manager.subscribe('tasks.*', async (msg) => {
  //       messages.push(msg.channel);
  //       await msg.ack();
  //     });

  //     await manager.publish('tasks.cleanup', {}, { delayMs: 1000 });

  //     expect(messages).toHaveLength(0);

  //     await new Promise(resolve => setTimeout(resolve, 1500));

  //     expect(messages).toEqual(['tasks.cleanup']);
  //   });
  // });

  // describe('Wildcard High Channel Count Stability', () => {
  //   it('should handle wildcard subscriptions efficiently with many channels', async () => {
  //     const receivedChannels = new Set<string>();

  //     await manager.subscribe('metrics.*', async (msg) => {
  //       receivedChannels.add(msg.channel);
  //       await msg.ack();
  //     });

  //     for (let i = 0; i < 100; i++) {
  //       await manager.publish(`metrics.channel${i}`, { value: i });
  //     }

  //     await new Promise(resolve => setTimeout(resolve, 3000));

  //     expect(receivedChannels.size).toBe(100);
  //   });
  // });

  // describe('Wildcard Unsubscribe Handling', () => {
  //   it('should correctly unsubscribe from wildcard subscriptions', async () => {
  //     const messages: string[] = [];

  //     const sub = await manager.subscribe('logs.*', async (msg) => {
  //       messages.push(msg.channel);
  //       await msg.ack();
  //     });

  //     await manager.publish('logs.info', {});
  //     await new Promise(resolve => setTimeout(resolve, 1000));

  //     await sub.unsubscribe();

  //     await manager.publish('logs.error', {});
  //     await new Promise(resolve => setTimeout(resolve, 1000));

  //     expect(messages).toEqual(['logs.info']);
  //   });
  // });


  // describe('Wildcard DLQ Handling', () => {
  //   it('should correctly move failed wildcard subscription messages to DLQ', async () => {
  //     const dlqMessages: string[] = [];

  //     await manager.subscribe('alerts.*', async (msg) => {
  //       throw new Error('Force DLQ');
  //     }, { maxRetries: 1 });

  //     await manager.subscribeToDLQ(async (msg) => {
  //       dlqMessages.push(msg.channel);
  //       await msg.ack();
  //     });

  //     await manager.publish('alerts.critical', {});

  //     await new Promise(resolve => setTimeout(resolve, 3000));

  //     expect(dlqMessages).toEqual(['alerts.critical']);
  //   });
  // });

  // describe('Wildcard Resilience on Restart', () => {
  //   it('should restore wildcard subscriptions correctly after restart', async () => {
  //     const received: string[] = [];

  //     await manager.subscribe('sessions.*', async (msg) => {
  //       received.push(msg.channel);
  //       await msg.ack();
  //     });

  //     await manager.publish('sessions.start', {});
  //     await new Promise(resolve => setTimeout(resolve, 1000));

  //     await manager.stopAll();

  //     // Создание нового manager'а
  //     manager = new NotificationManager({ redis: 'redis://localhost:6379/1' });

  //     await manager.subscribe('sessions.*', async (msg) => {
  //       received.push(msg.channel);
  //       await msg.ack();
  //     });

  //     await manager.publish('sessions.end', {});
  //     await new Promise(resolve => setTimeout(resolve, 1000));

  //     expect(received).toEqual(['sessions.start', 'sessions.end']);
  //   });
  // });
});
