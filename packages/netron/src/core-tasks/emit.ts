import { RemotePeer } from '../remote-peer';

/**
 * Emits an event to all subscribers registered for a specific event name.
 * This function is responsible for propagating events through the Netron network
 * by executing all registered event handlers for the given event.
 * 
 * @param {RemotePeer} peer - The remote peer instance that will emit the event
 * @param {string} eventName - The name of the event to emit. This should match
 *                            the name used when subscribing to the event
 * @param {...any[]} args - Variable number of arguments that will be passed to
 *                          each event handler. These arguments represent the
 *                          event payload and can be of any type
 * 
 * @example
 * // Emit a service event with some data
 * emit(remotePeer, 'service:update', { id: '123', status: 'active' });
 * 
 * @example
 * // Emit a peer event with multiple arguments
 * emit(remotePeer, 'peer:connected', peerId, timestamp);
 */
export function emit(peer: RemotePeer, eventName: string, ...args: any[]) {
  // Retrieve the set of handlers registered for this event name
  const handlers = peer.eventSubscribers.get(eventName);

  // If handlers exist for this event, execute each one with the provided arguments
  if (handlers) {
    for (const handler of handlers) {
      // Execute the handler with the spread arguments
      // This allows handlers to receive the arguments in their original form
      handler(...args);
    }
  }
}
