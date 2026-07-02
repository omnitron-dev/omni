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
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { ProjectService } from './project.service.js';

// =============================================================================
// Types
// =============================================================================

export interface BackupInfo {
  id: string;
  database: string;
  filename: string;
  size: number;
  createdAt: string;
  compressed: boolean;
}

interface ScheduleEntry {
  database: string;
  cron: string;
  timer?: NodeJS.Timeout;
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
    const backups = await this.listBackups();
    const backup = backups.find((b) => b.id === backupId);
    if (!backup) throw new Error(`Backup '${backupId}' not found`);

    const filepath = path.join(this.backupDir, backup.filename);
    if (!fs.existsSync(filepath)) throw new Error(`Backup file not found: ${backup.filename}`);

    this.logger.info({ database: backup.database, filename: backup.filename }, 'Restoring backup');

    const { dbConfig, isDocker, containerName } = this.resolveDbConfig(backup.database);

    if (isDocker) {
      await this.pgRestoreDocker(containerName, dbConfig, filepath, backup.compressed);
    } else {
      await this.pgRestoreLocal(dbConfig, filepath, backup.compressed);
    }

    this.logger.info({ database: backup.database }, 'Backup restored');
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
    this.armSchedule(database, cron);
    const map = this.store.kvGetSync<Record<string, string>>(BackupService.SCHEDULES_KV_KEY) ?? {};
    map[database] = cron;
    this.store.kvSetSync(BackupService.SCHEDULES_KV_KEY, map);
    this.logger.info({ database, cron }, 'Backup schedule set + persisted');
  }

  /** Cancel + un-persist a schedule. */
  async removeSchedule(database: string): Promise<void> {
    const existing = this.schedules.get(database);
    if (existing?.timer) clearInterval(existing.timer);
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
    for (const [database, cron] of Object.entries(map)) {
      this.armSchedule(database, cron);
      n++;
    }
    if (n > 0) this.logger.info({ count: n }, 'Restored persisted backup schedules');
  }

  async listSchedules(): Promise<Record<string, string>> {
    return this.store.kvGetSync<Record<string, string>>(BackupService.SCHEDULES_KV_KEY) ?? {};
  }

  async getSchedule(database: string): Promise<string | null> {
    return this.schedules.get(database)?.cron ?? (await this.listSchedules())[database] ?? null;
  }

  /** In-memory timer arm (no persistence) — shared by setSchedule/restore. */
  private armSchedule(database: string, cron: string): void {
    const existing = this.schedules.get(database);
    if (existing?.timer) clearInterval(existing.timer);
    const intervalMs = this.parseCronInterval(cron);
    const timer = setInterval(() => {
      void (async () => {
        try {
          if (database === 'all') await this.createAllBackups();
          else await this.createBackup(database, { compress: true });
          await this.pruneOldBackups(database).catch(() => { /* best-effort */ });
        } catch (err) {
          this.logger.error({ database, error: (err as Error).message }, 'Scheduled backup failed');
        }
      })();
    }, intervalMs);
    timer.unref();
    this.schedules.set(database, { database, cron, timer });
  }

  /**
   * Retention: keep the most recent `keep` backups per database, delete older.
   * Bounds unbounded growth from hourly schedules (~168/week/db otherwise).
   */
  private async pruneOldBackups(database: string, keep = 48): Promise<void> {
    const dbs = database === 'all'
      ? [...new Set([...this.buildStackDbMap().keys()].filter((k) => !k.includes('/')))]
      : [database];
    for (const db of dbs) {
      const backups = (await this.listBackups(db)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const old of backups.slice(keep)) {
        try { await this.deleteBackup(old.id); } catch { /* best-effort */ }
      }
    }
  }

  dispose(): void {
    for (const entry of this.schedules.values()) {
      if (entry.timer) clearInterval(entry.timer);
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
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    if (compress) {
      // pg_dump inside container, pipe through gzip, write to host
      const cmd = `docker exec ${container} pg_dump -U ${config.user} -d ${config.database} | gzip > "${outputPath}"`;
      const { execFile: ef } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        ef('/bin/sh', ['-c', cmd], { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      const { stdout } = await exec('docker', [
        'exec', container, 'pg_dump', '-U', config.user, '-d', config.database,
      ], { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 });
      fs.writeFileSync(outputPath, stdout);
    }
  }

  private async pgRestoreDocker(
    container: string,
    config: DbConfig,
    inputPath: string,
    compressed: boolean
  ): Promise<void> {
    const cmd = compressed
      ? `gunzip -c "${inputPath}" | docker exec -i ${container} psql -U ${config.user} -d ${config.database}`
      : `docker exec -i ${container} psql -U ${config.user} -d ${config.database} < "${inputPath}"`;

    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile('/bin/sh', ['-c', cmd], { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ===========================================================================
  // Private — pg_dump local
  // ===========================================================================

  private async pgDumpLocal(config: DbConfig, outputPath: string, compress: boolean): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    const env = { ...process.env, PGPASSWORD: config.password };
    const pgArgs = ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', config.database];

    if (compress) {
      const cmd = `pg_dump ${pgArgs.join(' ')} | gzip > "${outputPath}"`;
      await new Promise<void>((resolve, reject) => {
        execFile('/bin/sh', ['-c', cmd], { timeout: 600_000, maxBuffer: 100 * 1024 * 1024, env }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      const { stdout } = await exec('pg_dump', pgArgs, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024, env });
      fs.writeFileSync(outputPath, stdout);
    }
  }

  private async pgRestoreLocal(config: DbConfig, inputPath: string, compressed: boolean): Promise<void> {
    const env = { ...process.env, PGPASSWORD: config.password };
    const pgArgs = `-h ${config.host} -p ${config.port} -U ${config.user} -d ${config.database}`;

    const cmd = compressed
      ? `gunzip -c "${inputPath}" | psql ${pgArgs}`
      : `psql ${pgArgs} < "${inputPath}"`;

    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile('/bin/sh', ['-c', cmd], { timeout: 600_000, maxBuffer: 100 * 1024 * 1024, env }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
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

  private parseCronInterval(cron: string): number {
    // Simple interval parsing for MVP:
    // "daily" = 24h, "hourly" = 1h, "weekly" = 7d, or numeric ms
    const presets: Record<string, number> = {
      'hourly': 3_600_000,
      'daily': 86_400_000,
      'weekly': 604_800_000,
    };

    const preset = presets[cron.toLowerCase()];
    if (preset) return preset;

    const num = parseInt(cron, 10);
    if (!isNaN(num) && num > 0) return num;

    // Default: daily
    return 86_400_000;
  }
}

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
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
