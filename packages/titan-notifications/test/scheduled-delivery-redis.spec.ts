import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelRegistry } from '../src/channel/channel-registry.js';
import { NotificationsService } from '../src/notifications.service.js';
import { NotificationManager } from '../src/rotif/rotif.js';
import { RotifTransport } from '../src/transport/rotif.transport.js';
import type { ChannelSendResult } from '../src/channel/channel.interface.js';
import type { NotificationPayload } from '../src/notifications.types.js';
import { getTestRedisUrl, isInMockMode } from './rotif/helpers/test-utils.js';

describe.skipIf(isInMockMode())('scheduled channel delivery through Rotif', () => {
  const services = new Set<NotificationsService>();
  const recipient = { id: 'operator' };
  function notification(): NotificationPayload & { id: string } {
    return { id: randomUUID(), type: 'alert', title: 'Threshold reached', message: 'Disk' };
  }
  async function replica(scope: string, send: () => Promise<ChannelSendResult>) {
    const manager = new NotificationManager({ redis: getTestRedisUrl(0), checkDelayInterval: 20, blockInterval: 20 });
    const transport = new RotifTransport(manager);
    const registry = new ChannelRegistry();
    registry.register({ name: 'mail', type: 'email', send, validateRecipient: () => true, isAvailable: async () => true,
      healthCheck: async () => ({ name: 'mail', type: 'email', available: true }), formatContent: p => ({ text: p.message }) });
    const service = new NotificationsService(transport, undefined, undefined, undefined, registry,
      { deliveryScope: scope, defaultChannels: ['mail'] });
    services.add(service);
    await service.onStart();
    return { service, transport };
  }
  afterEach(async () => {
    await Promise.all(Array.from(services, service => service.onDestroy()));
    services.clear();
  });

  it('retains an acknowledged schedule across publisher exit and lost replies; two replicas deliver once', async () => {
    const scope = randomUUID();
    const delivered: number[] = [];
    const send = async () => { delivered.push(Date.now()); return { success: true, messageId: 'mail-receipt' }; };
    const publisher = await replica(scope, send);
    const payload = notification();
    const due = Date.now() + 1000;
    const created = await publisher.service.schedule(recipient, payload, due);
    expect(created).toMatchObject({ notificationId: payload.id, status: 'scheduled', channels: [] });
    expect(delivered).toEqual([]);
    await publisher.service.onDestroy();
    services.delete(publisher.service);
    const [first, second] = await Promise.all([replica(scope, send), replica(scope, send)]);
    await expect(second.service.schedule({ id: 'other' }, payload, due)).rejects.toThrow(/another request/);
    await vi.waitFor(async () => expect(await first.service.getStatus(payload.id)).toMatchObject({
      status: 'sent', channels: [{ channel: 'mail', messageId: 'mail-receipt' }],
    }), { timeout: 8000 });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toBeGreaterThanOrEqual(due);
    expect(await second.service.schedule(recipient, payload, due)).toMatchObject({ notificationId: payload.id, status: 'sent' });
    expect(await first.service.cancel(payload.id)).toBe(false);
    expect(delivered).toHaveLength(1);
  });

  it('cancels from another replica and binds the receipt to the delivery scope', async () => {
    const scope = randomUUID();
    const send = vi.fn(async () => ({ success: true }));
    const [a, b, other] = await Promise.all([replica(scope, send), replica(scope, send), replica(randomUUID(), send)]);
    const payload = notification();
    const due = Date.now() + 450;
    await a.service.schedule(recipient, payload, due);
    expect(await other.service.cancel(payload.id)).toBe(false);
    expect(await other.service.getStatus(payload.id)).toBeNull();
    expect(await b.service.cancel(payload.id)).toBe(true);
    expect(await a.service.cancel(payload.id)).toBe(true);
    expect(await a.service.schedule(recipient, payload, due)).toMatchObject({ status: 'cancelled' });
    const witness = notification();
    await b.service.schedule(recipient, witness, due + 60);
    await vi.waitFor(async () => expect(await a.service.getStatus(witness.id)).toMatchObject({ status: 'sent' }), { timeout: 8000 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await b.service.getStatus(payload.id)).toMatchObject({ status: 'cancelled' });
  });

  it('keeps an unresolved provider receipt and rejects cancellation after claim', async () => {
    const scope = randomUUID();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const send = vi.fn(async () => { await gate; throw Error('Provider response lost'); });
    const [a, b] = await Promise.all([replica(scope, send), replica(scope, send)]);
    const payload = notification();
    const due = Date.now() + 80;
    try {
      await a.service.schedule(recipient, payload, due);
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce(), { timeout: 8000 });
      expect(await b.service.getStatus(payload.id)).toMatchObject({ status: 'unconfirmed' });
      expect(await b.service.cancel(payload.id)).toBe(false);
      expect(await b.service.schedule(recipient, payload, due)).toMatchObject({ status: 'unconfirmed' });
    } finally {
      release();
    }
    await vi.waitFor(async () => expect(await a.service.getStatus(payload.id)).toMatchObject({
      status: 'unconfirmed', channels: [{ channel: 'mail', status: 'unconfirmed', error: 'Provider response lost' }],
    }), { timeout: 8000 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
