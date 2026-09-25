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
 *
 * The disk says what was built; it does not say what RUNS. Which release a
 * stack last took is in the daemon's audit trail, served as `deployments()`,
 * so `list`, `show` and `prune` ask the daemon for that one fact — and say
 * so when it cannot be asked, rather than printing a disk-only answer that
 * reads as «deployed nowhere».
 */

import fs from 'node:fs';

import { log, table } from '@xec-sh/kit';

import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { describeAbsence } from './daemon-required.js';
import { emitError, emitJson } from './output.js';
import { runReleaseBuild, type ReleaseBuildOptions } from '../release/build-run.js';
import type { ReleaseArtifact, ReleaseManifest } from '../release/manifest.js';
import {
  listReleases,
  projectOfId,
  pruneReleases,
  readReleaseDetail,
  readReleaseManifest,
  releasesRoot,
  type ReleaseDetail,
} from '../release/store.js';
import type { IOmnitronAuditService, IOmnitronReleaseService, ReleaseDeploymentDto } from '../shared/dto/services.js';
import {
  deploymentsAnswer,
  noGateRan,
  pruneBlindness,
  readGates,
  stacksByRelease,
  unnamedStacks,
  type DeploymentsAnswer,
} from '../shared/release-reading.js';

export type { ReleaseBuildOptions };

const MINUTE = 60_000;

/** The most `stack.start` rows `deployments()` reads — its own ceiling. */
const DEPLOYMENT_ROWS = 200;

/**
 * A size, in the unit that shows it.
 *
 * Every size here was printed in MB to one decimal, and the logs of a build
 * that did not finish are kilobytes: daos-202609221632's six logs weigh 481 B
 * to 41 054 B, and each one read «0.0 MB» — six files that looked empty, in
 * the place an operator opens to find out why the build stopped.
 */
function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Which release each stack runs — the daemon's answer, or why there is none
// ---------------------------------------------------------------------------

/**
 * `known: false` is not «nothing is deployed», and nothing here may read it
 * as that. Two daemons leave the question open: one that does not answer,
 * and one whose database did not come up — it runs with no audit trail and
 * serves `deployments()` as `[]`, the same shape as «no stack has taken a
 * release». A prune that took either for an empty answer would delete the
 * release a stack is running.
 */
