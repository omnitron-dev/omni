/**
 * Slave→master replication: the guarantees the service header states.
 *
 * `sync.service.ts` opens with five numbered guarantees. Four were not
 * implemented, and each failure is silent by construction — replication that
 * drops data still reports success, because the thing that would notice is
 * the thing that is missing. These pin the decisions that make them true.
 */

import { describe, it, expect } from 'vitest';

import {
  deliveredIds,
  sweepMadeProgress,
  planEviction,
  SYNCED_RETENTION_MS,
  type IngestOutcome,
} from '../../src/services/sync-policy.js';

const outcome = (o: Partial<IngestOutcome>): IngestOutcome => ({
  accepted: [],
  duplicates: [],
  failed: [],
  ...o,
});

describe('deliveredIds — guarantee 1, zero data loss', () => {
  it('releases what the master accepted', () => {
    expect(deliveredIds(outcome({ accepted: ['a', 'b'] }))).toEqual(['a', 'b']);
  });

  it('releases a duplicate: the master has it', () => {
    // A retry after a lost acknowledgement. Holding it forever would be the
    // mirror-image bug — a buffer that never drains.
    expect(deliveredIds(outcome({ duplicates: ['a'] }))).toEqual(['a']);
  });

  it('never releases what the master rejected', () => {
    // The regression itself. The push path marked every entry synced after
    // `receiveBatch` returned, and `receiveBatch` swallows per-entry
    // failures into a warning — so forty rejected entries out of a hundred
    // were marked delivered and evicted a day later.
    const result = deliveredIds(outcome({ accepted: ['a'], duplicates: ['b'], failed: ['c', 'd'] }));

    expect(result).toEqual(['a', 'b']);
    expect(result).not.toContain('c');
    expect(result).not.toContain('d');
  });

  it('releases nothing when the whole batch failed', () => {
    expect(deliveredIds(outcome({ failed: ['a', 'b', 'c'] }))).toEqual([]);
  });
});

describe('sweepMadeProgress — a rejected entry must not loop', () => {
  it('continues while a page contains something new', () => {
    expect(sweepMadeProgress(new Set(['a']), ['a', 'b'])).toBe(true);
  });

  it('stops when a page repeats what was already seen', () => {
    // Entries the master rejects stay pending, so the next fetch returns
    // them. Once delivery stopped lying, this became reachable: without it
    // one permanently unacceptable entry spins the sweep forever.
    expect(sweepMadeProgress(new Set(['a', 'b']), ['a', 'b'])).toBe(false);
  });

  it('treats an empty page as no progress', () => {
    expect(sweepMadeProgress(new Set(['a']), [])).toBe(false);
  });

  it('makes progress on the first page, when nothing has been seen', () => {
    expect(sweepMadeProgress(new Set(), ['a'])).toBe(true);
  });
});

describe('planEviction — guarantee 5, bounded buffer', () => {
  const MB = 1024 * 1024;

  it('does nothing while the table is inside its budget', () => {
    const plan = planEviction({ totalBytes: 10 * MB, maxBytes: 500 * MB, totalRows: 1000, syncedRows: 900 });

    expect(plan.overflowRows).toBe(0);
    expect(plan.discardsUndelivered).toBe(false);
    expect(plan.syncedOlderThanMs).toBe(SYNCED_RETENTION_MS);
  });

  it('drops enough rows to get back under budget', () => {
    // 1000 rows filling 1000 MB against a 500 MB budget: 1 MB per row, and
    // the target is 90% of budget, so 550 rows have to go.
    const plan = planEviction({ totalBytes: 1000 * MB, maxBytes: 500 * MB, totalRows: 1000, syncedRows: 1000 });

    expect(plan.overflowRows).toBe(550);
    expect(plan.discardsUndelivered).toBe(false);
  });

  it('aims below the budget, not at it', () => {
    // Evicting exactly to the line means evicting again next cycle.
    const plan = planEviction({ totalBytes: 501 * MB, maxBytes: 500 * MB, totalRows: 501, syncedRows: 501 });
    expect(plan.overflowRows).toBeGreaterThan(1);
  });

  it('says when it is about to discard undelivered data', () => {
    // The distinction that has to reach a log line: dropping delivered
    // entries costs debugging history, dropping undelivered ones costs data.
    const plan = planEviction({ totalBytes: 1000 * MB, maxBytes: 500 * MB, totalRows: 1000, syncedRows: 100 });

    expect(plan.overflowRows).toBe(550);
    expect(plan.discardsUndelivered).toBe(true);
  });

  it('never plans to drop more rows than exist', () => {
    const plan = planEviction({ totalBytes: 10_000 * MB, maxBytes: 1 * MB, totalRows: 10, syncedRows: 0 });
    expect(plan.overflowRows).toBeLessThanOrEqual(10);
  });

  it('does nothing when it cannot compute a row size', () => {
    // An empty table reporting a size, or a nonsense budget. Guessing here
    // would delete rows on the strength of a division by zero.
    for (const params of [
      { totalBytes: 100 * MB, maxBytes: 1 * MB, totalRows: 0, syncedRows: 0 },
      { totalBytes: 100 * MB, maxBytes: 0, totalRows: 10, syncedRows: 0 },
      { totalBytes: 0, maxBytes: 1 * MB, totalRows: 10, syncedRows: 0 },
    ]) {
      expect(planEviction(params).overflowRows, JSON.stringify(params)).toBe(0);
    }
  });

  it('always reports the routine retention window', () => {
    // The synced-row pass runs every cycle regardless of budget; it is not
    // conditional on the overflow branch.
    const plan = planEviction({ totalBytes: 1, maxBytes: 1000, totalRows: 1, syncedRows: 1 });
    expect(plan.syncedOlderThanMs).toBe(SYNCED_RETENTION_MS);
  });
});
