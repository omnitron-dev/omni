/**
 * What a build was built from — `BUILD.json`, written by
 * `scripts/stamp-build.mjs` beside the output it describes.
 *
 * The daemon reports its own (`status`), and the node bundle takes its
 * version from the stamps of what it ships instead of from the working tree,
 * which says nothing about when `dist` was last compiled.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildStamp {
  /** The commit the build was compiled from. */
  commit: string;
  /** Whether the tree held uncommitted changes when it was. */
  dirty: boolean;
  /** When, ISO 8601. */
  builtAt: string;
}

export const BUILD_STAMP_FILE = 'BUILD.json';

/** The stamp in `dir`, or `null` when there is none or it cannot be read as one. */
export function readBuildStamp(dir: string): BuildStamp | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, BUILD_STAMP_FILE), 'utf8')) as Partial<BuildStamp>;
    if (typeof raw.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(raw.commit)) return null;
    if (typeof raw.dirty !== 'boolean' || typeof raw.builtAt !== 'string') return null;
    return { commit: raw.commit, dirty: raw.dirty, builtAt: raw.builtAt };
  } catch {
    return null;
  }
}

/**
 * This process's own build: `dist/BUILD.json` for a daemon running from
 * `dist` (this module is `dist/shared/build-stamp.js`); `null` when running
 * from source, or from a build nobody stamped.
 */
export const OWN_BUILD: BuildStamp | null = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.basename(path.dirname(here)) === 'dist' ? readBuildStamp(path.dirname(here)) : null;
})();