async function readDeployments(): Promise<DeploymentsAnswer> {
  const client = createDaemonClient();
  try {
    const absence = await client.whyUnreachable();
    if (absence) return { known: false, why: describeAbsence(absence) };
    // The trail first. A daemon without one does not expose `OmnitronAudit`
    // at all, and one whose database went away says `available: false`;
    // either way its `deployments()` would answer `[]`.
    let trail = false;
    try {
      const audit = await client.service<IOmnitronAuditService>('OmnitronAudit');
      trail = (await audit.available())?.available === true;
    } catch {
      trail = false;
    }
    if (!trail) {
      return deploymentsAnswer(false, []);
    }
    const releases = await client.service<IOmnitronReleaseService>('OmnitronRelease');
    return deploymentsAnswer(true, (await releases.deployments({ limit: DEPLOYMENT_ROWS })) ?? []);
  } catch (err) {
    return { known: false, why: `the daemon could not say which release a stack runs: ${(err as Error)?.message ?? String(err)}` };
  } finally {
    await client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export async function releaseBuildCommand(projectName: string, options: ReleaseBuildOptions = {}): Promise<void> {
  const started = Date.now();
  let releaseRoot: string | null = null;
  // Ctrl-C or a `kill` stops the build the way a build stops — its steps'
  // process groups ended, its build root removed on the way out — instead of
  // the way a killed process does, which leaves 2 GB of clones behind (six
  // of them, 12 GB, on 2026-09-25). A second signal does not wait.
  const stop = new AbortController();
  let signalled: NodeJS.Signals | null = null;
  const onSignal = (sig: NodeJS.Signals): void => {
    if (signalled) process.exit(sig === 'SIGINT' ? 130 : 143);
    signalled = sig;
    log.warn(`${sig} — stopping the build; its build root goes on the way out (a second ${sig} does not wait)`);
    stop.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    const outcome = await runReleaseBuild(projectName, { ...options, signal: options.signal ?? stop.signal }, (p) => {
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
      `  artifacts: ${m.artifacts.length} (${size(bytes)})` +
        ((m.artifactFailures ?? []).length ? ` — did not build: ${(m.artifactFailures ?? []).map((f) => f.app).join(', ')}` : ''),
    );
    if (m.project.onRemote === false || m.omni.onRemote === false) {
      const local = [m.project.onRemote === false ? projectName : null, m.omni.onRemote === false ? 'omni' : null].filter(Boolean);
      log.warn(`  built from a commit no remote branch contains (${local.join(', ')}) — nobody else can rebuild it`);
    }
    log.info(`  manifest: ${outcome.manifestPath}`);
  } catch (err) {
    log.error(`Release build failed after ${Math.round((Date.now() - started) / MINUTE)} min: ${(err as Error).message}`);
    if (releaseRoot) {
      log.info(`  its logs: ${releaseRoot}/logs${options.keepSource ? ` · its build root: ${releaseRoot}/src` : ''}`);
    }
    process.exitCode = signalled ? (signalled === 'SIGINT' ? 130 : 143) : 1;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/**
 * Everything built on this machine, newest first: what it is worth, where it
 * runs, and what a running stack measured about it.
 *
 * Where it runs was on no screen here. Measured 2026-09-23: test ran
 * daos-202609230810 (its `stack.start` row, 08:38:44Z), the list printed
 * that release as one of 25 rows alike, and the eleven attestations the
 * JSON carried as `verified` — 0810 on test, 31 of 31 — were not in the
 * table either. Those two facts decide what may be pruned and what
 * production may be promoted from.
 */
export async function releaseListCommand(): Promise<void> {
  const root = releasesRoot();
  const releases = listReleases(root);
  const answer = await readDeployments();
  const byRelease = answer.known ? stacksByRelease(answer.deployments) : null;
  const unnamed = answer.known ? unnamedStacks(answer.deployments) : [];
  if (
    emitJson({
      releases: releases.map((r) => ({
        ...r,
        // `null`: the daemon could not be asked — not «on no stack».
        deployedOn: byRelease
          ? (byRelease.get(r.id) ?? []).map((d) => ({ stack: d.stack, at: d.at, source: d.source }))
          : null,
      })),
      root,
      deployments: answer.known ? answer.deployments : null,
      ...(answer.known ? {} : { deploymentsUnknown: answer.why }),
    })
  )
    return;
  if (releases.length === 0) {
    const why = fs.existsSync(root) ? '' : ` — ${root} does not exist`;
    log.info(`No releases on this machine${why}. \`omnitron release build <project>\` makes one.`);
    return;
  }
  const rows = releases.map((r) => ({
    id: r.id,
    built: r.builtAt ? r.builtAt.slice(0, 16).replace('T', ' ') : '—',
    // A build that failed leaves its logs and no manifest. Listed as such
    // rather than hidden: it is taking up the disk either way.
    gates: readGates(r).text,
    artifacts: r.complete ? String(r.artifacts.count) : '—',
    statics: r.statics ? r.statics.stack : '—',
    // `?` when the daemon could not be asked, said under the table.
    deployed: byRelease ? (byRelease.get(r.id) ?? []).map((d) => d.stack).join(', ') || '—' : '?',
    attested: r.verified.map((v) => `${v.stack}: ${v.passed}/${v.total}`).join(', ') || '—',
    size: size(r.bytes),
  }));
  table({
    width: 'auto',
    data: rows,
    columns: [
      { key: 'id', header: 'Release', width: 46 },
      { key: 'built', header: 'Built (UTC)', width: 17 },
      { key: 'gates', header: 'Gates', width: 11 },
      { key: 'artifacts', header: 'Apps', width: 5 },
      { key: 'statics', header: 'Statics', width: 8 },
      { key: 'deployed', header: 'Deployed', width: 10 },
      { key: 'attested', header: 'Attested', width: 13 },
      { key: 'size', header: 'Size', width: 9 },
    ],
  });
  if (!answer.known) log.warn(`Deployed: unknown — ${answer.why}.`);
  if (unnamed.length > 0) {
    log.warn(`${unnamed.join(', ')} last took a release whose name the trail did not record — it is on none of these rows.`);
  }
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

/** What a deployment compares for an app: `inputs`, or the sha256 where a manifest predates it. */
function inputsOf(a: ReleaseArtifact): string {
  return a.inputs ?? a.sha256;
}

/**
 * This release's apps against what another stack of its project runs.
 *
 * By `inputs` — the hash a deployment hands `decideRedeploy` — and not the
 * tarball's sha256, which moves with every build. Measured between
 * daos-202609230652 and -0810: the sha256 differs for all six tarballs,
 * `inputs` for `main` alone, and deploying 0810 over 0652 on test restarted
 * main and left the other five running («Left running» ×5, 08:38:35Z). The
 * sha256 said six, and only `inputs` said one.
 */
interface InputsAgainst {
  readonly stack: string;
  /** The release that stack runs. */
  readonly release: string;
  /** When it took it. */
  readonly at: string;
  /** `null` when that release is not on this disk to compare with. */
  readonly apps: ReadonlyArray<{ app: string; inputs: string; there: string | null; differs: boolean }> | null;
}

function inputsAgainst(m: ReleaseManifest, deployments: readonly ReleaseDeploymentDto[]): InputsAgainst[] {
  const project = projectOfId(m.id);
  const out: InputsAgainst[] = [];
  for (const d of deployments) {
    if (d.project !== project || !d.release || d.release === m.id) continue;
    const other = readReleaseManifest(d.release);
    const theirs = new Map((other?.artifacts ?? []).map((a) => [a.app, inputsOf(a)]));
    out.push({
      stack: d.stack,
      release: d.release,
      at: d.at,
      apps: other
        ? m.artifacts.map((a) => {
            const there = theirs.get(a.app) ?? null;
            return { app: a.app, inputs: inputsOf(a), there, differs: there !== inputsOf(a) };
          })
        : null,
    });
  }
  return out;
}

/**
 * Why a release cannot be shown — said once, and in the mode asked for.
 *
 * A directory with no manifest was reported twice over and against itself:
 * «No release 'X' on this machine — …/manifest.json does not exist», then
 * «X exists (0.1 MB) and holds no manifest» (measured on
 * daos-202609221632). And the error went through `log.error`, so under
 * `--json` nothing machine-readable was written and the JSON guard added
 * «`release show` does not support --json» on stderr — about a command that
 * does.
 */
function cannotShow(id: string, err: unknown): void {
  process.exitCode = 1;
  let detail: ReleaseDetail | null = null;
  try {
    detail = readReleaseDetail(id);
  } catch {
    // Not there at all, or not an id: the loader's own words say which.
  }
  if (detail && !detail.complete) {
    const said = emitError(
      `Release ${id} has no manifest — its build did not finish, or has not yet: ${detail.root} holds only what the build left (${size(detail.bytes)})`,
      { root: detail.root, bytes: detail.bytes, logs: detail.logs },
    );
    if (!said) for (const l of detail.logs) log.info(`    logs/${l.name} — ${size(l.bytes)}`);
    return;
  }
  emitError((err as Error)?.message ?? String(err));
}

/** One release, in full: what it was built from, what it says, what it carries, where it runs. */
export async function releaseShowCommand(id: string): Promise<void> {
  const { loadRelease } = await import('../release/load.js');
  let release: Awaited<ReturnType<typeof loadRelease>>;
  try {
    // The checked read: every artifact's size and sha256 against the
    // manifest, exactly as a deployment would take it.
    release = await loadRelease(id);
  } catch (err) {
    cannotShow(id, err);
    return;
  }
  const m = release.manifest;
  // Everything read BEFORE anything is emitted. `--json` used to emit the
  // manifest and return here, so what the text printed after it was in no
  // JSON: measured on daos-202609230810, the text said «6 artifact file(s)
  // on this disk match the manifest» and «attested on test: 31 of 31», and
  // the JSON held neither.
  const { loadAttestations } = await import('../release/attest.js');
  const attestations = loadAttestations(m.id);
  const answer = await readDeployments();
  const runsIt = answer.known ? answer.deployments.filter((d) => d.release === m.id) : null;
  const against = answer.known ? inputsAgainst(m, answer.deployments) : null;
  if (
    emitJson({
      ...m,
      verifiedFiles: release.files,
      attestations,
      deployedOn: runsIt ? runsIt.map((d) => ({ stack: d.stack, at: d.at, source: d.source })) : null,
      inputsAgainst: against,
      ...(answer.known ? {} : { deploymentsUnknown: answer.why }),
    })
  )
    return;
  log.info(`Release ${m.id}`);
  log.info(`  built ${m.builtAt} by ${m.builtBy} with omnitron ${m.builtWith.omnitron}`);
  for (const [what, source] of [['project', m.project], ['omni', m.omni]] as const) {
    const remote = source.onRemote === true ? '' : source.onRemote === false ? ' — on no remote branch' : ' — no remote to ask';
    log.info(`  ${what}: ${source.commit.slice(0, 12)} ${source.repo}${remote}`);
  }
  const none = noGateRan(m.gates);
  const failed = m.gates.filter((g) => g.status !== 'passed');
  log.info(none ? '  gates: none ran' : `  gates: ${m.gates.length - failed.length} of ${m.gates.length} passed`);
  for (const gate of m.gates) {
    const mark = gate.status === 'passed' ? 'pass' : gate.status;
    log.info(`    ${mark.padEnd(9)} ${gate.name}${gate.detail ? ` — ${gate.detail}` : ''}`);
  }
  for (const a of m.artifacts) {
    // `inputs` beside the sha256: the sha256 names the file, `inputs` is
    // what a deployment compares to decide whether the app is restarted.
    const inputs = a.inputs ? a.inputs.slice(0, 12) : '(none recorded — a deployment compares the sha256)';
    const marks = (against ?? []).flatMap((c) => {
      const mine = c.apps?.find((x) => x.app === a.app);
      if (!mine) return [];
      if (!mine.differs) return [`same as ${c.stack}'s`];
      return [mine.there ? `differs from ${c.stack}'s ${mine.there.slice(0, 12)}` : `not in what ${c.stack} took`];
    });
    log.info(
      `  ${a.app}@${a.version}  ${size(a.bytes)}  sha256 ${a.sha256.slice(0, 12) || '(none)'}  inputs ${inputs}` +
        (marks.length > 0 ? ` (${marks.join('; ')})` : ''),
    );
  }
  for (const f of m.artifactFailures ?? []) log.warn(`  ${f.app} did not build — ${f.error.split('\n')[0]}`);
  if (m.statics) log.info(`  statics for ${m.statics.stack}: ${m.statics.files} files, ${size(m.statics.bytes)} from ${m.statics.dir}`);
  log.info(`  ${release.files.length} artifact file(s) on this disk match the manifest`);
  // What stacks measured about it since — with each probe that did not
  // pass in its own words, the tail it printed included: a finding on a
  // node is read here or nowhere.
  for (const a of attestations) {
    const passed = a.gates.filter((g) => g.status === 'passed').length;
    const where = a.onNode.hosts.length > 0 ? ` on ${a.onNode.hosts.join(', ')}` : '';
    log.info(`  attested on ${a.stack}: ${passed} of ${a.gates.length} probes passed, measured ${a.at}${where}`);
    for (const g of a.gates.filter((x) => x.status !== 'passed')) {
      log.info(`    ${g.status.padEnd(9)} ${g.name}${g.detail ? ` — ${g.detail}` : ''}`);
      for (const line of (g.output ?? '').split('\n').filter(Boolean)) log.info(`        ${line}`);
    }
  }
  if (!answer.known) {
    log.warn(`  deployed on: unknown — ${answer.why}`);
    return;
  }
  for (const d of runsIt ?? []) log.info(`  deployed on ${d.stack} since ${d.at}${d.source ? ` (${d.source})` : ''}`);
  if ((runsIt ?? []).length === 0) log.info("  deployed on: no stack — no stack's last start took it");
  // Against what each other stack of the project last took, by the trail —
  // what the master's disk can say about a node without reading the node.
  for (const c of against ?? []) {
    if (!c.apps) {
      log.info(`  against ${c.stack}: it last took ${c.release}, which is not on this disk — nothing to compare the inputs with`);
      continue;
    }
    const differ = c.apps.filter((x) => x.differs).map((x) => x.app);
    log.info(
      `  against ${c.stack}, which last took ${c.release} at ${c.at}: ` +
        (differ.length === 0
          ? 'every app carries the same inputs — a deployment restarts none unless one is down or its configuration changed'
          : `${differ.length} of ${c.apps.length} app(s) carry other inputs — ${differ.join(', ')}. A deployment ships ` +
            `${differ.length === 1 ? 'that one' : 'those'} and leaves the rest running unless one is down or its configuration changed`),
    );
  }
}

// ---------------------------------------------------------------------------
// attest
// ---------------------------------------------------------------------------

/**
 * `omnitron release attest <id> --stack test --from <file|->`
 *
 * Takes what a stack's probes measured about this release and stores it
 * beside the manifest. Through the DAEMON rather than the disk, for one
 * reason: the freshness refusal — «this attestation finished before the
 * deployment it claims to be about» — needs the audit trail, and the trail
 * is the daemon's. A command that wrote the file itself would keep an
 * attestation about a system that had since been replaced.
 */
/**
 * What an attestation said beyond its probes: what the run took away after
 * itself, what it left and why, and whether it could read the legal texts.
 * The producer measured all of it on the node; a tally of probes alone says
 * nothing about the accounts and organisations a run made on the stand.
 */
function sayWhatTheRunLeft(answer: import('../shared/dto/services.js').AttestStored): void {
  const c = answer.cleanup;
  if (c) {
    if (c.run === null) log.warn(`  cleanup: not run — ${c.notRun ?? 'the run had no name to remove by'}`);
    else {
      const taken = Object.entries(c.removed ?? {})
        .filter(([, n]) => n > 0)
        .map(([kind, n]) => `${n} ${kind}`);
      const said = `  cleanup: run ${c.run} removed ${taken.length ? taken.join(', ') : 'nothing — it had made nothing to remove'}`;
      if (c.failed) log.warn(`${said} — FAILED: ${c.failed}`);
      else log.info(said);
      const retired = Object.entries(c.retired ?? {})
        .filter(([, n]) => n > 0)
        .map(([kind, n]) => `${n} ${kind}`);
      if (retired.length) log.info(`  retired: ${retired.join(', ')} — blocked in place, their real-chain addresses still watched`);
    }
    for (const l of c.leftBehind ?? []) log.warn(`  left behind: ${l.what} — ${l.why.join('; ') || 'no reason given'}`);
  }
  if (answer.legalTextsUnread) log.warn(`  legal texts: could not be read — ${answer.legalTextsUnread}`);
}

export async function releaseAttestCommand(
  id: string,
  options: { stack?: string; from?: string; onNode?: boolean } = {},
): Promise<void> {
  if (!options.stack) {
    log.error('Which stack measured it? `omnitron release attest <id> --stack test --on-node`, or `--from <file|->`');
    process.exitCode = 1;
    return;
  }
  if (options.onNode && options.from) {
    log.error('Either the daemon runs the probes on the node (--on-node) or you hand over what they printed (--from) — not both');
    process.exitCode = 1;
    return;
  }
  if (options.onNode) {
    const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
    try {
      log.info(`Running ${id}'s probes on ${options.stack}'s node — upload, then the suite, under the node's deploy lease…`);
      const svc = await client.service<import('../shared/dto/services.js').IOmnitronReleaseService>('OmnitronRelease');
      const answer = await svc.attestOnNode({ release: id, stack: options.stack });
      const failed = answer.gates - answer.passed;
      const line = `${answer.passed} of ${answer.gates} probes passed on ${answer.node}`;
      if (failed === 0) log.success(`Attested ${id} on ${options.stack}: ${line}`);
      else log.warn(`Attested ${id} on ${options.stack}: ${line}, ${failed} did not`);
      log.info(`  probes from ${answer.scriptsFrom === 'release' ? 'the release itself' : "the release's commit (git archive)"}`);
      // An older daemon does not report it; say nothing rather than «0».
      if (typeof answer.sourceFiles === 'number') {
        log.info(
          answer.sourceFiles > 0
            ? `  with ${answer.sourceFiles} application source files from the release's commit, removed from the node after the run`
            : "  with no application sources — the release's commit has no apps/*/src or packages/*/src; probes that read code say NOT RUN",
        );
      }
      if (answer.accounts === 'provisioned') log.info('  accounts: created by the run and removed at its end (--provision)');
      else if (answer.accounts === 'not-declared')
        log.info(`  accounts: none provisioned — ${options.stack} does not declare release.attest.provision; probes that sign in say NOT RUN`);
      else if (answer.accounts === 'producer-cannot')
        log.warn("  accounts: none provisioned — the stack allows it, but this release's producer predates --provision");
      sayWhatTheRunLeft(answer);
      log.info(`  ${answer.path}`);
    } catch (err) {
      log.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      await client.disconnect();
    }
    return;
  }
  let stdout: string;
  try {
    stdout = options.from && options.from !== '-' ? fs.readFileSync(options.from, 'utf8') : fs.readFileSync(0, 'utf8');
  } catch (err) {
    log.error(`Could not read the attestation: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const client = createDaemonClient();
  try {
    const svc = await client.service<import('../shared/dto/services.js').IOmnitronReleaseService>('OmnitronRelease');
    const answer = await svc.attest({ release: id, stack: options.stack, stdout });
    const failed = answer.gates - answer.passed;
    if (failed === 0) log.success(`Attested ${id} on ${options.stack}: ${answer.passed} of ${answer.gates} probes passed`);
    else log.warn(`Attested ${id} on ${options.stack}: ${answer.passed} of ${answer.gates} probes passed, ${failed} did not`);
    sayWhatTheRunLeft(answer);
    log.info(`  ${answer.path}`);
  } catch (err) {
    log.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// prune
// ---------------------------------------------------------------------------

/**
 * Remove all but the newest `keep` releases — never one a stack runs.
 *
 * `--yes` is required before anything is deleted. The console passed the
 * releases its stacks run as `protect`; this command passed nothing, and on
 * 2026-09-23 seven releases were built and five deployed — five more builds
 * without a deployment and the release test runs was past `--keep 5`, where
 * `--yes` deleted it. So the daemon is asked. When it cannot answer — down,
 * with no trail to read, or with a stack whose last release has no name —
 * `--yes` refuses, unless `--allow-unprotected` says the operator accepts
 * removing without knowing: the same shape as `--allow-dirty`.
 */
export async function releasePruneCommand(
  options: { keep?: number; yes?: boolean; allowUnprotected?: boolean } = {},
): Promise<void> {
  try {
    const keep = options.keep ?? 5;
    const answer = await readDeployments();
    const byRelease = answer.known ? stacksByRelease(answer.deployments) : new Map<string, ReleaseDeploymentDto[]>();
    const blind = pruneBlindness(answer);
    const refused = options.yes === true && blind !== null && options.allowUnprotected !== true;
    const apply = options.yes === true && !refused;
    const result = pruneReleases({ keep, apply, protect: [...byRelease.keys()] });
    for (const id of result.spared) {
      const where = (byRelease.get(id) ?? []).map((d) => `${d.project}/${d.stack}`).join(', ');
      log.info(`  keeping ${id} — ${where} runs it`);
    }
    if (result.doomed.length === 0) {
      log.info(`${result.kept} release(s), keeping ${keep} — nothing to remove.`);
      return;
    }
    for (const d of result.doomed) {
      log.info(`  ${apply ? 'removing' : 'would remove'} ${d.id} (${size(d.bytes)}${d.keptSource ? ' + a build root, not measured' : ''})`);
    }
    // A build root is two clones with their `node_modules` — gigabytes, and
    // not in the size above, which counts what a release carries. Without
    // this line, removing 14 GB read as «2001.9 MB freed» (2026-09-25).
    const roots = result.doomed.filter((d) => d.keptSource).length;
    const rootsNote = roots > 0 ? `, plus ${roots} build root(s) of builds that did not finish — not in that size` : '';
    if (refused) {
      log.error(
        `Nothing was removed: ${blind} — so which of these a stack is running cannot be told. ` +
          'Start the daemon (`omnitron up`) and the ones deployed are kept, or pass --allow-unprotected to remove them without knowing.',
      );
      process.exitCode = 1;
      return;
    }
    if (!options.yes) {
      if (blind) log.warn(`Which of these a stack is running is unknown: ${blind}. --yes refuses without --allow-unprotected.`);
      log.warn(`${result.doomed.length} release(s), ${size(result.freedBytes)}${rootsNote}. Nothing was removed — pass --yes to remove them.`);
      return;
    }
    if (blind) log.warn(`Removed without knowing which releases stacks run (--allow-unprotected): ${blind}.`);
    log.success(`Removed ${result.removed.length} release(s), ${size(result.freedBytes)} freed${rootsNote}; ${result.kept} kept.`);
  } catch (err) {
    log.error((err as Error).message);
    process.exitCode = 1;
  }
}
