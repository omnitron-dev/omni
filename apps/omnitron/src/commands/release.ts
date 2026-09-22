/**
 * `omnitron release build|list|show|prune` — the terminal's view of releases.
 *
 * A deployment compiles whatever the deploying machine's disk holds. A
 * release is built from a named commit of BOTH repositories — the project,
 * and omni, whose packages are vendored into every artifact — in clean
 * clones, with every gate run against those clones, and the artifacts packed
 * from them. Nothing of the developer's working tree takes part: not their
 * uncommitted edits, not their `dist`, not their omni.
 *
 * The work itself is in `release/build-run.ts` and the disk is read by
 * `release/store.ts`, because the console asks for exactly the same things
 * through `services/release.rpc-service.ts`. This file is what a terminal
 * adds and a browser does not: lines as they happen, a table, an exit code.
 */

import fs from 'node:fs';

import { log, table } from '@xec-sh/kit';

import { emitJson } from './output.js';
import { runReleaseBuild, type ReleaseBuildOptions } from '../release/build-run.js';
import { listReleases, pruneReleases, readReleaseDetail, releasesRoot } from '../release/store.js';

export type { ReleaseBuildOptions };

const MINUTE = 60_000;

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

export async function releaseBuildCommand(projectName: string, options: ReleaseBuildOptions = {}): Promise<void> {
  const started = Date.now();
  let releaseRoot: string | null = null;
  try {
    const outcome = await runReleaseBuild(projectName, options, (p) => {
      if (p.releaseId && !releaseRoot) {
        releaseRoot = `${releasesRoot()}/${p.releaseId}`;
        log.info(`Release ${p.releaseId}`);
        log.info(`  ${releaseRoot}`);
      }
      log.info(`  ${p.at.slice(11, 19)}  ${String(p.percent).padStart(3)}%  ${p.phase}`);
    });
    const m = outcome.manifest;
    const failedGates = m.gates.filter((g) => g.status !== 'passed');
    const bytes = m.artifacts.reduce((sum, a) => sum + a.bytes, 0);
    log.success(`Release ${outcome.id} — ${Math.round(outcome.durationMs / MINUTE)} min`);
    log.info(
      `  gates: ${m.gates.length - failedGates.length} of ${m.gates.length} passed` +
        (failedGates.length ? ` — ${failedGates.map((g) => `${g.name} ${g.status}`).join(', ')}` : ''),
    );
    log.info(
      `  artifacts: ${m.artifacts.length} (${mb(bytes)} MB)` +
        ((m.artifactFailures ?? []).length ? ` — did not build: ${(m.artifactFailures ?? []).map((f) => f.app).join(', ')}` : ''),
    );
    if (m.project.onRemote === false || m.omni.onRemote === false) {
      const local = [m.project.onRemote === false ? projectName : null, m.omni.onRemote === false ? 'omni' : null].filter(Boolean);
      log.warn(`  built from a commit no remote branch contains (${local.join(', ')}) — nobody else can rebuild it`);
    }
    log.info(`  manifest: ${outcome.manifestPath}`);
  } catch (err) {
    log.error(`Release build failed after ${Math.round((Date.now() - started) / MINUTE)} min: ${(err as Error).message}`);
    if (releaseRoot) log.info(`  kept for inspection: ${releaseRoot}`);
    process.exitCode = 1;
  }
}

/** Everything built on this machine, newest first, with what it is worth. */
export async function releaseListCommand(): Promise<void> {
  const root = releasesRoot();
  const releases = listReleases(root);
  const rows = releases.map((r) => ({
    id: r.id,
    built: r.builtAt ? r.builtAt.slice(0, 16).replace('T', ' ') : '—',
    // A build that failed leaves its logs and no manifest. Listed as such
    // rather than hidden: it is taking up the disk either way.
    gates: r.complete ? `${r.gates.passed}/${r.gates.total}` : 'no manifest',
    artifacts: r.complete ? String(r.artifacts.count) : '—',
    statics: r.statics ? r.statics.stack : '—',
    mb: mb(r.bytes),
  }));
  if (emitJson({ releases, root })) return;
  if (rows.length === 0) {
    const why = fs.existsSync(root) ? '' : ` — ${root} does not exist`;
    log.info(`No releases on this machine${why}. \`omnitron release build <project>\` makes one.`);
    return;
  }
  table({
    width: 'auto',
    data: rows,
    columns: [
      { key: 'id', header: 'Release', width: 46 },
      { key: 'built', header: 'Built (UTC)', width: 17 },
      { key: 'gates', header: 'Gates', width: 11 },
      { key: 'artifacts', header: 'Apps', width: 5 },
      { key: 'statics', header: 'Statics', width: 8 },
      { key: 'mb', header: 'MB', width: 7 },
    ],
  });
}

