/**
 * SpecialEventBuffer — the two invariants the class exists for.
 *
 * Both were broken and neither was covered: `delete()` unmapped the queue but
 * left the in-flight drain emitting from the array it had captured, and the
 * queue cap dropped index 0 — an entry the drain had already sent — sliding
 * every unemitted event one place left under a cursor that did not move.
 */
import { describe, it, expect, vi } from 'vitest';

import { SpecialEventBuffer } from '../../src/netron/special-event-buffer.js';
import { MAX_EVENT_QUEUE_SIZE } from '../../src/netron/constants.js';
import type { ILogger } from '../../src/types/logger.js';

const silentLogger = (): ILogger =>
  ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => silentLogger(),
  }) as unknown as ILogger;

/** A gate the emit handler blocks on, so a drain can be held mid-flight. */
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

describe('SpecialEventBuffer', () => {
  describe('delete()', () => {
    it('cancels the in-flight drain, not just the map entry', async () => {
      const emitted: string[] = [];
      const first = gate();

      const buffer = new SpecialEventBuffer(async (name) => {
        emitted.push(name);
        // Hold the drain inside the first event.
        if (emitted.length === 1) await first.opened;
      }, silentLogger());

      const drain = buffer.emitSpecial('e1', 'id', {});
      // Queue two more behind the event being awaited.
      await buffer.emitSpecial('e2', 'id', {});
      await buffer.emitSpecial('e3', 'id', {});
      expect(emitted).toEqual(['e1']);

      buffer.delete('id');

      first.open();
      await drain;

      // e1 was already out and cannot be recalled; e2 and e3 must not follow.
      expect(emitted).toEqual(['e1']);
    });

    it('does not let a later emit for the same id start a second drain', async () => {
      // Two drains running concurrently for one id is exactly the interleaving
      // this class exists to prevent, and the old delete() set it up: the
      // abandoned drain's `finally` unmapped whatever queue the id held by
      // then — including a *fresh* one, still being drained — so the next emit
      // saw an empty slot and started a drain of its own alongside it.
      const order: string[] = [];
      const oldGate = gate();
      const freshGate = gate();

      const buffer = new SpecialEventBuffer(async (name) => {
        order.push(`start:${name}`);
        if (name === 'old') await oldGate.opened;
        if (name === 'new-1') await freshGate.opened;
        order.push(`end:${name}`);
      }, silentLogger());

      const abandoned = buffer.emitSpecial('old', 'id', {});
      buffer.delete('id');

      // A fresh sequence for the same id, held mid-flight.
      const fresh = buffer.emitSpecial('new-1', 'id', {});
      await Promise.resolve();

      // Let the abandoned drain finish and run its cleanup while the fresh
      // drain is still in flight.
      oldGate.open();
      await abandoned;

      // The queue the fresh drain owns must have survived that cleanup, so this
      // enqueues behind new-1 instead of starting a drain beside it.
      const queued = buffer.emitSpecial('new-2', 'id', {});
      freshGate.open();
      await Promise.all([fresh, queued]);

      expect(order.indexOf('end:new-1')).toBeLessThan(order.indexOf('start:new-2'));
      expect(order.filter((o) => o.startsWith('start:'))).toEqual(['start:old', 'start:new-1', 'start:new-2']);
    });
  });

  describe('queue cap', () => {
    it('drops an event that has not been emitted, and only one per overflow', async () => {
      const emitted: string[] = [];
      const held = gate();
      const logger = silentLogger();

      const buffer = new SpecialEventBuffer(async (name) => {
        emitted.push(name);
        // Hold the drain inside the very first event so everything else queues.
        if (emitted.length === 1) await held.opened;
      }, logger);

      const drain = buffer.emitSpecial('head', 'id', {});

      // Fill to the cap, then push one more so exactly one drop happens.
      for (let i = 0; i <= MAX_EVENT_QUEUE_SIZE; i++) {
        await buffer.emitSpecial(`q${i}`, 'id', {});
      }
      expect(logger.error).toHaveBeenCalledTimes(1);

      held.open();
      await drain;

      // 'head' plus the cap's worth of queued events, one of which was dropped
      // to make room for the last. Before the fix the drop removed 'head' —
      // already emitted, so nothing was freed — and the cursor then skipped
      // 'q0' entirely, losing an event nobody had asked to drop.
      expect(emitted[0]).toBe('head');
      expect(emitted).toHaveLength(MAX_EVENT_QUEUE_SIZE + 1);
      expect(emitted).not.toContain('q0'); // the oldest UNEMITTED event
      expect(emitted).toContain('q1');
      expect(emitted).toContain(`q${MAX_EVENT_QUEUE_SIZE - 1}`);

      // FIFO across the survivors.
      const queued = emitted.slice(1);
      expect(queued).toEqual([...queued].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
    });
  });

  it('emits sequentially per id and releases the queue when drained', async () => {
    const order: string[] = [];
    const buffer = new SpecialEventBuffer(async (name) => {
      order.push(`start:${name}`);
      await new Promise((r) => setTimeout(r, 1));
      order.push(`end:${name}`);
    }, silentLogger());

    const a = buffer.emitSpecial('a', 'id', {});
    const b = buffer.emitSpecial('b', 'id', {});
    await Promise.all([a, b]);

    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
    expect((buffer as unknown as { ownEvents: Map<string, unknown> }).ownEvents.has('id')).toBe(false);
  });
});
