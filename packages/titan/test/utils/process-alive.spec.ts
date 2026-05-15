import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { isProcessAlive } from '../../src/utils/process-alive.js';

/**
 * Tests cover the three semantic paths of process.kill(pid, 0):
 *   - returns normally → alive (our own pid)
 *   - throws ESRCH → dead (spawned a child, waited for exit)
 *   - throws EPERM → alive on a different uid/cap; mocked because
 *     reproducing it for real requires root-owned processes
 *
 * Plus invalid-input guards: NaN, 0, negative, fractional pids
 * must all return false WITHOUT touching `process.kill`.
 */

describe('isProcessAlive', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true for the current process pid', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false after a spawned child exits (ESRCH)', async () => {
    const child = spawn('true');
    const pid = child.pid!;
    expect(pid).toBeGreaterThan(0);
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    // Give the OS a tick to reap.
    await new Promise((r) => setTimeout(r, 10));
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('returns false for pid 0', () => {
    expect(isProcessAlive(0)).toBe(false);
  });

  it('returns false for negative pid', () => {
    expect(isProcessAlive(-1)).toBe(false);
  });

  it('returns false for NaN pid', () => {
    expect(isProcessAlive(Number.NaN)).toBe(false);
  });

  it('returns false for non-integer pid', () => {
    expect(isProcessAlive(1.5)).toBe(false);
  });

  it('returns false for Infinity', () => {
    expect(isProcessAlive(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('does not invoke process.kill for invalid inputs', () => {
    const spy = vi.spyOn(process, 'kill');
    isProcessAlive(0);
    isProcessAlive(-1);
    isProcessAlive(Number.NaN);
    isProcessAlive(1.5);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns true on EPERM (process exists, we lack permission)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('not permitted') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });
    expect(isProcessAlive(12345)).toBe(true);
  });

  it('returns false on ESRCH (no such process)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('no such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it('treats unknown error codes as dead (safer default)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('something weird') as NodeJS.ErrnoException;
      err.code = 'EINVAL';
      throw err;
    });
    expect(isProcessAlive(12345)).toBe(false);
  });
});
