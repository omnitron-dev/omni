import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { EventBroadcasterService } from '../../src/services/event-broadcaster.service.js';
import { EventBroadcasterRpcService } from '../../src/services/event-broadcaster.rpc-service.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { createDaemonPrincipalValidator } from '../../src/services/daemon-authority.js';
import { APP_EVENTS } from '../../src/shared/events.js';

async function fixture(validate?: (context: any) => Promise<void>) {
  const context = { userId: 'human', roles: ['viewer'], permissions: [],
    metadata: { principalType: 'human', sessionId: 'session', expiresAt: Date.now() + 3600000 } };
  let current: typeof context | undefined = context;
  const store = { validateSessionAuthority: vi.fn(async () => ({ userId: 'human', sessionId: 'session', role: 'viewer' })) };
  const remote = { id: 'tab', getAuthContext: () => current, runTask: vi.fn(async (..._args: any[]) => {}), close: vi.fn(async () => {}) };
  const broadcaster = new EventBroadcasterService(createNullLogger());
  const service = new EventBroadcasterRpcService(broadcaster,
    { peers: new Map([['tab', remote]]), peer: { subscribe: vi.fn() } }, validate ?? createDaemonPrincipalValidator(store));
  const subscribe = () => createAuthContextWrapper()(new Map<string, unknown>([['peerId', 'tab'], ['authContext', context]]),
    () => service.subscribe({ channels: ['*'] }));
  await subscribe();
  const revoke = () => { current = undefined; };
  return { remote, service, broadcaster, store, context, subscribe, revoke };
}
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe('event stream lifetime and bounded delivery', () => {
  it('stops delivery on expiry even though the peer remains connected', async () => {
    const f = await fixture();
    f.broadcaster.broadcast(APP_EVENTS.STARTED, { name: 'sample' }); await settle();
    expect(f.remote.runTask).toHaveBeenCalledOnce();
    f.context.metadata.expiresAt = Date.now() - 1;
    f.broadcaster.broadcast(APP_EVENTS.CRASHED, { name: 'sample' }); await settle();
    expect(f.remote.runTask).toHaveBeenCalledOnce();
    expect(f.remote.close).toHaveBeenCalledOnce();
    expect(f.broadcaster.getSubscriberCount()).toBe(0);
  });
  it('refuses revoked sessions and session-store failure before transmitting data', async () => {
    for (const outage of [false, true]) {
      const f = await fixture();
      if (outage) f.store.validateSessionAuthority.mockRejectedValue(new Error('store unavailable'));
      else f.store.validateSessionAuthority.mockResolvedValue(null as never);
      f.broadcaster.broadcast(APP_EVENTS.STARTED, { name: 'sample' }); await settle();
      expect(f.remote.runTask).not.toHaveBeenCalled();
      expect(f.remote.close).toHaveBeenCalledOnce();
    }
  });
  it('has one in-flight delivery and closes a slow consumer before its queue exceeds the bound', async () => {
    const f = await fixture();
    f.remote.runTask.mockImplementation(() => new Promise(() => {}));
    f.broadcaster.broadcast(APP_EVENTS.STARTED, { order: 0 }); await settle();
    for (let order = 1; order < 258; order++) f.broadcaster.broadcast(APP_EVENTS.STARTED, { order });
    await settle();
    expect(f.remote.runTask).toHaveBeenCalledOnce();
    expect(f.remote.close).toHaveBeenCalledOnce();
    expect(f.broadcaster.getSubscriberCount()).toBe(0);
  });
  it('bounds payload bytes and snapshots accepted payloads before asynchronous authorization', async () => {
    const f = await fixture();
    const data = { name: 'original' };
    f.broadcaster.broadcast(APP_EVENTS.STARTED, data); data.name = 'changed'; await settle();
    expect(f.remote.runTask.mock.calls[0]![2]).toMatchObject({ data: { name: 'original' } });
    f.broadcaster.broadcast(APP_EVENTS.STARTED, { data: 'x'.repeat(256 * 1024) }); await settle();
    expect(f.remote.runTask).toHaveBeenCalledOnce();
    expect(f.remote.close).toHaveBeenCalledOnce();
  });
  it('fences a timed-out session check so a late answer cannot send data', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const f = await fixture(() => new Promise(resolve => { finish = resolve; }));
    f.broadcaster.broadcast(APP_EVENTS.STARTED, { name: 'sample' }); await settle();
    await vi.advanceTimersByTimeAsync(5000);
    finish(); await settle();
    expect(f.remote.runTask).not.toHaveBeenCalled();
    expect(f.remote.close).toHaveBeenCalledOnce();
  });
  it('does not release a replacement subscription when the old send fails late', async () => {
    let fail!: (error: Error) => void;
    const f = await fixture();
    f.remote.runTask.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    f.broadcaster.broadcast(APP_EVENTS.STARTED, { old: true }); await settle();
    await f.subscribe();
    fail(new Error('old send failed')); await settle();
    f.broadcaster.broadcast(APP_EVENTS.STARTED, { next: true }); await settle();
    expect(f.broadcaster.getSubscriberCount()).toBe(1);
    expect(f.remote.close).not.toHaveBeenCalled();
    expect(f.remote.runTask).toHaveBeenCalledTimes(2);
  });
});
