import { RemotePeer } from '../remote-peer.js';

/**
 * Unsubscribes from events previously subscribed to from a remote peer in the Netron network.
 * This function handles the cleanup of event subscriptions by:
 * 1. Retrieving the stored subscription handler from the peer's remote subscriptions map
 * 2. Unsubscribing the handler from the local Netron peer instance
 * 3. Removing the subscription entry from the peer's remote subscriptions map
 *
 * @param {RemotePeer} peer - The remote peer instance from which to unsubscribe.
 *                           This peer must be connected and have an active subscription
 *                           for the specified event.
 * @param {string} eventName - The name of the event to unsubscribe from. This should match
 *                            the event name used when originally subscribing to the event.
 * @returns {void} This function does not return a value as it operates through side effects.
 *
 * @example
 * // Unsubscribe from a service update event
 * unsubscribe(remotePeer, 'service:update');
 *
 * @remarks
 * This function is the counterpart to the subscribe function and is used to clean up
 * event subscriptions when they are no longer needed. It ensures proper cleanup of
 * event handlers and prevents memory leaks in the Netron network.
 *
 * The function is idempotent - calling it multiple times with the same parameters
 * will not cause errors, as it checks for the existence of the subscription before
 * attempting to remove it.
 */
export function unsubscribe(peer: RemotePeer, eventName: string): void {
  // Retrieve the stored event handler function from the peer's remote subscriptions map
  const fn = peer.remoteSubscriptions.get(eventName);

  // Only proceed with unsubscription if a handler exists for this event
  if (fn) {
    // Remove the event handler from the local Netron peer instance
    // This stops the handler from receiving future events
    peer.netron.peer.unsubscribe(eventName, fn);

    // Clean up the subscription entry from the peer's remote subscriptions map
    // This ensures proper memory management and prevents stale references
    peer.remoteSubscriptions.delete(eventName);
  }
}
