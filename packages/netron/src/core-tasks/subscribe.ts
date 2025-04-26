import { RemotePeer } from '../remote-peer';

/**
 * Subscribes to events from a remote peer in the Netron network.
 * This function establishes a two-way event subscription mechanism:
 * 1. Creates a handler function that forwards events to the remote peer
 * 2. Stores the subscription in the peer's remote subscriptions map
 * 3. Registers the subscription with the local Netron peer instance
 * 
 * @param {RemotePeer} peer - The remote peer instance to subscribe to events from.
 *                           This peer must be connected and authenticated in the Netron network.
 * @param {string} eventName - The name of the event to subscribe to. This should match
 *                            the event name used when emitting events on the remote peer.
 * @returns {void} This function does not return a value as it operates through side effects.
 * 
 * @example
 * // Subscribe to a service update event from a remote peer
 * subscribe(remotePeer, 'service:update');
 * 
 * @remarks
 * The subscription mechanism works as follows:
 * - When an event is emitted on the remote peer, it will be forwarded to this peer
 * - The handler function created here will execute the 'emit' task on the remote peer
 * - This creates a bidirectional event channel between the peers
 * 
 * @throws {Error} If the peer is not connected or if the event subscription fails
 */
export function subscribe(peer: RemotePeer, eventName: string): void {
  // Create a handler function that will forward events to the remote peer
  // The handler takes any number of arguments and forwards them to the emit task
  const fn = (...args: any[]) => peer.runTask('emit', eventName, ...args);

  // Store the subscription in the peer's remote subscriptions map
  // This allows for tracking and cleanup of subscriptions
  peer.remoteSubscriptions.set(eventName, fn);

  // Register the subscription with the local Netron peer instance
  // This establishes the actual event listening mechanism
  peer.netron.peer.subscribe(eventName, fn);
}
