/**
 * The client and the server must agree on which version is "latest".
 *
 * `queryInterface('Foo')` without a version asks whoever answers to pick the
 * newest. The server answers with `semver.rcompare` — switched to it in T#41,
 * after a lexical sort ranked `9.0.0` above `10.0.0` and clients silently kept
 * being routed at a legacy build. The browser client answered the same
 * question with its own comparator, in two copies, and that comparator was
 * `v.split('.').map(Number)`:
 *
 *     Number('0-beta')  ->  NaN
 *     NaN || 0          ->  0
 *
 * so `1.0.0-beta` compared EQUAL to `1.0.0` and which one a caller got was
 * down to sort stability. One copy now, and it follows semver precedence.
 */

import { describe, it, expect } from 'vitest';
import { compareSemver } from '../../src/utils/semver.js';

/** How both call sites use it: descending, newest first. */
const newestFirst = (versions: string[]) => [...versions].sort((a, b) => compareSemver(b, a));

describe('compareSemver', () => {
  it('orders release versions numerically, not lexically', () => {
    // The T#41 bug, on the client side.
    expect(compareSemver('10.0.0', '9.0.0')).toBe(1);
    expect(newestFirst(['9.0.0', '10.0.0', '2.0.0'])[0]).toBe('10.0.0');
  });

  it('ranks a prerelease below the release it precedes', () => {
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-beta')).toBe(1);
    expect(newestFirst(['1.0.0-beta', '1.0.0'])[0], 'a caller asking for latest got a prerelease').toBe('1.0.0');
  });

  it('orders prereleases among themselves by semver rules', () => {
    // §11.4: numeric identifiers compare numerically, alphanumeric
    // lexically, numeric ranks below alphanumeric, and more fields win.
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.10', '1.0.0-alpha.9')).toBe(1);
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
  });

  it('ignores build metadata, which takes no part in precedence', () => {
    expect(compareSemver('1.0.0+build.7', '1.0.0')).toBe(0);
    expect(compareSemver('1.2.3+a', '1.2.3+b')).toBe(0);
  });

  it('treats a missing component as zero', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.3', '1.2.9')).toBe(1);
  });

  it('sorts a version it cannot read LAST, not as 0.0.0', () => {
    // The old comparator read `garbage` as 0.0.0, which is a real version and
    // could be returned as "latest" when it was the only candidate.
    expect(newestFirst(['1.0.0', 'not-a-version'])).toEqual(['1.0.0', 'not-a-version']);
    expect(newestFirst(['not-a-version', '0.0.1'])).toEqual(['0.0.1', 'not-a-version']);
    expect(compareSemver('nonsense', 'rubbish')).toBe(0);
  });

  it('is a consistent comparator, so a sort cannot depend on input order', () => {
    const versions = ['1.0.0', '1.0.0-beta', '10.0.0', '2.1.0', '2.1.0-rc.1', '9.9.9'];
    const forward = newestFirst(versions);
    const backward = newestFirst([...versions].reverse());
    expect(forward).toEqual(backward);
    expect(forward[0]).toBe('10.0.0');
  });
});
