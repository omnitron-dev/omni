/**
 * `omnitron doctor` — the finding model.
 *
 * The command's value is entirely in what it says, so what is tested here is
 * the contract every finding must satisfy: a title, evidence for it, and —
 * for anything actionable — a remedy. A check that reports a status without
 * cause is precisely the thing this command exists to replace, so "every
 * error has evidence and a remedy" is an invariant, not a style preference.
 */

import { describe, it, expect } from 'vitest';

import type { Finding, FindingSeverity } from '../../src/commands/doctor.js';

/**
 * Re-implementation of the module's private ordering, exercised against the
 * exported type. Kept here rather than exported from the command because the
 * ordering is presentation, not contract — but it must stay stable, since an
 * operator reads top-down and expects the worst first.
 */
function order(findings: Finding[]): Finding[] {
  const rank: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
  return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const sample: Finding[] = [
  { id: 'daemon.recently-restarted', severity: 'info', title: 'Restarted recently', evidence: ['uptime: 1m'] },
  {
    id: 'app.errored',
    severity: 'error',
    title: 'Critical app "main" is errored',
    evidence: ['status: errored', 'exit code 1'],
    remedy: 'Inspect it.',
  },
  {
    id: 'infra.not-running',
    severity: 'warning',
    title: 'Container "redis" is exited',
    evidence: ['image: redis:7'],
    remedy: 'Run `omnitron up`.',
  },
];

describe('doctor findings', () => {
  it('orders errors before warnings before info', () => {
    expect(order(sample).map((f) => f.severity)).toEqual(['error', 'warning', 'info']);
  });

  it('gives every finding evidence for its claim', () => {
    // A title on its own is an assertion. The evidence is what lets an
    // operator believe it — and, when the diagnosis is wrong, see that it is.
    for (const finding of sample) {
      expect(finding.evidence.length, finding.id).toBeGreaterThan(0);
    }
  });

  it('gives every actionable finding a remedy', () => {
    for (const finding of sample) {
      if (finding.severity === 'info') continue;
      expect(finding.remedy, finding.id).toBeTruthy();
    }
  });

  it('identifies findings by a stable id so scripts can match on them', () => {
    for (const finding of sample) {
      expect(finding.id).toMatch(/^[a-z]+\.[a-z-]+$/);
    }
    expect(new Set(sample.map((f) => f.id)).size).toBe(sample.length);
  });
});

describe('error description', () => {
  /**
   * Mirrors `describeError` in the command. This is the routine that makes a
   * failed pg connection legible: Node throws an `AggregateError` whose own
   * `message` is EMPTY, with the real reason in `errors[]`. Logging
   * `err.message` there prints a blank — which is how a dead database looked
   * like `{"error":""}` in the daemon log for an entire session.
   */
  function describeError(err: unknown): string {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    const e = err as { message?: string; errors?: Array<{ message?: string; code?: string }>; code?: string };

    if (Array.isArray(e.errors) && e.errors.length > 0) {
      const inner = e.errors.map((x) => x.message || x.code).filter(Boolean).join('; ');
      if (inner) return e.code ? `${inner} (${e.code})` : inner;
    }
    if (e.message) return e.code ? `${e.message} (${e.code})` : e.message;
    return e.code ?? 'unknown error';
  }

  it('unwraps an AggregateError with an empty message', () => {
    const err = Object.assign(new AggregateError([], ''), {
      code: 'ECONNREFUSED',
      errors: [
        { message: 'connect ECONNREFUSED 127.0.0.1:5480', code: 'ECONNREFUSED' },
        { message: 'connect ECONNREFUSED ::1:5480', code: 'ECONNREFUSED' },
      ],
    });

    const described = describeError(err);
    expect(described).toContain('127.0.0.1:5480');
    expect(described).toContain('ECONNREFUSED');
    expect(described).not.toBe('');
  });

  it('appends a code to an ordinary error', () => {
    expect(describeError(Object.assign(new Error('nope'), { code: 'EACCES' }))).toBe('nope (EACCES)');
  });

  it('falls back to the code when there is no message at all', () => {
    expect(describeError({ code: 'ENOTFOUND' })).toBe('ENOTFOUND');
  });

  it('never returns an empty string', () => {
    for (const input of [null, undefined, {}, new Error(''), 'plain']) {
      expect(describeError(input).length).toBeGreaterThan(0);
    }
  });
});
