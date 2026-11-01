import { describe, expect, it } from 'vitest';
import { evaluateSessionPolicy } from './session-policy.js';

describe('session policy', () => {
  const facts = { hasMfa: true, createdAt: Date.parse('2026-11-01T00:00:00Z'), now: Date.parse('2026-11-01T00:30:00Z') };
  it('requires a verified factor and limits absolute session age at the boundary', () => {
    expect(evaluateSessionPolicy({ requireMfa: true }, { ...facts, hasMfa: false })).toEqual({ allowed: false, reason: 'mfa_required' });
    expect(evaluateSessionPolicy({ maxSessionDuration: 30 }, facts)).toEqual({ allowed: false, reason: 'session_expired' });
    expect(evaluateSessionPolicy({ maxSessionDuration: 31 }, facts)).toEqual({ allowed: true });
  });
  it('uses the declared timezone and carries overnight windows into the following day', () => {
    const window = { days: [6], startHour: 23, endHour: 2, timezone: 'UTC' };
    expect(evaluateSessionPolicy({ timeWindows: [window] }, facts)).toEqual({ allowed: true });
    expect(evaluateSessionPolicy({ timeWindows: [{ ...window, timezone: 'Europe/Moscow' }] }, facts))
      .toEqual({ allowed: false, reason: 'outside_time_window' });
  });
  it.each([{ timeWindows: [{ days: [0], startHour: 0, endHour: 24, timezone: 'invalid' }] },
    { maxSessionDuration: NaN }, { requireMfa: 'yes' }, { futureConstraint: true }])('refuses malformed or unsupported controls %j', policy => {
    expect(evaluateSessionPolicy(policy as never, facts)).toEqual({ allowed: false, reason: 'invalid_policy' });
  });
});
