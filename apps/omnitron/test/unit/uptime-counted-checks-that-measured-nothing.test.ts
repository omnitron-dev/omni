/**
 * The fleet page reported 0% uptime for software that was never installed.
 *
 * A node's OMNITRON strip aggregates health checks into buckets and colours
 * each one green→red by the fraction that found omnitron running. Two kinds
 * of check are not measurements of that: one that reached the machine and
 * found no omnitron installed on it, and one whose SSH was refused, which
 * never got far enough to look.
 *
 * `getUptimeBar` knew this — it returned -1 rather than 0 when EVERY check in
 * a bucket said "not installed", with a comment explaining that 0 would paint
 * a machine that was never meant to run one solid red. Underneath that guard
 * the proportion still divided by every check in the bucket, so a bucket that
 * mixed the two got a wrong number instead of no number, and the wrongness
 * grew with the share of non-measurements.
 *
 * Measured 2026-09-14 on the test node: 60 checks reading "omnitron: command
 * not found" and 13 reading "SSH unavailable", one day, summarised on the
 * card as "OMNITRON 0%" in red. Nothing was down. Nothing was ever up. The
 * strip had no way to say so.
 */

import { describe, it, expect } from 'vitest';

import { assembleBuckets, type UptimeAggregateRow } from '../../src/services/node-health.repository.js';

const START = Date.parse('2026-09-14T00:00:00Z');
const HOUR = 3_600_000;

/** One bucket's counts, defaulting to "nothing happened". */
function row(counts: Partial<UptimeAggregateRow> & { checks: number }): UptimeAggregateRow {
  return {
    idx: 0,
    ping_up: counts.checks,
    omni_up: 0,
    omni_measured: 0,
    omni_absent: 0,
    ...counts,
  };
}

const only = (r: UptimeAggregateRow) => assembleBuckets([r], START, HOUR, 1)[0]!;

describe('uptime is the fraction of the checks that measured it', () => {
  it('divides by the measurements, not by every check', () => {
    // 12 up, 6 down, 6 that found nothing installed. The honest figure is
    // 12 of 18. Dividing by 24 gives 50%, and the difference is entirely the
    // checks the same query had just declared not to be measurements.
    const bucket = only(row({ checks: 24, omni_up: 12, omni_measured: 18, omni_absent: 6 }));

    expect(bucket.omnitron).toBeCloseTo(12 / 18);
    expect(bucket.omnitron).not.toBeCloseTo(12 / 24);
  });

  it('reports no figure at all when nothing measured it', () => {
    const bucket = only(row({ checks: 60, omni_measured: 0, omni_absent: 60 }));

    expect(bucket.omnitron).toBe(-1);
  });

  it('says WHY there is no figure: nothing installed', () => {
    // The live case. Without this the strip is the same grey as a bucket
    // nothing ever wrote to, and says "no data" about 60 definite answers.
    const bucket = only(row({ checks: 60, omni_measured: 0, omni_absent: 60 }));

    expect(bucket.omnitronUnmeasured).toBe('absent');
  });

  it('says WHY there is no figure: could not reach it', () => {
    // An SSH outage is not an omnitron outage, and the operator who sees the
    // strip needs to be sent to the right machine.
    const bucket = only(row({ checks: 13, omni_measured: 0, omni_absent: 0 }));

    expect(bucket.omnitronUnmeasured).toBe('unreachable');
  });

  it('calls a mixed unmeasured bucket absent when anything found it absent', () => {
    // 60 said "not installed", 13 could not look. "Not installed" is the
    // finding; the failures add nothing to it.
    const bucket = only(row({ checks: 73, omni_measured: 0, omni_absent: 60 }));

    expect(bucket.omnitron).toBe(-1);
    expect(bucket.omnitronUnmeasured).toBe('absent');
  });

  it('leaves a bucket nothing wrote to alone', () => {
    const [bucket] = assembleBuckets([], START, HOUR, 1);

    expect(bucket).toMatchObject({ omnitron: -1, ping: -1, checks: 0 });
    // Not "absent", not "unreachable" — nothing was asked, so nothing is said.
    expect(bucket!.omnitronUnmeasured).toBeUndefined();
  });

  it('gives a fully-measured bucket no reason, because it has a figure', () => {
    const bucket = only(row({ checks: 10, omni_up: 10, omni_measured: 10 }));

    expect(bucket.omnitron).toBe(1);
    expect(bucket.omnitronUnmeasured).toBeUndefined();
  });
});

describe('the rest of the series still holds', () => {
  it('reads the counts Postgres returns as strings', () => {
    // `count(*)` comes back as a string over the wire; arithmetic on it would
    // concatenate rather than divide.
    const bucket = only(row({ checks: '24' as never, omni_up: '12' as never, omni_measured: '18' as never, ping_up: '24' as never }));

    expect(bucket.omnitron).toBeCloseTo(12 / 18);
    expect(bucket.ping).toBe(1);
    expect(bucket.checks).toBe(24);
  });

  it('places each row in its own bucket, oldest first', () => {
    const buckets = assembleBuckets(
      [row({ idx: 0, checks: 4, ping_up: 4 }), row({ idx: 2, checks: 4, ping_up: 0 })],
      START, HOUR, 3,
    );

    expect(buckets.map((b) => b.t)).toEqual([
      new Date(START).toISOString(),
      new Date(START + HOUR).toISOString(),
      new Date(START + 2 * HOUR).toISOString(),
    ]);
    expect(buckets[0]!.ping).toBe(1);
    expect(buckets[1]!.checks).toBe(0);
    expect(buckets[2]!.ping).toBe(0);
  });

  it('discards an index outside the window rather than writing past the array', () => {
    const buckets = assembleBuckets(
      [row({ idx: -1, checks: 4 }), row({ idx: 9, checks: 4 }), row({ idx: 'x' as never, checks: 4 })],
      START, HOUR, 2,
    );

    expect(buckets).toHaveLength(2);
    expect(buckets.every((b) => b.checks === 0)).toBe(true);
  });
});
