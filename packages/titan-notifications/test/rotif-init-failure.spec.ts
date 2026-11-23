import { afterEach, describe, expect, it, vi } from 'vitest';
import { defer } from '@omnitron-dev/common';
import { NotificationManager } from '../src/rotif/rotif.js';
import { getTestRedisUrl } from './rotif/helpers/test-utils.js';

describe('notification manager readiness', () => {
  let manager: NotificationManager | undefined;

  afterEach(async () => {
    try {
      await manager?.destroy();
    } finally {
      vi.restoreAllMocks();
    }
  });

  function start() {
    const scripts = defer<void>();
    vi.spyOn(NotificationManager.prototype, 'loadLuaScripts').mockReturnValueOnce(scripts.promise);
    manager = new NotificationManager({
      redis: getTestRedisUrl(0),
      disableDelayed: true,
      enableHealthCheck: false,
    });
    return { manager, scripts };
  }

  it('propagates initialization failures to readiness and waiting publishers', async () => {
    const { manager, scripts } = start();
    const failure = new Error('cannot open pattern updates');
    const startup = manager as unknown as { subscribeToPatternUpdates(): void };
    vi.spyOn(startup, 'subscribeToPatternUpdates').mockImplementation(() => { throw failure; });
    const waiters = Promise.all([
      expect(manager.waitUntilReady()).rejects.toBe(failure),
      expect(manager.publish('notice', 'queued')).rejects.toBe(failure),
    ]);
    scripts.resolve();
    await waiters;
  });

  it.each(['stopAll', 'destroy'] as const)('%s releases callers while initialization is pending', async (shutdown) => {
    const { manager, scripts } = start();
    const waiters = Promise.all([
      expect(manager.waitUntilReady()).rejects.toThrow('stopped during initialization'),
      expect(manager.publish('notice', 'queued')).rejects.toThrow('stopped during initialization'),
    ]);
    await manager[shutdown]();
    await waiters;
    scripts.resolve();
    await expect(manager.waitUntilReady()).rejects.toThrow('stopped during initialization');
  }, 5_000);
});
