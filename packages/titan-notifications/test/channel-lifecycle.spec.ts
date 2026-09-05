import { describe, it, expect, vi } from 'vitest';

import { ChannelRegistry } from '../src/channel/channel-registry.js';
import { NotificationsService } from '../src/notifications.service.js';
import type { NotificationChannel } from '../src/channel/channel.interface.js';

/**
 * `NotificationChannel.shutdown()` is documented as "Shutdown the channel and
 * cleanup resources", the built-in channels leave it empty with "Override in
 * subclass if needed", and `ChannelRegistry.shutdownAll()` calls it — but
 * nothing in the package ever called `shutdownAll()`. A subclass that closes an
 * SMTP pool or an APNs connection there would never have been asked to.
 */
function makeChannel(name: string, calls: string[]): NotificationChannel {
  return {
    name,
    type: 'email' as any,
    initialize: async () => {
      calls.push(`init:${name}`);
    },
    shutdown: async () => {
      calls.push(`shutdown:${name}`);
    },
    isAvailable: async () => true,
    healthCheck: async () => ({ name, type: 'email' as any, available: true }),
    validateRecipient: () => true,
    formatContent: () => ({}) as any,
    send: async () => ({}) as any,
  };
}

describe('channel lifecycle', () => {
  it('shuts channels down when the service is destroyed', async () => {
    const calls: string[] = [];
    const registry = new ChannelRegistry();
    registry.register(makeChannel('a', calls));
    registry.register(makeChannel('b', calls));
    await registry.initializeAll();

    const transport = { destroy: vi.fn(async () => {}) };
    const service = new NotificationsService(
      transport as any,
      undefined,
      undefined,
      undefined,
      registry
    );

    await service.onDestroy();

    expect(calls.filter((c) => c.startsWith('shutdown:')).sort()).toEqual(['shutdown:a', 'shutdown:b']);
    // Channels stop delivering before the bus underneath them is torn down.
    expect(transport.destroy).toHaveBeenCalled();
  });

  it('does not discard a shutdownAll() that arrives while initializeAll() is awaiting', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow: NotificationChannel = {
      ...makeChannel('slow', calls),
      initialize: async () => {
        calls.push('init:slow');
        await gate;
      },
    };

    const registry = new ChannelRegistry();
    registry.register(slow);

    const initializing = registry.initializeAll();
    // `initialized` used to be assigned only after the awaits, so this read
    // `false`, concluded there was nothing to shut down and returned — leaving
    // every channel initialized and no shutdown() ever issued.
    const shuttingDown = registry.shutdownAll();
    release();
    await Promise.all([initializing, shuttingDown]);

    expect(calls).toContain('shutdown:slow');
    expect(registry.isInitialized).toBe(false);
  });
});
