import type { ILogger } from '../types/logger.js';
import { Errors } from '../errors/index.js';
import { MAX_EVENT_QUEUE_SIZE } from './constants.js';

/**
 * How many already-emitted entries may sit at the head of a queue before the
 * drain's cursor is rewound and the prefix reclaimed. Index-based iteration is
 * what keeps a drain O(n) rather than O(n²); compacting in batches preserves
 * that while stopping a long-lived drain from retaining every event it has
 * emitted.
 */
const COMPACT_THRESHOLD = 256;

/** Per-id state: the pending events, the drain's cursor, and its status. */
interface EventQueue {
  events: { name: string; data: any }[];
  /** Index of the next event to emit; everything below it is already out. */
  processed: number;
  /** True while a drain owns this queue. */
  draining: boolean;
  /** Set by {@link SpecialEventBuffer.delete}; stops the drain. */
  cancelled: boolean;
}

/**
 * NET-3: extracted from the `Netron` god object.
 *
 * Buffers "special" lifecycle events per id and emits them sequentially with a
 * per-event 5s timeout and a bounded queue (DoS guard). The first emit for an
 * id drains its queue; a concurrent emit for the same id just enqueues and
 * returns, so the in-flight drain picks it up — this preserves ordering without
 * re-entrant processing.
 */
export class SpecialEventBuffer {
  /** Per-id ordered queue of pending special events. */
  private readonly ownEvents: Map<string, EventQueue> = new Map();

  /**
   * @param emit - Underlying parallel emit (Netron's `emitParallel`).
   * @param logger - For dropped-event / emit-error reporting.
   */
  constructor(
    private readonly emit: (name: string, data: any) => Promise<unknown>,
    private readonly logger: ILogger
  ) {}

  /**
   * Drop the pending queue for an id (e.g. on peer cleanup), cancelling the
   * in-flight drain along with it. The event currently being awaited cannot be
   * recalled and still completes; everything queued behind it does not emit.
   */
  delete(id: string): void {
    const queue = this.ownEvents.get(id);
    this.ownEvents.delete(id);
    // Cancelling the queue, not just unmapping it, is the whole point. Removing
    // only the map entry left the drain emitting from the queue it had already
    // captured — so "delete" cancelled nothing — and let the next emitSpecial
    // for the same id install a fresh queue and start a SECOND concurrent
    // drain, which is the opposite of the per-id sequencing this class exists
    // to provide.
    if (queue) queue.cancelled = true;
  }

  /**
   * Emit a special event with guaranteed sequential, FIFO processing per id,
   * a 5s per-event timeout, graceful error handling, and a bounded queue.
   *
   * @returns resolves when this id's queue has fully drained (for the caller
   *   that started the drain) or immediately (for callers that only enqueued).
   */
  async emitSpecial(event: string, id: string, data: any): Promise<void> {
    let queue = this.ownEvents.get(id);
    if (!queue) {
      queue = { events: [], processed: 0, draining: false, cancelled: false };
      this.ownEvents.set(id, queue);
    }

    // Reclaim the emitted prefix of a long-running drain.
    if (queue.processed >= COMPACT_THRESHOLD) {
      queue.events.splice(0, queue.processed);
      queue.processed = 0;
    }

    // Prevent unbounded queue growth (DoS protection). The event dropped is the
    // oldest one that has NOT been emitted yet: dropping index 0 — as this used
    // to — targets an entry the drain already sent, which frees nothing and
    // slides every remaining element one place left, under a cursor that does
    // not move. Each drop therefore silently skipped one unemitted event.
    const pending = queue.events.length - queue.processed;
    if (pending >= MAX_EVENT_QUEUE_SIZE) {
      this.logger.error(
        { event, id, queueSize: pending },
        `Event queue limit exceeded (${MAX_EVENT_QUEUE_SIZE}), dropping oldest event`
      );
      queue.events.splice(queue.processed, 1);
    }

    queue.events.push({ name: event, data });

    // A drain already owns this queue and will pick the event up.
    if (queue.draining) {
      return;
    }
    queue.draining = true;

    try {
      // Index-based iteration rather than shift(): O(n) for the whole drain,
      // and new events appended mid-drain are picked up by the loop condition.
      while (queue.processed < queue.events.length && !queue.cancelled) {
        const eventData = queue.events[queue.processed];
        queue.processed++;
        if (eventData === undefined) {
          continue;
        }
        try {
          let timeoutId: NodeJS.Timeout | undefined;

          const timeoutPromise = new Promise<void>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(Errors.timeout('Event emission: ' + eventData.name, 5000));
            }, 5000);
          });

          const emitPromise = this.emit(eventData.name, eventData.data);

          await Promise.race([emitPromise, timeoutPromise]).finally(() => {
            if (timeoutId !== undefined) {
              clearTimeout(timeoutId);
            }
          });
        } catch (err: any) {
          this.logger.error(`Event emit error: ${err.message}`);
        }
      }
    } finally {
      queue.draining = false;
      // Drop the map entry only while it still holds OUR queue. After a
      // delete() the map may already hold a fresh queue with its own drain;
      // unmapping that one would let the next emit start a second drain for
      // the same id.
      if (this.ownEvents.get(id) === queue) {
        this.ownEvents.delete(id);
      }
    }
  }
}
