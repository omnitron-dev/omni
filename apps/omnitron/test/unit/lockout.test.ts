/**
 * How long an account stays locked after failed sign-ins.
 *
 * The daemon's auth service had 469 lines and no tests. This is the part
 * worth pinning first: it decides when an operator is shut out of the
 * infrastructure control plane, and every mistake in it is either a lockout
 * that never engages or one that never lets go.
 */

import { describe, it, expect } from 'vitest';

import {
  computeLockout,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_BASE_MS,
  LOCKOUT_MAX_MS,
} from '../../src/services/lockout.js';

const NOW = Date.UTC(2026, 0, 1);

/** Lockout duration in ms, or null. */
const durationOf = (attempts: number): number | null => {
  const until = computeLockout(attempts, NOW);
  return until === null ? null : until.getTime() - NOW;
};

describe('computeLockout', () => {
  it('does not lock while under the threshold', () => {
    // Four wrong passwords is a person mistyping, not an attack.
    for (let attempts = 0; attempts < MAX_FAILED_ATTEMPTS; attempts += 1) {
      expect(durationOf(attempts), `attempts=${attempts}`).toBeNull();
    }
  });

  it('locks for the base duration exactly at the threshold', () => {
    expect(durationOf(MAX_FAILED_ATTEMPTS)).toBe(LOCKOUT_BASE_MS);
  });

  it('doubles with each further failure', () => {
    expect(durationOf(MAX_FAILED_ATTEMPTS + 1)).toBe(LOCKOUT_BASE_MS * 2);
    expect(durationOf(MAX_FAILED_ATTEMPTS + 2)).toBe(LOCKOUT_BASE_MS * 4);
    expect(durationOf(MAX_FAILED_ATTEMPTS + 3)).toBe(LOCKOUT_BASE_MS * 8);
  });

  it('stops doubling at the cap', () => {
    // Without a ceiling a persistent attacker locks the account for years,
    // which turns a defence into a denial of service against the operator.
    expect(durationOf(MAX_FAILED_ATTEMPTS + 20)).toBe(LOCKOUT_MAX_MS);
    expect(durationOf(1000)).toBe(LOCKOUT_MAX_MS);
  });

  it('stays capped where the doubling overflows to Infinity', () => {
    // 2 ** 1024 is Infinity. The cap holds only because Infinity compares
    // larger — a subtraction-based clamp would produce NaN here.
    const until = computeLockout(2000, NOW);
    expect(until).not.toBeNull();
    expect(Number.isFinite(until!.getTime())).toBe(true);
    expect(durationOf(2000)).toBe(LOCKOUT_MAX_MS);
  });

  it('locks rather than opens on a nonsensical count', () => {
    // NaN would compare false against the threshold and read as "not locked",
    // disabling the defence for whichever caller produced it. The safe
    // direction is to lock.
    expect(durationOf(Number.NaN)).toBe(LOCKOUT_BASE_MS);
    expect(durationOf(Number.POSITIVE_INFINITY)).toBe(LOCKOUT_BASE_MS);
  });

  it('measures from the moment given, not from the module being loaded', () => {
    const later = Date.UTC(2026, 5, 1);
    expect(computeLockout(MAX_FAILED_ATTEMPTS, later)!.getTime()).toBe(later + LOCKOUT_BASE_MS);
  });

  it('is bounded so an operator is never locked out for more than half an hour', () => {
    // The property that matters to whoever has to get back in.
    for (const attempts of [5, 10, 50, 500, 5000]) {
      expect(durationOf(attempts)!, `attempts=${attempts}`).toBeLessThanOrEqual(30 * 60_000);
    }
  });
});