/** One release, in full: what it was built from, what it says, what it carries. */
export async function releaseShowCommand(id: string): Promise<void> {
  const { loadRelease } = await import('../release/load.js');
  try {
    // The checked read: every artifact's size and sha256 against the
    // manifest, exactly as a deployment would take it.
    const release = await loadRelease(id);
    const m = release.manifest;
    if (emitJson(m)) return;
    log.info(`Release ${m.id}`);
    log.info(`  built ${m.builtAt} by ${m.builtBy} with omnitron ${m.builtWith.omnitron}`);
    for (const [what, source] of [['project', m.project], ['omni', m.omni]] as const) {
      const remote = source.onRemote === true ? '' : source.onRemote === false ? ' — on no remote branch' : ' — no remote to ask';
      log.info(`  ${what}: ${source.commit.slice(0, 12)} ${source.repo}${remote}`);
    }
    const failed = m.gates.filter((g) => g.status !== 'passed');
    log.info(`  gates: ${m.gates.length - failed.length} of ${m.gates.length} passed`);
    for (const gate of m.gates) {
      const mark = gate.status === 'passed' ? 'pass' : gate.status;
      log.info(`    ${mark.padEnd(9)} ${gate.name}${gate.detail ? ` — ${gate.detail}` : ''}`);
    }
    for (const a of m.artifacts) {
      log.info(`  ${a.app}@${a.version}  ${mb(a.bytes)} MB  sha256 ${a.sha256.slice(0, 12) || '(none)'}`);
    }
    for (const f of m.artifactFailures ?? []) log.warn(`  ${f.app} did not build — ${f.error.split('\n')[0]}`);
    if (m.statics) log.info(`  statics for ${m.statics.stack}: ${m.statics.files} files, ${mb(m.statics.bytes)} MB from ${m.statics.dir}`);
    log.info(`  ${release.files.length} artifact file(s) on this disk match the manifest`);
  } catch (err) {
    log.error((err as Error).message);
    // An unfinished build has no manifest to load; say what IS there rather
    // than only that it could not be read.
    try {
      const detail = readReleaseDetail(id);
      if (!detail.complete) {
        log.info(`  ${detail.root} exists (${mb(detail.bytes)} MB) and holds no manifest — the build did not finish.`);
        for (const l of detail.logs) log.info(`    logs/${l.name} — ${mb(l.bytes)} MB`);
      }
    } catch {
      // Not there at all; the first message said so.
    }
    process.exitCode = 1;
  }
}

/**
 * Remove all but the newest `keep` releases.
 *
 * `--yes` is required before anything is deleted: this does not know which
 * release a stack is running — the `stack.start` rows do.
 */
export async function releasePruneCommand(options: { keep?: number; yes?: boolean } = {}): Promise<void> {
  try {
    const result = pruneReleases({ keep: options.keep ?? 5, apply: options.yes === true });
    if (result.doomed.length === 0) {
      log.info(`${result.kept} release(s), keeping ${options.keep ?? 5} — nothing to remove.`);
      return;
    }
    for (const d of result.doomed) log.info(`  ${options.yes ? 'removing' : 'would remove'} ${d.id} (${mb(d.bytes)} MB)`);
    if (!options.yes) {
      log.warn(`${result.doomed.length} release(s), ${mb(result.freedBytes)} MB. Nothing was removed — pass --yes to remove them.`);
      return;
    }
    log.success(`Removed ${result.removed.length} release(s), ${mb(result.freedBytes)} MB freed; ${result.kept} kept.`);
  } catch (err) {
    log.error((err as Error).message);
    process.exitCode = 1;
  }
}
