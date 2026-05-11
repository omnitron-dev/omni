import { RemotePeer } from '../remote-peer.js';
import { Errors } from '../../errors/index.js';

/**
 * Default upper bound on the number of distinct event subscriptions a
 * single remote peer may hold (T#42). Overridable via the Netron
 * option `maxSubscriptionsPerPeer`. The default is intentionally
 * generous — production deployments with adversarial peers should
 * lower it.
 */
const DEFAULT_MAX_SUBSCRIPTIONS_PER_PEER = 1000;

/**
 * Subscribes to events from a remote peer in the Netron network.
 *
 * Behaviour:
 * 1. Creates a handler function that forwards events to the remote peer.
 * 2. Stores the subscription in the peer's `remoteSubscriptions` map.
 * 3. Registers the subscription with the local Netron peer instance.
 *
 * SECURITY (T#42): each entry costs memory (event name string + closure)
 * and a slot in the local peer's event emitter. Before this fix, an
 * attacker peer could call `subscribe` repeatedly with random event
 * names and grow `remoteSubscriptions` without bound — a trivial
 * memory-exhaustion DoS. We now enforce a per-peer cap and reject
 * additional subscriptions with `Errors.tooManyRequests`. The cap
 * is shared with `Netron.options.maxSubscriptionsPerPeer`.
 *
 * @param peer - The remote peer instance.
 * @param eventName - The event name to subscribe to.
 */
export function subscribe(peer: RemotePeer, eventName: string): void {
  // Idempotent: re-subscribing to the same event reuses the existing
  // handler. Don't count this against the cap.
  if (peer.remoteSubscriptions.has(eventName)) {
    return;
  }

  const limit = peer.netron.options?.maxSubscriptionsPerPeer ?? DEFAULT_MAX_SUBSCRIPTIONS_PER_PEER;
  if (peer.remoteSubscriptions.size >= limit) {
    throw Errors.tooManyRequests().withDetails({
      reason: 'subscription_limit_exceeded',
      peerId: peer.id,
      limit,
    });
  }

  // Create a handler function that forwards events to the remote peer.
  const fn = (...args: any[]) => peer.runTask('emit', eventName, ...args);

  // Store the subscription on the peer; supports cleanup via unsubscribe()
  // and on peer-disconnect cleanup.
  peer.remoteSubscriptions.set(eventName, fn);

  // Register the subscription with the local Netron peer instance.
  peer.netron.peer.subscribe(eventName, fn);
}
