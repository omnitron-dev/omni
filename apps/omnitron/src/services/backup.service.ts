import { OMNITRON_HOME } from '../config/defaults.js';
/**
 * BackupService — Database backup and restore automation
 *
 * Manages PostgreSQL database backups for omnitron-pg and app databases.
 * Backups stored as compressed pg_dump files in ~/.omnitron/backups/.
 * Uses Docker exec for pg_dump/pg_restore when databases are containerised.
 *
 * Features:
 * - Create on-demand backups (compressed gzip)
 * - List available backups with metadata
 * - Restore from backup
 * - Scheduled automated backups (cron expressions)
 * - Automatic cleanup of old backups
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Injectable, Inject, Optional } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { DAEMON_STATE_STORE_TOKEN, PROJECT_SERVICE_TOKEN } from '../shared/tokens.js';
import { getEnv } from '../shared/env-config.js';
import { resolveOmnitronPgConfig } from '../database/connection.js';
import { ensurePrivateDir, sealFile, sealDirContents } from '../shared/private-files.js';
import { dumpToFile, restoreFromFile, formatBackupSize, formatUtc, resolveBackupId } from './backup-pipeline.js';
import {
  parseSchedule,
  nextCronDelay,
  describeSchedule,
  type SchedulePlan,
} from './backup-schedule.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { ProjectService } from './project.service.js';
import type {
  BackupInfo,
  BackupArtifactRequest,
} from '../shared/dto/backups.js';
import { inspectStackContainers } from '../infrastructure/container-runtime.js';
import { recoveryState } from '../daemon/recovery-state.js';
import { backupStorageObjects, restoreStorageObjects, validateStorageBucket } from './backup-storage.js';

// =============================================================================
// Types
// =============================================================================

export type {
  BackupInfo,
} from '../shared/dto/backups.js';
interface ScheduleEntry {
  database: string;
  /** The specification as the operator wrote it — cron, preset, or ms. */
  cron: string;
  plan: SchedulePlan;
  /**
   * The pending `setTimeout`. Both forms arm one run at a time and each run
   * arms the next: cron because its occurrences are not evenly spaced, the
   * interval form because its next run is measured from the last one.
   */
  timer?: NodeJS.Timeout;
  /** When the pending timer fires (ISO, UTC). */
  nextRunAt?: string;
  /** Set once a schedule has been cancelled, so an in-flight tick stops. */
  cancelled?: boolean;
}

/**
 * A schedule's first run after a start is never sooner than this — the
 * stacks whose databases it dumps are still coming up — and every further
 * schedule armed by the same start waits one `FIRST_RUN_STAGGER_MS` more, so
 * two overdue passes do not begin in the same second.
 */
const FIRST_RUN_GRACE_MS = 60_000;
const FIRST_RUN_STAGGER_MS = 60_000;

/**
 * After a pass that backed up nothing, the next attempt comes this soon (or
 * at the interval, when that is sooner). Running overdue passes at start is
 * what makes this necessary: a daily pass that finds its stacks not yet up
 * would otherwise wait a whole day to try again.
 */
const RETRY_AFTER_NOTHING_MS = 15 * 60_000;

import type { BackupPassOutcome, BackupPassEntry, BackupOrigin, BackupRecord, BackupStackCoverage, BackupPassRecord, BackupScheduleStatus, BackupStatus } from '../shared/dto/backups.js';
export type { BackupPassOutcome, BackupPassEntry, BackupOrigin, BackupRecord, BackupStackCoverage, BackupPassRecord, BackupScheduleStatus, BackupStatus } from '../shared/dto/backups.js';

/** The daemon's own control-plane database: the audit log, deployments, runs. */
const CONTROL_PLANE_DB = 'omnitron';

/** A failure's own words, without the "Backup failed for 'x':" every wrapper adds. */
function reasonOf(err: unknown): string {
  const e = err as Error & { cause?: unknown };
  const inner = e?.cause instanceof Error ? e.cause.message : undefined;
  return (inner ?? e?.message ?? String(err)).slice(0, 500);
}

/**
 * The outcome of a pass, from its entries. No entries is `empty`, never `ok`:
 * «0 of 0 backed up» is a pass that protected nothing.
 */
export function passOutcome(entries: Array<{ ok: boolean; skipped?: boolean }>): BackupPassOutcome {
  const attempted = entries.filter((e) => !e.skipped);
  if (attempted.length === 0) return 'empty';
  const ok = attempted.filter((e) => e.ok).length;
  if (ok === attempted.length) return 'ok';
  return ok === 0 ? 'failed' : 'partial';
}

/** What an index row's metadata column holds; every field is absent on some rows. */
interface BackupMetadata {
  filename?: string;
  compressed?: boolean;
  type?: string;
  project?: string;
  stack?: string;
  scope?: 'stack' | 'control-plane';
  bucket?: string;
}

function metadataOf(raw: string | null): BackupMetadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as BackupMetadata;
  } catch {
    return {};
  }
}

/** A pass entry named so that two stacks' `main` cannot be taken for each other. */
function qualifiedEntry(e: BackupPassEntry & { project?: string; stack?: string }): BackupPassEntry {
  const { project, stack, ...rest } = e;
  return project && stack && !e.skipped ? { ...rest, target: `${project}/${stack}/${e.target}` } : rest;
}

/** The index/listing fields that say where a backup came from. */
function originFields(origin: BackupOrigin): Pick<BackupRecord, 'project' | 'stack' | 'scope'> {
  return origin === 'control-plane'
    ? { scope: 'control-plane' }
    : { project: origin.project, stack: origin.stack, scope: 'stack' };
}

/**
 * Non-database artefacts that only a `full` pass produces, and therefore
 * only a `full` pass used to prune.
 */
const FULL_BACKUP_ARTEFACTS = ['storage-objects', 'tor-keys', 'daemon-state'] as const;

/**
 * Tor state that is re-fetched from the network, excluded from the key backup.
 *
 * These are the directory cache and its scratch files. They are identical
 * across every Tor client, replaced on a schedule, and useless in a restore —
 * a restored Tor re-downloads them before it does anything else.
 */
const TOR_REGENERABLE_STATE = [
  './cached-*',
  './diff-cache',
  './unverified-*',
  './lock',
] as const;

/** SQLite leaves these beside a database it opens (`-journal` in rollback mode). */
const SQLITE_SIDECARS = ['-shm', '-wal', '-journal'] as const;

/** Scratch directories `createStorageBackup` and `restoreStorageBackup` remove in a `finally`. */
const STORAGE_STAGING_DIR = /^\.storage-(stage|restore)-[0-9a-f]{8}$/;

/** The database file a SQLite sidecar belongs to, or null for any other file. */
function sidecarOwner(name: string): string | null {
  for (const suffix of SQLITE_SIDECARS) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return null;
}

function bytesUnder(target: string): number {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const child of fs.readdirSync(target)) total += bytesUnder(path.join(target, child));
    return total;
  } catch {
    return 0;
  }
}

export interface LeftoverSweep {
  removed: Array<{ name: string; bytes: number; reason: string }>;
  /** Sidecars left alone because the database they belong to is still there. */
  besideBackups: { files: number; bytes: number };
  /** Orphaned sidecars left alone because their WAL still holds frames. */
  keptOrphans: string[];
}

/**
 * Remove what an interrupted pass leaves in the backup directory.
 *
 * Measured on the master, 2026-09-23: 28 files, 79 300 253 B (75.6 MiB), that
 * no index row names — so `backup list` never showed them and retention never
 * pruned them:
 *
 *     23 zero-byte files               22 `tor-keys`, 1 `storage` (July–September)
 *      2 `main_…sql.gz.partial`         7 150 144 B and 70 477 299 B — the daemon
 *                                      restarted mid-dump at 13:15:43Z and
 *                                      21:15:47Z on 09-21, and no catch of ours
 *                                      runs in a process that is gone
 *      3 truncated archives            the ones named on `execToFile`
 *
 * A `.partial` is by construction not a backup (`dumpToFile`, `execToFile`
 * write under it and rename only a finished file), and a zero-byte file
 * restores nothing, so both go. Nothing is in flight when this runs: it is
 * called from the constructor, once, before any schedule is armed.
 *
 * The SQLite sidecars are more careful, because something may have a
 * database open. Measured: 102 of them (51 `-shm` of 32 768 B, 51 `-wal` of
 * 0 B). Apple's `sqlite3` keeps both files after it closes a WAL database, and
 * a `daemon-state_*.db` backup IS one — `.backup` copies the WAL flag in the
 * header from the live store. So every open of a backup left a pair: 3 pairs
 * `….db.partial-shm/-wal` from our own integrity check, which ran on the
 * staging name and then renamed the file away from them; 4 pairs whose `.db`
 * retention had deleted, because `deleteBackup` removed only the named file;
 * and 44 pairs beside backups that still exist, written by bulk opens at
 * 2026-09-11 23:50 and 09-14 15:27 local — not by this code.
 *
 * Only an ORPHAN pair is removed — its database is gone, so nothing can open
 * it — and only while its WAL holds no frames. A pair beside a live database
 * is counted and kept: that one is not provably idle.
 */
