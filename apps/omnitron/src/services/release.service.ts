/**
 * Releases, as the daemon holds them.
 *
 * A release build takes a quarter of an hour, two `pnpm install`s and the
 * whole gate suite. That is fine in a terminal, where the operator watches
 * the lines go by; through an RPC call it is impossible — no console waits
 * fifteen minutes for one answer, and a browser tab that is closed halfway
 * must not stop the build. So the call STARTS a build and returns its id,
 * and everything about it is then read from here: the phase, the percent,
 * the gates as they answer, and the error if it failed.
 *
 * The records live in memory only. A daemon restart therefore loses them —
 * and it also kills the build, which is why an unfinished build leaves a
 * directory with no manifest and `release list` shows exactly that. The disk
 * is the durable record; this is the live one.
 */

import { randomUUID } from 'node:crypto';

import type { ILogger } from '@omnitron-dev/titan/module/logger';

import { runReleaseBuild, type BuildPhase, type ReleaseBuildOptions } from '../release/build-run.js';
import {
  listReleases,
  pruneReleases,
  readReleaseDetail,
  readReleaseLog,
  releasesRoot,
  type PruneResult,
  type ReleaseDetail,
  type ReleaseSummary,
} from '../release/store.js';
import type { GateOutcome } from '../release/manifest.js';

/** What the caller asked for, as it is shown back to them. */
export interface BuildRequest {
  readonly project: string;
  readonly projectCommit?: string | undefined;
  readonly omniCommit?: string | undefined;
  readonly forStack?: string | undefined;
  readonly skipGates?: boolean | undefined;
  readonly keepSource?: boolean | undefined;
  /** Names only — a value here would be in every console's memory. */
  readonly envKeys?: readonly string[] | undefined;
}

export interface BuildRecord {
  readonly buildId: string;
  readonly request: BuildRequest;
  /** Known once the two commits are resolved, a few seconds in. */
  releaseId: string | null;
  state: 'running' | 'done' | 'failed' | 'stopped';
  phase: string;
  percent: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  gates: GateOutcome[];
  error: string | null;
  /** Who asked, as the request proved it. */
  readonly requestedBy: string | null;
  /** Every phase line, in order — the console's live log. */
  readonly history: BuildPhase[];
}

/** How many finished builds are kept for looking back at. */
const KEEP_RECORDS = 20;

