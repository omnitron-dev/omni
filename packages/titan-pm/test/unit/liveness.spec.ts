/**
 * Liveness — `verifyPidIdentity` must actually look the process up.
 *
 * The bug behind these tests: the lookup used a bare `require()` inside its
 * `try`, in a `"type": "module"` package. `require` does not exist there, so
 * the first statement threw `ReferenceError`, the `catch` turned it into
 * `null`, and the caller read that as "could not confirm" — the documented
 * benign case. A defence that fails into its own benign case leaves nothing
 * behind to notice.
 *
 * **These tests could not have caught it, and cannot catch its return.**
 * Vite's transform defines `require` in every module it loads, so inside
 * vitest `typeof require === 'function'` — measured — and the broken version
 * passes all five of these. The instrument that found it is eslint's
 * `@typescript-eslint/no-require-imports`, which reported that line and only
 * that line across every `type: module` package (prism's `createRequire`
 * form is correctly left alone). Anything failing only under real ESM has to
 * be caught before the test runner, not inside it.
 *
 * What the tests below are still worth: they pin the three-valued contract —
 * true / false / null — which is easy to erode into "null on anything
 * inconvenient", the exact shape the bug wore.
 */

import { describe, it, expect } from 'vitest';
import { basename } from 'node:path';
import { getLiveness, isAlive, verifyPidIdentity } from '../../src/liveness.js';

describe('verifyPidIdentity', () => {
  it('confirms the process it is running inside', () => {
    // Asserting `true` and not merely "not null": `null` is what the broken
    // version returned, and it is also a legal answer, so only a positive
    // identification distinguishes the two.
    expect(verifyPidIdentity(process.pid, [basename(process.execPath)])).toBe(true);
  });

  it('answers false — not null — when the command does not match', () => {
    expect(verifyPidIdentity(process.pid, ['definitely-not-this-binary'])).toBe(false);
  });

  it('answers null only for a pid it refuses to look up', () => {
    expect(verifyPidIdentity(0, ['node'])).toBeNull();
    expect(verifyPidIdentity(-1, ['node'])).toBeNull();
    expect(verifyPidIdentity(Number.NaN, ['node'])).toBeNull();
  });
});

describe('getLiveness', () => {
  it('sees its own process as alive', () => {
    expect(getLiveness(process.pid)).toBe('alive');
    expect(isAlive(process.pid)).toBe(true);
  });

  it('treats the pids process.kill would misread as dead', () => {
    // 0 is "this process group" and -1 is "every process we may signal";
    // passing either through would be a catastrophic misread of intent.
    expect(getLiveness(0)).toBe('dead');
    expect(getLiveness(-1)).toBe('dead');
    expect(getLiveness(null)).toBe('dead');
    expect(getLiveness(undefined)).toBe('dead');
  });
});
