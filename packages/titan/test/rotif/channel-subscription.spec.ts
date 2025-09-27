
import { delay, defer } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestConfig } from './helpers/test-utils.js';

describe('NotificationManager – Channel Subscription Tests', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = new NotificationManager(createTestConfig(1, {
      blockInterval: 100,
    }));
    await manager.redis.flushdb();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('should deliver messages only to exact matching subscribers', async () => {
    const received: any[] = [];

    await manager.subscribe('users.signup', async (msg) => {
      received.push(msg.payload);
      await msg.ack();
    });

    await manager.publish('users.signup', { userId: 1 });
    await manager.publish('users.signin', { userId: 2 });

    await delay(500);

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ userId: 1 });
  }, 10000);

  it('should not deliver messages to unsubscribed channels', async () => {
    const received: any[] = [];

    await manager.subscribe('users.signup', async (msg) => {
      received.push(msg.payload);
      await msg.ack();
    });

    await manager.publish('users.signout', { userId: 3 });

    await delay(500);

    expect(received).toHaveLength(0);
  }, 10000);

  it('should deliver to multiple subscribers with overlapping patterns', async () => {
    const received: string[] = [];
    const def = defer();

    await manager.subscribe('users.signout', async (msg) => {
      received.push(`users.signout:${msg.channel}`);
      await msg.ack();
      if (received.length === 2) {
        def.resolve?.(undefined);
      }
    }, { groupName: 'g1' });

    await manager.subscribe('users.signout', async (msg) => {
      received.push(`users.signout:${msg.channel}`);
      await msg.ack();
      if (received.length === 2) {
        def.resolve?.(undefined);
      }
    }, { groupName: 'g2' });

    // Small delay to ensure both consumer loops are ready
    await delay(100);

    await manager.publish('users.signout', {});

    await def.promise;

    expect(received).toEqual(
      expect.arrayContaining(['users.signout:users.signout', 'users.signout:users.signout']),
    );
    expect(received.length).toBe(2);
  }, 10000);

  it('should correctly handle exactly-once delivery', async () => {
    const attempts: number[] = [];
    const received: any[] = [];
    const def = defer();

    await manager.subscribe('users.signup', async (msg) => {
      attempts.push(msg.attempt);
      received.push(msg.payload);
      throw new Error('forced error');
    }, {
      exactlyOnce: true,
      maxRetries: 2,
      retryDelay: 50,
    });

    const dlqMsgs: any[] = [];
    manager.subscribeToDLQ(async (msg) => {
      dlqMsgs.push(msg.payload);
      await msg.ack();
      def.resolve?.(undefined);
    });

    await manager.publish('users.signup', { userId: 10 });

    await def.promise;

    // maxRetries: 2 means 2 retries AFTER the first attempt, so 3 total attempts
    expect(attempts).toEqual([1, 2, 3]);
    expect(received).toEqual([{ userId: 10 }, { userId: 10 }, { userId: 10 }]);
    expect(dlqMsgs).toEqual([{ userId: 10 }]);
  }, 10000);

  it('should correctly process delayed messages', async () => {
    const timestamps: number[] = [];
    const start = Date.now();
    const def = defer();

    await manager.subscribe('notifications.reminder', async (msg) => {
      timestamps.push(Date.now() - start);
      await msg.ack();
      def.resolve?.(undefined);
    }, { startFrom: '0' });

    await delay(400);

    await manager.publish('notifications.reminder', {}, { delayMs: 500 });

    await def.promise;

    expect(timestamps.length).toBe(1);
    expect(timestamps[0]).toBeGreaterThanOrEqual(500);
  }, 10000);


  // it('should requeue messages from DLQ correctly', async () => {
  //   const received: any[] = [];
  //   let fail = true;

  //   await manager.subscribe('payments.failed', async (msg) => {
  //     if (fail) {
  //       fail = false;
  //       throw new Error('forced error');
  //     }
  //     received.push(msg.payload);
  //     await msg.ack();
  //   }, { maxRetries: 0 });

  //   await manager.publish('payments.failed', { paymentId: 5 });

  //   await delay(1000);

  //   expect(received.length).toBe(0);

  //   await manager.requeueFromDLQ();

  //   await delay(500);

  //   expect(received).toEqual([{ paymentId: 5 }]);
  // });
});
