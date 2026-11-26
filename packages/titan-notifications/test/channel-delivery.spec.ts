import { describe, expect, it, vi } from 'vitest';
import { ChannelRegistry } from '../src/channel/channel-registry.js';
import { WebhookChannel } from '../src/channel/channels/webhook.channel.js';
import type { ChannelSendResult, NotificationChannel } from '../src/channel/channel.interface.js';
import { NotificationsService } from '../src/notifications.service.js';
import type { NotificationPayload, IRateLimiter, IPreferenceStore } from '../src/notifications.types.js';
import type { MessagingTransport, TransportPublishResult } from '../src/transport/transport.interface.js';

const recipient = { id: 'recipient' };
const payload: NotificationPayload = { type: 'alert', title: 'Disk', message: 'Threshold reached' };

export function recordingChannel(name: string, send: () => Promise<ChannelSendResult>): NotificationChannel {
  return { name, type: 'email', isAvailable: async () => true, validateRecipient: () => true,
    formatContent: value => ({ text: value.message }), healthCheck: async () => ({ name, type: 'email', available: true }), send };
}

function transport(status: TransportPublishResult['status'] = 'published') {
  return { publish: vi.fn(async () => ({
    status, success: ['published', 'scheduled', 'duplicate'].includes(status), messageIds: ['stream-entry'],
    patternCount: 1, timestamp: Date.now(),
  })) } as unknown as MessagingTransport;
}

