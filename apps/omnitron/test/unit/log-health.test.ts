/**
 * Reading the log table as a symptom.
 *
 * A message repeated far more often than anything else is a loop that cannot
 * make progress, and it is invisible from every surface an operator normally
 * looks at: the logs page shows the most recent lines, which are all the same
 * line; the alerts page shows rules nobody wrote for a failure nobody
 * predicted; and the daemon reports itself healthy throughout, because it is.
 *
 * This host carried 2.5 million copies of "Failed to process outbox event"
 * across three days in May — one event with a `retryCount` of 799 289 — under
 * 13 GB of log table, and nothing anywhere said so.
 */

import { describe, it, expect } from 'vitest';

import {
  findDominantErrors,
  findRepetitionLoad,
  findRetryLoops,
  findDuplicatedLogs,
  describeFinding,
  DOMINANCE_SHARE,
  DOMINANCE_MIN_COUNT,
  RETRY_LOOP_THRESHOLD,
} from '../../src/commands/log-health.js';

/**
 * The real error volume of this host, 2026-09-07, from the check's own query:
 * 15 094 error/fatal rows in 24 hours. Eight messages repeat; together they
 * are 76.5% of the day. The largest is 27.8%.
 *
 * `findDominantErrors` reports none of it, and cannot: its criterion is a
 * share of the total, and every additional broken loop enlarges the
 * denominator. The first of these loops, alone, would have been 100% and
 * reported at once. Eight of them are silent.
 */
const LIVE_ERROR_DAY = [
  { app: 'daos/dev/paysys', message: 'webhook-delivery-worker: tick failed', count: 4203 },
  { app: 'daos/dev/priceverse', message: 'Aggregation error', count: 2544 },
  { app: 'daos/dev/messaging', message: 'All 3 heartbeat attempts failed', count: 1691 },
  { app: 'daos/dev/messaging', message: 'Scheduled messages processing failed', count: 848 },
  { app: 'daos/dev/paysys', message: 'Confirmation check failed in poll cycle', count: 566 },
  { app: 'daos/dev/paysys', message: 'Withdrawal reorg sweep failed in poll cycle', count: 566 },
  { app: 'daos/dev/paysys', message: 'BTC scan failed in poll cycle', count: 566 },
  { app: 'daos/dev/paysys', message: 'XMR credited-reorg sweep failed in poll cycle', count: 566 },
  // The remaining 3 544 are NOT one message. Modelling them as a single row
  // was this fixture's own first defect: at 3 544 it cleared
  // DOMINANCE_MIN_COUNT and was itself counted as a loop, which made the
  // assertion pass on 15 094 — the whole day — and would have hidden a real
  // failure to distinguish repetition from variety.
  ...Array.from({ length: 44 }, (_, i) => ({
    app: 'daos/dev/main',
    message: `one-off failure ${i}`,
    count: 80,
  })),
  { app: 'daos/dev/main', message: 'one-off failure 44', count: 24 },
];

