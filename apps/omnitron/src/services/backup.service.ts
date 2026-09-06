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
import { Injectable, Inject, Optional } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { DAEMON_STATE_STORE_TOKEN, PROJECT_SERVICE_TOKEN } from '../shared/tokens.js';
import { expandPath } from '../shared/paths.js';
import { dumpToFile, restoreFromFile } from './backup-pipeline.js';
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
} from '../shared/dto/backups.js';

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
   * `setInterval` for the interval forms, `setTimeout` for cron (each run
   * arms the next one, because cron occurrences are not evenly spaced).
   * `clearTimeout` and `clearInterval` are interchangeable in Node, so a
   * single field and a single cancel path are enough.
   */
  timer?: NodeJS.Timeout;
  /** Set once a cron schedule has been cancelled, so an in-flight tick stops. */
  cancelled?: boolean;
}



/**
 * Non-database artefacts that only a `full` pass produces, and therefore
 * only a `full` pass used to prune.
 */
const FULL_BACKUP_ARTEFACTS = ['storage-objects', 'tor-keys', 'daemon-state'] as const;

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
  private readonly backupDir: string;
  private readonly logger: ILogger;
  private schedules = new Map<string, ScheduleEntry>();
  /**
   * True once the legacy .meta.json scan + import has run for this
   * process. Subsequent list/restore calls skip the directory walk.
   */
  private legacyMigrated = false;

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
    this.backupDir = expandPath('~/.omnitron/backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  /**
   * Lazy one-shot import of legacy .meta.json side-cars into the
   * SQLite `backups` table. Idempotent — flag-guarded so multiple
   * concurrent listBackups() calls don't double-import. After this
   * runs the .meta.json files are unlinked (the SQLite row is
   * authoritative).
   */
  private migrateLegacyMetaIfPresent(): void {
    if (this.legacyMigrated) return;
    this.legacyMigrated = true;
    try {
      const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.meta.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.backupDir, file), 'utf-8');
          const info = JSON.parse(content) as BackupInfo;
          const backupFile = path.join(this.backupDir, info.filename);
          if (!fs.existsSync(backupFile)) continue;
          const stats = fs.statSync(backupFile);
          // upsert isn't available; insert is — but the migration
          // can run multiple times across crashes, so swallow
          // duplicate-id errors (better-sqlite3 throws on UNIQUE).
          try {
            this.store.insertBackupSync({
              id: info.id,
              app: info.database,
              path: backupFile,
              size_bytes: stats.size,
              created_at: info.createdAt,
              metadata: { filename: info.filename, compressed: info.compressed },
            });
          } catch {
            // Already imported — skip.
          }
          try { fs.unlinkSync(path.join(this.backupDir, file)); } catch { /* */ }
        } catch (err) {
          this.logger.warn({ file, err: (err as Error).message }, 'Backup metadata migration: skipping corrupt entry');
        }
      }
    } catch {
      // backup dir doesn't exist or unreadable — nothing to migrate.
    }
  }

  // ===========================================================================
  // Create backup
  // ===========================================================================

  async createBackup(database: string, options?: { compress?: boolean }): Promise<BackupInfo> {
    const compress = options?.compress !== false;
    const id = randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = compress ? '.sql.gz' : '.sql';
    const filename = `${database}_${timestamp}_${id.slice(0, 8)}${ext}`;
    const filepath = path.join(this.backupDir, filename);

    this.logger.info({ database, filename, compress }, 'Creating backup');

    const { dbConfig, isDocker, containerName } = this.resolveDbConfig(database);

    try {
      if (isDocker) {
        await this.pgDumpDocker(containerName, dbConfig, filepath, compress);
      } else {
        await this.pgDumpLocal(dbConfig, filepath, compress);
      }

      const stats = fs.statSync(filepath);

      const info: BackupInfo = {
        id,
        database,
        filename,
        size: stats.size,
        createdAt: new Date().toISOString(),
        compressed: compress,
      };

      // Persist metadata transactionally to SQLite. Pre-T-7 this
      // was a side-car .meta.json fs.writeFileSync — torn-write
      // risk if the daemon was SIGKILL'd between the dump and the
      // meta write.
      this.store.insertBackupSync({
        id: info.id,
        app: info.database,
        path: filepath,
        size_bytes: stats.size,
        created_at: info.createdAt,
        metadata: { filename: info.filename, compressed: info.compressed },
      });

      this.logger.info({ database, filename, size: stats.size }, 'Backup created');
      return info;
    } catch (err) {
      // Cleanup failed backup
      try { fs.unlinkSync(filepath); } catch { /* ignore */ }
      throw new Error(`Backup failed for '${database}': ${(err as Error).message}`, { cause: err });
    }
  }

  // ===========================================================================
  // Non-DB backup targets: storage objects, tor keys, daemon-state (secrets)
  // ===========================================================================

  /** First running stack's provisioned InfrastructureService (for minio/tor). */
  private getRunningInfra(): { infra: InfraLike; project: string; stack: string } | null {
    const projects = this.projects;
    if (!projects) return null;
    try {
      const mgr = projects.getInfraManager();
      for (const p of projects.listProjects()) {
        let stacks: string[] = [];
        try { stacks = projects.getRunningStacks(p.name); } catch { continue; }
        for (const stack of stacks) {
          const infra = mgr.getInstance(p.name, stack) as unknown as InfraLike | null;
          if (infra) return { infra, project: p.name, stack };
        }
      }
    } catch { /* no running stack */ }
    return null;
  }

  /** Index a already-written backup file into the SQLite backups table. */
  private indexBackupFile(app: string, filepath: string, type: string): BackupInfo {
    const stats = fs.statSync(filepath);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const filename = path.basename(filepath);
    this.store.insertBackupSync({
      id, app, path: filepath, size_bytes: stats.size, created_at: createdAt,
      metadata: { filename, compressed: filename.endsWith('.gz'), type },
    });
    return { id, database: app, filename, size: stats.size, createdAt, compressed: filename.endsWith('.gz') };
  }

  private async execShell(cmd: string, timeoutMs = 600_000): Promise<void> {
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile('/bin/sh', ['-c', cmd], { timeout: timeoutMs, maxBuffer: 200 * 1024 * 1024 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  private async execToFile(cmd: string, outputPath: string, timeoutMs = 600_000): Promise<void> {
    try {
      await this.execShell(cmd, timeoutMs);
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error('backup produced an empty file');
      }
    } catch (err) {
      // The empty-file check was already here and works — it kept these out
      // of the index. What it did not do was clean up: 22 zero-byte
      // `tor-keys` files had accumulated in the backup directory, on disk but
      // in no listing, which is the worst place for a file to be.
      fs.rmSync(outputPath, { force: true });
      throw err;
    }
  }

  private async restoreStorageBackup(filepath: string): Promise<void> {
    const running = this.getRunningInfra();
    const conn = running?.infra.getConnectionInfo('minio') as { accessKey?: string; secretKey?: string } | null;
    const container = running?.infra.getResolvedContainerName('minio');
    if (!running || !conn || !container) throw new Error('minio not found in any running stack');
    const ak = conn.accessKey ?? 'minioadmin';
    const sk = conn.secretKey ?? 'minioadmin';
    const stage = path.join(this.backupDir, `.storage-restore-${randomUUID().slice(0, 8)}`);
    // Untar on the host, docker cp into the container, then mirror back into the
    // bucket (minio has no tar, so staging happens host-side).
    const inner = `mc alias set _bk http://localhost:9000 ${ak} ${sk} >/dev/null 2>&1; ` +
      `mc mb --ignore-existing _bk/storage >/dev/null 2>&1; ` +
      `mc mirror --overwrite --quiet /tmp/_bk_storage _bk/storage >/dev/null 2>&1; true`;
    try {
      await this.execShell(
        `rm -rf "${stage}" && mkdir -p "${stage}" && tar xzf "${filepath}" -C "${stage}" && ` +
        `docker exec ${container} rm -rf /tmp/_bk_storage && docker cp "${stage}/_bk_storage" ${container}:/tmp/_bk_storage && ` +
        `docker exec ${container} sh -c '${inner}'`,
      );
    } finally {
      await this.execShell(`rm -rf "${stage}"`).catch(() => { /* best-effort */ });
    }
  }

  private async restoreTorKeysBackup(filepath: string): Promise<void> {
    const container = this.getRunningInfra()?.infra.getResolvedContainerName('tor');
    if (!container) throw new Error('tor not found in any running stack');
    await this.execShell(`docker exec -i ${container} sh -c 'tar xzf - -C /var/lib/tor' < "${filepath}"`);
    this.logger.warn({}, 'Tor keys restored — restart the tor container to serve the restored onion');
  }

  /** Object-level backup of the minio `storage` bucket (mc mirror → tar.gz). */
  async createStorageBackup(): Promise<BackupInfo> {
    const running = this.getRunningInfra();
    const conn = running?.infra.getConnectionInfo('minio') as
      | { accessKey?: string; secretKey?: string } | null;
    const container = running?.infra.getResolvedContainerName('minio');
    if (!running || !conn || !container) throw new Error('minio not found in any running stack');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(this.backupDir, `storage-objects_${ts}_${randomUUID().slice(0, 8)}.tar.gz`);
    const stage = path.join(this.backupDir, `.storage-stage-${randomUUID().slice(0, 8)}`);
    const ak = conn.accessKey ?? 'minioadmin';
    const sk = conn.secretKey ?? 'minioadmin';
    // mc is bundled in the minio image (tar is NOT): mirror the bucket into a
    // container temp dir, `docker cp` it to the host, then tar on the host.
    // Object-level (not raw volume) so it survives minio storage-format changes.
    const inner = `mc alias set _bk http://localhost:9000 ${ak} ${sk} >/dev/null 2>&1; ` +
      `mc mb --ignore-existing _bk/storage >/dev/null 2>&1; ` +
      `rm -rf /tmp/_bk_storage && mkdir -p /tmp/_bk_storage && ` +
      `mc mirror --overwrite --quiet _bk/storage /tmp/_bk_storage >/dev/null 2>&1; true`;
    this.logger.info({ container }, 'Backing up minio storage bucket');
    try {
      await this.execShell(`docker exec ${container} sh -c '${inner}'`);
      await this.execToFile(
        `rm -rf "${stage}" && mkdir -p "${stage}" && docker cp ${container}:/tmp/_bk_storage "${stage}/" && ` +
        `tar czf "${filepath}" -C "${stage}" _bk_storage`,
        filepath,
      );
    } finally {
      await this.execShell(`rm -rf "${stage}"`).catch(() => { /* best-effort */ });
    }
    return this.indexBackupFile('storage-objects', filepath, 'storage-objects');
  }

  /** Snapshot the Tor hidden-service keys (the .onion identity). */
  async createTorKeysBackup(): Promise<BackupInfo> {
    const running = this.getRunningInfra();
    const container = running?.infra.getResolvedContainerName('tor');
    if (!container) throw new Error('tor not found in any running stack');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(this.backupDir, `tor-keys_${ts}_${randomUUID().slice(0, 8)}.tar.gz`);
    this.logger.info({ container }, 'Backing up tor hidden-service keys');
    await this.execToFile(`docker exec ${container} tar czf - -C /var/lib/tor . > "${filepath}"`, filepath);
    return this.indexBackupFile('tor-keys', filepath, 'tor-keys');
  }

  /** Online snapshot of the daemon-state DB (encrypted secrets + backup index). */
  async createSecretsBackup(): Promise<BackupInfo> {
    const src = expandPath('~/.omnitron/data/daemon-state.db');
    if (!fs.existsSync(src)) throw new Error('daemon-state.db not found');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(this.backupDir, `daemon-state_${ts}_${randomUUID().slice(0, 8)}.db`);
    // `.backup` is SQLite's online-consistent snapshot — safe while the daemon
    // holds the DB open in WAL mode.
    this.logger.info({}, 'Backing up daemon-state.db (secrets + backup index)');
    await this.execToFile(`sqlite3 "${src}" ".backup '${filepath}'"`, filepath);
    return this.indexBackupFile('daemon-state', filepath, 'daemon-state');
  }

  /**
   * Full backup: every stack DB + minio storage objects + tor keys +
   * daemon-state (secrets). Per-target failures are captured, not fatal.
   */
  async createFullBackup(): Promise<Array<{ target: string; ok: boolean; id?: string; size?: number; error?: string }>> {
    const results: Array<{ target: string; ok: boolean; id?: string; size?: number; error?: string }> = [];
    for (const r of await this.createAllBackups()) {
      const { database, ...rest } = r;
      results.push({ target: database, ...rest });
    }
    const extras: Array<[string, () => Promise<BackupInfo>]> = [
      ['storage-objects', () => this.createStorageBackup()],
      ['tor-keys', () => this.createTorKeysBackup()],
      ['daemon-state', () => this.createSecretsBackup()],
    ];
    for (const [target, fn] of extras) {
      try {
        const info = await fn();
        results.push({ target, ok: true, id: info.id, size: info.size });
      } catch (err) {
        results.push({ target, ok: false, error: (err as Error).message });
      }
    }
    this.logger.info({ total: results.length, ok: results.filter((r) => r.ok).length }, 'createFullBackup complete');
    return results;
  }

  // ===========================================================================
  // List backups
  // ===========================================================================

  async listBackups(database?: string): Promise<BackupInfo[]> {
    this.migrateLegacyMetaIfPresent();
    const rows = this.store.selectBackupsSync(database);
    const backups: BackupInfo[] = [];
    for (const row of rows) {
      // The .sql.gz bytes still live on disk; if they were deleted
      // externally, drop the row (self-cleaning index) so a stale
      // entry doesn't haunt the listing.
      if (!fs.existsSync(row.path)) {
        try { this.store.deleteBackupSync(row.id); } catch { /* best-effort */ }
        continue;
      }
      let meta: { filename?: string; compressed?: boolean } = {};
      if (row.metadata) {
        try { meta = JSON.parse(row.metadata); } catch { /* */ }
      }
      const filename = meta.filename ?? path.basename(row.path);
      backups.push({
        id: row.id,
        database: row.app,
        filename,
        size: row.size_bytes,
        createdAt: row.created_at,
        compressed: meta.compressed ?? filename.endsWith('.gz'),
      });
    }
    return backups;
  }

  // ===========================================================================
  // Restore backup
  // ===========================================================================

  async restoreBackup(backupId: string): Promise<void> {
    this.migrateLegacyMetaIfPresent();
    const row = this.store.selectBackupsSync().find((r) => r.id === backupId);
    if (!row) throw new Error(`Backup '${backupId}' not found`);
    if (!fs.existsSync(row.path)) throw new Error(`Backup file not found: ${row.path}`);

    let meta: { type?: string; compressed?: boolean } = {};
    if (row.metadata) { try { meta = JSON.parse(row.metadata); } catch { /* */ } }
    const type = meta.type ?? 'postgres';

    this.logger.info({ app: row.app, type, path: row.path }, 'Restoring backup');

    switch (type) {
      case 'storage-objects':
        await this.restoreStorageBackup(row.path);
        break;
      case 'tor-keys':
        await this.restoreTorKeysBackup(row.path);
        break;
      case 'daemon-state':
        throw new Error(
          'Refusing to restore daemon-state.db into a running daemon. Stop the daemon (`omnitron down`), ' +
          `copy ${row.path} to ~/.omnitron/data/daemon-state.db, then start it (\`omnitron up\`).`,
        );
      default: {
        // Postgres — resolve the live target and pg_restore.
        const { dbConfig, isDocker, containerName } = this.resolveDbConfig(row.app);
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
        this.armSchedule(database, parseSchedule(cron));
        n++;
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

  /** In-memory timer arm (no persistence) — shared by setSchedule/restore. */
  private armSchedule(database: string, plan: SchedulePlan): void {
    const existing = this.schedules.get(database);
    if (existing) {
      existing.cancelled = true;
      if (existing.timer) clearTimeout(existing.timer);
    }

    const entry: ScheduleEntry = { database, cron: plan.spec, plan };
    this.schedules.set(database, entry);

    if (plan.kind === 'interval') {
      entry.timer = setInterval(() => void this.runScheduledBackup(database), plan.intervalMs);
      entry.timer.unref();
    } else {
      // Cron occurrences are not evenly spaced — "0 3 * * *" is 23 or 25
      // hours apart across a DST boundary, and "0 0 1 * *" is 28 to 31 days.
      // Each run computes the next one from the clock rather than adding a
      // fixed interval, so the schedule cannot drift off its stated time.
      const armNext = (): void => {
        if (entry.cancelled) return;
        const delay = nextCronDelay(plan.expression);
        entry.timer = setTimeout(() => {
          void this.runScheduledBackup(database).finally(armNext);
        }, delay);
        entry.timer.unref();
      };
      armNext();
    }

    this.logger.debug({ database, schedule: describeSchedule(plan) }, 'Backup schedule armed');
  }

  /**
   * One scheduled tick. Extracted so both timer shapes share it, and so a
   * failure is reported the same way from either.
   */
  private async runScheduledBackup(database: string): Promise<void> {
    try {
      if (database === 'full') await this.createFullBackup();
      else if (database === 'all') await this.createAllBackups();
      else await this.createBackup(database, { compress: true });
      await this.pruneOldBackups(database).catch(() => { /* best-effort */ });
    } catch (err) {
      this.logger.error({ database, error: (err as Error).message }, 'Scheduled backup failed');
    }
  }

  /**
   * Retention: keep the most recent `keep` backups per database, delete older.
   * Bounds unbounded growth from hourly schedules (~168/week/db otherwise).
   */
  private async pruneOldBackups(database: string, keep = 48): Promise<void> {
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
      const scheduled = [...this.buildStackDbMap().keys()].filter((k) => !k.includes('/'));
      const onDisk = (await this.listBackups()).map((b) => b.database);
      dbs = databasesToPrune(scheduled, onDisk);
    } else {
      dbs = [database];
    }
    for (const db of dbs) {
      const backups = (await this.listBackups(db)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const old of backups.slice(keep)) {
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

  private resolveDbConfig(database: string): { dbConfig: DbConfig; isDocker: boolean; containerName: string } {
    // 1. Stack databases — resolved LIVE from the running stacks' real
    //    infrastructure (container, credentials, DB list) via ProjectService.
    //    This is the primary path for project/app databases (main, storage,
    //    priceverse, paysys, messaging, geo, …). Accepts either the bare DB
    //    name ("main") or a fully-qualified "<project>/<stack>/<db>" key.
    const stackMap = this.buildStackDbMap();
    const stackEntry = stackMap.get(database);
    if (stackEntry) {
      return {
        dbConfig: {
          host: stackEntry.host,
          port: stackEntry.port,
          user: stackEntry.user,
          password: stackEntry.password,
          database: stackEntry.database,
        },
        isDocker: !!stackEntry.container,
        containerName: stackEntry.container ?? '',
      };
    }

    // 2. Omnitron's own control-plane database (daemon state DB).
    if (database === 'omnitron' || database === 'omnitron-pg') {
      return {
        dbConfig: { host: 'localhost', port: 5480, user: 'omnitron', password: 'omnitron', database: 'omnitron' },
        isDocker: true,
        containerName: 'omnitron-pg',
      };
    }

    // 3. Unknown — fail loudly rather than silently dumping the wrong DB
    //    (the pre-fix behaviour that made `backup create main` hit the wrong
    //    database entirely).
    const known = [...new Set([...stackMap.keys()].filter((k) => !k.includes('/')))];
    throw new Error(
      `Unknown backup target '${database}'. Known databases: ${known.length ? known.join(', ') : '(no running stack)'}, omnitron`,
    );
  }

  /**
   * Resolve every database of every running stack to its real connection
   * (container, credentials) straight from the provisioned InfrastructureService
   * — so the backup set is always in lock-step with what omnitron provisioned.
   * Registers both the bare DB name and a "<project>/<stack>/<db>" key.
   */
  private buildStackDbMap(): Map<string, StackDbResolution> {
    const map = new Map<string, StackDbResolution>();
    const projects = this.projects;
    if (!projects) return map;
    try {
      const infraManager = projects.getInfraManager();
      for (const p of projects.listProjects()) {
        let stacks: string[] = [];
        try { stacks = projects.getRunningStacks(p.name); } catch { continue; }
        for (const stack of stacks) {
          const infra = infraManager.getInstance(p.name, stack);
          if (!infra) continue;
          const conn = infra.getConnectionInfo('postgres') as
            | { host?: string; port?: number; user?: string; password?: string }
            | null;
          if (!conn) continue;
          const container = infra.getResolvedContainerName('postgres') ?? undefined;
          for (const db of infra.getPostgresDatabases()) {
            const res: StackDbResolution = {
              container,
              host: String(conn.host ?? 'localhost'),
              port: Number(conn.port ?? 5432),
              user: String(conn.user ?? 'postgres'),
              password: String(conn.password ?? 'postgres'),
              database: db,
              project: p.name,
              stack,
            };
            if (!map.has(db)) map.set(db, res); // bare name: first stack wins
            map.set(`${p.name}/${stack}/${db}`, res); // fully-qualified: unambiguous
          }
        }
      }
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Failed to resolve stack DB topology for backup');
    }
    return map;
  }

  /**
   * Back up every database of every running stack. A single DB failure is
   * captured per-entry and does not abort the rest. Returns per-DB results.
   */
  async createAllBackups(): Promise<Array<{ database: string; ok: boolean; id?: string; size?: number; error?: string }>> {
    const bareNames = [...new Set([...this.buildStackDbMap().keys()].filter((k) => !k.includes('/')))];
    const results: Array<{ database: string; ok: boolean; id?: string; size?: number; error?: string }> = [];
    for (const db of bareNames) {
      try {
        const info = await this.createBackup(db, { compress: true });
        results.push({ database: db, ok: true, id: info.id, size: info.size });
      } catch (err) {
        results.push({ database: db, ok: false, error: (err as Error).message });
      }
    }
    this.logger.info({ total: results.length, ok: results.filter((r) => r.ok).length }, 'createAllBackups complete');
    return results;
  }

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
