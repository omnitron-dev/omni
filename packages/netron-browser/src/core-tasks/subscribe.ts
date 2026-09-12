/**
 * Subscribe/Unsubscribe Core Tasks
 *
 * Manages event subscriptions between peers for bidirectional event streaming.
 * When a client subscribes to an event on the server, the server will forward
 * matching events back to the client.
 *
 * @module netron-browser/core-tasks/subscribe
 */

import type { EventSubscriber } from '../core/types.js';

/**
 * Core task names
 */
export const CORE_TASK_SUBSCRIBE = 'subscribe';
export const CORE_TASK_UNSUBSCRIBE = 'unsubscribe';

/**
 * Interface for peers that support subscriptions
 */
export interface SubscribableLocalPeer {
  subscribe(eventName: string, handler: EventSubscriber): Promise<void> | void;
  unsubscribe(eventName: string, handler: EventSubscriber): Promise<void> | void;
}

/**
 * Interface for peers that can run tasks (for forwarding events)
 */
export interface TaskRunnablePeer {
  runTask(name: string, ...args: any[]): Promise<any>;
  remoteSubscriptions: Map<string, EventSubscriber>;
}

/**
 * Context for subscription operations
 */
export interface SubscriptionContext {
  localPeer: SubscribableLocalPeer;
  remotePeer: TaskRunnablePeer;
}

/**
 * Subscribe Request type
 */
export interface SubscribeRequest {
  eventName: string;
}

/**
 * Subscribe Response type
 */
export interface SubscribeResponse {
  success: boolean;
}

/**
 * Create a subscribe request
 */
export function createSubscribeRequest(eventName: string): SubscribeRequest {
  return { eventName };
}

/**
 * Check if response is a valid subscribe response
 */
export function isSubscribeResponse(obj: unknown): obj is SubscribeResponse {
  return obj !== null && typeof obj === 'object' && 'success' in obj && typeof (obj as any).success === 'boolean';
}

/**
 * Subscribe to an event.
 *
 * Creates a handler that forwards events from the local peer to the remote peer.
 * The handler invokes the 'emit' task on the remote peer when events occur.
 *
 * @param peer - The remote peer requesting the subscription
 * @param eventName - Name of the event to subscribe to
 * @param localPeer - The local peer to subscribe on
 *
 * @example
 * ```typescript
 * // Client subscribes to server events
 * await peer.runTask('subscribe', 'user:login');
 *
 * // Server now forwards 'user:login' events to this client
 * ```
 */
export async function subscribe(
  peer: TaskRunnablePeer,
  eventName: string,
  localPeer: SubscribableLocalPeer,
): Promise<void> {
  // Create a handler that forwards events to the remote peer
  const handler: EventSubscriber = (...args: any[]) => {
    // Fire and forget - use .catch to prevent unhandled rejections
    peer.runTask('emit', eventName, ...args).catch((error) => {
      console.error(`Failed to forward event "${eventName}" to remote peer:`, error);
    });
  };

  // Register with the local peer FIRST, and await it.
  //
  // `SubscribableLocalPeer.subscribe` is declared `Promise<void> | void`, and
  // this used to call it bare, after writing the tracking map. Two things
  // followed when it rejected: the task dispatcher — which does
  // `await handler(...)` and answers the remote peer with the result — saw a
  // synchronous return and replied SUCCESS, so the subscriber believed it was
  // subscribed and no event ever arrived; and `remoteSubscriptions` held a
  // handler registered nowhere, so the later `unsubscribe` had something to
  // remove and removed nothing.
  //
  // A subscription that reports success and delivers nothing is the worst
  // shape this can take: there is no error anywhere to notice.
  await localPeer.subscribe(eventName, handler);

  // Store the handler for later unsubscription — only once the registration
  // it refers to actually exists.
  peer.remoteSubscriptions.set(eventName, handler);
}

/**
 * Unsubscribe from an event.
 *
 * Removes the handler that was forwarding events to the remote peer.
 *
 * @param peer - The remote peer requesting unsubscription
 * @param eventName - Name of the event to unsubscribe from
 * @param localPeer - The local peer to unsubscribe from
 *
 * @example
 * ```typescript
 * // Client unsubscribes from server events
 * await peer.runTask('unsubscribe', 'user:login');
 *
 * // Server no longer forwards 'user:login' events to this client
 * ```
 */
export async function unsubscribe(
  peer: TaskRunnablePeer,
  eventName: string,
  localPeer: SubscribableLocalPeer,
): Promise<void> {
  const handler = peer.remoteSubscriptions.get(eventName);
  if (!handler) {
    return; // Already unsubscribed or never subscribed - idempotent
  }

  // Awaited, and the map entry is dropped only after it succeeds. Unawaited,
  // a rejected unregistration still deleted the entry: the handler stayed
  // live on the local peer and went on forwarding events to a peer that had
  // explicitly asked to stop, with nothing left in `remoteSubscriptions` to
  // find it by. Leaving the entry on failure keeps `cleanupSubscriptions` and
  // a retried `unsubscribe` able to reach it.
  await localPeer.unsubscribe(eventName, handler);

  peer.remoteSubscriptions.delete(eventName);
}

/**
 * Cleanup all subscriptions for a peer.
 *
 * Should be called when a peer disconnects to prevent memory leaks.
 *
 * @param peer - The remote peer being disconnected
 * @param localPeer - The local peer to clean up subscriptions from
 */
export async function cleanupSubscriptions(
  peer: TaskRunnablePeer,
  localPeer: SubscribableLocalPeer,
): Promise<void> {
  for (const [eventName, handler] of peer.remoteSubscriptions) {
    try {
      // `await` inside the try is what makes the catch reachable. The call
      // may return a promise, and a synchronous catch cannot see a rejected
      // one — so "log but don't throw - continue cleanup" did neither for an
      // async local peer: the rejection escaped the loop entirely and the
      // remaining subscriptions were never unregistered.
      await localPeer.unsubscribe(eventName, handler);
    } catch (error) {
      // Log but don't throw - continue cleanup
      console.error(`Error cleaning up subscription for "${eventName}":`, error);
    }
  }
  peer.remoteSubscriptions.clear();
}
