/**
 * Every omnitron called itself `0.2.0`, so the fleet view had nothing to
 * compare.
 *
 * The copy on npm, published in May, and a build from this morning carried
 * the same version string. A node running either reported `v0.2.0`, and the
 * page whose job is to show the fleet could not answer "which of my nodes are
 * behind" — the question an upgrade exists to act on.
 *
 * A locally built omnitron now carries `+local.<sha>.<stamp>`, which makes
 * two builds different strings. These pin how they are compared, and the
 * comparison is not semver's: build metadata is IGNORED in semver precedence,
 * so `0.2.0+local.a.202609150345` and `0.2.0+local.b.202608010000` are equal
 * to any version library. Reading them as equal is exactly what would make a
 * stale node look current.
 */

import { describe, it, expect } from 'vitest';

import { buildStampOf, versionStanding, newestVersion } from '../../webapp/src/pages/nodes.js';

const NEW = '0.2.0+local.9f9ebe7ad8cb.202609150345';
const OLD = '0.2.0+local.46417f99ed5c.202609141938';
const PUBLISHED = '0.2.0';

describe('reading a build stamp', () => {
  it('takes the timestamp out of a local version', () => {
    expect(buildStampOf(NEW)).toBe('202609150345');
  });

  it('has none for a published version', () => {
    expect(buildStampOf(PUBLISHED)).toBeNull();
    expect(buildStampOf(undefined)).toBeNull();
  });

  it('refuses something shaped like one but not it', () => {
    // A tag, a pre-release, a hand-edited string. Anything that is not the
    // form this code writes must not be ordered as though it were.
    expect(buildStampOf('0.2.0+local.abc')).toBeNull();
    expect(buildStampOf('0.2.0-rc.1')).toBeNull();
    expect(buildStampOf('0.2.0+dirty')).toBeNull();
  });
});

describe('where a node stands', () => {
  it('calls the newest current', () => {
    expect(versionStanding(NEW, NEW)).toBe('current');
  });

  it('calls an older build behind — which semver would not', () => {
    // The whole reason this is not `semver.lt`: those two compare EQUAL,
    // because everything after `+` is ignored in precedence.
    expect(versionStanding(OLD, NEW)).toBe('behind');
  });

  it('calls a published version different, not older', () => {
    // Nothing on this page knows when `0.2.0` was built. "Behind" would be a
    // claim; "differs" is what is known.
    expect(versionStanding(PUBLISHED, NEW)).toBe('differs');
    expect(versionStanding(NEW, PUBLISHED)).toBe('differs');
  });

  it('says nothing when there is nothing to compare', () => {
    expect(versionStanding(undefined, NEW)).toBe('unknown');
    expect(versionStanding(NEW, undefined)).toBe('unknown');
  });

  it('does not call a newer node behind', () => {
    // A node upgraded out of band is ahead, not behind, and marking it would
    // send an operator to upgrade the thing that is already newest.
    expect(versionStanding(NEW, OLD)).toBe('current');
  });
});

describe('the newest the fleet has', () => {
  it('is the latest stamp, not the first seen', () => {
    expect(newestVersion([OLD, NEW])).toBe(NEW);
    expect(newestVersion([NEW, OLD])).toBe(NEW);
  });

  it('prefers a stamped build over an unstamped one', () => {
    // A published version has no age here, so it cannot be the yardstick for
    // "behind" while a dated build is available.
    expect(newestVersion([PUBLISHED, OLD])).toBe(OLD);
  });

  it('falls back to a published version when that is all there is', () => {
    expect(newestVersion([PUBLISHED, undefined])).toBe(PUBLISHED);
  });

  it('is undefined for a fleet that reports nothing', () => {
    expect(newestVersion([undefined, undefined])).toBeUndefined();
    expect(newestVersion([])).toBeUndefined();
  });
});
