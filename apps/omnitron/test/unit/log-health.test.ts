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
  findRetryLoops,
  findDuplicatedLogs,
  describeFinding,
  DOMINANCE_SHARE,
  DOMINANCE_MIN_COUNT,
  RETRY_LOOP_THRESHOLD,
} from '../../src/commands/log-health.js';

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

  it('says nothing when no line is duplicated', () => {
    expect(findDuplicatedLogs([], 1000)).toEqual([]);
    expect(findDuplicatedLogs([{ app: 'a', otherApp: 'b', count: 0 }], 1000)).toEqual([]);
  });

  it('does not divide by a zero total', () => {
    expect(findDuplicatedLogs([{ app: 'a', otherApp: 'b', count: 5 }], 0)).toEqual([]);
  });
});
