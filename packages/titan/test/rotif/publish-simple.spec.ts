import Redis from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestConfig } from './helpers/test-utils.js';

describe('Lua Script - Atomic Publish', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    manager = new NotificationManager(createTestConfig(1, { blockInterval: 100 }));
    redis = manager.redis;
    await redis.flushdb();

    // Фиктивный обработчик для активации паттерна
    await manager.subscribe('test.channel', async () => { }, { startFrom: '0' });
    await manager.subscribe('test.delayed', async () => { }, { startFrom: '0' });

    // Ждём, пока паттерны гарантированно появятся
    await waitForActivePatterns(manager, ['test.channel', 'test.delayed']);
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should atomically publish normal messages to active pattern streams', async () => {
    const channel = 'test.channel';
    const id = await manager.publish(channel, { msg: 'hello' });
    expect(typeof id).toBe('string');

    // убедимся, что проверяем правильный стрим
    const messages = await redis.xrange(`rotif:stream:${channel}`, '-', '+');
    if (messages.length === 0) {
      // отладочная информация, чтобы понять, в какие стримы ушло сообщение
      const keys = await redis.keys('rotif:stream:*');
      console.log('Existing streams:', keys);
    }
    expect(messages.length).toBe(1);
  });

  it('should atomically schedule delayed messages', async () => {
    const result = await manager.publish('test.delayed', { msg: 'delayed hello' }, { delayMs: 5000 });
    expect(result).toBe('SCHEDULED');

    const scheduled = await redis.zrange('rotif:scheduled', 0, -1);
    expect(scheduled.length).toBe(1);
  });
});

// Вспомогательная функция для ожидания активации паттернов
async function waitForActivePatterns(manager: NotificationManager, patterns: string[], timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const allActive = patterns.every(pattern => manager['activePatterns'].has(pattern));
    if (allActive) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Patterns not activated in time: ${patterns}`);
}