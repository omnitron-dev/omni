import { RecoveryMutation } from '../daemon/recovery-state.js';
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
 * Job observations survive controller replacement in the daemon state store.
 * A final manifest can recover a completed build after an interrupted response.
 */

import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { availableParallelism } from 'node:os';

import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

import { runReleaseBuild, type BuildPhase, type ReleaseBuildOptions } from '../release/build-run.js';
import {
  listReleases,
  pruneReleases,
  readReleaseDetail,
  readReleaseManifest,
  readReleaseLog,
  releasesRoot,
  type PruneResult,
  type ReleaseDetail,
  type ReleaseSummary,
} from '../release/store.js';

import type { BuildRequest, BuildRecord } from '../shared/dto/releases.js';
import { parseFrameworkSource } from '../shared/framework-source.js';
import { readBuildChecks } from '../shared/release-reading.js';
export type { BuildRequest, BuildRecord } from '../shared/dto/releases.js';

/** How many finished builds are kept for looking back at. */
const KEEP_RECORDS = 20;
const RECORD_PREFIX = 'release:build:';
type BuildStore = Pick<DaemonStateStore, 'kvKeys' | 'kvGetSync' | 'kvSetSync' | 'kvDeleteSync'>;
type Publisher = (id: string, options: { signal: AbortSignal; progress: (done: number, total: number) => void }) =>
  Promise<NonNullable<BuildRecord['publication']>>;

export class ReleaseService {
  private readonly records = new Map<string, BuildRecord>();
  private readonly running = new Map<string, AbortController>();

  private readonly waiting = new Map<string, () => void>();

  constructor(
    private readonly logger: ILogger,
    private readonly concurrency = Math.min(2, availableParallelism()),
    private readonly store?: BuildStore,
    private readonly publish?: Publisher,
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('releaseBuildConcurrency must be a positive integer');
  }

  /** Restore observations before exposing RPC. A lost executor cannot certify completion or replay an override. */
  async restore(): Promise<void> {
    if (!this.store) return;
    for (const key of await this.store.kvKeys(RECORD_PREFIX)) {
      const record = this.store.kvGetSync<BuildRecord>(key, { strict: true });
      if (!record || key !== RECORD_PREFIX + record.buildId) throw Error('Invalid release build record: ' + key);
      if (record.state === 'queued' || record.state === 'running') {
        const manifest = record.releaseId && readReleaseManifest(record.releaseId);
        if (manifest && manifest.id === record.releaseId) {
          const checks = readBuildChecks(manifest);
          record.state = checks.exitCode === 0 ? 'done' : 'failed';
          record.error = checks.reason;
          record.gates = [...manifest.gates];
          record.percent = 100;
          record.phase = 'Recovered from release manifest';
          if (checks.exitCode === 0 && record.request.publish && !record.publication) {
            record.state = 'interrupted';
            record.phase = 'Publication unconfirmed';
            record.error = 'The build is complete. Verify or repeat release push for this release ID to confirm its store index.';
          }
        } else {
          record.state = 'interrupted';
          record.error = 'The controller session ended before a final release manifest was recorded';
          record.phase = 'Interrupted';
        }
        record.finishedAt = new Date().toISOString();
        record.durationMs = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
        this.persist(record);
      }
      this.records.set(record.buildId, record);
    }
  }

  private persist(record: BuildRecord): void {
    this.store?.kvSetSync(RECORD_PREFIX + record.buildId, record);
  }

  get activeBuildCount(): number {
    return this.running.size + this.waiting.size;
  }

  get canPublish(): boolean { return this.publish !== undefined; }

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
    return [...this.records.values()].reverse().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  build(buildId: string): BuildRecord | null {
    return this.records.get(buildId) ?? null;
  }

  /** Reserve the project before any async work. Other projects share this builder's bounded slots. */
  @RecoveryMutation()
  start(
    request: BuildRequest & { env?: Record<string, string> },
    requestedBy: string | null,
    reauthorize?: () => Promise<unknown>,
  ): BuildRecord {
    // Validate before a request reaches records, audit output or an asynchronous build.
    const frameworkSource = request.frameworkSource === undefined ? undefined : parseFrameworkSource(request.frameworkSource);
    if (request.publish !== undefined && typeof request.publish !== 'boolean') throw new Error('publish must be a boolean');
    if (request.publish && (!this.publish || request.skipGates)) throw new Error('Publishing requires a configured release store and a full gate run');
    const busy = [...this.records.values()].find(r => r.request.project === request.project && (r.state === 'queued' || r.state === 'running'));
    if (busy) {
      throw new Error(
        `Project ${busy.request.project} already has build ${busy.buildId} ` +
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
        ...(frameworkSource ? { frameworkSource } : {}),
        ...(request.forStack ? { forStack: request.forStack } : {}),
        ...(request.skipGates ? { skipGates: true } : {}),
        ...(request.keepSource ? { keepSource: true } : {}),
        ...(request.publish && { publish: true }),
        ...(envKeys.length ? { envKeys } : {}),
      },
      releaseId: null,
      state: 'queued',
      phase: 'Waiting for a build slot',
      percent: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: 0,
      gates: [],
      error: null,
      requestedBy,
      history: [],
    };
    this.persist(record);
    this.records.set(buildId, record);
    this.forget();

    const env = request.env && Object.freeze({ ...request.env });
    if (this.running.size < this.concurrency) this.run(record, env, reauthorize, false);
    else this.waiting.set(buildId, AsyncLocalStorage.bind(() => this.run(record, env, reauthorize, true)));
    return record;
  }

