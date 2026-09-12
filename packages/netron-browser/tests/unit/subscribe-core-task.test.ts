/**
 * `subscribe` / `unsubscribe` must not report success they did not achieve.
 *
 * `SubscribableLocalPeer.subscribe` and `.unsubscribe` are declared
 * `Promise<void> | void`, and both core tasks called them bare. The task
 * dispatcher in `ws-client.ts` does `const result = await handler(...)` and
 * answers the remote peer with it — so a synchronous return meant SUCCESS was
 * sent regardless of what the local registration actually did.
 *
 * Three consequences, all silent:
 *   - a failed subscribe answered success, and no event ever arrived;
 *   - `remoteSubscriptions` recorded a handler registered nowhere;
 *   - a failed unsubscribe still deleted the map entry, leaving the handler
 *     live on the local peer, forwarding events to a peer that had asked to
 *     stop, with nothing left to find it by.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  subscribe,
  unsubscribe,
  cleanupSubscriptions,
  type SubscribableLocalPeer,
  type TaskRunnablePeer,
} from '../../src/core-tasks/subscribe.js';

const makePeer = (): TaskRunnablePeer => ({
  runTask: vi.fn(async () => undefined),
  remoteSubscriptions: new Map(),
});

describe('subscribe core task', () => {
  it('rejects when the local peer cannot register, instead of answering success', async () => {
    const peer = makePeer();
    const local: SubscribableLocalPeer = {
      subscribe: vi.fn(async () => {
        throw new Error('local peer refused');
      }),
      unsubscribe: vi.fn(),
    };

    await expect(subscribe(peer, 'user:login', local)).rejects.toThrow('local peer refused');
  });

  it('does not record a handler that was never registered', async () => {
    const peer = makePeer();
    const local: SubscribableLocalPeer = {
      subscribe: vi.fn(async () => {
        throw new Error('local peer refused');
      }),
      unsubscribe: vi.fn(),
    };

    await subscribe(peer, 'user:login', local).catch(() => undefined);

    // A tracking entry whose registration failed is worse than none: the later
    // unsubscribe finds it, removes it, and reports success for a second thing
    // that did not happen.
    expect(peer.remoteSubscriptions.has('user:login')).toBe(false);
  });

  it('records the handler on success', async () => {
    const peer = makePeer();
    const local: SubscribableLocalPeer = { subscribe: vi.fn(async () => undefined), unsubscribe: vi.fn() };

    await subscribe(peer, 'user:login', local);

    expect(local.subscribe).toHaveBeenCalledTimes(1);
    expect(peer.remoteSubscriptions.has('user:login')).toBe(true);
  });

  it('still works when the local peer is synchronous', async () => {
    // The contract allows both; the fix must not require a promise.
    const peer = makePeer();
    const local: SubscribableLocalPeer = { subscribe: vi.fn(), unsubscribe: vi.fn() };

    await subscribe(peer, 'ping', local);

    expect(peer.remoteSubscriptions.has('ping')).toBe(true);
  });
});

describe('unsubscribe core task', () => {
  it('keeps the tracking entry when the local peer fails to unregister', async () => {
    const peer = makePeer();
    const local: SubscribableLocalPeer = {
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => {
        throw new Error('cannot unregister');
      }),
    };
    await subscribe(peer, 'user:login', local);

    await expect(unsubscribe(peer, 'user:login', local)).rejects.toThrow('cannot unregister');

    // The handler is still live on the local peer; dropping the entry would
    // leave nothing able to reach it.
    expect(peer.remoteSubscriptions.has('user:login')).toBe(true);
  });

  it('removes the entry once the unregistration succeeds', async () => {
    const peer = makePeer();
    const local: SubscribableLocalPeer = {
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
    };
    await subscribe(peer, 'user:login', local);
    await unsubscribe(peer, 'user:login', local);

    expect(peer.remoteSubscriptions.has('user:login')).toBe(false);
  });

  it('is idempotent for an event that was never subscribed', async () => {
    const peer = makePeer();
    const local: SubscribableLocalPeer = { subscribe: vi.fn(), unsubscribe: vi.fn() };

    await expect(unsubscribe(peer, 'never', local)).resolves.toBeUndefined();
    expect(local.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('cleanupSubscriptions', () => {
  it('continues past a failing unregistration instead of abandoning the rest', async () => {
    // The loop's try/catch says "log but don't throw - continue cleanup". With
    // a bare call it did neither for an async local peer: the rejection
    // escaped the loop and every later subscription stayed registered.
    const peer = makePeer();
    const failing = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('first one fails');
      })
      .mockImplementation(async () => undefined);
    const local: SubscribableLocalPeer = { subscribe: vi.fn(async () => undefined), unsubscribe: failing };

    await subscribe(peer, 'a', local);
    await subscribe(peer, 'b', local);
    await subscribe(peer, 'c', local);

    await expect(cleanupSubscriptions(peer, local)).resolves.toBeUndefined();

    expect(failing, 'cleanup stopped at the first failure').toHaveBeenCalledTimes(3);
    expect(peer.remoteSubscriptions.size).toBe(0);
  });
});
