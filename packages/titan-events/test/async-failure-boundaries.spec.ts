import { describe, expect, it, vi } from 'vitest';
import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { EventsService } from '../src/events.service.js';
import { EventMetadataService } from '../src/event-metadata.service.js';

describe('asynchronous event failure boundaries', () => {
  it.each([false, true])('propagates wildcard failures (async=%s) without skipping regular handlers', async (asyncFailure) => {
    const events = new EventsService(new EnhancedEventEmitter(), new EventMetadataService());
    const regular = vi.fn(async () => 'completed');
    events.subscribe('notification.sent', regular);
    events.subscribe('notification.*', asyncFailure ? async () => { throw new Error('observer'); } : () => { throw new Error('observer'); });
    await expect(events.emitAsync('notification.sent', { id: 1 })).rejects.toThrow('observer');
    expect(regular).toHaveBeenCalledOnce();
    expect(events.getStatistics('notification.sent')).toMatchObject({ emitCount: 1, errorCount: 1 });
    await events.onDestroy();
  });
});