export class ReleaseService {
  private readonly records = new Map<string, BuildRecord>();
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly logger: ILogger) {}

  root(): string {
    return releasesRoot();
  }

  list(): ReleaseSummary[] {
    return listReleases();
  }

  get(id: string): ReleaseDetail {
    return readReleaseDetail(id);
  }

  log(id: string, name: string, lines?: number): { name: string; bytes: number; tail: string } {
    return readReleaseLog(id, name, lines ?? 200);
  }

  /**
   * Remove old releases — never one that is being built right now.
   *
   * A build in progress is a directory with no manifest, and an unfinished
   * release sorts to the END of the list: with `keep: 5` and six directories,
   * the sixth is the one the daemon is writing into. Deleting it would take
   * the clones out from under `pnpm` mid-install and leave the build failing
   * on a path that stopped existing. The store cannot know this — only the
   * service holds the live records — so the protection is added here.
   */
  prune(options: { keep?: number; apply?: boolean; protect?: readonly string[] }): PruneResult {
    const building = [...this.records.values()]
      .filter((r) => r.state === 'running' && r.releaseId)
      .map((r) => r.releaseId!);
    return pruneReleases({ ...options, protect: [...(options.protect ?? []), ...building] });
  }

  /** Every build this daemon has run since it started, newest first. */
  builds(): BuildRecord[] {
    return [...this.records.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  build(buildId: string): BuildRecord | null {
    return this.records.get(buildId) ?? null;
  }

  /**
   * Start a build, and refuse a second one.
   *
   * Two builds at once would be two `pnpm install`s, two gate suites and two
   * copies of the same store on one machine; the second would not fail, it
   * would just make both take three times as long and leave the operator
   * unable to tell which set of gate failures belonged to which. One at a
   * time, and the refusal names the one that is running.
   */
  start(
    request: BuildRequest & { env?: Record<string, string> },
    requestedBy: string | null,
  ): BuildRecord {
    const busy = [...this.records.values()].find((r) => r.state === 'running');
    if (busy) {
      throw new Error(
        `A release build is already running on this master: ${busy.request.project} ` +
          `${busy.releaseId ? `(${busy.releaseId}) ` : ''}— ${busy.phase} (${busy.percent}%), started ${busy.startedAt}. ` +
          `Wait for it, or stop it.`,
      );
    }
    const buildId = randomUUID();
    const envKeys = Object.keys(request.env ?? {}).sort();
    const record: BuildRecord = {
      buildId,
      request: {
        project: request.project,
        ...(request.projectCommit ? { projectCommit: request.projectCommit } : {}),
        ...(request.omniCommit ? { omniCommit: request.omniCommit } : {}),
        ...(request.forStack ? { forStack: request.forStack } : {}),
        ...(request.skipGates ? { skipGates: true } : {}),
        ...(request.keepSource ? { keepSource: true } : {}),
        ...(envKeys.length ? { envKeys } : {}),
      },
      releaseId: null,
      state: 'running',
      phase: 'starting',
      percent: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: 0,
      gates: [],
      error: null,
      requestedBy,
      history: [],
    };
    this.records.set(buildId, record);
    this.forget();

    const controller = new AbortController();
    this.running.set(buildId, controller);
    const options: ReleaseBuildOptions = {
      ...(request.projectCommit ? { projectCommit: request.projectCommit } : {}),
      ...(request.omniCommit ? { omniCommit: request.omniCommit } : {}),
      ...(request.forStack ? { forStack: request.forStack } : {}),
      ...(request.skipGates ? { skipGates: true } : {}),
      ...(request.keepSource ? { keepSource: true } : {}),
      ...(request.env ? { env: request.env } : {}),
      signal: controller.signal,
    };

    // Deliberately not awaited: the caller gets the build id now. Every
    // outcome lands on the record, including a throw — an unhandled
    // rejection here would take the daemon down with it.
    void runReleaseBuild(request.project, options, (phase) => this.onPhase(buildId, phase))
      .then((outcome) => {
        const r = this.records.get(buildId)!;
        r.state = 'done';
        r.releaseId = outcome.id;
        r.gates = [...outcome.manifest.gates];
        r.percent = 100;
        r.durationMs = outcome.durationMs;
        r.finishedAt = new Date().toISOString();
        const passed = r.gates.filter((g) => g.status === 'passed').length;
        this.logger.info(
          { release: outcome.id, gates: `${passed}/${r.gates.length}`, minutes: Math.round(outcome.durationMs / 60_000) },
          'Release built',
        );
      })
      .catch((err: Error) => {
        const r = this.records.get(buildId)!;
        r.state = controller.signal.aborted ? 'stopped' : 'failed';
        r.error = err.message;
        r.finishedAt = new Date().toISOString();
        r.durationMs = Date.now() - Date.parse(r.startedAt);
        this.logger.error(
          { project: request.project, build: buildId, error: err.message },
          r.state === 'stopped' ? 'Release build stopped' : 'Release build failed',
        );
      })
      .finally(() => {
        this.running.delete(buildId);
      });

    this.logger.info({ project: request.project, build: buildId, by: requestedBy ?? 'system' }, 'Release build started');
    return record;
  }

  /**
   * Stop a running build.
   *
   * The step that is running is ended by its process group, as a timeout
   * ends one, and the build then refuses to go on to the next step. What it
   * has written stays on disk with no manifest — a release directory without
   * a manifest is an unfinished build, which is what this is.
   */
  stop(buildId: string): BuildRecord {
    const record = this.records.get(buildId);
    if (!record) throw new Error(`No build '${buildId}' on this daemon`);
    if (record.state !== 'running') throw new Error(`That build is already ${record.state}`);
    this.running.get(buildId)?.abort();
    record.phase = 'stopping';
    return record;
  }

  /**
   * Stop every running build, for a daemon that is going down.
   *
   * Every step runs detached, in its own process group, so without this a
   * shutdown leaves `pnpm install` and the gate suite running for another
   * quarter of an hour under no supervision at all.
   */
  stopAll(): string[] {
    const stopped: string[] = [];
    for (const [buildId, controller] of this.running) {
      controller.abort();
      const record = this.records.get(buildId);
      if (record) record.phase = 'stopping';
      stopped.push(record?.releaseId ?? buildId);
    }
    if (stopped.length > 0) {
      this.logger.warn({ builds: stopped.join(', ') }, 'Stopping release build(s) — this daemon is going down');
    }
    return stopped;
  }

  private onPhase(buildId: string, phase: BuildPhase): void {
    const record = this.records.get(buildId);
    if (!record) return;
    record.phase = phase.phase;
    record.percent = phase.percent;
    record.durationMs = Date.now() - Date.parse(record.startedAt);
    if (phase.releaseId) record.releaseId = phase.releaseId;
    if (phase.gates) record.gates = [...phase.gates];
    record.history.push(phase);
  }

  /** Keep the running ones and the newest finished; drop the rest. */
  private forget(): void {
    const finished = [...this.records.values()]
      .filter((r) => r.state !== 'running')
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    for (const old of finished.slice(KEEP_RECORDS)) this.records.delete(old.buildId);
  }
}
