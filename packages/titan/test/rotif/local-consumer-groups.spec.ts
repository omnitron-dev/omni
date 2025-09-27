import { delay } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/rotif.js';
import { getTestRedisUrl } from './helpers/test-utils.js';


describe('Multiple Subscribers Handling whithin one rotif instance', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = new NotificationManager({
      redis: getTestRedisUrl(1),
      maxRetries: 2,
      blockInterval: 100,
      localRoundRobin: true,
    });
    await manager.redis.flushdb();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('should deliver messages to multiple subscribers in the same default group once', async () => {
    const receivedA: any[] = [];
    const receivedB: any[] = [];

    await manager.subscribe('multi.test', async (msg) => {
      receivedA.push(msg.payload);
    });

    await manager.subscribe('multi.test', async (msg) => {
      receivedB.push(msg.payload);
    });

    await delay(100);

    await manager.publish('multi.test', { value: 'test' });

    await delay(1000);

    // Сообщение должно быть доставлено только одному из подписчиков
    expect(receivedA.length + receivedB.length).toBe(1);
  });

  it('should deliver messages independently when subscribers have unique groups', async () => {
    const receivedA: any[] = [];
    const receivedB: any[] = [];

    await manager.subscribe('multi.unique', async (msg) => {
      receivedA.push(msg.payload);
    }, { groupName: 'groupA' });

    await manager.subscribe('multi.unique', async (msg) => {
      receivedB.push(msg.payload);
    }, { groupName: 'groupB' });

    await delay(100);

    await manager.publish('multi.unique', { data: 'unique-groups' });

    await delay(1000);

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1); // Каждый consumer-group получает сообщение независимо

    expect(receivedA[0]).toEqual({ data: 'unique-groups' });
    expect(receivedB[0]).toEqual({ data: 'unique-groups' });
  });

  it('should handle mixed subscribers correctly (default and unique groups)', async () => {
    const receivedDefault: any[] = [];
    const receivedUnique: any[] = [];

    await manager.subscribe('multi.mixed', async (msg) => {
      receivedDefault.push(msg.payload);
    });

    await manager.subscribe('multi.mixed', async (msg) => {
      receivedUnique.push(msg.payload);
    }, { groupName: 'unique-group' });

    await delay(100);

    await manager.publish('multi.mixed', { data: 'mixed-test' });

    await delay(1000);

    expect(receivedDefault).toHaveLength(1);
    expect(receivedUnique).toHaveLength(1);

    expect(receivedDefault[0]).toEqual({ data: 'mixed-test' });
    expect(receivedUnique[0]).toEqual({ data: 'mixed-test' });
  });

});
