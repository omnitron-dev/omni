import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import type { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestNotificationManager, getTestRedisConfig, isRedisInMockMode } from './helpers/test-utils.js';

const describeRedis = isRedisInMockMode() ? describe.skip : describe;

describeRedis('consumer retirement', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = await createTestNotificationManager(0, {
      blockInterval: 30_000,
      disableDelayed: true,
      disablePendingMessageRecovery: true,
    });
    await manager.waitUntilReady();
    await manager.redis.flushdb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await manager.stopAll();
  });

  const channel = 'retirement.message';
  const stream = `rotif:stream:${channel}`;

  async function blockedReaders() {
    const db = String(getTestRedisConfig(0).db);
    return String(await manager.redis.client('LIST')).trim().split('\n').filter(line => {
      const fields = Object.fromEntries(line.split(' ').map(field => field.split('=')));
      return fields.db === db && fields.name?.startsWith(`rotif-read:${stream}:`)
        && fields.flags?.includes('b') && fields.cmd === 'xreadgroup';
    });
  }

  it('closes only the last subscriber’s readers and delivers immediately after resubscription', async () => {
    const received: unknown[] = [];
    const first = await manager.subscribe(channel, async () => {});
    const second = await manager.subscribe(channel, async msg => { received.push(msg.payload); });
    await expect.poll(blockedReaders).toHaveLength(2);
    await first.unsubscribe();
    expect(await blockedReaders()).toHaveLength(2);
    await manager.publish(channel, { sequence: 0 });
    await expect.poll(() => received).toEqual([{ sequence: 0 }]);
    await expect.poll(blockedReaders).toHaveLength(2);

    await second.unsubscribe();
    await expect.poll(blockedReaders, { timeout: 2_000 }).toEqual([]);
    for (let sequence = 1; sequence <= 5; sequence++) {
      const sub = await manager.subscribe(channel, async msg => { received.push(msg.payload); });
      await expect.poll(blockedReaders).toHaveLength(2);
      await manager.publish(channel, { sequence });
      await expect.poll(() => received.length).toBe(sequence + 1);
      await sub.unsubscribe();
    }
    expect(received).toEqual(Array.from({ length: 6 }, (_, sequence) => ({ sequence })));
  });

  it('leaves a delivery pending when its read completes after retirement', async () => {
    let releaseRead!: () => void;
    const held = new Promise<void>(resolve => { releaseRead = resolve; });
    let readReturned = false;
    const original = Redis.prototype.xreadgroup;
    vi.spyOn(Redis.prototype, 'xreadgroup').mockImplementation(async function holdRetiredRead(...args) {
      const result = await Reflect.apply(original, this, args);
      if (!readReturned && args.includes(stream) && result) {
        readReturned = true;
        await held;
      }
      return result;
    });
    const retired = vi.fn();
    const sub = await manager.subscribe(channel, retired);
    try {
      await manager.publish(channel, { sequence: 'pending' });
      await expect.poll(() => readReturned).toBe(true);
      await sub.unsubscribe();
      const replacement = vi.fn();
      await manager.subscribe(channel, replacement);
      releaseRead();
      await manager.publish(channel, { sequence: 'new' });
      await expect.poll(() => replacement.mock.calls.length).toBe(1);
      expect(retired).not.toHaveBeenCalled();
      expect(replacement.mock.calls[0][0].payload).toEqual({ sequence: 'new' });
      const pending = await manager.redis.xpending(stream, `grp:${channel}`);
      expect(pending[0]).toBe(1);
    } finally {
      releaseRead();
    }
  });
});