export function sweepBackupLeftovers(dir: string): LeftoverSweep {
  const report: LeftoverSweep = { removed: [], besideBackups: { files: 0, bytes: 0 }, keptOrphans: [] };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return report;
  }
  const present = new Set(entries.map((e) => e.name));
  const sizeOf = (name: string): number => {
    try { return fs.statSync(path.join(dir, name)).size; } catch { return 0; }
  };
  const remove = (name: string, reason: string): void => {
    const target = path.join(dir, name);
    const bytes = bytesUnder(target);
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      return; // not ours to remove — it stays, and stays out of the count
    }
    present.delete(name);
    report.removed.push({ name, bytes, reason });
  };

  // Files first: removing a `.partial` is what orphans the sidecars beside it.
  for (const e of entries) {
    if (e.isDirectory()) {
      if (STORAGE_STAGING_DIR.test(e.name)) remove(e.name, 'the scratch directory of an interrupted storage pass');
      continue;
    }
    if (!e.isFile() || sidecarOwner(e.name) !== null) continue;
    if (e.name.endsWith('.partial')) remove(e.name, 'an interrupted dump');
    else if (sizeOf(e.name) === 0) remove(e.name, 'empty');
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    const owner = sidecarOwner(e.name);
    if (owner === null) continue;
    if (present.has(owner)) {
      report.besideBackups.files++;
      report.besideBackups.bytes += sizeOf(e.name);
      continue;
    }
    if (present.has(`${owner}-wal`) && sizeOf(`${owner}-wal`) > 0) {
      report.keptOrphans.push(e.name);
      continue;
    }
    remove(e.name, 'the SQLite sidecar of a database that is gone');
  }
  return report;
}

/**
 * Which databases a sweep should bound, given what is scheduled and what
 * actually has backups.
 *
 * Split out because the choice is the whole point: pruning only the
 * scheduled set means retention runs where the producer still runs and
 * nowhere else, so anything dropped from the configuration keeps its history
 * for ever.
 */
export function databasesToPrune(scheduled: string[], onDisk: string[]): string[] {
  return [...new Set([...scheduled, ...onDisk, ...FULL_BACKUP_ARTEFACTS])];
}

// =============================================================================
// Service
// =============================================================================

@Injectable()
export class BackupService {
  private static readonly SCHEDULES_KV_KEY = 'backup:schedules';
  private activeOperations = 0;
  private quiescing = false;

  activeOperationCount(): number { return this.activeOperations; }

  prepareHandoff(): void {
    if (this.activeOperations) throw new Error('Backup or restore is active; finish it before replacing the backend');
    this.quiescing = true;
    this.dispose();
  }

  async resumeAfterHandoff(): Promise<void> {
    if (!this.quiescing) return;
    this.quiescing = false;
    await this.restoreSchedules().catch(error => {
      this.logger.error({ error: reasonOf(error) }, 'Backup schedules could not resume after backend handoff; inspect backup schedules');
    });
  }

