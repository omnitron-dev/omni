/**
 * A refused subscribe must not make the event permanently dead.
 *
 * `RemotePeer.subscribe` runs a remote task and records the handler locally.
 * It used to record FIRST:
 *
 *     this.eventSubscribers.set(eventName, [handler]);   // recorded
 *     await this.runTask('subscribe', eventName);        // may reject
 *
 * `runTask('subscribe')` rejects for ordinary, expected reasons — `forbidden`
 * for a RESERVED_EVENT, `tooManyRequests` past `maxSubscriptionsPerPeer`, a
 * task timeout, a closed connection. The FIRST caller sees that rejection. But
 * the map entry survives it, so every LATER subscriber to the same event takes
 * the `else` branch, pushes its handler onto a list nothing feeds, and returns
 * SUCCESSFULLY.
 *
 * One refusal and that event is silently dead for the life of the peer, with
 * no error for anyone after the first to notice.
 */

import { describe, it, expect, vi } from 'vitest';

import { RemotePeer } from '../../src/netron/remote-peer.js';

/** A RemotePeer with `runTask` stubbed — the network is not what is under test. */
function makePeer(runTask: (name: string, ...args: any[]) => Promise<any>): RemotePeer {
  const peer = Object.create(RemotePeer.prototype) as RemotePeer;
  (peer as any).eventSubscribers = new Map();
  (peer as any).runTask = vi.fn(runTask);
  return peer;
}

describe('RemotePeer.subscribe — a refusal must not poison the event', () => {
  it('leaves no local record when the remote refuses', async () => {
    const peer = makePeer(async () => {
      throw new Error('subscription_limit_exceeded');
    });

    await expect(peer.subscribe('user:login', vi.fn())).rejects.toThrow('subscription_limit_exceeded');
    expect((peer as any).eventSubscribers.has('user:login')).toBe(false);
  });

  it('lets a later subscriber retry instead of silently succeeding', async () => {
    // This is the consequence that matters. With the old ordering the second
    // call returned successfully and received nothing, forever.
    let refuse = true;
    const peer = makePeer(async () => {
      if (refuse) throw new Error('temporarily refused');
      return undefined;
    });

    await expect(peer.subscribe('user:login', vi.fn())).rejects.toThrow();

    refuse = false;
    const second = vi.fn();
    await expect(peer.subscribe('user:login', second)).resolves.toBeUndefined();

    expect((peer as any).runTask).toHaveBeenCalledTimes(2);
    expect((peer as any).eventSubscribers.get('user:login')).toEqual([second]);
  });

  it('records the handler once the remote accepts', async () => {
    const peer = makePeer(async () => undefined);
    const handler = vi.fn();

    await peer.subscribe('user:login', handler);

    expect((peer as any).eventSubscribers.get('user:login')).toEqual([handler]);
    expect((peer as any).runTask).toHaveBeenCalledTimes(1);
  });

  it('does not re-run the remote task for an additional local handler', async () => {
    // The existing contract: one remote subscription, many local handlers.
    const peer = makePeer(async () => undefined);
    const a = vi.fn();
    const b = vi.fn();

    await peer.subscribe('user:login', a);
    await peer.subscribe('user:login', b);

    expect((peer as any).runTask).toHaveBeenCalledTimes(1);
    expect((peer as any).eventSubscribers.get('user:login')).toEqual([a, b]);
  });
});

describe('RemotePeer.unsubscribe — a refusal must not lose the record', () => {
  it('keeps the entry when the remote refuses to unsubscribe', async () => {
    let accept = true;
    const peer = makePeer(async (name: string) => {
      if (name === 'unsubscribe' && !accept) throw new Error('cannot unsubscribe');
      return undefined;
    });
    const handler = vi.fn();
    await peer.subscribe('user:login', handler);

    accept = false;
    await expect(peer.unsubscribe('user:login', handler)).rejects.toThrow('cannot unsubscribe');

    // The remote is still forwarding; forgetting it here would leave nothing
    // able to stop it, and a later subscribe would be answered from the
    // remote's own idempotency check without it ever having stopped.
    expect((peer as any).eventSubscribers.has('user:login')).toBe(true);
  });

  it('drops the entry once the remote agrees', async () => {
    const peer = makePeer(async () => undefined);
    const handler = vi.fn();
    await peer.subscribe('user:login', handler);
    await peer.unsubscribe('user:login', handler);

    expect((peer as any).eventSubscribers.has('user:login')).toBe(false);
  });

  it('does not call the remote while other handlers remain', async () => {
    const peer = makePeer(async () => undefined);
    const a = vi.fn();
    const b = vi.fn();
    await peer.subscribe('e', a);
    await peer.subscribe('e', b);

    await peer.unsubscribe('e', a);

    expect((peer as any).runTask).toHaveBeenCalledTimes(1); // the subscribe only
    expect((peer as any).eventSubscribers.get('e')).toEqual([b]);
  });
});
