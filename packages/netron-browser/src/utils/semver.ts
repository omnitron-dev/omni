/**
 * Version comparison for the browser client, without pulling in `semver`.
 *
 * There were two copies of this, one in `core/abstract-peer.ts` and one in
 * `core-tasks/query-interface.ts`, both used for the same thing: sorting a
 * service's versions to answer an unqualified `queryInterface('Foo')` with the
 * newest. The server answers that same question with `semver.rcompare`
 * (T#41, after a lexical sort ranked 9.0.0 above 10.0.0), so these are the
 * client half of one protocol decision and must agree with it.
 *
 * The naive version they both had was `v.split('.').map(Number)`, which loses
 * two things semver defines:
 *
 *   - a PRERELEASE ranks BELOW its release (§11.3), but `Number('0-beta')` is
 *     `NaN` and `NaN || 0` is `0`, so `1.0.0-beta` compared EQUAL to `1.0.0`
 *     and which one won was down to sort stability;
 *   - build metadata is ignored in precedence (§10), which the same `NaN → 0`
 *     accidentally got right and for the wrong reason.
 *
 * Anything unparseable now sorts LAST rather than as `0.0.0`: a version string
 * we cannot read is not a version we should hand a caller as "latest".
 */

interface Parsed {
  release: number[];
  prerelease: string[] | null;
}

function parse(version: string): Parsed | null {
  // Strip build metadata: it takes no part in precedence.
  const withoutBuild = version.split('+', 1)[0] ?? '';
  const dash = withoutBuild.indexOf('-');
  const releasePart = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const prereleasePart = dash === -1 ? null : withoutBuild.slice(dash + 1);

  const release = releasePart.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (release.length === 0 || release.some(Number.isNaN)) return null;

  return { release, prerelease: prereleasePart === null ? null : prereleasePart.split('.') };
}

/** Compare two dot-separated prerelease identifier lists (semver §11.4). */
function comparePrerelease(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    // A larger set of fields, all else equal, has higher precedence.
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      // Numeric identifiers always have lower precedence than alphanumeric.
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two versions by semver precedence.
 *
 * @returns -1 if `v1` sorts before `v2`, 1 if after, 0 if equal in precedence.
 *   An unparseable version sorts before every parseable one, so a descending
 *   sort puts it last.
 */
export function compareSemver(v1: string, v2: string): number {
  const a = parse(v1);
  const b = parse(v2);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  for (let i = 0; i < Math.max(a.release.length, b.release.length); i++) {
    const p1 = a.release[i] ?? 0;
    const p2 = b.release[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  // Equal release: a prerelease ranks below the release it precedes.
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) return comparePrerelease(a.prerelease, b.prerelease);
  return 0;
}
