/**
 * A deployment that says nothing cannot be told from one that has stopped.
 *
 * The measurement behind `reportPhases`: on 2026-09-22 a remote deployment
 * logged «Starting remote stack — deploying to slave daemons» at 04:43:47 and
 * its next line at 04:57:36 — 829 seconds apart, with the work in flight the
 * whole time. Everything this file pins is about the middle of that window,
 * which is the part no transition log can reach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { reportPhases, type PhaseLogger } from '../../src/project/deploy-phases.js';

function recorder(): PhaseLogger & { lines: Array<{ obj: Record<string, unknown>; msg: string }> } {
  const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  return {
    lines,
    info(obj, msg) {
      lines.push({ obj, msg });
    },
  };
}

describe('a deploy that said nothing for fourteen minutes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says nothing before a phase is entered — an unnamed step is not progress', () => {
    const log = recorder();
    const phases = reportPhases(log, { stack: 'test' }, 30_000);

    vi.advanceTimersByTime(120_000);

    expect(log.lines).toHaveLength(0);
    phases.done();
  });

  it('names the phase it is in, on the interval, while nothing else happens', () => {
    const log = recorder();
    const phases = reportPhases(log, { project: 'daos', stack: 'test' }, 30_000);

    phases.enter('building artifacts');
    vi.advanceTimersByTime(90_000);
    phases.done();

    expect(log.lines.map((l) => l.msg)).toEqual([
      'Still building artifacts',
      'Still building artifacts',
      'Still building artifacts',
    ]);
    // The seconds are the point: a line that repeats without them cannot
    // distinguish a step that is slow from a step that is stuck.
    expect(log.lines.map((l) => l.obj['seconds'])).toEqual([30, 60, 90]);
    expect(log.lines[0]?.obj).toMatchObject({ project: 'daos', stack: 'test', phase: 'building artifacts' });
  });

  it('carries the caller context into every line, not only the first', () => {
    const log = recorder();
    const phases = reportPhases(log, { project: 'daos', stack: 'test' }, 30_000);

    phases.enter('provisioning 37.27.130.185');
    vi.advanceTimersByTime(60_000);
    phases.done();

    for (const line of log.lines) {
      expect(line.obj['project']).toBe('daos');
      expect(line.obj['stack']).toBe('test');
    }
  });

  it('counts the seconds of the CURRENT phase, not of the deployment', () => {
    const log = recorder();
    const phases = reportPhases(log, {}, 30_000);

    phases.enter('building artifacts');
    vi.advanceTimersByTime(75_000); // ticks at 30 s and 60 s of building
    phases.enter('delivering 6 artifacts');
    vi.advanceTimersByTime(30_000); // the tick at 90 s finds delivery 15 s old
    phases.done();

    expect(log.lines.map((l) => [l.msg, l.obj['seconds']])).toEqual([
      ['Still building artifacts', 30],
      ['Still building artifacts', 60],
      // 15, not 90: the cadence belongs to the reporter, the clock to the
      // phase. An operator reading «delivering, 90 s» would be told the
      // deployment's age and shown it as the step's.
      ['Still delivering 6 artifacts', 15],
    ]);
  });

  it('stops when the deployment does — and stays stopped if stopped twice', () => {
    const log = recorder();
    const phases = reportPhases(log, {}, 30_000);

    phases.enter('building artifacts');
    vi.advanceTimersByTime(30_000);
    expect(log.lines).toHaveLength(1);

    phases.done();
    phases.done();
    vi.advanceTimersByTime(300_000);

    expect(log.lines).toHaveLength(1);
  });

  it('does not hold the process open — the timer is unrefed', () => {
    const log = recorder();
    const unref = vi.fn();
    const spy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref } as unknown as NodeJS.Timeout);

    const phases = reportPhases(log, {}, 30_000);
    phases.done();
    spy.mockRestore();

    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('a phase entered after `done` reports nothing — the reporter is spent, not paused', () => {
    const log = recorder();
    const phases = reportPhases(log, {}, 30_000);

    phases.done();
    phases.enter('delivering 6 artifacts');
    vi.advanceTimersByTime(300_000);

    expect(log.lines).toHaveLength(0);
  });
});
