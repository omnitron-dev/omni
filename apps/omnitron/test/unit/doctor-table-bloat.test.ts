/**
 * Telling a big table from a bloated one.
 *
 * Both look identical from `pg_total_relation_size`, and they have opposite
 * remedies: shorten the retention window, or reclaim the file. Getting it
 * backwards sends an operator to tighten a retention pass that is already
 * doing its job.
 *
 * The figures below are this host's, measured: 13.3 GiB of `logs` holding
 * 67 419 live rows after retention deleted 22 468 313 of them. `DELETE` does
 * not return space to the operating system, and plain `VACUUM` only makes
 * the pages reusable inside the file.
 */

import { describe, it, expect } from 'vitest';

import { looksBloated, bytesPerLiveRow } from '../../src/commands/doctor.js';

const GIB = 1024 ** 3;

describe('bytesPerLiveRow', () => {
  it('divides', () => {
    expect(bytesPerLiveRow(1000, 10)).toBe(100);
  });

  it('calls a table with no live rows infinitely expensive per row', () => {
    // Not a division by zero to be avoided quietly: a gigabyte holding
    // nothing IS entirely reclaimable, which is the strongest form of the
    // finding rather than a case to skip.
    expect(bytesPerLiveRow(GIB, 0)).toBe(Infinity);
  });
});

describe('looksBloated', () => {
  it('recognises this host: 13.3 GiB for 67 419 rows', () => {
    expect(looksBloated(13.3 * GIB, 67_419)).toBe(true);
    expect(bytesPerLiveRow(13.3 * GIB, 67_419) / 1024).toBeCloseTo(207, 0);
  });

  it('leaves a genuinely large table alone', () => {
    // 13 GiB across 60 million rows is ~230 bytes each — a busy platform
    // with a wide retention window, and shortening it is the right advice.
    expect(looksBloated(13 * GIB, 60_000_000)).toBe(false);
  });

  it('says nothing about a small table however sparse', () => {
    // A 40 MiB table holding four rows is bloated in the same sense and not
    // worth an operator's attention; the finding is about disk pressure.
    expect(looksBloated(40 * 1024 ** 2, 4)).toBe(false);
  });

  it('holds at the size floor', () => {
    expect(looksBloated(GIB - 1, 1)).toBe(false);
    expect(looksBloated(GIB, 1)).toBe(true);
  });

  it('holds at the per-row threshold', () => {
    // One Postgres page per row is already far past what a few hundred bytes
    // of log line can explain, so the boundary sits there.
    const rows = 1_000_000;
    expect(looksBloated(8 * 1024 * rows, rows)).toBe(false);
    expect(looksBloated(8 * 1024 * rows + rows, rows)).toBe(true);
  });

  it('treats an empty gigabyte as bloat', () => {
    expect(looksBloated(2 * GIB, 0)).toBe(true);
  });
});
