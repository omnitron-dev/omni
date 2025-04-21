import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { NotificationManager } from '../src';

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';
const parsed = new URL(REDIS_URL);

describe('NotificationManager - Pub/Sub mode', () => {
  let manager: NotificationManager;
  let publisher: Redis;

  beforeAll(async () => {
    manager = new NotificationManager({
      redis: {
        host: parsed.hostname,
        port: parseInt(parsed.port || '6379'),
        db: 1,
      },
      enableDelayed: false,
      blockInterval: 100,
    });

    publisher = new Redis({
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379'),
      db: 1,
    });

    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
    await publisher.quit();
  });

  it('should deliver messages via Pub/Sub mode', async () => {
    const receivedMessages: any[] = [];

    await manager.subscribe('channel.test', async (msg) => {
      receivedMessages.push(msg);
    }, { usePubSub: true });

    await delay(100);

    const payload = { text: 'Hello PubSub!' };
    await publisher.publish('channel.test', JSON.stringify({ payload }));

    await delay(500);

    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0].channel).toBe('channel.test');
    expect(receivedMessages[0].payload).toEqual(payload);
  });

  it('should support wildcard patterns in Pub/Sub', async () => {
    const wildcardMessages: any[] = [];

    await manager.subscribe('channel.*', async (msg) => {
      wildcardMessages.push(msg);
    }, { usePubSub: true });

    await delay(100);

    const payloadA = { id: 'A' };
    const payloadB = { id: 'B' };

    await publisher.publish('channel.one', JSON.stringify({ payload: payloadA }));
    await publisher.publish('channel.two', JSON.stringify({ payload: payloadB }));

    await delay(500);

    expect(wildcardMessages.length).toBe(2);
    expect(wildcardMessages[0].channel).toBe('channel.one');
    expect(wildcardMessages[0].payload).toEqual(payloadA);
    expect(wildcardMessages[1].channel).toBe('channel.two');
    expect(wildcardMessages[1].payload).toEqual(payloadB);
  });
});