  private run(record: BuildRecord, env: Record<string, string> | undefined, reauthorize: (() => Promise<unknown>) | undefined, queued: boolean): void {
    const { buildId, requestedBy, request } = record;
    const { frameworkSource } = request;
    const controller = new AbortController();
    this.running.set(buildId, controller);
    record.state = 'running';
    record.phase = 'starting';
    const options: ReleaseBuildOptions = {
      ...(request.projectCommit ? { projectCommit: request.projectCommit } : {}),
      ...(request.omniCommit ? { omniCommit: request.omniCommit } : {}),
      ...(frameworkSource ? { frameworkSource } : {}),
      ...(request.forStack ? { forStack: request.forStack } : {}),
      ...(request.skipGates ? { skipGates: true } : {}),
      ...(request.keepSource ? { keepSource: true } : {}),
      ...(env ? { env } : {}),
      signal: controller.signal,
    };

    // Deliberately not awaited: the caller gets the build id now. Every
    // outcome lands on the record, including a throw — an unhandled
    // rejection here would take the daemon down with it.
    const build = () => {
      controller.signal.throwIfAborted();
      return runReleaseBuild(request.project, options, phase => this.onPhase(buildId, request.publish
        ? { ...phase, percent: Math.round(phase.percent * 0.9) } : phase));
    };
    const execution = queued && reauthorize ? reauthorize().then(build) : build();
    void execution.then(async (outcome) => {
        const r = this.records.get(buildId)!;
        const checks = readBuildChecks(outcome.manifest);
        r.releaseId = outcome.id;
        r.gates = [...outcome.manifest.gates];
        if (checks.exitCode === 0 && request.publish && this.publish) {
          await reauthorize?.();
          controller.signal.throwIfAborted();
          const progress = (done: number, total: number) => {
            const percent = total ? 90 + Math.floor(9 * done / total) : 90;
            if (r.percent === percent && r.phase.startsWith('Publishing')) return;
            this.onPhase(buildId, { phase: total ? `Publishing · ${done} of ${total} files` : 'Publishing to release store', percent, at: new Date().toISOString() });
          };
          progress(0, 0);
          r.publication = await this.publish(outcome.id, { signal: controller.signal, progress });
          r.phase = 'Published to release store';
        }
        r.state = checks.exitCode === 0 ? 'done' : 'failed';
        r.error = checks.reason;
        r.percent = 100;
        r.durationMs = Date.now() - Date.parse(r.startedAt);
        r.finishedAt = new Date().toISOString();
        const passed = r.gates.filter((g) => g.status === 'passed').length;
        this.logger.info(
          { release: outcome.id, gates: `${passed}/${r.gates.length}`, minutes: Math.round(outcome.durationMs / 60_000), state: r.state, error: r.error },
          checks.exitCode === 0 ? 'Release built' : 'Release checks did not pass; artifacts retained for diagnosis',
        );
      })
      .catch((err: Error) => {
        const r = this.records.get(buildId)!;
        const publicationUnknown = request.publish && r.history.some(phase => phase.phase.startsWith('Publishing')) && !r.publication;
        r.state = publicationUnknown ? 'interrupted' : controller.signal.aborted ? 'stopped' : 'failed';
        r.error = publicationUnknown
          ? `${err.message}. Publication unconfirmed. Verify or repeat release push for ${r.releaseId}.` : err.message;
        r.finishedAt = new Date().toISOString();
        r.durationMs = Date.now() - Date.parse(r.startedAt);
        this.logger.error(
          { project: request.project, build: buildId, error: err.message },
          r.state === 'stopped' ? 'Release build stopped' : 'Release build failed',
        );
      })
      .finally(() => {
        try { this.persist(record); }
        catch (error) { this.logger.error({ buildId, error: (error as Error).message }, 'Could not persist the final build record'); }
        this.running.delete(buildId);
        const next = this.waiting.entries().next();
        if (!next.done) {
          const [id, start] = next.value;
          this.waiting.delete(id);
          start();
        }
      });

    this.logger.info({ project: request.project, build: buildId, by: requestedBy ?? 'system' }, 'Release build started');
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
    if (this.waiting.delete(buildId)) {
      record.state = 'stopped';
      record.phase = 'Cancelled before starting';
      record.finishedAt = new Date().toISOString();
      record.durationMs = Date.now() - Date.parse(record.startedAt);
      this.persist(record);
      return record;
    }
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
    const stopped = [...this.waiting.keys()];
    for (const id of stopped) this.stop(id);
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
    this.persist(record);
  }

  /** Keep the running ones and the newest finished; drop the rest. */
  private forget(): void {
    const finished = this.builds().filter(r => r.state !== 'running' && r.state !== 'queued');
    const retained = new Map<string, number>();
    for (const old of finished) {
      const count = retained.get(old.request.project) ?? 0;
      retained.set(old.request.project, count + 1);
      if (count >= KEEP_RECORDS) {
        this.store?.kvDeleteSync(RECORD_PREFIX + old.buildId);
        this.records.delete(old.buildId);
      }
    }
  }
}
