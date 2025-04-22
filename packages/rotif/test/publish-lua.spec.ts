import Redis from 'ioredis';

import { NotificationManager } from '../src';

describe('Lua Script - Atomic Publish', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    manager = new NotificationManager({ redis: { db: 1 } });
    redis = manager.redis;
    await redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should atomically publish normal messages', async () => {
    const id = await manager.publish('test.channel', { msg: 'hello' });
    expect(typeof id).toBe('string');

    const messages = await redis.xrange('rotif:stream:test.channel', '-', '+');
    expect(messages.length).toBe(1);
  });

  it('should atomically schedule delayed messages', async () => {
    const result = await manager.publish('test.delayed', { msg: 'delayed hello' }, { delayMs: 5000 });
    expect(result).toBe('SCHEDULED');

    const scheduled = await redis.zrange('rotif:scheduled', 0, -1);
    expect(scheduled.length).toBe(1);
  });
});
