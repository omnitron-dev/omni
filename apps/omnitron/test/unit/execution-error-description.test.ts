/**
 * `describeXecError` — the reason line on a failed remote command.
 *
 * `@xec-sh/core` flattens the failure to a string before emitting
 * `command:error`, so the handler that read `event.error?.message` got
 * `undefined` every time and logged `Exec error {"error":undefined}` — a
 * warning that names the problem and then withholds it. What is pinned here
 * is the invariant that survives that mistake and the next one: whatever the
 * engine puts in `error`, this returns something an operator can read.
 */

import { describe, it, expect } from 'vitest';

import { describeXecError } from '../../src/execution/execution.service.js';

describe('describeXecError', () => {
  it('passes through the flattened string the engine actually sends', () => {
    expect(describeXecError('ssh: connect to host 10.0.0.4 port 22: Connection refused')).toBe(
      'ssh: connect to host 10.0.0.4 port 22: Connection refused'
    );
  });

  it('unwraps an Error, should a future version stop flattening', () => {
    expect(describeXecError(new Error('command not found: pg_dump'))).toBe('command not found: pg_dump');
  });

  it('reads a message off a plain object rather than stringifying it', () => {
    // The regression in miniature: `String({message: 'x'})` is
    // '[object Object]', which is worse than useless in a log.
    expect(describeXecError({ message: 'exit 127' })).toBe('exit 127');
  });

  it('never returns an empty string', () => {
    for (const input of [undefined, null, '', {}, new Error(''), 0, false]) {
      expect(describeXecError(input).length, JSON.stringify(input)).toBeGreaterThan(0);
    }
  });

  it('falls back to the name when an Error carries no message', () => {
    expect(describeXecError(new TypeError())).toBe('TypeError');
  });

  it('stringifies a value it has no better handle on, rather than dropping it', () => {
    // A number or a symbol-ish value is not a reason, but printing it beats
    // printing nothing — it is at least evidence that something arrived.
    expect(describeXecError(127)).toBe('127');
  });
});
