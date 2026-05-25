/**
 * Path helpers — single source of truth for `~`-expansion.
 *
 * Pre-fix 31 distinct call sites inlined the same one-liner
 * `path.replace('~', process.env['HOME'] ?? '')`. That pattern had
 * three quiet bugs:
 *   - `''` for HOME on weird environments produced literal paths
 *     like `'/.omnitron/state.json'` (root-anchored, owner = root)
 *     rather than failing fast.
 *   - It only replaced the FIRST `~`, so a config that contained
 *     `~/foo/~/bar` (rare but possible) silently mis-resolved.
 *   - It didn't handle `~/` vs `~user/` correctly (we don't need
 *     the latter, but the inline pattern wouldn't reject it either).
 *
 * Centralising the expansion gives us one place to add validation
 * (refuse empty HOME, prefer `os.homedir()` over raw env), and a
 * later ConfigService migration can substitute in without touching
 * 31 call sites again.
 */

import os from 'node:os';

/**
 * Expand a leading `~` or `~/` to the current user's home directory.
 * No-op for paths that don't start with `~`.
 *
 * Throws if `~` is at the start but no home directory is resolvable
 * — better to fail fast than to silently fall through to a root-
 * anchored path that the caller almost certainly doesn't intend.
 */
export function expandPath(p: string): string {
  if (!p) return p;
  if (p === '~') {
    return getHomeDir();
  }
  if (p.startsWith('~/')) {
    return getHomeDir() + p.slice(1);
  }
  return p;
}

/**
 * Resolve the home directory. Prefers `os.homedir()` (which respects
 * platform conventions on Windows + handles missing HOME) over the
 * raw env var. Throws when no home dir is resolvable so the failure
 * is visible at boot rather than producing a root-anchored path.
 */
function getHomeDir(): string {
  const home = os.homedir() || process.env['HOME'] || process.env['USERPROFILE'];
  if (!home) {
    throw new Error(
      'Cannot resolve home directory: neither os.homedir() nor $HOME/$USERPROFILE is set. ' +
        'Set HOME explicitly when launching omnitron in a minimal environment.',
    );
  }
  return home;
}
