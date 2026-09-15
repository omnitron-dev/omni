/**
 * The commonest database failure there is produced an empty sentence.
 *
 * Node resolves `localhost` to `::1` and `127.0.0.1` and tries both, so a
 * Postgres that is not listening rejects with an `AggregateError`. That
 * error's `message` is the EMPTY STRING and `String(err)` is the bare word
 * `AggregateError`; the two `ECONNREFUSED` reasons are in `err.errors`,
 * which nothing read. Measured here, against a closed port:
 *
 *     constructor  AggregateError
 *     message      ""
 *     code         "ECONNREFUSED"
 *     errors       ['connect ECONNREFUSED ::1:59999',
 *                   'connect ECONNREFUSED 127.0.0.1:59999']
 *
 * Every layer above composed from `.message`, so the operator got:
 *
 *     Connection health check failed:
 *     Service default is unavailable: Connection health check failed:
 *
 * On the daos stand on 2026-09-15, paysys had written that line 29 099 times
 * into one log file — its `default` connection had failed to establish at
 * startup and every repository access since had said so, never once naming a
 * cause. Downstream, an organisation's revenue tile read «0 BTC», because
 * main turned the same silence into a zero.
 *
 * `describeError` is what those places compose from now.
 */

import { describe, it, expect } from 'vitest';
import { describeError } from '../src/utils/describe-error.js';

describe('an error that says nothing', () => {
  it('names the causes of an AggregateError', () => {
    const err = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
      ],
      '',
    );

    // The control for this whole file: the input really is empty.
    expect(err.message).toBe('');
    expect(String(err)).toBe('AggregateError');

    const described = describeError(err);
    expect(described).toContain('ECONNREFUSED');
    expect(described).toContain('5432');
  });

  it('collapses the same reason repeated per address', () => {
    const one = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const err = new AggregateError([one, new Error('connect ECONNREFUSED 127.0.0.1:5432')], '');

    // Both entries describe one failure; saying it twice helps nobody.
    expect(describeError(err)).toBe('connect ECONNREFUSED 127.0.0.1:5432');
  });

  it('falls back to a code when there is neither message nor cause', () => {
    // What pg leaves when it leaves nothing else.
    expect(describeError(Object.assign(new Error(''), { code: '28P01' }))).toContain('28P01');
  });

  it('falls back to the name when there is not even a code', () => {
    class OddError extends Error {
      override name = 'OddError';
    }
    expect(describeError(new OddError(''))).toBe('OddError');
  });

  it('follows `cause` when that is where the words are', () => {
    const err = new Error('', { cause: new Error('password authentication failed') });
    expect(describeError(err)).toBe('password authentication failed');
  });
});

describe('an error that says something is left alone', () => {
  it('returns the message', () => {
    expect(describeError(new Error('relation "users" does not exist'))).toBe('relation "users" does not exist');
  });

  it('appends a code the message does not already carry', () => {
    const err = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    expect(describeError(err)).toBe('terminating connection due to administrator command (57P01)');
  });

  it('and does not repeat one it does', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    expect(describeError(err)).toBe('connect ECONNREFUSED 127.0.0.1:5432');
  });
});

describe('it never answers with an empty string', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a bare object', {}],
    ['an empty Error', new Error('')],
    ['an empty AggregateError with no causes', new AggregateError([], '')],
    ['a number', 42],
  ])('%s', (_label, value) => {
    const described = describeError(value);
    // A caller composing `${prefix}: ${describeError(e)}` deserves something
    // after the colon — that is the defect this file is about.
    expect(described.trim().length).toBeGreaterThan(0);
  });

  it('and a plain string passes through', () => {
    expect(describeError('pool exhausted')).toBe('pool exhausted');
  });
});

describe('the manager composes from it', () => {
  const SOURCE = require('node:fs').readFileSync(
    new URL('../src/database.manager.ts', import.meta.url),
    'utf8',
  ) as string;

  it('every place that used to reach for `.message` goes through it', () => {
    expect(SOURCE).toContain('Connection health check failed: ${describeError(health.error)}');
    // Nothing composes an operator-facing string from `.message` any more —
    // the first sweep missed three of these, and this is what found them.
    expect(SOURCE).not.toContain('${health.error.message}');
    expect(SOURCE).not.toContain('info.lastError?.message');
    expect(SOURCE).not.toContain('(error as Error).message');
    expect(SOURCE).not.toContain('result.error.message');
  });
});
