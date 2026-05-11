/**
 * Regression test for T#42 — `remoteSubscriptions` was unbounded.
 *
 * Any peer could call the `subscribe` core task with random event
 * names and force the server to grow `RemotePeer.remoteSubscriptions`
 * without bound. Each entry costs an event-name string, a closure,
 * and a slot in the local peer's event emitter — a trivial memory-
 * exhaustion DoS reachable through a few lines of attacker code.
 *
 * Fix: per-peer cap enforced in `subscribe`. Default 1000; tunable
 * via `Netron.options.maxSubscriptionsPerPeer`. Duplicate
 * subscriptions are idempotent and don't count against the cap.
 */

import { describe, it, expect } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { subscribe } from '../../../src/netron/core-tasks/subscribe.js';
import { createMockLogger } from '../test-utils.js';

function mkPeer(opts: { maxSubscriptionsPerPeer?: number } = {}) {
  const netron = new Netron(createMockLogger(), { id: 'sub-cap-test', ...opts });
  // We don't need a real socket — the subscribe task just touches
  // `peer.remoteSubscriptions` and `peer.netron.peer.subscribe`.
  const fakeSocket: any = {
    readyState: 1,
    on: () => undefined,
    send: () => undefined,
    close: () => undefined,
  };
  const peer = new RemotePeer(fakeSocket, netron, 'attacker-peer');
  return { netron, peer };
}

describe('subscribe core task — per-peer subscription cap (T#42)', () => {
  it('accepts subscriptions up to and including the configured cap', () => {
    const { peer } = mkPeer({ maxSubscriptionsPerPeer: 5 });
    for (let i = 0; i < 5; i++) {
      expect(() => subscribe(peer, `event-${i}`)).not.toThrow();
    }
    expect(peer.remoteSubscriptions.size).toBe(5);
  });

  it('rejects the next subscription once the cap is hit', () => {
    const { peer } = mkPeer({ maxSubscriptionsPerPeer: 3 });
    subscribe(peer, 'a');
    subscribe(peer, 'b');
    subscribe(peer, 'c');
    expect(() => subscribe(peer, 'd')).toThrow(/subscription_limit_exceeded|Too many|429/i);
    expect(peer.remoteSubscriptions.size).toBe(3);
    expect(peer.remoteSubscriptions.has('d')).toBe(false);
  });

  it('treats duplicate subscriptions as idempotent and does not count them against the cap', () => {
    const { peer } = mkPeer({ maxSubscriptionsPerPeer: 2 });
    subscribe(peer, 'x');
    subscribe(peer, 'x'); // duplicate — must NOT count
    subscribe(peer, 'y');
    expect(peer.remoteSubscriptions.size).toBe(2);
    expect(() => subscribe(peer, 'z')).toThrow();
  });

  it('uses the default cap of 1000 when no option is configured', () => {
    const { peer } = mkPeer();
    for (let i = 0; i < 1000; i++) {
      subscribe(peer, `e-${i}`);
    }
    expect(peer.remoteSubscriptions.size).toBe(1000);
    expect(() => subscribe(peer, 'overflow')).toThrow();
  });
});
