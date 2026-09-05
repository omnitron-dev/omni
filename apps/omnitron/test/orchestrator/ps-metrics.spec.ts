/**
 * Reading `ps` output, and what a failed read is allowed to say.
 *
 * The batch path left its map empty on error, with a comment reading "no
 * reading is honest, a zero reading is not". The single-pid path — every
 * classic-mode app — returned `{ cpu: 0, memory: 0 }` on exactly the same
 * failure, and the caller wrote that over `handle.lastMetrics`. So a `ps`
 * that timed out under load made a running app read as idle, which is a
 * legitimate reading and therefore an invisible one.
 *
 * Two conventions for the same event, in the same file, twenty lines apart.
 */

import { describe, it, expect } from 'vitest';

import { parsePsLine, parsePsBatch, mergeSample } from '../../src/orchestrator/ps-metrics.js';

describe('parsePsLine', () => {
  it('reads the three columns ps prints', () => {
    // `ps -p 1234 -o pid=,rss=,%cpu=` — rss is kilobytes.
    expect(parsePsLine(' 1234 102400  12.5')).toEqual({
      pid: 1234,
      sample: { cpu: 12.5, memory: 102400 * 1024 },
    });
  });

  it('reads a zero-CPU process as zero, not as absent', () => {
    // An idle process is a real reading and must survive.
    expect(parsePsLine('42 8192 0.0')?.sample).toEqual({ cpu: 0, memory: 8192 * 1024 });
  });

  it('returns null on a partial line rather than inventing a zero', () => {
    // `ps` under memory pressure can print a truncated line, and a pid that
    // exits between the query and the read prints nothing at all.
    // `parseFloat('')` is NaN, which renders as `NaN%` in the console and
    // poisons any total it is summed into.
    for (const line of ['', '   ', '1234', '1234 102400', 'garbage', '1234 abc 12.5', '1234 102400 abc']) {
      expect(parsePsLine(line), JSON.stringify(line)).toBeNull();
    }
  });

  it('rejects values that cannot describe a process', () => {
    expect(parsePsLine('0 100 1.0')).toBeNull();
    expect(parsePsLine('-1 100 1.0')).toBeNull();
    expect(parsePsLine('1234 -5 1.0')).toBeNull();
    expect(parsePsLine('1234 100 -1')).toBeNull();
  });

  it('never returns NaN in a sample', () => {
    for (const line of ['1234 x 1.0', '1234 100 x', 'x 100 1.0']) {
      const parsed = parsePsLine(line);
      expect(parsed === null || Number.isFinite(parsed.sample.cpu)).toBe(true);
    }
  });
});

describe('parsePsBatch', () => {
  it('reads every process ps could report', () => {
    const batch = parsePsBatch(' 100 1024  1.0\n 200 2048  2.5\n 300 4096  0.0');

    expect([...batch.keys()]).toEqual([100, 200, 300]);
    expect(batch.get(200)).toEqual({ cpu: 2.5, memory: 2048 * 1024 });
  });

  it('keeps the readable lines when one is not', () => {
    // `ps` prints the pids that exist and says nothing about the ones that
    // do not — a batch is normally partial, and that is not an error.
    const batch = parsePsBatch(' 100 1024  1.0\n\n  \n 300 4096  0.5');

    expect([...batch.keys()]).toEqual([100, 300]);
  });

  it('returns an empty map for empty output rather than throwing', () => {
    expect(parsePsBatch('').size).toBe(0);
    expect(parsePsBatch('\n\n').size).toBe(0);
  });
});

describe('mergeSample', () => {
  it('keeps the previous reading when the new one could not be taken', () => {
    // The defect, stated directly: a failed `ps` must not make a busy app
    // look idle.
    const previous = { cpu: 42, memory: 500 * 1024 * 1024 };
    expect(mergeSample(previous, null)).toEqual(previous);
  });

  it('takes a real zero over a stale reading', () => {
    // An app that genuinely went idle must be able to say so.
    const previous = { cpu: 42, memory: 500 * 1024 * 1024 };
    expect(mergeSample(previous, { cpu: 0, memory: 1024 })).toEqual({ cpu: 0, memory: 1024 });
  });

  it('reports nothing when there is nothing to report', () => {
    expect(mergeSample(null, null)).toBeNull();
  });
});
