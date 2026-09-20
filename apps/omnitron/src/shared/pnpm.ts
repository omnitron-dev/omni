/**
 * Where `pnpm` is, for a process that did not inherit a shell's PATH.
 *
 * The daemon is started by launchd, whose PATH is
 *
 *     /Users/…/.nvm/versions/node/v24.13.0/bin:/usr/local/bin:
 *     /opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
 *
 * — measured off the running process — and pnpm's own installer puts the
 * binary in `~/Library/pnpm`, which is on none of those. A bare `'pnpm'` in
 * an `execFile` is therefore an ENOENT every time the daemon runs it, and
 * never when a developer runs the same code from a terminal.
 *
 * This lived as a private function in `artifact-builder.ts`, written for
 * exactly that failure. `bundle-builder.ts` had the same bare `'pnpm'` call
 * six lines into the loop that packs every workspace package, and fixing one
 * copy left the other — so the artifact builder found pnpm and the bundle
 * builder it delegates to did not. It is one question and now has one answer.
 *
 * Resolved once per process and remembered: the answer cannot change while
 * the daemon runs, and the search is a handful of `stat` calls.
 *
 * Returns `pnpm` unchanged when nothing is found, so the failure is an ENOENT
 * naming the command rather than a path this invented.
 */

import fs from 'node:fs';

let pnpmPath: string | null = null;

export function resolvePnpm(): string {
  if (pnpmPath) return pnpmPath;

  const home = process.env['HOME'] ?? '';
  const candidates = [
    // The two pnpm installs itself into, in the order it prefers.
    process.env['PNPM_HOME'] ? `${process.env['PNPM_HOME']}/pnpm` : null,
    home ? `${home}/Library/pnpm/pnpm` : null,
    home ? `${home}/.local/share/pnpm/pnpm` : null,
    '/opt/homebrew/bin/pnpm',
    '/usr/local/bin/pnpm',
  ].filter((c): c is string => c !== null);

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      pnpmPath = candidate;
      return candidate;
    } catch {
      // Not here; try the next.
    }
  }
  return 'pnpm';
}

/** The resolver, for a test that must run on the machine it is about. */
export function resolvePnpmForTests(): string {
  pnpmPath = null;
  return resolvePnpm();
}