describe('registered notification delivery', () => {
  it('retries explicit webhook throttling and preserves uncertain or rejected HTTP outcomes', async () => {
    const channel = new WebhookChannel({ retryDelay: 0 });
    const target = { id: 'operator', webhookUrl: 'https://example.test/signal' };
    const content = channel.formatContent(payload);
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      fetch.mockResolvedValueOnce(new Response(null, { status: 429 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(await channel.send(target, content)).toMatchObject({ success: true, metadata: { attempts: 2, statusCode: 204 } });
      fetch.mockResolvedValueOnce(new Response(null, { status: 400 }));
      expect(await channel.send(target, content)).toMatchObject({ success: false, unconfirmed: false, metadata: { attempts: 1 } });
      fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
      expect(await channel.send(target, content)).toMatchObject({ success: false, unconfirmed: true, metadata: { attempts: 1 } });
      fetch.mockRejectedValueOnce(Error('Connection lost'));
      expect(await channel.send(target, content)).toMatchObject({ success: false, unconfirmed: true, metadata: { attempts: 1 } });
      expect(fetch).toHaveBeenCalledTimes(5);
      expect(() => channel.configure({ retries: Infinity })).toThrow('Invalid webhook retries');
      expect(() => channel.configure({ validateSSL: false })).toThrow('certificate validation');
    } finally {
      fetch.mockRestore();
    }
  });

  it('exposes broker acceptance without inventing a provider receipt', async () => {
    const service = new NotificationsService(transport());
    expect(await service.send(recipient, payload, { channels: ['mail'] })).toMatchObject({ status: 'queued', channels: [] });
    expect(await service.broadcast([recipient], payload)).toMatchObject({ pendingCount: 1, successCount: 0 });
  });

  it('preserves the accepted provider receipt when rate accounting fails', async () => {
    const channels = new ChannelRegistry();
    const send = vi.fn(async () => ({ success: true, messageId: 'provider-receipt' }));
    channels.register(recordingChannel('mail', send));
    const limiter: IRateLimiter = { checkLimit: async () => ({ allowed: true }),
      recordSent: async () => { throw Error('Quota store unavailable'); }, reset: async () => {} };
    const service = new NotificationsService(transport(), limiter, undefined, undefined, channels);
    expect(await service.send(recipient, payload, { channels: ['mail'] })).toMatchObject({
      status: 'sent', channels: [{ channel: 'mail', messageId: 'provider-receipt' }],
      accountingErrors: [{ channel: 'mail', error: 'Quota store unavailable' }],
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('returns a failed provider receipt and never charges for it', async () => {
    const channels = new ChannelRegistry();
    channels.register(recordingChannel('primary', async () => ({ success: false, error: 'Recipient rejected' })));
    const recordSent = vi.fn();
    const limiter = { checkLimit: async () => ({ allowed: true }), recordSent } as unknown as IRateLimiter;
    const service = new NotificationsService(transport(), limiter, undefined, undefined, channels);
    expect(await service.send(recipient, payload, { channels: ['primary'] })).toMatchObject({
      status: 'failed', channels: [{ channel: 'primary', status: 'failed' }], error: 'Recipient rejected',
    });
    expect(recordSent).not.toHaveBeenCalled();
  });

  it('applies preferences and quotas to fallback channels, stops at the first success and preserves options', async () => {
    const channels = new ChannelRegistry();
    const calls: string[] = [];
    for (const name of ['primary', 'muted', 'limited', 'standby', 'extra']) {
      channels.register(recordingChannel(name, async () => { calls.push(name); return { success: name !== 'primary' }; }));
    }
    const recordSent = vi.fn();
    const limiter = { checkLimit: async (_id: string, channel: string) => ({ allowed: channel !== 'limited' }), recordSent } as unknown as IRateLimiter;
    const prefs = { getPreferences: async () => ({ channels: { muted: { enabled: false } } }) } as unknown as IPreferenceStore;
    const service = new NotificationsService(transport(), limiter, prefs, undefined, channels);
    const options = { channels: ['primary', 'muted'], fallbackChannels: ['primary', 'muted', 'limited', 'standby', 'extra'] };
    const result = await service.send(recipient, payload, options);
    expect(result.status).toBe('sent');
    expect(result.channels.map(c => [c.channel, c.status])).toEqual([['primary','failed'], ['limited','skipped'], ['standby','success']]);
    expect(calls).toEqual(['primary', 'standby']);
    expect(recordSent.mock.calls).toEqual([['recipient', 'standby', 'alert']]);
    expect(options.channels).toEqual(['primary', 'muted']);
  });

  it('does not try an alternative after an unconfirmed external effect', async () => {
    const channels = new ChannelRegistry();
    const fallback = vi.fn(async () => ({ success: true }));
    channels.register(recordingChannel('primary', async () => { throw Error('Lost response'); }));
    channels.register(recordingChannel('fallback', fallback));
    const service = new NotificationsService(transport(), undefined, undefined, undefined, channels);
    expect(await service.send(recipient, payload, { channels: ['primary'], fallbackChannels: ['fallback'] }))
      .toMatchObject({ status: 'unconfirmed', channels: [{ channel: 'primary', status: 'unconfirmed' }] });
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(['failed','duplicate','scheduled'] as const)('does not make an inline delivery on %s', async status => {
    const channels = new ChannelRegistry();
    const send = vi.fn(async () => ({ success: true }));
    channels.register(recordingChannel('primary', send));
    const service = new NotificationsService(transport(status), undefined, undefined, undefined, channels);
    const result = await service.send(recipient, payload, { channels: ['primary'] });
    expect(result.channels).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('counts partial sends, confirmed alternatives and thrown publications through broadcast', async () => {
    const channels = new ChannelRegistry();
    channels.register(recordingChannel('mail', async () => ({ success: true })));
    channels.register(recordingChannel('text', async () => ({ success: false, error: 'Declined' })));
    const broker = transport();
    vi.mocked(broker.publish).mockRejectedValueOnce(Error('Broker offline'));
    const service = new NotificationsService(broker, undefined, undefined, undefined, channels, { defaultChannels: ['mail','text'] });
    expect(await service.broadcast([{ id: 'a' }, {id: 'b'}], payload)).toMatchObject({
      totalRecipients: 2, failureCount: 1, partialCount: 1, successCount: 0, pendingCount: 0,
    });
  });
});
