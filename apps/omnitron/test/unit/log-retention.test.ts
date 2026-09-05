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
    expect(plan.batchSize).toBe(RETENTION_BATCH);
    expect(plan.batchSize).toBeLessThan(plan.maxThisPass);
  });

  it('bounds a single pass', () => {
    // A first run against years of history must not monopolise the daemon;
    // the next hourly pass finishes the job.
    expect(planRetention(14, NOW)!.maxThisPass).toBe(RETENTION_MAX_PER_PASS);
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