  private async trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.quiescing) throw new Error('Backup admission is paused for backend handoff');
    this.activeOperations++;
    try { return await recoveryState.run('Backup or restore in progress', operation); }
    finally { this.activeOperations--; }
  }

  /** Target → the last pass it ran. Beside the schedules, in the same store. */
  private static readonly PASSES_KV_KEY = 'backup:last-pass';
  private readonly backupDir: string;
  private readonly logger: ILogger;
  private schedules = new Map<string, ScheduleEntry>();
  /** True only after every discovered metadata sidecar was safely imported. */
  private legacyMigrated = false;
  /** The tail of the scheduled passes, which run one at a time — see `runExclusive`. */
  private passQueue: Promise<unknown> = Promise.resolve();

  // T-2 — @Inject decorators bind tokens to ctor positions; framework
  // reads metadata directly, no inject:[] array drift possible.
  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule,
    /**
     * T-7 — backup metadata persistence moved off side-car .meta.json
     * files onto the SQLite-backed `backups` table in
     * DaemonStateStore. The .sql.gz bytes themselves stay on disk
     * (large + streaming pg_restore needs random access), but the
     * INDEX of `which backup exists, for which app, when, how big`
     * lives in SQLite — atomic upserts, no torn-write window on
     * kill -9 mid-write. One-shot migration of legacy .meta.json
     * files happens on the first list/restore call.
     */
    @Inject(DAEMON_STATE_STORE_TOKEN) private readonly store: DaemonStateStore,
    /**
     * Optional so the daemon still boots (and omnitron-pg self-backup still
     * works) even if the project subsystem is unavailable. When present it is
     * the source of truth for the running stacks' real DB topology, replacing
     * the old hardcoded omnitron-pg-only mappings.
     */
    @Optional() @Inject(PROJECT_SERVICE_TOKEN) private readonly projects?: ProjectService,
  ) {
    this.logger = loggerModule.logger;
    this.backupDir = path.join(OMNITRON_HOME, 'backups');
    // 0700 on the directory, 0600 on every file in it — see `private-files`.
    // The sweep reaches backwards on purpose: the files written before this
    // existed are the ones that have been world-readable the longest, and a
    // fix that only protects future backups protects nothing that matters.
    ensurePrivateDir(this.backupDir);
    const tightened = sealDirContents(this.backupDir);
    if (tightened > 0) {
      this.logger.warn(
        { dir: this.backupDir, files: tightened },
        'Backup files were readable beyond their owner — permissions tightened',
      );
    }
    this.clearLeftovers();
  }

  /**
   * Once per start: remove what interrupted passes left behind, and name what
   * is still on disk without an index row. See `sweepBackupLeftovers`.
   */
  private clearLeftovers(): void {
    const swept = sweepBackupLeftovers(this.backupDir);
    if (swept.removed.length > 0) {
      const bytes = swept.removed.reduce((sum, r) => sum + r.bytes, 0);
      this.logger.warn(
        {
          dir: this.backupDir,
          files: swept.removed.length,
          bytes,
          removed: swept.removed.map((r) => `${r.name} (${r.reason}, ${r.bytes} B)`),
        },
        `Removed ${swept.removed.length} leftover file(s) from the backup directory, ${formatBackupSize(bytes)}`,
      );
    }
    if (swept.keptOrphans.length > 0) {
      this.logger.warn(
        { dir: this.backupDir, files: swept.keptOrphans },
        'SQLite sidecars of a deleted database still hold WAL frames — left in place',
      );
    }
    if (swept.besideBackups.files > 0) {
      this.logger.info(
        { dir: this.backupDir, files: swept.besideBackups.files, bytes: swept.besideBackups.bytes },
        'SQLite sidecars sit beside backups that still exist — left in place; retention removes them with their database',
      );
    }

    // What is left and still in no index: a file restore cannot name, no
    // listing shows and retention never prunes. Not removed — a file with
    // content may be a good backup whose row was lost — but not silent either.
    try {
      this.migrateLegacyMetaIfPresent();
      const indexed = new Set(this.store.selectBackupsSync().map((r) => path.basename(r.path)));
      const stray: Array<{ name: string; bytes: number }> = [];
      for (const e of fs.readdirSync(this.backupDir, { withFileTypes: true })) {
        if (!e.isFile() || indexed.has(e.name)) continue;
        if (sidecarOwner(e.name) !== null || e.name.endsWith('.meta.json')) continue;
        stray.push({ name: e.name, bytes: bytesUnder(path.join(this.backupDir, e.name)) });
      }
      if (stray.length > 0) {
        const bytes = stray.reduce((sum, s) => sum + s.bytes, 0);
        this.logger.warn(
          { dir: this.backupDir, files: stray.length, bytes, names: stray.map((s) => `${s.name} (${s.bytes} B)`) },
          `${stray.length} file(s) in the backup directory are in no index (${formatBackupSize(bytes)}) — ` +
            'not listed, not restorable by id, never pruned',
        );
      }
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Could not compare the backup directory with its index');
    }
  }

  /** Transfer historical sidecars only after a durable, exact index acknowledgement. */
  private migrateLegacyMetaIfPresent(): void {
    if (this.legacyMigrated) return;
    this.legacyMigrated = true;
    try {
      const files = fs.readdirSync(this.backupDir).filter(file => file.endsWith('.meta.json'));
      for (const file of files) {
        const metadataFile = path.join(this.backupDir, file);
        try {
          const original = fs.lstatSync(metadataFile);
          if (!original.isFile()) throw new Error('Backup metadata is not a regular file');
          const content = fs.readFileSync(metadataFile, 'utf8');
          const info = JSON.parse(content) as BackupInfo;
          if (!info || typeof info.id !== 'string' || !info.id || typeof info.database !== 'string' || !info.database ||
            typeof info.filename !== 'string' || !info.filename || path.basename(info.filename) !== info.filename ||
            typeof info.createdAt !== 'string' || !Number.isFinite(Date.parse(info.createdAt)) || typeof info.compressed !== 'boolean')
            throw new Error('Invalid backup metadata record');
          const backupFile = path.join(this.backupDir, info.filename);
          const stats = fs.lstatSync(backupFile);
          if (!stats.isFile()) throw new Error('Backup archive is not a regular file');
          const expected = {
            id: info.id, app: info.database, path: backupFile,
            size_bytes: stats.size, created_at: info.createdAt,
          };
          const metadata = { filename: info.filename, compressed: info.compressed };
          const db = this.store.initSync();
          if (db.inTransaction) throw new Error('Backup index is busy in another transaction; retry the metadata import');
          const previous = db.pragma('synchronous', { simple: true });
          try {
            db.pragma('synchronous = FULL');
            let existed = false;
            db.transaction(() => {
              existed = this.store.selectBackupsSync().some(row => row.id === info.id);
              if (!existed) this.store.insertBackupSync({ ...expected, metadata });
              const observed = this.store.selectBackupsSync().find(row => row.id === info.id);
              if (!observed) throw new Error(`Backup index did not confirm metadata ID '${info.id}'`);
              const { metadata: storedMetadata, ...identity } = observed;
              if (!isDeepStrictEqual(identity, expected) || !isDeepStrictEqual(JSON.parse(storedMetadata ?? 'null'), metadata))
                throw new Error(`Backup metadata ID '${info.id}' conflicts with its existing index record`);
            }).immediate();
            if (existed) {
              // A read-only FULL transaction cannot harden an earlier NORMAL
              // commit. Confirm that its WAL frames reached the synced database
              // before discarding the remaining sidecar copy.
              const checkpoint = db.pragma('wal_checkpoint(FULL)') as Array<{ busy: number; log: number; checkpointed: number }>;
              const result = checkpoint[0];
              if (!result || result.busy !== 0 || result.log < 0 || result.checkpointed !== result.log)
                throw new Error(`Backup index checkpoint was not confirmed for metadata ID '${info.id}'`);
            }
          } finally { db.pragma(`synchronous = ${Number(previous)}`); }
          const current = fs.lstatSync(metadataFile);
          if (current.dev !== original.dev || current.ino !== original.ino || current.size !== original.size ||
            current.mtimeMs !== original.mtimeMs || current.ctimeMs !== original.ctimeMs || fs.readFileSync(metadataFile, 'utf8') !== content)
            throw new Error('Backup metadata changed during import; replacement was retained');
          fs.unlinkSync(metadataFile);
        } catch (err) {
          this.legacyMigrated = false;
          this.logger.warn({ file, err: reasonOf(err) }, 'Backup metadata migration deferred; source will be retried if present');
        }
      }
    } catch (err) {
      this.legacyMigrated = false;
      this.logger.warn({ directory: this.backupDir, err: reasonOf(err) }, 'Could not scan backup metadata; import will be retried');
    }
  }

  // ===========================================================================
  // Create backup
  // ===========================================================================

  async createBackup(database: string, options?: { compress?: boolean }): Promise<BackupRecord> {
    return this.trackOperation(() => this.createDatabaseBackup(database, options));
  }

  private async createDatabaseBackup(database: string, options?: { compress?: boolean }): Promise<BackupRecord> {
    const compress = options?.compress !== false;
    // Resolved before the file is named: the name is the database's, never
    // the `<project>/<stack>/<db>` key, whose slashes would be directories.
    const { dbConfig, isDocker, containerName, origin } = this.resolveDbTarget(database);
    const name = origin === 'control-plane' ? CONTROL_PLANE_DB : dbConfig.database;
    const from = originFields(origin);
    const id = randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = compress ? '.sql.gz' : '.sql';
    const filename = `${name}_${timestamp}_${id.slice(0, 8)}${ext}`;
    const filepath = path.join(this.backupDir, filename);

    this.logger.info({ database: name, ...from, filename, compress }, 'Creating backup');

    let publicationConfirmed = false;
    let indexConfirmed = false;
    try {
      if (isDocker) {
        await this.pgDumpDocker(containerName, dbConfig, filepath, compress);
      } else {
        await this.pgDumpLocal(dbConfig, filepath, compress);
      }
      publicationConfirmed = true;

      // Before it is indexed, and therefore before anything else can learn
      // the path: a pg_dump redirected into a file lands at whatever the
      // umask says, which for a normal login shell is 0644.
      sealFile(filepath);
      const stats = fs.statSync(filepath);

      const info: BackupRecord = {
        id,
        database: name,
        filename,
        size: stats.size,
        createdAt: new Date().toISOString(),
        compressed: compress,
        ...from,
      };

      // Persist metadata transactionally to SQLite. Pre-T-7 this
      // was a side-car .meta.json fs.writeFileSync — torn-write
      // risk if the daemon was SIGKILL'd between the dump and the
      // meta write. The stack travels with the row — see `BackupOrigin`.
      this.store.insertBackupSync({
        id: info.id,
        app: name,
        path: filepath,
        size_bytes: stats.size,
        created_at: info.createdAt,
        metadata: { filename: info.filename, compressed: info.compressed, type: 'postgres', ...from },
      });
      indexConfirmed = true;

      this.logger.info({ database: name, ...from, filename, size: stats.size }, 'Backup created');
      return info;
    } catch (err) {
      // The pipeline owns its private staging. A final path may belong to a
      // concurrent writer, or hold a complete backup whose fsync/index receipt
      // was lost. Never turn that uncertainty into destructive cleanup.
      const recovery = publicationConfirmed
        ? `Complete backup file retained at ${filepath}; ${indexConfirmed
          ? 'index insertion completed'
          : 'index completion was not confirmed; inspect the file and backup index before retrying'}.`
        : `Publication was not confirmed; any file at ${filepath} was left in place.`;
      throw new Error(`Backup failed for '${database}': ${(err as Error).message}. ${recovery}`, { cause: err });
    }
  }

  // ===========================================================================
  // Non-DB backup targets: storage objects, tor keys, daemon-state (secrets)
  // ===========================================================================

  /** Retained infrastructure remains addressable while application writers are stopped. */
  private resourceInstances(): Array<{ infra: InfraLike; project: string; stack: string }> {
    return this.projects?.getInfraManager().listInstances() ?? [];
  }

  private async resolveResource(service: 'minio' | 'tor', scope?: { project: string; stack: string }) {
    const targets = this.resourceInstances().filter(target => target.infra.getResolvedContainerName(service));
    const selected = scope
      ? targets.filter(target => target.project === scope.project && target.stack === scope.stack)
      : targets;
    if (selected.length !== 1) {
      const wanted = scope ? `${scope.project}/${scope.stack}/${service}` : service;
      throw new Error(`Cannot resolve backup target '${wanted}' on this host. Name one provisioned stack: ${
        targets.map(target => `${target.project}/${target.stack}`).join(', ') || '(none)'}`);
    }
    const target = selected[0]!;
    const name = target.infra.getResolvedContainerName(service)!;
    const container = (await inspectStackContainers(target, [name])).find(item => item.name === name);
    if (!container) throw new Error(`Backup container '${name}' is absent; refusing another allocation`);
    return { ...target, container: container.id };
  }

  async createArtifactBackup(request: BackupArtifactRequest): Promise<BackupRecord> {
    if (!request || typeof request.project !== 'string' || !request.project || typeof request.stack !== 'string' || !request.stack)
      throw new Error('An artifact backup requires an explicit project and stack');
    if (request.kind === 'storage-objects') {
      validateStorageBucket(request.bucket);
      return this.createStorageBackup(request, request.bucket);
    }
    if (request.kind === 'tor-keys') return this.createTorKeysBackup(request);
    throw new Error('Unsupported backup artifact kind');
  }

  /** Index a already-written backup file into the SQLite backups table. */
  private indexBackupFile(app: string, filepath: string, type: string, origin: BackupOrigin, bucket?: string): BackupRecord {
    // Every non-DB target — storage objects, tor keys, daemon-state — finishes
    // here, which makes this the one place their mode can be set once.
    sealFile(filepath);
    const stats = fs.statSync(filepath);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const filename = path.basename(filepath);
    const from = originFields(origin);
    this.store.insertBackupSync({
      id, app, path: filepath, size_bytes: stats.size, created_at: createdAt,
      metadata: { filename, compressed: filename.endsWith('.gz'), type, ...from, ...(bucket ? { bucket } : {}) },
    });
    return { id, database: app, filename, size: stats.size, createdAt, compressed: filename.endsWith('.gz'), ...from, ...(bucket ? { bucket } : {}) };
  }

  /** Run a shell command, rejecting on a non-zero exit. Returns its stdout. */
  private async execShell(cmd: string, timeoutMs = 600_000): Promise<string> {
    const { execFile } = await import('node:child_process');
    return new Promise<string>((resolve, reject) => {
      execFile('/bin/sh', ['-c', cmd], { timeout: timeoutMs, maxBuffer: 200 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err); else resolve(String(stdout ?? ''));
      });
    });
  }

  /**
   * Run a command that produces a backup file, and publish the name only if
   * the file is READABLE.
   *
   * The check was `size === 0`, and "not empty" is not "not corrupt".
   * Measured in `~/.omnitron/backups` 2026-09-14, four files that passed it:
   *
   *     main_2026-09-14T07-51…sql.gz          98 304 B  gzip header, body cut off
   *     quotes_2026-09-10T06-27…sql.gz      1.5 MB  same
   *     storage-objects_2026-07-02T10-22…gz       122 B  «OCI runtime exec failed:
   *                                                       "tar": not found in $PATH»
   *
   * The last one is the shape in miniature: a shell error message, sitting
   * under a `.tar.gz` name, 122 bytes long and therefore "not empty". The
   * property that matters is whether the archive opens; the property measured
   * was how many bytes exist.
   *
   * The write also lands on the final name from its first byte, so a command
   * interrupted half-way — a full disk, a killed container — leaves a
   * truncated archive under the name a restore would pick up. Today's
   * ENOSPC-mid-write is exactly that case.
   *
   * So: write to `<name>.partial`, verify, then rename. Rename within a
   * directory is atomic, which makes the visible state binary — either the
   * name is absent, or it names an archive that opened.
   */
  private async execToFile(cmd: string, outputPath: string, timeoutMs = 600_000): Promise<void> {
    const staging = `${outputPath}.partial`;
    fs.rmSync(staging, { force: true });

    try {
      await this.execShell(cmd.split(outputPath).join(staging), timeoutMs);
      if (!fs.existsSync(staging) || fs.statSync(staging).size === 0) {
        throw new Error('backup produced an empty file');
      }
      await this.assertReadable(staging, outputPath);
      fs.renameSync(staging, outputPath);
    } catch (err) {
      // The empty-file check was already here and works — it kept these out
      // of the index. What it did not do was clean up: 22 zero-byte
      // `tor-keys` files had accumulated in the backup directory, on disk but
      // in no listing, which is the worst place for a file to be.
      fs.rmSync(staging, { force: true });
      fs.rmSync(outputPath, { force: true });
      throw err;
    }
  }

  /**
   * Open the archive and fail if it does not open.
   *
   * Keyed on the FINAL name's extension, not the staging one — `.partial` is
   * an implementation detail and would otherwise match nothing and verify
   * nothing, which is the failure mode this whole method exists to remove.
   *
   * An extension nobody has taught this to check passes: the alternative is
   * refusing a backup that was taken correctly, and a verification gap is
   * better than losing a good archive. The three formats produced here are
   * all covered.
   */
  private async assertReadable(staging: string, finalPath: string): Promise<void> {
    if (finalPath.endsWith('.gz')) {
      await this.execShell(`gzip -t "${staging}"`, 300_000);
      return;
    }
    if (finalPath.endsWith('.db')) {
      // `.backup` produces a consistent snapshot, but a disk that filled
      // during the copy produces a short file that sqlite still opens.
      //
      // The copy is switched out of WAL mode first. `.backup` carries the
      // live store's WAL flag into the copy's header, and Apple's `sqlite3`
      // keeps `-shm` and `-wal` after it closes a WAL database — so this very
      // check left `<name>.db.partial-shm` (32 768 B) and `-wal` (0 B) on
      // every `full` pass, named after a staging file the rename then took
      // away: three such pairs on the master, from 09-17, 09-18 and 09-19.
      // In rollback mode a backup is one file, whoever opens it later. The
      // store puts it back into WAL itself when a restored copy is opened.
      try {
        const out = await this.execShell(
          `sqlite3 "${staging}" "PRAGMA journal_mode=DELETE;" "PRAGMA integrity_check;"`,
          300_000,
        );
        const verdict = out.trim().split('\n').pop()?.trim();
        if (verdict !== 'ok') {
          throw new Error(`backup failed its integrity check: ${out.trim().slice(0, 200)}`);
        }
      } finally {
        // Leaving WAL mode checkpoints and removes the WAL, but Apple's build
        // keeps the `-shm`, which means nothing to a rollback-mode database.
        // A WAL that is still there is removed only if it holds no frames.
        fs.rmSync(`${staging}-shm`, { force: true });
        const wal = `${staging}-wal`;
        if (fs.existsSync(wal) && fs.statSync(wal).size === 0) fs.rmSync(wal, { force: true });
      }
    }
  }

  private storageTarget(target: { infra: InfraLike; container: string }, bucket: string) {
    validateStorageBucket(bucket);
    const connection = target.infra.getConnectionInfo('minio');
    if (typeof connection?.['accessKey'] !== 'string' || typeof connection['secretKey'] !== 'string')
      throw new Error('MinIO credentials are unavailable for the selected stack');
    return { container: target.container, accessKey: connection['accessKey'], secretKey: connection['secretKey'], bucket };
  }

  private artifactOrigin(meta: BackupMetadata): { project: string; stack: string } | undefined {
    if (meta.scope === 'control-plane' || !!meta.project !== !!meta.stack)
      throw new Error('Invalid artifact backup origin; refusing an inferred restore target');
    return meta.project && meta.stack ? { project: meta.project, stack: meta.stack } : undefined;
  }

  private async restoreStorageBackup(filepath: string, meta: BackupMetadata): Promise<void> {
    const target = await this.resolveResource('minio', this.artifactOrigin(meta));
    await restoreStorageObjects(this.storageTarget(target, meta.bucket ?? 'storage'), filepath);
  }

  private async restoreTorKeysBackup(filepath: string, meta: BackupMetadata): Promise<void> {
    const target = await this.resolveResource('tor', this.artifactOrigin(meta));
    await restoreFromFile('docker', ['exec', '-i', target.container, 'tar', 'xf', '-', '-C', '/var/lib/tor'], filepath, true);
    this.logger.warn({ project: target.project, stack: target.stack }, 'Tor keys restored — restart that stack’s tor container to serve the restored onion');
  }

  /** Explicit bucket and stack; an omitted scope is accepted only for one unambiguous legacy target. */
  async createStorageBackup(scope?: { project: string; stack: string }, bucket = 'storage'): Promise<BackupRecord> {
    return this.trackOperation(() => this.captureStorageBackup(scope, bucket));
  }

  private async captureStorageBackup(scope: { project: string; stack: string } | undefined, bucket: string): Promise<BackupRecord> {
    validateStorageBucket(bucket);
    const target = await this.resolveResource('minio', scope);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(this.backupDir, `storage-objects_${timestamp}_${randomUUID().slice(0, 8)}.tar.gz`);
    this.logger.info({ project: target.project, stack: target.stack, bucket, container: target.container }, 'Backing up storage bucket');
    await backupStorageObjects(this.storageTarget(target, bucket), filepath);
    return this.indexBackupFile('storage-objects', filepath, 'storage-objects', { project: target.project, stack: target.stack }, bucket);
  }

  /**
   * Snapshot the Tor hidden-service keys (the .onion identity).
   *
   * `-C /var/lib/tor .` took the whole data directory, and what dominates that
   * directory is Tor's DIRECTORY CACHE, not key material. Measured on this
   * host: a 29 MiB archive of which `cached-microdescs` was 42.5 MiB
   * uncompressed, `cached-microdescs.new` 16 MiB and
   * `cached-microdesc-consensus` 3.5 MiB — against `hs_ed25519_secret_key`
   * files of 96 bytes each. Forty such archives held 400 MiB, essentially all
   * of it a public consensus any Tor client re-downloads in minutes, on a
   * machine whose disk has filled before and taken the database and the onion
   * with it.
   *
   * The exclusions are Tor's own regenerable state, by name. Everything else
   * is kept, so a hidden-service directory added later is still captured
   * without anyone remembering to update a list.
   */
  async createTorKeysBackup(scope?: { project: string; stack: string }): Promise<BackupRecord> {
    return this.trackOperation(() => this.captureTorKeys(scope));
  }

  private async captureTorKeys(scope?: { project: string; stack: string }): Promise<BackupRecord> {
    const running = await this.resolveResource('tor', scope);
    const container = running.container;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(this.backupDir, `tor-keys_${ts}_${randomUUID().slice(0, 8)}.tar.gz`);
    this.logger.info({ container }, 'Backing up tor hidden-service keys');
    const excludes = TOR_REGENERABLE_STATE.map(g => `--exclude=${g}`);
    await dumpToFile('docker', ['exec', container, 'tar', 'cf', '-', ...excludes, '-C', '/var/lib/tor', '.'], filepath, true);
    return this.indexBackupFile('tor-keys', filepath, 'tor-keys', { project: running.project, stack: running.stack });
  }

  /** Online snapshot of the daemon-state DB (encrypted secrets + backup index). */
  async createSecretsBackup(): Promise<BackupRecord> {
    return this.trackOperation(() => this.captureSecrets());
  }

  private async captureSecrets(): Promise<BackupRecord> {
    const src = path.join(OMNITRON_HOME, 'data/daemon-state.db');
    if (!fs.existsSync(src)) throw new Error('daemon-state.db not found');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(this.backupDir, `daemon-state_${ts}_${randomUUID().slice(0, 8)}.db`);
    // `.backup` is SQLite's online-consistent snapshot — safe while the daemon
    // holds the DB open in WAL mode.
    this.logger.info({}, 'Backing up daemon-state.db (secrets + backup index)');
    await this.execToFile(`sqlite3 "${src}" ".backup '${filepath}'"`, filepath);
    return this.indexBackupFile('daemon-state', filepath, 'daemon-state', 'control-plane');
  }

  /**
   * Full backup: every stack DB + the control-plane DB + minio storage
   * objects + tor keys + daemon-state (secrets). Per-target failures are
   * captured, not fatal.
   */
  async createFullBackup(
    trigger: BackupPassRecord['trigger'] = 'manual',
  ): Promise<Array<{ target: string; ok: boolean; id?: string; size?: number; error?: string }>> {
    return this.trackOperation(() => this.createFullBackupOnce(trigger));
  }

  private async createFullBackupOnce(
    trigger: BackupPassRecord['trigger'] = 'manual',
  ): Promise<Array<{ target: string; ok: boolean; id?: string; size?: number; error?: string }>> {
    const startedAt = new Date();
    const results: Array<BackupPassEntry & { project?: string; stack?: string }> = [];
    for (const r of await this.backUpStackDatabases()) {
      const { database, ...rest } = r;
      results.push({ target: database, ...rest });
    }
    const extras: Array<[string, () => Promise<BackupRecord>, { project: string; stack: string }?]> = [
      // The control plane — the audit log among it. Neither `all` nor `full`
      // took it: its one copy on the master, 2026-09-05T07:39Z, was made by
      // hand. `omnitron-pg` names it whatever the stacks' databases are called.
      [CONTROL_PLANE_DB, () => this.createBackup('omnitron-pg', { compress: true })],
      ['daemon-state', () => this.createSecretsBackup()],
    ];
    for (const resource of this.resourceInstances()) {
      if (resource.infra.getResolvedContainerName('minio')) {
        try {
          const buckets = resource.infra.getMinioBuckets();
          if (!buckets.length) throw new Error('No bucket inventory is declared; use an explicit artifact backup target');
          for (const bucket of buckets) extras.push([`storage-objects/${bucket}`, () => this.createStorageBackup(resource, bucket), resource]);
        } catch (error) {
          results.push({ target: 'storage-objects', project: resource.project, stack: resource.stack,
            ok: false, error: reasonOf(error) });
        }
      }
      if (resource.infra.getResolvedContainerName('tor')) extras.push(['tor-keys', () => this.createTorKeysBackup(resource), resource]);
    }
    for (const [target, fn, scope] of extras) {
      try {
        const info = await fn();
        results.push({ target, ok: true, id: info.id, size: info.size, ...(info.project && info.stack ? { project: info.project, stack: info.stack } : {}) });
      } catch (err) {
        const origin = scope ? { project: scope.project, stack: scope.stack } : {};
        results.push({ target, ok: false, error: (err as Error).message, ...origin });
        this.logger.error({ target, ...origin, error: reasonOf(err) }, 'Backup failed');
      }
    }
    this.finishPass('full', trigger, startedAt, results.map(qualifiedEntry));
    return results;
  }

  /**
   * Close a pass: one summary line at a level that matches what happened, and
   * a persisted record `backup schedules` shows.
   *
   * The summary was always `info` — `createAllBackups complete
   * {"total":6,"ok":5}` for the 06:04Z pass on the master that lost `main`,
   * the same level and message as a pass that lost nothing — and
   * `runScheduledBackup` discarded the results, its `error` reachable only by
   * a throw that a per-entry catch never let happen.
   */
  private finishPass(
    target: string,
    trigger: BackupPassRecord['trigger'],
    startedAt: Date,
    entries: BackupPassEntry[],
  ): BackupPassRecord {
    const attempted = entries.filter((e) => !e.skipped);
    const failures = attempted
      .filter((e) => !e.ok)
      .map((e) => ({ target: e.target, error: (e.error ?? 'failed').slice(0, 500) }));
    const notBackedUp = entries.filter((e) => e.skipped).map((e) => ({ stack: e.target, reason: e.error ?? 'not backed up' }));
    const record: BackupPassRecord = {
      target,
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      outcome: passOutcome(entries),
      ok: attempted.length - failures.length,
      total: attempted.length,
      failures,
      ...(notBackedUp.length > 0 ? { notBackedUp } : {}),
    };
    const summary = { target, trigger, total: record.total, ok: record.ok, outcome: record.outcome };
    const msg = target === 'full' ? 'createFullBackup complete' : target === 'all' ? 'createAllBackups complete' : 'Backup pass complete';
    // Every pass says which running stacks it could not reach. «all» reading
    // as «every stack» is how the test stack went unbacked-up with nothing
    // anywhere saying so.
    if (notBackedUp.length > 0) {
      this.logger.warn(
        { target, notBackedUp: notBackedUp.map((n) => n.stack) },
        `Running stacks this pass could not back up: ${notBackedUp.map((n) => `${n.stack} (${n.reason})`).join('; ')}`,
      );
    }
    if (record.outcome === 'ok') {
      this.logger.info(summary, msg);
    } else if (record.outcome === 'empty') {
      this.logger.warn(summary, `${msg} — nothing was backed up: no database or artefact was found`);
    } else {
      this.logger.error(
        { ...summary, failed: failures.map((f) => f.target) },
        `${msg} — ${failures.length} of ${record.total} failed: ${failures.map((f) => f.target).join(', ')}`,
      );
    }
    try {
      const passes = this.store.kvGetSync<Record<string, BackupPassRecord>>(BackupService.PASSES_KV_KEY) ?? {};
      passes[target] = record;
      this.store.kvSetSync(BackupService.PASSES_KV_KEY, passes);
    } catch (err) {
      this.logger.warn({ target, err: (err as Error).message }, 'Could not record the backup pass');
    }
    return record;
  }

  /** The last recorded pass of every target. */
  private lastPasses(): Record<string, BackupPassRecord> {
    try {
      return this.store.kvGetSync<Record<string, BackupPassRecord>>(BackupService.PASSES_KV_KEY) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * What the schedules are and what each last did — what `backup schedules`
   * prints, and what `backup list` warns from.
   */
  async getStatus(): Promise<BackupStatus> {
    const specs = await this.listSchedules();
    const passes = this.lastPasses();
    const schedules: BackupScheduleStatus[] = Object.entries(specs).map(([target, spec]) => {
      let schedule: string | null = null;
      let error: string | undefined;
      try {
        schedule = describeSchedule(parseSchedule(spec));
      } catch (err) {
        error = (err as Error).message;
      }
      const last = this.lastBackupOf(target);
      return {
        target,
        spec,
        schedule,
        ...(error ? { error } : {}),
        armed: this.schedules.has(target),
        lastPass: passes[target] ?? null,
        lastBackupAt: last === null ? null : new Date(last).toISOString(),
        nextRunAt: this.schedules.get(target)?.nextRunAt ?? null,
      };
    });
    return { schedules, stacks: this.surveyStacks().stacks };
  }

  // ===========================================================================
  // List backups
  // ===========================================================================

  async listBackups(database?: string): Promise<BackupRecord[]> {
    this.migrateLegacyMetaIfPresent();
    const rows = this.store.selectBackupsSync(database);
    const backups: BackupRecord[] = [];
    for (const row of rows) {
      // The .sql.gz bytes still live on disk; if they were deleted
      // externally, drop the row (self-cleaning index) so a stale
      // entry doesn't haunt the listing.
      if (!fs.existsSync(row.path)) {
        try { this.store.deleteBackupSync(row.id); } catch { /* best-effort */ }
        continue;
      }
      const meta = metadataOf(row.metadata);
      const filename = meta.filename ?? path.basename(row.path);
      backups.push({
        id: row.id,
        database: row.app,
        filename,
        size: row.size_bytes,
        createdAt: row.created_at,
        compressed: meta.compressed ?? filename.endsWith('.gz'),
        // Where it came from, when the row recorded it — see `BackupOrigin`.
        ...(meta.project && meta.stack ? { project: meta.project, stack: meta.stack } : {}),
        ...(meta.scope ? { scope: meta.scope } : {}),
        ...(meta.bucket ? { bucket: meta.bucket } : {}),
      });
    }
    return backups;
  }

  // ===========================================================================
  // Restore backup
  // ===========================================================================

  async restoreBackup(backupId: string): Promise<void> {
    return this.trackOperation(() => this.restoreBackupOnce(backupId));
  }

  private async restoreBackupOnce(backupId: string): Promise<void> {
    this.migrateLegacyMetaIfPresent();
    // The full id, or a prefix of it that names one backup — what the CLI
    // prints. An ambiguous prefix is refused with every candidate named.
    const row = resolveBackupId(
      this.store.selectBackupsSync(),
      backupId,
      (r) => `${r.id} (${r.app}, ${formatUtc(r.created_at)})`,
    );
    if (!fs.existsSync(row.path)) throw new Error(`Backup file not found: ${row.path}`);

    const meta = metadataOf(row.metadata);
    const type = meta.type ?? 'postgres';

    this.logger.info({ app: row.app, type, path: row.path }, 'Restoring backup');

    switch (type) {
      case 'storage-objects':
        await this.restoreStorageBackup(row.path, meta);
        break;
      case 'tor-keys':
        await this.restoreTorKeysBackup(row.path, meta);
        break;
      case 'daemon-state':
        throw new Error(
          'Refusing to restore daemon-state.db into a running daemon. Stop the daemon (`omnitron down`), ' +
          `copy ${row.path} to ~/.omnitron/data/daemon-state.db, then start it (\`omnitron up\`).`,
        );
      default: {
        // Postgres — into the database it was TAKEN from. By its name alone
        // that was whichever running stack came first, so a `main` of one
        // stack could be restored over another's.
        const { dbConfig, isDocker, containerName } = this.restoreTargetOf(row.app, meta);
        const compressed = meta.compressed ?? row.path.endsWith('.gz');
        if (isDocker) await this.pgRestoreDocker(containerName, dbConfig, row.path, compressed);
        else await this.pgRestoreLocal(dbConfig, row.path, compressed);
      }
    }

    this.logger.info({ app: row.app, type }, 'Backup restored');
  }

  // ===========================================================================
  // Delete backup
  // ===========================================================================

  async deleteBackup(backupId: string): Promise<void> {
    const backups = await this.listBackups();
    const backup = backups.find((b) => b.id === backupId);
    if (!backup) throw new Error(`Backup '${backupId}' not found`);

    const filepath = path.join(this.backupDir, backup.filename);

    // Drop the SQLite row first so a concurrent listBackups call
    // doesn't return a record whose .sql.gz file is about to be
    // unlinked. Backup-file unlink is best-effort — a missing
    // file just means the operator already removed it.
    this.store.deleteBackupSync(backup.id);
    try { fs.unlinkSync(filepath); } catch { /* ignore */ }
    // And whatever SQLite left beside it. Removing only the named file is how
    // four `daemon-state_*.db-shm/-wal` pairs on the master came to outlive
    // the backups retention had pruned — belonging to nothing, in no listing.
    for (const suffix of SQLITE_SIDECARS) {
      try { fs.unlinkSync(filepath + suffix); } catch { /* none, or not ours */ }
    }

    this.logger.info({ database: backup.database, filename: backup.filename }, 'Backup deleted');
  }

  // ===========================================================================
  // Schedule
  // ===========================================================================

  /**
   * Arm and PERSIST a recurring backup. `database` may be a specific DB name,
   * a "<project>/<stack>/<db>" key, or the special target "all" — which backs
   * up every database of every running stack each tick. Persisted to state_kv
   * so it survives daemon restarts (re-armed via restoreSchedules on boot).
   */
  async setSchedule(database: string, cron: string): Promise<void> {
    // Parse before arming and before persisting: a specification the daemon
    // cannot read must reach the operator as an error now, not as a backup
    // running at a time nobody chose. `parseSchedule` throws rather than
    // defaulting, which is the entire contract.
    const plan = parseSchedule(cron);
    this.armSchedule(database, plan);
    const map = this.store.kvGetSync<Record<string, string>>(BackupService.SCHEDULES_KV_KEY) ?? {};
    map[database] = cron;
    this.store.kvSetSync(BackupService.SCHEDULES_KV_KEY, map);
    this.logger.info({ database, cron, schedule: describeSchedule(plan) }, 'Backup schedule set + persisted');
  }

  /** Cancel + un-persist a schedule. */
  async removeSchedule(database: string): Promise<void> {
    const existing = this.schedules.get(database);
    if (existing) {
      // Order matters: a cron tick already running re-arms itself when it
      // finishes, and it checks this flag to decide not to.
      existing.cancelled = true;
      if (existing.timer) clearTimeout(existing.timer);
    }
    this.schedules.delete(database);
    const map = this.store.kvGetSync<Record<string, string>>(BackupService.SCHEDULES_KV_KEY) ?? {};
    delete map[database];
    this.store.kvSetSync(BackupService.SCHEDULES_KV_KEY, map);
    this.logger.info({ database }, 'Backup schedule removed');
  }

  /** Re-arm every persisted schedule. Called once at daemon start. */
  async restoreSchedules(): Promise<void> {
    const map = this.store.kvGetSync<Record<string, string>>(BackupService.SCHEDULES_KV_KEY) ?? {};
    let n = 0;
    const rejected: string[] = [];
    for (const [database, cron] of Object.entries(map)) {
      // A stored row can be unreadable — written before this was validated,
      // or hand-edited. Neither reaction is obvious, so both are wrong on
      // their own: refusing to boot over one bad backup schedule is out of
      // proportion, and quietly arming a default would put the backup at a
      // time nobody chose, which is what this whole change is about. The row
      // is skipped and named at `error` level; `backup schedules` still lists
      // it, so it stays visible as configured-but-not-running.
      try {
        this.armSchedule(database, parseSchedule(cron), n);
        n++;
        const last = this.lastBackupOf(database);
        this.logger.info(
          {
            database,
            schedule: cron,
            lastBackupAt: last === null ? null : new Date(last).toISOString(),
            nextRunAt: this.schedules.get(database)?.nextRunAt ?? null,
          },
          'Backup schedule armed',
        );
      } catch (err) {
        rejected.push(database);
        this.logger.error(
          { database, cron, error: (err as Error).message },
          'Persisted backup schedule is unreadable — NOT armed; this database is not being backed up'
        );
      }
    }
    if (n > 0) this.logger.info({ count: n }, 'Restored persisted backup schedules');
    if (rejected.length > 0) {
      this.logger.error({ databases: rejected }, 'Backup schedules skipped — fix them with `omnitron backup schedule`');
    }
  }

  async listSchedules(): Promise<Record<string, string>> {
    return this.store.kvGetSync<Record<string, string>>(BackupService.SCHEDULES_KV_KEY) ?? {};
  }

  async getSchedule(database: string): Promise<string | null> {
    return this.schedules.get(database)?.cron ?? (await this.listSchedules())[database] ?? null;
  }

  /**
   * In-memory timer arm (no persistence) — shared by setSchedule/restore.
   *
   * An interval schedule used to be `setInterval(run, intervalMs)` from the
   * moment it was armed — the moment the daemon started — whatever had run
   * before. Measured on the master: 83 daemon starts between 09-20 07:23Z and
   * 09-23, the longest uptime 10 h 51 min, so the `full` daily pass never
   * fired, and its newest `tor-keys`, `storage-objects` and `daemon-state`
   * copies were 3 d 15 h old; the hourly `all` pass left 13 gaps over two
   * hours in 74 h (the longest 5 h 43 min, 18 restarts inside it).
   *
   * Now the first run is due one interval after the target's newest backup
   * in the index — immediately if that is already past, which after days of
   * restarts it is — but never sooner than `FIRST_RUN_GRACE_MS`, and each
   * further schedule armed by the same start one `FIRST_RUN_STAGGER_MS` later
   * (`slot`). Every later run is measured from when the previous one STARTED,
   * so a long pass does not push the cadence back, and passes never overlap.
   */
  private armSchedule(database: string, plan: SchedulePlan, slot = 0): void {
    if (this.quiescing) throw new Error('Backup admission is paused for backend handoff');
    const existing = this.schedules.get(database);
    if (existing) {
      existing.cancelled = true;
      if (existing.timer) clearTimeout(existing.timer);
    }

    const entry: ScheduleEntry = { database, cron: plan.spec, plan };
    this.schedules.set(database, entry);

    const arm = (delay: number): void => {
      if (entry.cancelled) return;
      entry.nextRunAt = new Date(Date.now() + delay).toISOString();
      entry.timer = setTimeout(() => {
        const startedAt = Date.now();
        void this.runExclusive(() => entry.cancelled ? Promise.resolve('empty' as BackupPassOutcome) : this.runScheduledBackup(database)).then((outcome) => {
          if (plan.kind === 'interval') {
            const backedUpSomething = outcome === 'ok' || outcome === 'partial';
            const wait = backedUpSomething ? plan.intervalMs : Math.min(plan.intervalMs, RETRY_AFTER_NOTHING_MS);
            arm(Math.max(0, startedAt + wait - Date.now()));
          } else {
            // Cron occurrences are not evenly spaced — "0 3 * * *" is 23 or
            // 25 hours apart across a DST boundary, and "0 0 1 * *" is 28 to
            // 31 days. Each run computes the next one from the clock rather
            // than adding a fixed interval, so the schedule cannot drift off
            // its stated time.
            arm(nextCronDelay(plan.expression));
          }
        });
      }, delay);
      entry.timer.unref();
    };

    if (plan.kind === 'interval') {
      const last = this.lastBackupOf(database);
      const due = last === null ? 0 : last + plan.intervalMs - Date.now();
      arm(Math.max(due, FIRST_RUN_GRACE_MS + slot * FIRST_RUN_STAGGER_MS));
    } else {
      arm(nextCronDelay(plan.expression));
    }

    this.logger.debug({ database, schedule: describeSchedule(plan), nextRunAt: entry.nextRunAt }, 'Backup schedule armed');
  }

  /**
   * Scheduled passes run one at a time. Two schedules due together — which is
   * what every start after a long gap produces — would otherwise dump the same
   * databases twice, concurrently, on a machine already under load.
   */
  private runExclusive<T>(run: () => Promise<T>): Promise<T> {
    const turn = this.passQueue.then(run, run);
    this.passQueue = turn.catch(() => undefined);
    return turn;
  }

  /**
   * When `target` last produced a backup, by the index — the newest row among
   * the artefacts that target writes: `full` → the ones only it produces;
   * `all` → any stack database; a database → that database. Null when none.
   */
  private lastBackupOf(target: string): number | null {
    let rows: ReturnType<DaemonStateStore['selectBackupsSync']>;
    try {
      rows = this.store.selectBackupsSync();
    } catch {
      return null;
    }
    const fullOnly = new Set<string>(FULL_BACKUP_ARTEFACTS);
    // `<project>/<stack>/<db>` counts that stack's rows, and rows from before
    // the stack was recorded; a bare name counts every row of that name.
    const parts = target.split('/');
    const name = parts[parts.length - 1]!;
    const stackOf = parts.length === 3 ? { project: parts[0], stack: parts[1] } : null;
    let newest: number | null = null;
    for (const row of rows) {
      const meta = metadataOf(row.metadata);
      const counts =
        target === 'full' ? fullOnly.has(row.app)
        : target === 'all'
          ? (meta.type === undefined || meta.type === 'postgres') && meta.scope !== 'control-plane' &&
            !fullOnly.has(row.app) && row.app !== CONTROL_PLANE_DB
        : row.app === name &&
          (!stackOf || !meta.project || (meta.project === stackOf.project && meta.stack === stackOf.stack));
      if (!counts) continue;
      const at = Date.parse(row.created_at);
      if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
    }
    return newest;
  }

  /**
   * One scheduled tick. Extracted so both timer shapes share it, and so a
   * failure is reported the same way from either. Returns how it ended, which
   * decides how soon the next attempt comes.
   */
  private async runScheduledBackup(database: string): Promise<BackupPassOutcome> {
    if (this.quiescing) return 'empty';
    return this.trackOperation(() => this.runScheduledPass(database));
  }

  private async runScheduledPass(database: string): Promise<BackupPassOutcome> {
    let outcome: BackupPassOutcome = 'failed';
    try {
      if (database === 'full') outcome = passOutcome(await this.createFullBackup('schedule'));
      else if (database === 'all') outcome = passOutcome(await this.createAllBackups('schedule'));
      else {
        // A single database is a pass of one, recorded like the others; its
        // failure is caught here rather than thrown past the record.
        const startedAt = new Date();
        let entry: BackupPassEntry;
        try {
          const info = await this.createBackup(database, { compress: true });
          entry = { target: database, ok: true, id: info.id, size: info.size };
        } catch (err) {
          entry = { target: database, ok: false, error: (err as Error).message };
          this.logger.error({ database, error: reasonOf(err) }, 'Backup failed');
        }
        outcome = this.finishPass(database, 'schedule', startedAt, [entry]).outcome;
      }
      await this.pruneOldBackups(database).catch(error => {
        this.logger.error({ database, error: reasonOf(error) }, 'Backup retention failed');
      });
    } catch (err) {
      this.logger.error({ database, error: (err as Error).message }, 'Scheduled backup failed');
    }
    return outcome;
  }

  /**
   * Retention: keep the most recent `keep` backups per database, delete older.
   * Bounds unbounded growth from hourly schedules (~168/week/db otherwise).
   *
   * Per database OF EACH STACK, now that a row says which stack it came from:
   * two stacks' `main` are two histories, and one count across both would
   * keep half of each. A row from before the stack was recorded is pruned as
   * rows always were — once `keep` newer rows of its database name exist —
   * so the history already on disk is bounded exactly as before.
   */
  private async pruneOldBackups(database: string, keep = 48): Promise<void> {
    const rows = await this.listBackups();
    let dbs: string[];
    if (database === 'all' || database === 'full') {
      // Union of what is scheduled and what is ON DISK.
      //
      // The schedule-derived set alone prunes only the databases the current
      // configuration still backs up, so anything dropped from it keeps its
      // history for ever — retention that runs where the producer still runs
      // and nowhere else. Measured on this host: `tor-keys` held 37 files
      // and 343 MiB, none newer than two months, because they are named only
      // in the `full` pass and that pass no longer runs; `storage-objects`
      // held fifteen more.
      //
      // Reading the backup index instead means a sweep bounds everything it
      // finds, including the leftovers of a schedule someone removed.
      const scheduled = [...new Set(this.surveyStacks().databases.map((d) => d.database))];
      dbs = databasesToPrune(scheduled, rows.map((b) => b.database));
    } else {
      dbs = [database.slice(database.lastIndexOf('/') + 1)];
    }
    const newestFirst = (a: BackupRecord, b: BackupRecord): number => b.createdAt.localeCompare(a.createdAt);
    for (const db of dbs) {
      const ofName = rows.filter((r) => r.database === db).sort(newestFirst);
      const byOrigin = new Map<string, BackupRecord[]>();
      for (const r of ofName) {
        const origin = r.project && r.stack ? `${r.project}/${r.stack}` : r.scope === 'control-plane' ? 'control-plane' : '';
        const resource = origin && r.database === 'storage-objects' ? `${origin}/${r.bucket ?? 'storage'}` : origin;
        byOrigin.set(resource, [...(byOrigin.get(resource) ?? []), r]);
      }
      const doomed: BackupRecord[] = [];
      for (const [origin, group] of byOrigin) {
        if (origin === '') {
          // Unrecorded: judged against every row of the name, as before.
          const rank = new Map(ofName.map((r, i) => [r.id, i]));
          doomed.push(...group.filter((r) => (rank.get(r.id) ?? 0) >= keep));
        } else {
          doomed.push(...group.slice(keep));
        }
      }
      for (const old of doomed) {
        try { await this.deleteBackup(old.id); } catch { /* best-effort */ }
      }
    }
  }

  dispose(): void {
    for (const entry of this.schedules.values()) {
      // Flag first: clearing the timer does not stop a cron tick that is
      // already running, and that tick re-arms itself when it finishes.
      // Without the flag a disposed service keeps scheduling backups.
      entry.cancelled = true;
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.schedules.clear();
  }

  // ===========================================================================
  // Private — pg_dump via Docker
  // ===========================================================================

  private async pgDumpDocker(
    container: string,
    config: DbConfig,
    outputPath: string,
    compress: boolean
  ): Promise<void> {
    await dumpToFile(
      'docker',
      ['exec', container, 'pg_dump', '-U', config.user, '-d', config.database],
      outputPath,
      compress
    );
  }

  private async pgRestoreDocker(
    container: string,
    config: DbConfig,
    inputPath: string,
    compressed: boolean
  ): Promise<void> {
    await restoreFromFile(
      'docker',
      ['exec', '-i', container, 'psql', '-U', config.user, '-d', config.database],
      inputPath,
      compressed
    );
  }

  // ===========================================================================
  // Private — pg_dump local
  // ===========================================================================

  private async pgDumpLocal(config: DbConfig, outputPath: string, compress: boolean): Promise<void> {
    // The uncompressed path used to buffer the whole dump in memory with a
    // 100 MB ceiling, which an ordinary database exceeds. Both paths stream.
    await dumpToFile(
      'pg_dump',
      ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', config.database],
      outputPath,
      compress,
      { env: { ...process.env, PGPASSWORD: config.password } }
    );
  }

  private async pgRestoreLocal(config: DbConfig, inputPath: string, compressed: boolean): Promise<void> {
    await restoreFromFile(
      'psql',
      ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', config.database],
      inputPath,
      compressed,
      { env: { ...process.env, PGPASSWORD: config.password } }
    );
  }

  // ===========================================================================
  // Private — helpers
  // ===========================================================================

  /**
   * The database a backup target names, resolved LIVE from the running
   * stacks' real infrastructure (container, credentials, DB list):
   *
   *   `<project>/<stack>/<db>`  that database of that stack;
   *   `omnitron-pg`             the control plane, always;
   *   a bare name               the one running stack that has it — and a
   *                             refusal naming every candidate when more than
   *                             one does. It was "first stack wins", which
   *                             dumps, and restores into, whichever stack the
   *                             iteration happened to reach first;
   *   `omnitron`                the control plane, when no stack has one.
   */
  private resolveDbTarget(database: string): ResolvedDb {
    const { databases } = this.surveyStacks();
    const keyOf = (d: StackDbResolution): string => `${d.project}/${d.stack}/${d.database}`;
    const fromStack = (d: StackDbResolution): ResolvedDb => ({
      dbConfig: { host: d.host, port: d.port, user: d.user, password: d.password, database: d.database },
      isDocker: !!d.container,
      containerName: d.container ?? '',
      origin: { project: d.project, stack: d.stack },
    });

    const exact = databases.find((d) => keyOf(d) === database);
    if (exact) return fromStack(exact);
    if (database === 'omnitron-pg') return this.controlPlaneTarget();

    const named = databases.filter((d) => d.database === database);
    if (named.length === 1) return fromStack(named[0]!);
    if (named.length > 1) {
      throw new Error(
        `'${database}' is a database of ${named.length} running stacks — name one: ${named.map(keyOf).join(', ')}`,
      );
    }
    if (database === CONTROL_PLANE_DB) return this.controlPlaneTarget();

    // Unknown — fail loudly rather than silently dumping the wrong DB (the
    // pre-fix behaviour that made `backup create main` hit the wrong database
    // entirely).
    const known = [...new Set(databases.map((d) => d.database))];
    throw new Error(
      `Unknown backup target '${database}'. Known databases: ${known.length ? known.join(', ') : '(no running stack)'}, omnitron`,
    );
  }

  /**
   * The control-plane database, from the resolver the daemon itself connects
   * with rather than a second copy of its credentials — `localhost:5480`,
   * `omnitron`/`omnitron` were written out here by hand. Dumped through the
   * `omnitron-pg` container unless OMNITRON_DATABASE_URL points elsewhere.
   */
  private controlPlaneTarget(): ResolvedDb {
    const pg = resolveOmnitronPgConfig();
    const elsewhere = !!getEnv().OMNITRON_DATABASE_URL;
    return {
      dbConfig: { host: pg.host, port: pg.port, user: pg.user, password: pg.password, database: pg.database },
      isDocker: !elsewhere,
      containerName: elsewhere ? '' : 'omnitron-pg',
      origin: 'control-plane',
    };
  }

  /** Where a backup being restored goes: where it was taken from. */
  private restoreTargetOf(app: string, meta: BackupMetadata): ResolvedDb {
    if (meta.scope === 'control-plane') return this.controlPlaneTarget();
    if (meta.project && meta.stack) {
      const key = `${meta.project}/${meta.stack}/${app}`;
      if (this.surveyStacks().databases.some((d) => `${d.project}/${d.stack}/${d.database}` === key)) {
        return this.resolveDbTarget(key);
      }
      throw new Error(
        `This backup of '${app}' was taken from ${meta.project}/${meta.stack}, ` +
          `which has no running database '${app}' on this host — refusing to restore it anywhere else`,
      );
    }
    // Taken before the stack was recorded: the one running stack that has a
    // database of this name, or a refusal naming them all.
    return this.resolveDbTarget(app);
  }

  /**
   * Every running stack, and every database of it this host can reach — from
   * the provisioned InfrastructureService, so the backup set is always in
   * lock-step with what omnitron provisioned.
   *
   * A stack whose infrastructure is not on this host used to be skipped with
   * `if (!infra) continue`, and nothing else ever mentioned it. On the master
   * that is sample/test, whose database container runs on 37.27.130.185: every
   * `all` pass was `{"total":6}` — sample/dev's six — while `backup list`
   * printed «Found 380 backup(s)» and `backup schedules` «all hourly».
   * Remote stacks are still not dumped from here; they are now named.
   */
  private surveyStacks(): { databases: StackDbResolution[]; stacks: BackupStackCoverage[] } {
    const databases: StackDbResolution[] = [];
    const stacks: BackupStackCoverage[] = [];
    const projects = this.projects;
    if (!projects) return { databases, stacks };
    try {
      const infraManager = projects.getInfraManager();
      for (const p of projects.listProjectRegistrations()) {
        let running: string[] = [];
        try { running = projects.getRunningStacks(p.name); } catch { continue; }
        running = [...new Set([...running, ...this.resourceInstances().filter(item => item.project === p.name).map(item => item.stack)])];
        for (const stack of running) {
          const infra = infraManager.getInstance(p.name, stack);
          if (!infra) {
            stacks.push({ project: p.name, stack, databases: [], notBackedUp: this.whyNotHere(p.name, stack) });
            continue;
          }
          const conn = infra.getConnectionInfo('postgres') as
            | { host?: string; port?: number; user?: string; password?: string }
            | null;
          if (!conn) {
            // No postgres in this stack: nothing to dump, and nothing missed.
            stacks.push({ project: p.name, stack, databases: [] });
            continue;
          }
          const container = infra.getResolvedContainerName('postgres') ?? undefined;
          const names = infra.getPostgresDatabases();
          for (const db of names) {
            databases.push({
              container,
              host: String(conn.host ?? 'localhost'),
              port: Number(conn.port ?? 5432),
              user: String(conn.user ?? 'postgres'),
              password: String(conn.password ?? 'postgres'),
              database: db,
              project: p.name,
              stack,
            });
          }
          stacks.push({ project: p.name, stack, databases: [...names] });
        }
      }
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Failed to resolve stack DB topology for backup');
    }
    return { databases, stacks };
  }

  /** Why a running stack's databases cannot be reached from this host. */
  private whyNotHere(project: string, stack: string): string {
    try {
      const info = this.projects!.getStack(project, stack);
      if (info.type === 'local') return 'its infrastructure is not provisioned on this host';
      const hosts = [...new Set((info.nodes ?? []).map((n) => n.host).filter(Boolean))];
      if (hosts.length > 0) return `its databases are on ${hosts.join(', ')}`;
    } catch { /* its configuration is not loaded — say what is known */ }
    return 'its infrastructure is not on this host';
  }

  /**
   * Back up every database of every running stack. A single DB failure is
   * captured per-entry and does not abort the rest. Returns per-DB results,
   * and — marked `skipped` — every running stack it could not reach.
   */
  async createAllBackups(
    trigger: BackupPassRecord['trigger'] = 'manual',
  ): Promise<Array<{ database: string; ok: boolean; id?: string; size?: number; error?: string }>> {
    return this.trackOperation(() => this.createAllBackupsOnce(trigger));
  }

  private async createAllBackupsOnce(
    trigger: BackupPassRecord['trigger'] = 'manual',
  ): Promise<Array<{ database: string; ok: boolean; id?: string; size?: number; error?: string }>> {
    const startedAt = new Date();
    const results = await this.backUpStackDatabases();
    this.finishPass('all', trigger, startedAt, results.map(({ database, ...rest }) => qualifiedEntry({ target: database, ...rest })));
    return results;
  }

  /**
   * The database half of `all` and `full`, stack by stack. Each failure is
   * logged where it happens, with the database and its reason: the 06:04Z
   * pass on the master lost `main` to the 600 s dump timeout, and the only
   * trace was a database missing from the next listing.
   *
   * Every database of every stack, by its `<project>/<stack>/<db>` key: by
   * bare name, a second stack's `main` was never dumped at all.
   */
  private async backUpStackDatabases(): Promise<
    Array<{ database: string; project?: string; stack?: string; ok: boolean; skipped?: boolean; id?: string; size?: number; error?: string }>
  > {
    const { databases, stacks } = this.surveyStacks();
    const results: Array<{
      database: string; project?: string; stack?: string; ok: boolean; skipped?: boolean; id?: string; size?: number; error?: string;
    }> = [];
    for (const d of databases) {
      const where = { project: d.project, stack: d.stack };
      try {
        const info = await this.createBackup(`${d.project}/${d.stack}/${d.database}`, { compress: true });
        results.push({ database: d.database, ...where, ok: true, id: info.id, size: info.size });
      } catch (err) {
        results.push({ database: d.database, ...where, ok: false, error: (err as Error).message });
        this.logger.error({ database: d.database, ...where, error: reasonOf(err) }, 'Backup failed');
      }
    }
    // The stacks nothing here reaches, in the results as well: a caller that
    // counts `ok` has to see that «all» did not mean every stack.
    for (const s of stacks) {
      if (!s.notBackedUp) continue;
      results.push({
        database: `${s.project}/${s.stack}`,
        project: s.project,
        stack: s.stack,
        ok: false,
        skipped: true,
        error: `not backed up — ${s.notBackedUp}`,
      });
    }
    return results;
  }

}

/** A database a backup target resolved to, and where a row of it will say it came from. */
interface ResolvedDb {
  dbConfig: DbConfig;
  isDocker: boolean;
  containerName: string;
  origin: BackupOrigin;
}

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Minimal shape of InfrastructureService used by the backup service. */
interface InfraLike {
  getConnectionInfo(service: string): Record<string, unknown> | null;
  getResolvedContainerName(service: string): string | null;
  getPostgresDatabases(): string[];
  getMinioBuckets(): string[];
}

/** A stack database resolved to its real, provisioned connection. */
interface StackDbResolution {
  /** Docker container to `docker exec` into (undefined ⇒ local pg_dump). */
  container: string | undefined;
  host: string;
  port: number;
  user: string;
  password: string;
  /** Actual database name inside the server. */
  database: string;
  project: string;
  stack: string;
}
