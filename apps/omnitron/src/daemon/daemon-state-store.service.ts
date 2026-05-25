/**
 * DaemonStateStore — unified SQLite-backed persistence for daemon-
 * local state that must survive daemon restarts.
 *
 * Why SQLite (not OMNITRON_DB / PostgreSQL):
 * ==========================================
 * Daemon boots BEFORE infrastructure (Docker containers including
 * PostgreSQL are provisioned BY the daemon). Daemon state has to be
 * readable during the pre-infrastructure boot phase, so persistence
 * via PostgreSQL would create a chicken-and-egg loop. SQLite (via
 * `better-sqlite3`) ships in-process, has no boot-order dependency,
 * provides WAL-mode crash-safe transactions, and Kysera gives the
 * same typed-query surface our other state uses.
 *
 * What lives here (T-7 in the audit):
 * ====================================
 * Previously these were five separate `fs.writeFileSync(JSON)`
 * surfaces with no transactional semantics across writes:
 *
 *   1. PersistedAppState  ← state-store.ts  (process registry for
 *                          crash-recovery + reconcile-on-boot)
 *   2. PidLock            ← pid-manager.ts (daemon PID file +
 *                          signature)
 *   3. ProjectRegistryEntry ← project.service.ts (registered projects)
 *   4. NodeRegistryEntry  ← node-manager.service.ts (fleet nodes)
 *   5. SecretsBlob        ← secrets.service.ts (encrypted secret store)
 *
 * Migrating each onto one transactional store eliminates the torn-
 * write risk a single fs.writeFileSync had (kill -9 mid-write left
 * truncated JSON; the daemon then booted with an empty registry and
 * every supervised app was treated as new).
 *
 * Schema is kept deliberately key-value where the workload allows
 * it (state_kv) and properly normalized only where queries need it
 * (projects, nodes). All schemas are auto-migrated on first open;
 * adding a new key never requires a separate migration step.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { expandPath } from '../shared/paths.js';

// =============================================================================
// Schema
// =============================================================================

export interface DaemonStateDatabase {
  /**
   * Generic key-value store. Used for state-store (persisted process
   * registry), pid-lock (daemon PID + signature), secrets blob, and
   * any other small singleton JSON document. `key` is the namespace,
   * `value` is JSON-encoded.
   */
  state_kv: {
    key: string;
    value: string;
    updated_at: string;
  };

  /**
   * Project registry. Each row = one registered ecosystem project
   * with its filesystem path + last-known config hash for change
   * detection.
   */
  projects: {
    name: string;
    path: string;
    config_hash: string | null;
    added_at: string;
    last_seen: string;
  };

  /**
   * Fleet nodes — replaces node-manager's in-memory + JSON file
   * registry. Master daemons store every slave they've shaken hands
   * with; slaves persist their master connection here so a slave
   * restart re-establishes the link without operator intervention.
   */
  nodes: {
    id: string;
    name: string;
    host: string;
    port: number;
    role: string; // 'master' | 'slave'
    status: string; // 'online' | 'offline' | 'unknown'
    last_heartbeat: string | null;
    metadata: string | null; // JSON
    added_at: string;
    updated_at: string;
  };

  /**
   * Backup index — backup.service writes one row per completed
   * snapshot. The bytes themselves live on disk (the .tar.gz under
   * ~/.omnitron/backups/), but the index of `which backup belongs to
   * which app + when + bytes` lives here so the listing is fast and
   * survives daemon restart without re-scanning the backup dir.
   */
  backups: {
    id: string;
    app: string;
    path: string;
    size_bytes: number;
    created_at: string;
    metadata: string | null; // JSON
  };
}

// =============================================================================
// Service
// =============================================================================

export class DaemonStateStore {
  private db: Kysely<DaemonStateDatabase> | null = null;
  private initialized = false;
  /** Resolved absolute path — cached so callers can log/probe it. */
  public readonly dbPath: string;

  constructor(
    private readonly logger: ILogger,
    dbPath: string = expandPath('~/.omnitron/data/daemon-state.db'),
  ) {
    this.dbPath = dbPath;
  }

  /**
   * Lazy-init. The first caller pays the open + auto-create cost
   * (~5 ms cold). Subsequent calls return the cached handle.
   */
  async getDb(): Promise<Kysely<DaemonStateDatabase>> {
    if (this.db) return this.db;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const database = new BetterSqlite3(this.dbPath);
    // WAL mode + busy_timeout + synchronous=NORMAL is the same
    // recipe SlaveStorageService uses; battle-tested under the
    // metrics drain workload.
    database.pragma('journal_mode = WAL');
    database.pragma('busy_timeout = 5000');
    database.pragma('synchronous = NORMAL');
    const dialect = new SqliteDialect({ database });
    this.db = new Kysely<DaemonStateDatabase>({ dialect });
    if (!this.initialized) {
      await this.createTables();
      this.initialized = true;
      this.logger.info({ path: this.dbPath }, 'Daemon state store initialized');
    }
    return this.db;
  }

  async dispose(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }
  }

  // ===========================================================================
  // High-level helpers — typed JSON KV
  // ===========================================================================

  /**
   * Read a JSON-encoded value under `key`. Returns null when the key
   * is absent OR the stored value fails to parse (the JSON.parse
   * error is logged but not thrown — the caller is free to choose
   * how to recover, typically by re-initialising the state).
   */
  async kvGet<T>(key: string): Promise<T | null> {
    const db = await this.getDb();
    const row = await db
      .selectFrom('state_kv')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch (err) {
      this.logger.warn({ key, err: (err as Error).message }, 'state_kv: JSON parse failed');
      return null;
    }
  }

  /**
   * Atomically upsert a JSON value under `key`. Wraps the encode +
   * write in a single transaction so a concurrent reader never sees
   * a half-written row. WAL mode guarantees readers see the prior
   * committed version until the transaction commits.
   */
  async kvSet<T>(key: string, value: T): Promise<void> {
    const db = await this.getDb();
    const payload = JSON.stringify(value);
    const now = new Date().toISOString();
    await db
      .insertInto('state_kv')
      .values({ key, value: payload, updated_at: now })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: payload, updated_at: now }))
      .execute();
  }

  /** Drop a key. Idempotent — no error if the key doesn't exist. */
  async kvDelete(key: string): Promise<void> {
    const db = await this.getDb();
    await db.deleteFrom('state_kv').where('key', '=', key).execute();
  }

  /** Walk every key starting with `prefix`. Used by reconcile paths. */
  async kvKeys(prefix?: string): Promise<string[]> {
    const db = await this.getDb();
    let q = db.selectFrom('state_kv').select('key');
    if (prefix) q = q.where('key', 'like', `${prefix}%`);
    const rows = await q.execute();
    return rows.map((r) => r.key);
  }

  // ===========================================================================
  // Private — Schema Creation
  // ===========================================================================

  private async createTables(): Promise<void> {
    if (!this.db) return;

    await sql`
      CREATE TABLE IF NOT EXISTS state_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `.execute(this.db);

    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        config_hash TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `.execute(this.db);

    await sql`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_heartbeat TEXT,
        metadata TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `.execute(this.db);
    await sql`
      CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes (status)
    `.execute(this.db);

    await sql`
      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        app TEXT NOT NULL,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT
      )
    `.execute(this.db);
    await sql`
      CREATE INDEX IF NOT EXISTS idx_backups_app_created ON backups (app, created_at)
    `.execute(this.db);
  }
}
