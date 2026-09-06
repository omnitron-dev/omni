/**
 * How much log history the daemon keeps.
 *
 * The `logs` table had no retention at all: every line from every app went
 * into Postgres and stayed. 22.5 million rows, 13 GB, on a machine that has
 * already lost its database and its infrastructure containers to a full
 * disk. `logging.maxSize` and `logging.maxFiles` exist and govern the
 * rotated FILES — two settings that read like retention and are not, which
 * is most of why the table had none.
 */

import { describe, it, expect } from 'vitest';

import {
  planRetention,
  batchesPerPass,
  RETENTION_BATCH,
  RETENTION_MAX_PER_PASS,
} from '../../src/services/log-retention.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');

describe('planRetention', () => {
  it('cuts off exactly the requested number of days back', () => {
    const plan = planRetention(14, NOW);
    expect(plan?.cutoff.toISOString()).toBe('2026-08-22T12:00:00.000Z');
  });

  it('disables rather than deleting everything when the setting is zero', () => {
    // The dangerous reading. A cutoff of "now" from `retentionDays: 0` would
    // empty the table on the next pass, and 0 is exactly what a config that
    // forgot the field, or a misplaced `?? 0`, produces.
    expect(planRetention(0, NOW)).toBeNull();
    expect(planRetention(-1, NOW)).toBeNull();
  });

  it('disables on a value it cannot use, rather than guessing', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(planRetention(bad, NOW), String(bad)).toBeNull();
    }
  });

  it('accepts a fractional day', () => {
    // Six hours. Useful on a machine that is filling up now.
    const plan = planRetention(0.25, NOW);
    expect(plan?.cutoff.toISOString()).toBe('2026-09-05T06:00:00.000Z');
  });

  it('deletes in batches, not in one statement', () => {
    // A single DELETE over 13 GB holds its transaction for the duration and
    // blocks the flush path behind it — the retention pass would surface as
    // the log pipeline stalling.
    const plan = planRetention(14, NOW)!;

    // Properties, not `toBe(RETENTION_BATCH)`. The plan is built from that
    // constant, so the comparison passes for every value it could hold —
    // including 1, which would issue ten thousand statements to delete what
    // one batch should, and including the whole table, which is the single
    // long transaction this bound exists to prevent. The test below already
    // says this about `maxThisPass`; this line was the exception it warns
    // against, sitting five lines above it.
    expect(plan.batchSize).toBeGreaterThanOrEqual(1_000);
    expect(plan.batchSize).toBeLessThanOrEqual(100_000);
    expect(plan.batchSize).toBeLessThan(plan.maxThisPass);
  });

  it('bounds a single pass', () => {
    // A first run against years of history must not monopolise the daemon;
    // the next hourly pass finishes the job.
    //
    // Asserted as properties rather than as `toBe(RETENTION_MAX_PER_PASS)`.
    // That comparison reads like a check and is a tautology: the plan is
    // built from the same constant, so it passes for any value the constant
    // could hold — including `Infinity`, which is precisely the state this
    // bound exists to prevent. A test of a limit has to be able to fail when
    // the limit is removed.
    const plan = planRetention(14, NOW)!;

    expect(Number.isFinite(plan.maxThisPass)).toBe(true);
    expect(plan.maxThisPass).toBeGreaterThan(0);
    // Large enough to make progress on a real backlog, small enough that one
    // pass cannot be the whole table: the daemon has 22M rows here.
    expect(plan.maxThisPass).toBeGreaterThanOrEqual(plan.batchSize);
    expect(plan.maxThisPass).toBeLessThan(5_000_000);
    // And it does not depend on how much history is being removed — a pass
    // over ten years must be bounded the same as one over ten days.
    expect(planRetention(3650, NOW)!.maxThisPass).toBe(plan.maxThisPass);
  });
});

describe('batchesPerPass', () => {
  it('covers the pass ceiling', () => {
    const plan = planRetention(14, NOW)!;
    expect(batchesPerPass(plan) * plan.batchSize).toBeGreaterThanOrEqual(plan.maxThisPass);
  });

  it('always runs at least one batch', () => {
    // A ceiling smaller than one batch still has to make progress, or
    // retention silently does nothing.
    expect(batchesPerPass({ cutoff: NOW, batchSize: 10_000, maxThisPass: 1 })).toBe(1);
    expect(batchesPerPass({ cutoff: NOW, batchSize: 10_000, maxThisPass: 0 })).toBe(1);
  });
});
