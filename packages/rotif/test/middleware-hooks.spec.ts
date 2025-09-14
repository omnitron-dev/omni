import { delay } from '@omnitron-dev/common';
import { it, expect, afterAll, describe, beforeAll } from '@jest/globals';

import { Middleware, NotificationManager } from '../src';
import { createTestConfig } from './helpers/test-utils';

describe('Middleware - hooks', () => {
  let manager: NotificationManager;

  beforeAll(async () => {
    manager = new NotificationManager(createTestConfig(1, {
      checkDelayInterval: 100,
      blockInterval: 100,
    });

    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should trigger middleware hooks', async () => {
    const calls: string[] = [];

    let resolveTest: () => void;
    let resolveError: () => void;

    const testProcessed = new Promise<void>(resolve => resolveTest = resolve);
    const errorProcessed = new Promise<void>(resolve => resolveError = resolve);

    const middleware: Middleware = {
      beforePublish: async (channel, payload) => {
        calls.push(`beforePublish:${channel}:${payload.data}`);
      },
      afterPublish: async (channel, payload, id) => {
        calls.push(`afterPublish:${channel}:${id}`);
      },
      beforeProcess: async (msg) => {
        calls.push(`beforeProcess:${msg.channel}:${msg.payload.data}`);
      },
      afterProcess: async (msg) => {
        calls.push(`afterProcess:${msg.channel}:${msg.payload.data}`);
        if (msg.payload.data === 'test') resolveTest();
      },
      onError: async (msg, err) => {
        calls.push(`onError:${msg.channel}:${err.message}`);
        if (msg.payload.data === 'error') resolveError();
      },
    };

    manager.use(middleware);

    await manager.subscribe('test.middleware', async (msg) => {
      if (msg.payload.data === 'error') throw new Error('test error');
    }, { startFrom: '0' });

    await delay(400);

    // Отправляем первое сообщение и ждём его полной обработки
    const id1 = await manager.publish('test.middleware', { data: 'test' });
    await testProcessed;

    // Только после этого отправляем второе сообщение
    const id2 = await manager.publish('test.middleware', { data: 'error' });
    await errorProcessed;

    expect(calls).toEqual([
      `beforePublish:test.middleware:test`,
      `afterPublish:test.middleware:${id1}`,
      `beforeProcess:test.middleware:test`,
      `afterProcess:test.middleware:test`,
      `beforePublish:test.middleware:error`,
      `afterPublish:test.middleware:${id2}`,
      `beforeProcess:test.middleware:error`,
      `onError:test.middleware:test error`,
    ]);
  }, 10000);
});
