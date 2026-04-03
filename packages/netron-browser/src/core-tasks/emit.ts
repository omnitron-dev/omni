/**
 * Emit Core Task
 *
 * Emits an event to registered handlers on the peer.
 * This is used for bi-directional event communication between peers.
 *
 * @module netron-browser/core-tasks/emit
 */

import type { EventSubscriber } from '../core/types.js';

/**
 * Core task name for emit operations
 */
export const CORE_TASK_EMIT = 'emit';

/**
 * Interface for peers that support event emission
 */
export interface EmitCapablePeer {
  eventSubscribers?: Map<string, Set<EventSubscriber>>;
}

/**
 * Emit an event to all registered handlers.
 *
 * This task is typically invoked by the remote peer to trigger
 * event handlers on the local peer. It's part of the bidirectional
 * event subscription system.
 *
 * @param peer - The peer on which to emit the event
 * @param eventName - Name of the event to emit
 * @param args - Arguments to pass to event handlers
 *
 * @example
 * ```typescript
 * // Server emits event to client
 * peer.runTask('emit', 'data:updated', { id: '123', value: 'new' });
 *
 * // Client handlers receive the event
 * peer.subscribe('data:updated', (data) => {
 *   console.log('Data updated:', data);
 * });
 * ```
 */
export function emit(peer: EmitCapablePeer, eventName: string, ...args: any[]): void {
  const handlers = peer.eventSubscribers?.get(eventName);
  if (!handlers) {
    return;
  }

  // Fire all handlers with the provided arguments
  for (const handler of handlers) {
    try {
      handler(...args);
    } catch (error) {
      // Log but don't throw - other handlers should still receive the event
      console.error(`Error in event handler for "${eventName}":`, error);
    }
  }
}

/**
 * Type guard to check if a peer supports event emission
 */
export function isEmitCapablePeer(peer: unknown): peer is EmitCapablePeer {
  return (
    peer !== null && typeof peer === 'object' && 'eventSubscribers' in peer && peer.eventSubscribers instanceof Map
  );
}
