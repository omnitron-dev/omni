/**
 * `BroadcastOptions.filters` is the option whose failure mode is the wrong
 * direction: a filter that is ignored does not send too few notifications, it
 * sends them to everyone the caller meant to exclude. `RecipientFilter` even
 * spells out eight operators, so the API reads as fully considered.
 *
 * It was declared and never read — `broadcast()` filtered by preferences only.
 */
import { describe, it, expect, vi } from 'vitest';

import { NotificationsService } from '../src/notifications.service.js';
import type {
  NotificationRecipient,
  NotificationPayload,
  BroadcastOptions,
} from '../src/notifications.types.js';

function serviceWithRecordingTransport() {
  const sentTo: string[] = [];
  const transport = {
    publish: vi.fn(async (channel: string) => {
      sentTo.push(channel);
      return { messageId: 'm_' + sentTo.length };
    }),
  };
  return { service: new NotificationsService(transport as any), sentTo, transport };
}

const PAYLOAD: NotificationPayload = { type: 'info', title: 'T', message: 'M' };

const RECIPIENTS: NotificationRecipient[] = [
  { id: 'u1', email: 'a@x.com', locale: 'en' },
  { id: 'u2', email: 'b@x.com', locale: 'ru' },
  { id: 'u3', email: 'c@x.com', locale: 'en' },
];

async function broadcastWith(options: BroadcastOptions) {
  const { service, sentTo } = serviceWithRecordingTransport();
  const result = await service.broadcast(RECIPIENTS, PAYLOAD, options);
  return { result, ids: sentTo.map((c) => c.split('.').pop()) };
}

describe('broadcast recipient filters', () => {
  it('sends to everyone when no filters are given', async () => {
    const { result, ids } = await broadcastWith({});
    expect(ids.sort()).toEqual(['u1', 'u2', 'u3']);
    expect(result.totalRecipients).toBe(3);
  });

  it('eq keeps only matching recipients', async () => {
    const { result, ids } = await broadcastWith({
      filters: [{ field: 'locale', operator: 'eq', value: 'en' }],
    });
    expect(ids.sort()).toEqual(['u1', 'u3']);
    // The count must describe what was actually sent, not what was passed in —
    // a caller reading totalRecipients: 3 would think the filter did nothing.
    expect(result.totalRecipients).toBe(2);
  });

  it('ne, in and nin work', async () => {
    expect((await broadcastWith({ filters: [{ field: 'locale', operator: 'ne', value: 'en' }] })).ids).toEqual(['u2']);
    expect(
      (await broadcastWith({ filters: [{ field: 'id', operator: 'in', value: ['u1', 'u3'] }] })).ids.sort(),
    ).toEqual(['u1', 'u3']);
    expect(
      (await broadcastWith({ filters: [{ field: 'id', operator: 'nin', value: ['u1', 'u3'] }] })).ids,
    ).toEqual(['u2']);
  });

  it('several filters are ANDed', async () => {
    const { ids } = await broadcastWith({
      filters: [
        { field: 'locale', operator: 'eq', value: 'en' },
        { field: 'id', operator: 'ne', value: 'u1' },
      ],
    });
    expect(ids).toEqual(['u3']);
  });

  it('a recipient missing the field is excluded, not included by accident', async () => {
    // Failing open is the whole defect this test exists for: an absent field
    // must not satisfy an equality filter.
    const { ids } = await broadcastWith({
      filters: [{ field: 'phone', operator: 'eq', value: '+100' }],
    });
    expect(ids).toEqual([]);
  });

  it('gt/gte/lt/lte compare orderable values', async () => {
    const { service, sentTo } = serviceWithRecordingTransport();
    await service.broadcast(
      [
        { id: 'a', locale: 'en' },
        { id: 'b', locale: 'ru' },
      ] as NotificationRecipient[],
      PAYLOAD,
      { filters: [{ field: 'locale', operator: 'gt', value: 'en' }] },
    );
    expect(sentTo.map((c) => c.split('.').pop())).toEqual(['b']);
  });
});
