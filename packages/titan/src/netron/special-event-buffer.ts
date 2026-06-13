import type { ILogger } from '../types/logger.js';
import { Errors } from '../errors/index.js';
import { MAX_EVENT_QUEUE_SIZE } from './constants.js';

/**
 * NET-3: extracted from the `Netron` god object.
 *
 * Buffers "special" lifecycle events per id and emits them sequentially with a
 * per-event 5s timeout and a bounded queue (DoS guard). The first emit for an
 * id drains its queue; a concurrent emit for the same id just enqueues and
 * returns, so the in-flight drain picks it up — this preserves ordering without
 * re-entrant processing. Behaviour is identical to the former
 * `Netron.emitSpecial` / `Netron.deleteSpecialEvents`.
 */
export class SpecialEventBuffer {
  /** Per-id ordered queue of pending special events. */
  private readonly ownEvents: Map<string, { name: string; data: any }[]> = new Map();

  /**
   * @param emit - Underlying parallel emit (Netron's `emitParallel`).
   * @param logger - For dropped-event / emit-error reporting.
   */
  constructor(
    private readonly emit: (name: string, data: any) => Promise<unknown>,
    private readonly logger: ILogger
  ) {}

  /** Drop the pending queue for an id (e.g. on peer cleanup). */
  delete(id: string): void {
    this.ownEvents.delete(id);
  }

  /**
   * Emit a special event with guaranteed sequential, FIFO processing per id,
   * a 5s per-event timeout, graceful error handling, and a bounded queue.
   *
   * @returns resolves when this id's queue has fully drained (for the caller
   *   that started the drain) or immediately (for callers that only enqueued).
   */
  async emitSpecial(event: string, id: string, data: any): Promise<void> {
    const events = this.ownEvents.get(id) || [];

    // Prevent unbounded queue growth (DoS protection)
    if (events.length >= MAX_EVENT_QUEUE_SIZE) {
      this.logger.error(
        { event, id, queueSize: events.length },
        `Event queue limit exceeded (${MAX_EVENT_QUEUE_SIZE}), dropping oldest event`
      );
      // Drop the oldest event to make room
      events.shift();
    }

    events.push({ name: event, data });
    this.ownEvents.set(id, events);

    if (events.length > 1) {
      return;
    }

    try {
      // Process events using index-based iteration to avoid O(n²) complexity
      // from shift() operations. We track processedCount separately since
      // new events may be added during processing.
      let processedCount = 0;
      while (processedCount < events.length) {
        const eventData = events[processedCount];
        processedCount++;
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
      this.ownEvents.delete(id);
    }
  }
}
