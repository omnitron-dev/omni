import { describe, expect, it, vi } from 'vitest';
import type {
  IncomingNotification,
  MessagingTransport,
  NotificationHandler,
  NotificationSubscription,
} from '@omnitron-dev/titan-notifications';
import { MailDeliveryWorker, type MailOutbox } from '../src/notifications.js';
import type { MailSender } from '../src/types.js';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture() {
  let handler!: NotificationHandler;
  const subscription = {
    unsubscribe: vi.fn(async () => {}),
    pattern: 'mail.test',
  } as unknown as NotificationSubscription;
  const bus = {
    subscribe: vi.fn(async (_pattern: string, next: NotificationHandler) => {
      handler = next;
      return subscription;
    }),
    publish: vi.fn(async () => ({ success: true })),
    healthCheck: async () => ({ connected: true, status: 'healthy' }),
  } as unknown as MessagingTransport;
  const store: MailOutbox = { pending: vi.fn(async () => ['id-1']), deliver: vi.fn(async () => {}) };
  const sender: MailSender = { send: vi.fn() };
  const worker = new MailDeliveryWorker(bus, store, sender, {
    channel: 'mail.test',
    group: 'mail.test.workers',
    intervalMs: 60000,
  });
  const message = (data: unknown = 'id-1'): IncomingNotification => ({
    id: 'event-1',
    channel: 'mail.test',
    payload: { type: 'mail.outbox', data },
    timestamp: 1,
    attempt: 1,
    ack: vi.fn(async () => {}),
  });
  return { bus, store, sender, worker, subscription, message, dispatch: (m: IncomingNotification) => handler(m) };
}
describe('delivery ownership and failure boundaries', () => {
  it('publishes only opaque IDs and reconciles again after lost wake-ups', async () => {
    const f = fixture();
    await f.worker.start();
    await f.worker.reconcile();
    expect(f.bus.publish).toHaveBeenCalledWith('mail.test', { type: 'mail.outbox', data: 'id-1' });
    const count = vi.mocked(f.bus.publish).mock.calls.length;
    await f.worker.reconcile();
    expect(vi.mocked(f.bus.publish).mock.calls.length).toBe(count + 1);
    await f.worker.stop();
  });
  it('does not ACK a failed database commit and exposes failure for retry', async () => {
    const f = fixture();
    await f.worker.start();
    vi.mocked(f.store.deliver).mockRejectedValueOnce(Error('database disconnected'));
    const m = f.message();
    await expect(f.dispatch(m)).rejects.toThrow('database disconnected');
    expect(m.ack).not.toHaveBeenCalled();
    await f.dispatch(m);
    expect(m.ack).toHaveBeenCalledOnce();
    await f.worker.stop();
  });
  it('acknowledges poison envelopes without treating their contents as email instructions', async () => {
    const f = fixture();
    await f.worker.start();
    const m = f.message({ to: 'external@example.test', text: 'injected' });
    await f.dispatch(m);
    expect(f.store.deliver).not.toHaveBeenCalled();
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(m.ack).toHaveBeenCalledOnce();
    await f.worker.stop();
  });
  it('preserves durable rows and reports unavailable when Redis refuses publication', async () => {
    const f = fixture();
    vi.mocked(f.bus.publish).mockResolvedValue({ success: false } as never);
    await f.worker.start();
    await expect(f.worker.reconcile()).rejects.toThrow('unavailable');
    expect((await f.worker.health()).available).toBe(false);
    expect(f.store.deliver).not.toHaveBeenCalled();
    vi.mocked(f.bus.publish).mockResolvedValue({ success: true } as never);
    await f.worker.reconcile();
    expect((await f.worker.health()).available).toBe(true);
    await f.worker.stop();
  });
  it('stops reconciliation, waits for active delivery, and retains the shared Redis pattern', async () => {
    const f = fixture();
    await f.worker.start();
    await f.worker.reconcile();
    const gate = deferred(),
      entered = deferred();
    vi.mocked(f.store.deliver).mockImplementation(async () => {
      entered.resolve();
      await gate.promise;
    });
    const m = f.message();
    const dispatch = f.dispatch(m);
    await entered.promise;
    let stopped = false;
    const stopping = f.worker.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    gate.resolve();
    await dispatch;
    await stopping;
    await f.worker.stop();
    expect(f.subscription.unsubscribe).toHaveBeenCalledExactlyOnceWith(false);
    expect(m.ack).toHaveBeenCalledOnce();
    await expect(f.worker.reconcile()).rejects.toThrow('closed');
    await expect(f.worker.start()).rejects.toThrow('closed');
  });
  it('drains a subscription whose creation completed after stop was requested', async () => {
    const f = fixture();
    const gate = deferred();
    const subscribe = vi.mocked(f.bus.subscribe).getMockImplementation()!;
    vi.mocked(f.bus.subscribe).mockImplementation(async (...args) => {
      await gate.promise;
      return subscribe(...args);
    });
    const start = f.worker.start();
    const stop = f.worker.stop();
    gate.resolve();
    await start;
    await stop;
    expect(f.subscription.unsubscribe).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.bus.publish).not.toHaveBeenCalled();
  });
});
