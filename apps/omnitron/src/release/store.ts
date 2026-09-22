/**
 * What is on this master's disk, as a list.
 *
 * `load.ts` opens ONE release and checks every byte of it, because a
 * deployment is about to ship it. A list is a different question: an operator
 * looking at twenty releases in a console wants to know what each one is and
 * what it is worth, and paying a sha256 over two gigabytes to draw a table
 * would make the page unusable. So this reads manifests and sizes, says
 * plainly when a directory has no manifest — a build that failed leaves its
 * logs and nothing else — and leaves the verification to the deployment.
 *
 * Both readers use it: `commands/release.ts` prints these rows, and
 * `services/release.rpc-service.ts` sends them to the console, so the two
 * never drift into two answers about one disk.
 */

import fs from 'node:fs';
import path from 'node:path';

import { releasesRoot } from './load.js';
import type { GateOutcome, ReleaseManifest } from './manifest.js';

export { releasesRoot };

/** One release, as a list shows it. */
export interface ReleaseSummary {
  readonly id: string;
  /** The project it was built for, read back out of the id. */
  readonly project: string;
  /** False when the directory holds no manifest: a build that did not finish. */
  readonly complete: boolean;
  readonly builtAt: string | null;
  readonly builtBy: string | null;
  /** The omnitron that packed it — version and the omni commit it ran from. */
  readonly builtWith: string | null;
  readonly projectCommit: string | null;
  readonly omniCommit: string | null;
  readonly projectRepo: string | null;
  readonly omniRepo: string | null;
  /** Whether each commit is on a remote branch: `null` — there was no remote to ask. */
  readonly onRemote: { project: boolean | null; omni: boolean | null };
  readonly gates: { total: number; passed: number; failed: number; notRun: number };
  /**
   * Every gate, in the order the build recorded them.
   *
   * Carried in the LIST and not only in the detail: «19 of 21» is not an
   * answer to «can I deploy this», and a console that had to open each
   * release to find out which gate failed would be asking twenty questions
   * to make one decision.
   */
  readonly gateList: readonly GateOutcome[];
  readonly artifacts: { count: number; bytes: number; apps: string[]; failed: string[] };
  readonly statics: { stack: string; files: number; bytes: number } | null;
  /** What the release carries: artifacts, statics, gate logs. Not the clones. */
  readonly bytes: number;
  /** The build's clones are still on disk — kept on purpose, or left by a failure. */
  readonly keptSource: boolean;
}

/** A release in full, for one screen: the manifest, plus what is beside it. */
export interface ReleaseDetail extends ReleaseSummary {
  readonly manifest: ReleaseManifest | null;
  readonly logs: ReadonlyArray<{ name: string; bytes: number }>;
  readonly root: string;
}

/** `daos-202609221432-81c8a074-c64963f6` → `daos`; a name may hold dashes too. */
export function projectOfId(id: string): string {
  return id.replace(/-\d{12}-[0-9a-f]{8}-[0-9a-f]{8}$/, '');
}

/**
 * What a release WEIGHS, without walking the build root.
 *
 * `src/` holds the two clones — with their `node_modules`, several hundred
 * thousand files — and it is transient: removed after a successful build
 * unless `--keep-source`, kept after a failed one as evidence. Walking it to
 * draw a table is what a list must never do: measured here, the console sat
 * on skeleton rows for the whole of a build because `dirBytes` was counting
 * the clones as they were being written.
 *
 * So the size is what the release CARRIES — artifacts, statics, logs — and
 * the presence of the clones is reported as a fact instead of a number.
 */
function releaseBytes(dir: string): { bytes: number; keptSource: boolean } {
  let keptSource = false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, keptSource: false };
  }
  let bytes = 0;
  for (const entry of entries) {
    if (entry.name === 'src') {
      keptSource = true;
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) bytes += dirBytes(full);
    else if (entry.isFile()) {
      try {
        bytes += fs.statSync(full).size;
      } catch {
        // Removed while we read; it is not in the total either way.
      }
    }
  }
  return { bytes, keptSource };
}

/** Bytes under a directory. Unreadable or absent counts as zero, not as a failure. */
export function dirBytes(dir: string): number {
  let bytes = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size;
        } catch {
          // Removed while we walked; it is not in the total either way.
        }
      }
    }
  };
  walk(dir);
  return bytes;
}

