import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { Container } from '@omnitron-dev/titan/nexus';
import { DiagnosticNotificationSink, DiagnosticNotificationsModule, DIAGNOSTIC_NOTIFICATION_SINK } from '../src/diagnostics.js';
import { NotificationsModule } from '../src/notifications.module.js';
import { NotificationsEventEmitter } from '../src/notifications.events.js';
import { NotificationsHealthIndicator } from '../src/notifications.health.js';
import type { DiagnosticEvent } from '@omnitron-dev/titan/diagnostics';
import type { EventsService } from '@omnitron-dev/titan-events';
import type { ILoggerModule } from '@omnitron-dev/titan/module/logger';
import type { MessagingTransport } from '../src/transport/transport.interface.js';

const event: DiagnosticEvent = { eventId: 'test-1', id: 'db.unavailable', source: 'test', timestamp: 1,
  state: 'raised', severity: 'critical', title: 'Database unavailable', evidence: ['password=secret'] };

describe('diagnostic transport adapter', () => {
  it('resolves through the configured Titan module without creating another transport', async () => {
    const publish = vi.fn().mockResolvedValue({ success: true, status: 'published', messageIds: ['di-message'] });
    const transport = { publish } as unknown as MessagingTransport;
    const module = DiagnosticNotificationsModule.forRoot({
      notifications: NotificationsModule.forRoot({ transport: { useTransport: transport } }),
      channel: 'operations.test',
    });
    const container = new Container();
    try {
      container.loadModule({ ...module, name: module.module.name });
      const sink = await container.resolveAsync(DIAGNOSTIC_NOTIFICATION_SINK);
      await sink.deliver(event);
      expect(publish.mock.calls[0]?.[0]).toBe('operations.test');
    } finally { await container.dispose(); }
  });
  it('uses the configured transport and a stable dedup key, without leaking credentials', async () => {
    const publish = vi.fn().mockResolvedValue({ success: true, status: 'published', messageIds: ['message-1'] });
    const sink = new DiagnosticNotificationSink({ publish });
    expect(await sink.deliver(event)).toEqual({ status: 'queued', messageIds: ['message-1'] });
    expect(JSON.stringify(publish.mock.calls)).not.toContain('secret');
    expect(publish.mock.calls[0]?.[2]).toMatchObject({ dedupKey: 'diagnostic:test-1:raised', priority: 'urgent' });
    publish.mockResolvedValueOnce({ success: true, status: 'duplicate', messageIds: [] });
    expect((await sink.deliver(event)).status).toBe('duplicate');
  });

  it('does not claim success without a consumer or a broker acknowledgement', async () => {
    const publish = vi.fn().mockResolvedValue({ success: true, status: 'no_subscribers', messageIds: [] });
    const sink = new DiagnosticNotificationSink({ publish });
    await expect(sink.deliver(event)).rejects.toMatchObject({ code: 'DIAGNOSTIC_DELIVERY_UNAVAILABLE', status: 'no_subscribers' });
    publish.mockRejectedValueOnce(new Error('offline'));
    await expect(sink.deliver(event)).rejects.toThrow('offline');
    await expect(sink.deliver({ ...event, state: 'invalid' } as unknown as DiagnosticEvent)).rejects.toThrow('state');
    expect(publish).toHaveBeenCalledTimes(2);
  });
});

describe('notification observer failures', () => {
  it('preserves a successful send while reporting handler failure through health until recovery', async () => {
    const emitAsync = vi.fn().mockRejectedValueOnce(new Error('password=hidden'));
    const logger = { error: vi.fn() };
    const events = new NotificationsEventEmitter({ emitAsync } as unknown as EventsService, { logger } as unknown as ILoggerModule);
    const health = new NotificationsHealthIndicator({ healthCheck: async () => ({ status: 'healthy', connected: true, timestamp: 1 }) } as MessagingTransport, events);
    await events.emitScheduled('sent-id', 1);
    expect((await health.check()).status).toBe('degraded');
    expect(events.snapshot().failures).toBe(1);
    expect(JSON.stringify(events.snapshot())).not.toContain('hidden');
    expect(logger.error).toHaveBeenCalledOnce();
    emitAsync.mockResolvedValueOnce([]);
    await events.emitScheduled('sent-id-2', 2);
    expect((await health.check()).status).toBe('healthy');
  });
});
