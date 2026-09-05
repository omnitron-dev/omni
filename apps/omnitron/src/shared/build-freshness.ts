/**
 * Is the code that is running the code that was written?
 *
 * Every package here resolves through `dist`, and nothing checks that `dist`
 * corresponds to `src`. Both test suites can be green while the application
 * runs a build from months ago — the package's tests exercise `src`, the
 * application's exercise `dist`, and neither one asks whether they are the
 * same program. A change lands, the suite passes, and the change was never
 * executed.
 *
 * That is not hypothetical. It was found by adding an export to a package's
 * `src/index.ts` and watching a test keep failing with "is not a constructor"
 * against a build four months old. And this daemon reproduces it in the small:
 * it starts from `dist/`, so a rebuild after it started leaves it running code
 * that no longer exists on disk.
 *
 * mtime is a proxy and it is a noisy one — copying a file back over itself
 * marks it modified without changing a byte. The asymmetry is what justifies
 * it: a false "rebuild needed" costs a rebuild, a false "all fresh" costs a
 * session spent verifying the wrong program.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface TreeEntry {
  /** Path relative to the tree root, e.g. `services/backup.service.ts`. */
  rel: string;
  mtimeMs: number;
}

export interface FreshnessReport {
  /** Sources whose build output is older than they are. */
  stale: string[];
  /** Sources with no build output at all — a file added since the last build. */
  unbuilt: string[];
  /** Newest source mtime, or 0 when there are no sources. */
  newestSourceMs: number;
  /** Newest artifact mtime, or 0 when there are no artifacts. */
  newestArtifactMs: number;
  /** False when there was nothing to compare — the caller must not read a verdict into that. */
  comparable: boolean;
}

/** `services/backup.service.ts` → `services/backup.service.js` */
export function artifactFor(rel: string): string {
  return rel.replace(/\.tsx?$/, '.js');
}

/** Sources that are not compiled into the shipped tree, and must not be compared. */
export function isCompiledSource(rel: string): boolean {
  if (!/\.tsx?$/.test(rel)) return false;
  if (rel.endsWith('.d.ts')) return false;
  if (/(^|\/)__(tests|mocks)__\//.test(rel)) return false;
  return !/\.(test|spec)\.tsx?$/.test(rel);
}

/**
 * Compare a source tree against a build tree.
 *
 * Pure: the caller supplies both listings, so the comparison can be tested
 * without a filesystem and without a build.
 */
export function compareTrees(sources: TreeEntry[], artifacts: TreeEntry[]): FreshnessReport {
  const built = new Map(artifacts.map((a) => [a.rel, a.mtimeMs]));
  const compiled = sources.filter((s) => isCompiledSource(s.rel));

  const stale: string[] = [];
  const unbuilt: string[] = [];

  for (const source of compiled) {
    const artifactMs = built.get(artifactFor(source.rel));
    if (artifactMs === undefined) unbuilt.push(source.rel);
    else if (source.mtimeMs > artifactMs) stale.push(source.rel);
  }

  const newestSourceMs = compiled.reduce((max, s) => Math.max(max, s.mtimeMs), 0);
  const newestArtifactMs = artifacts.reduce((max, a) => Math.max(max, a.mtimeMs), 0);

  return {
    stale: stale.sort(),
    unbuilt: unbuilt.sort(),
    newestSourceMs,
    newestArtifactMs,
    // Nothing to compare is not "fresh". A caller that treats an empty
    // listing as a pass turns a broken probe into a green report, which is
    // the failure this whole module is about.
    comparable: compiled.length > 0 && artifacts.length > 0,
  };
}

/**
 * Did the process start before the build it loaded was written?
 *
 * `null` when either timestamp is unknown — the same rule as `comparable`:
 * an unanswerable question does not get answered "no".
 */
export function processPredatesBuild(processStartedMs: number, newestArtifactMs: number): boolean | null {
  if (!Number.isFinite(processStartedMs) || processStartedMs <= 0) return null;
  if (!Number.isFinite(newestArtifactMs) || newestArtifactMs <= 0) return null;
  return newestArtifactMs > processStartedMs;
}

/** Walk a directory, returning every file relative to it. Missing root → []. */
export function listTree(root: string): TreeEntry[] {
  const out: TreeEntry[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'webapp') continue;
        walk(full);
      } else if (entry.isFile()) {
        try {
          out.push({ rel: path.relative(root, full), mtimeMs: fs.statSync(full).mtimeMs });
        } catch {
          /* raced with a build; not our problem to report */
        }
      }
    }
  };
  walk(root);
  return out;
}