function summarise(id: string, dir: string, manifest: ReleaseManifest | null): ReleaseSummary {
  const gates = manifest?.gates ?? [];
  const weight = releaseBytes(dir);
  return {
    id,
    project: projectOfId(id),
    complete: manifest !== null,
    builtAt: manifest?.builtAt ?? null,
    builtBy: manifest?.builtBy ?? null,
    builtWith: manifest?.builtWith?.omnitron ?? null,
    projectCommit: manifest?.project.commit ?? null,
    omniCommit: manifest?.omni.commit ?? null,
    projectRepo: manifest?.project.repo ?? null,
    omniRepo: manifest?.omni.repo ?? null,
    onRemote: { project: manifest?.project.onRemote ?? null, omni: manifest?.omni.onRemote ?? null },
    gates: {
      total: gates.length,
      passed: gates.filter((g) => g.status === 'passed').length,
      failed: gates.filter((g) => g.status === 'failed').length,
      notRun: gates.filter((g) => g.status !== 'passed' && g.status !== 'failed').length,
    },
    gateList: gates,
    artifacts: {
      count: manifest?.artifacts.length ?? 0,
      bytes: (manifest?.artifacts ?? []).reduce((sum, a) => sum + a.bytes, 0),
      apps: (manifest?.artifacts ?? []).map((a) => `${a.app}@${a.version}`),
      failed: (manifest?.artifactFailures ?? []).map((f) => f.app),
    },
    statics: manifest?.statics ?? null,
    bytes: weight.bytes,
    keptSource: weight.keptSource,
  };
}

function readManifest(dir: string): ReleaseManifest | null {
  const file = path.join(dir, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as ReleaseManifest;
    return manifest && typeof manifest.id === 'string' ? manifest : null;
  } catch {
    // No manifest, or one nothing can parse: an unfinished build, listed as such.
    return null;
  }
}

/** Every release on this machine, newest build first; unfinished ones last. */
export function listReleases(root: string = releasesRoot()): ReleaseSummary[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => summarise(e.name, path.join(root, e.name), readManifest(path.join(root, e.name))))
    .sort((a, b) => (a.builtAt ?? '') < (b.builtAt ?? '') ? 1 : (a.builtAt ?? '') > (b.builtAt ?? '') ? -1 : a.id < b.id ? 1 : -1);
}

/** One release, with its manifest and the logs its build left. */
export function readReleaseDetail(id: string, root: string = releasesRoot()): ReleaseDetail {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) throw new Error(`'${id}' is not a release id`);
  const dir = path.join(root, id);
  if (!fs.existsSync(dir)) throw new Error(`No release '${id}' on this machine — ${dir} does not exist`);
  const manifest = readManifest(dir);
  let logs: Array<{ name: string; bytes: number }> = [];
  try {
    logs = fs
      .readdirSync(path.join(dir, 'logs'), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => ({ name: e.name, bytes: fs.statSync(path.join(dir, 'logs', e.name)).size }));
  } catch {
    // A build that never reached its first step wrote no logs.
  }
  return { ...summarise(id, dir, manifest), manifest, logs, root: dir };
}

/**
 * The tail of one of a release's logs.
 *
 * The console shows these while a build runs and after it fails, so the name
 * is checked against the directory rather than joined blind: a log name is a
 * file name, never a path.
 */
export function readReleaseLog(
  id: string,
  name: string,
  lines = 200,
  root: string = releasesRoot(),
): { name: string; bytes: number; tail: string } {
  const detail = readReleaseDetail(id, root);
  const known = detail.logs.find((l) => l.name === name);
  if (!known) {
    throw new Error(`Release ${id} has no log '${name}' — it has ${detail.logs.map((l) => l.name).join(', ') || 'none'}`);
  }
  const file = path.join(detail.root, 'logs', name);
  const text = fs.readFileSync(file, 'utf8');
  const capped = Math.min(Math.max(1, Math.floor(lines)), 5000);
  return { name, bytes: known.bytes, tail: text.trimEnd().split('\n').slice(-capped).join('\n') };
}

export interface PruneResult {
  /** What would go, oldest first. */
  readonly doomed: ReadonlyArray<{ id: string; bytes: number }>;
  /** Removed for real, or empty when this was a dry run. */
  readonly removed: readonly string[];
  readonly kept: number;
  readonly freedBytes: number;
}

/**
 * Remove all but the newest `keep` releases.
 *
 * Deliberately blunt and deliberately explicit: it does not know which
 * release a stack is running — the `stack.start` rows do — so it never
 * decides that for itself, and it deletes nothing unless told to
 * (`apply`). `protect` is how a caller that DOES know keeps one: the console
 * passes the releases its stacks last deployed.
 */
export function pruneReleases(
  options: { keep?: number; apply?: boolean; protect?: readonly string[]; root?: string } = {},
): PruneResult {
  const keep = options.keep ?? 5;
  if (!Number.isInteger(keep) || keep < 0) throw new Error(`keep takes a whole number of releases, not ${String(options.keep)}`);
  const root = options.root ?? releasesRoot();
  const protect = new Set(options.protect ?? []);
  const all = listReleases(root);
  const doomed = all.slice(keep).filter((r) => !protect.has(r.id)).map((r) => ({ id: r.id, bytes: r.bytes }));
  const removed: string[] = [];
  if (options.apply) {
    for (const d of doomed) {
      fs.rmSync(path.join(root, d.id), { recursive: true, force: true });
      removed.push(d.id);
    }
  }
  return {
    doomed,
    removed,
    kept: all.length - doomed.length,
    freedBytes: doomed.reduce((sum, d) => sum + d.bytes, 0),
  };
}