describe('findDominantErrors', () => {
  it('finds a message that is most of the error volume', () => {
    const found = findDominantErrors([
      { app: 'storage', message: 'Failed to process outbox event', count: 668_919 },
      { app: 'omnitron', message: 'Process termination timeout', count: 149 },
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe('Failed to process outbox event');
    expect(found[0]!.share).toBeGreaterThan(0.99);
  });

  it('is not fooled by the same message recorded under two app names', () => {
    // The case that made this check fail against the window where the loop
    // actually happened. Every child line is stored twice — once under the
    // app, once under `omnitron` — so per-app grouping splits one message
    // into two rows of half the size, and 100% measures as 50%.
    const found = findDominantErrors([
      { app: 'omni/dev/storage', message: 'Failed to process outbox event', count: 668_919 },
      { app: 'omnitron', message: 'Failed to process outbox event', count: 668_919 },
      { app: 'omnitron', message: 'Process termination timeout', count: 149 },
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(1_337_838);
    expect(found[0]!.app, 'both sources named').toContain('omnitron');
    expect(found[0]!.app).toContain('omni/dev/storage');
  });

  it('stays quiet on a handful of errors, however lopsided', () => {
    // Three errors before lunch, two of them the same, is not a loop. The
    // share alone would fire here, which is why there is also a floor.
    expect(findDominantErrors([
      { app: 'a', message: 'x', count: 2 },
      { app: 'a', message: 'y', count: 1 },
    ])).toEqual([]);
  });

  it('stays quiet on a busy host with no single dominant failure', () => {
    // The threshold is about shape, not volume: many errors spread across
    // many messages is a busy system, not a stuck one.
    const spread = Array.from({ length: 10 }, (_, i) => ({ app: 'a', message: `m${i}`, count: 500 }));
    expect(findDominantErrors(spread)).toEqual([]);
  });

  it('needs both the share and the floor', () => {
    const justUnderFloor = Math.floor(DOMINANCE_MIN_COUNT - 1);
    expect(findDominantErrors([{ app: 'a', message: 'x', count: justUnderFloor }])).toEqual([]);
    expect(findDominantErrors([{ app: 'a', message: 'x', count: DOMINANCE_MIN_COUNT }])).toHaveLength(1);

    // Above the floor, under the share: not dominant. Needs three messages —
    // with two, one of them is always at or above half, which is a property
    // of the threshold worth knowing rather than working around.
    expect(findDominantErrors([
      { app: 'a', message: 'x', count: 400 },
      { app: 'a', message: 'y', count: 400 },
      { app: 'a', message: 'z', count: 400 },
    ])).toEqual([]);

    // At the boundary, two messages can both qualify — an even split is two
    // dominant failures, not zero. Asserted rather than assumed: the first
    // version of this test expected one and was wrong about the code.
    expect(findDominantErrors([
      { app: 'a', message: 'x', count: 500 },
      { app: 'a', message: 'y', count: 500 },
    ])).toHaveLength(2);
  });

  it('says nothing when there are no errors at all', () => {
    expect(findDominantErrors([])).toEqual([]);
    expect(findDominantErrors([{ app: 'a', message: 'x', count: 0 }])).toEqual([]);
  });
});

describe('findRetryLoops', () => {
  it('reports a retry count that means the ceiling is missing', () => {
    const found = findRetryLoops([
      { app: 'storage', message: 'Failed to process outbox event', count: 10, retryCount: 799_289 },
    ]);

    expect(found).toHaveLength(1);
    expect(describeFinding(found[0]!)).toContain('799,289');
  });

  it('leaves an ordinary retry policy alone', () => {
    // Five attempts with backoff is a policy. The threshold is set well above
    // anything a policy would produce, so this never argues with one.
    expect(findRetryLoops([{ app: 'a', message: 'x', count: 1, retryCount: 5 }])).toEqual([]);
    expect(findRetryLoops([{ app: 'a', message: 'x', count: 1, retryCount: RETRY_LOOP_THRESHOLD - 1 }])).toEqual([]);
    expect(findRetryLoops([{ app: 'a', message: 'x', count: 1, retryCount: RETRY_LOOP_THRESHOLD }])).toHaveLength(1);
  });

  it('reports the worst offender first', () => {
    const found = findRetryLoops([
      { app: 'a', message: 'x', count: 1, retryCount: 5_000 },
      { app: 'b', message: 'y', count: 1, retryCount: 900_000 },
    ]);

    expect(found.map((f) => f.retryCount)).toEqual([900_000, 5_000]);
  });
});

describe('findDuplicatedLogs', () => {
  it('reports lines stored under two app names', () => {
    const found = findDuplicatedLogs(
      [{ app: 'daos/dev/priceverse', otherApp: 'omnitron', count: 40 }],
      104
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.app).toContain('omnitron');
    expect(describeFinding(found[0]!)).toContain('40');
  });

  it('ignores the coincidences that remain after the defect is fixed', () => {
    // Two apps going through a coordinated shutdown log "Application
    // stopping" in the same millisecond. That is two apps doing the same
    // thing, not one line stored twice.
    //
    // Measured on this host after the fix: 18 rows in 1260, every one a
    // shared lifecycle phase. The first version of this check had no
    // threshold, fired on exactly those, and would have taught its reader
    // to ignore it.
    expect(findDuplicatedLogs([{ app: 'daos/dev/main', otherApp: 'daos/dev/paysys', count: 18 }], 1260)).toEqual([]);
  });

  it('still reports duplication at the scale the defect produced', () => {
    // The systematic case was around half the table.
    const found = findDuplicatedLogs([{ app: 'daos/dev/priceverse', otherApp: 'omnitron', count: 500 }], 1000);
    expect(found).toHaveLength(1);
    expect(found[0]!.share).toBeCloseTo(0.5);
  });

  it('draws the line where it says it does', () => {
    expect(findDuplicatedLogs([{ app: 'a', otherApp: 'b', count: 99 }], 1000)).toEqual([]);
    expect(findDuplicatedLogs([{ app: 'a', otherApp: 'b', count: 100 }], 1000)).toHaveLength(1);
  });

  it('says nothing when no line is duplicated', () => {
    expect(findDuplicatedLogs([], 1000)).toEqual([]);
    expect(findDuplicatedLogs([{ app: 'a', otherApp: 'b', count: 0 }], 1000)).toEqual([]);
  });

  it('does not divide by a zero total', () => {
    expect(findDuplicatedLogs([{ app: 'a', otherApp: 'b', count: 5 }], 0)).toEqual([]);
  });
});


describe('findRepetitionLoad', () => {
  it('reports the loops that no single-message threshold can see', () => {
    // The condition this exists for, with the numbers it was found on.
    expect(findDominantErrors(LIVE_ERROR_DAY)).toHaveLength(0);

    const [found] = findRepetitionLoad(LIVE_ERROR_DAY);
    expect(found).toBeDefined();
    expect(found!.count).toBe(11_550);
    expect(found!.share).toBeGreaterThan(0.76);
    // Naming them is the point: an operator who is told "repetition is 76% of
    // your errors" and not which messages has been given a statistic, not a
    // lead.
    expect(found!.message).toContain('webhook-delivery-worker: tick failed');
    expect(found!.message).toContain('Aggregation error');
  });

  it('stays silent when one message already dominates', () => {
    // Complementary, not overlapping: that case is `findDominantErrors`, and
    // reporting the same loop under two headings is how a check becomes
    // something people stop reading.
    const oneLoop = [
      { app: 'storage', message: 'Failed to process outbox event', count: 9000 },
      { app: 'storage', message: 'Also broken', count: 900 },
    ];
    expect(findDominantErrors(oneLoop)).toHaveLength(1);
    expect(findRepetitionLoad(oneLoop)).toHaveLength(0);
  });

  it('does not fire on ordinary assorted noise', () => {
    // Twenty different failures, none repeating enough to be a loop. This is
    // a busy day, not a stuck system, and the difference has to survive.
    const noise = Array.from({ length: 20 }, (_, i) => ({
      app: 'main',
      message: `distinct failure ${i}`,
      count: 40,
    }));
    expect(findRepetitionLoad(noise)).toHaveLength(0);
  });

  it('does not fire when repetition is a minority of the errors', () => {
    const mostlyVaried = [
      { app: 'main', message: 'a loop', count: 200 },
      { app: 'main', message: 'another loop', count: 200 },
      { app: 'main', message: 'assorted', count: 2000 },
    ];
    expect(findRepetitionLoad(mostlyVaried)).toHaveLength(0);
  });
});
