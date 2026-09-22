/**
 * SlaveStorageService — SQLite-backed local storage for slave daemons
 *
 * Slave daemons run WITHOUT PostgreSQL/Docker. All local data is stored
 * in a single SQLite database using Kysely through titan-database.
 *
 * Tables:
 *   - metrics_raw: time-series metrics (cpu, memory, rpc, custom)
 *   - sync_buffer: WAL for slave→master data replication
 *   - logs: structured log entries (buffered locally)
 *
 * Location: ~/.omnitron/data/slave.db
 *
 * Features:
 *   - WAL mode for concurrent reads/writes
 *   - Auto-creates tables on first use
 *   - Used by: titan-metrics (SQLiteMetricsStorage), SyncService, LogCollector
 *   - Zero Docker dependency
 */

import fs from 'node:fs';
import path from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { withDateBinding } from '../database/sqlite-date-binding.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

const OMNITRON_HOME = path.join(process.env['HOME'] ?? '/tmp', '.omnitron');
const DATA_DIR = path.join(OMNITRON_HOME, 'data');
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'slave.db');

// =============================================================================
// Schema
// =============================================================================

export interface SlaveDatabase {
  metrics_raw: {
    id: number;
    timestamp: number;
    nodeId: string | null;
    app: string;
    name: string;
    value: number;
    labels: string | null;
  };
  sync_buffer: {
    id: number;
    category: string;
    payload: string;
    createdAt: string;
    syncedAt: string | null;
  };
  logs: {
    id: string;
    timestamp: string;
    nodeId: string | null;
    app: string;
    level: string;
    message: string;
    labels: string | null;
    traceId: string | null;
    spanId: string | null;
    metadata: string | null;
  };
}

// =============================================================================
// Service
// =============================================================================

export class SlaveStorageService {
  private db: Kysely<SlaveDatabase> | null = null;
  private initialized = false;

  constructor(
    private readonly logger: ILogger,
    private readonly dbPath: string = DEFAULT_DB_PATH,
  ) {}

  /**
   * Get the Kysely instance (lazy-creates on first access).
   * Returns a typed Kysely<SlaveDatabase> ready for queries.
   */
  async getDb(): Promise<Kysely<SlaveDatabase>> {
    if (this.db) return this.db;

    // Ensure directory exists
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    // Dynamic import better-sqlite3 (peer dependency)
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const database = new BetterSqlite3(this.dbPath);

    // Enable WAL mode for concurrent access
    database.pragma('journal_mode = WAL');
    database.pragma('busy_timeout = 5000');
    database.pragma('synchronous = NORMAL');

    // Every `Date` bound to this database becomes an ISO string on the way
    // in. The daemon runs the same services against Postgres and SQLite, and
    // only one of the two drivers accepts a Date — see
    // `database/sqlite-date-binding.ts` for what that cost before this.
    const dialect = new SqliteDialect({ database: withDateBinding(database) });
    this.db = new Kysely<SlaveDatabase>({ dialect });

    // Auto-create tables
    if (!this.initialized) {
      await this.createTables();
      this.initialized = true;
      this.logger.info({ path: this.dbPath }, 'Slave SQLite storage initialized');
    }

    return this.db;
  }

  /**
   * Close the database connection.
   */
  async dispose(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }
  }

  // ===========================================================================
  // Private — Schema Creation
  // ===========================================================================

  private async createTables(): Promise<void> {
    if (!this.db) return;

    // metrics_raw — AUTOINCREMENT id (metrics inserted without explicit id)
    await sql`
      CREATE TABLE IF NOT EXISTS metrics_raw (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        nodeId TEXT,
        app TEXT NOT NULL,
        name TEXT NOT NULL,
        value REAL NOT NULL,
        labels TEXT
      )
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_metrics_ts_app_name
      ON metrics_raw (timestamp, app, name)
    `.execute(this.db);

    // sync_buffer — AUTOINCREMENT id (entries created by SyncService without explicit id)
    await sql`
      CREATE TABLE IF NOT EXISTS sync_buffer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        payload TEXT NOT NULL,
        -- ISO-8601 UTC, not datetime('now').
        --
        -- datetime('now') writes "2026-09-15 06:01:37": UTC, stating so
        -- nowhere. This column is replicated to the master and inserted into
        -- a timestamptz, where Postgres resolves an offset-less timestamp
        -- in the session's TimeZone — so the value only survives while that
        -- happens to be UTC. It also disagreed with syncedAt in the same
        -- row, which a bound Date writes in ISO form.
        --
        -- CREATE TABLE IF NOT EXISTS leaves an existing table's default
        -- alone, so this fixes new slaves only; toIsoUtc at the wire
        -- boundary is what repairs the ones already running.
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        syncedAt TEXT
      )
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_sync_pending
      ON sync_buffer (syncedAt, createdAt)
    `.execute(this.db);

    await this.createBufferStats();

    // logs — column names match OmnitronDatabase.LogsTable (camelCase)
    // id is TEXT (UUID) to match PG schema — allows LogCollectorService to work unchanged
    await sql`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        nodeId TEXT,
        app TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL DEFAULT '',
        labels TEXT,
        traceId TEXT,
        spanId TEXT,
        metadata TEXT
      )
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_logs_ts_app_level
      ON logs (timestamp, app, level)
    `.execute(this.db);
  }

  /**
   * What the replication buffer holds — its payload bytes, rows and rows
   * already delivered — kept in one row by the buffer's own triggers.
   *
   * The buffer's bound (`SyncService.enforceBufferBounds`) needs those three
   * figures every thirty seconds, and asked for them with a pass over the
   * whole table: `sum(octet_length(payload))` across every row, delivered
   * ones included, which the buffer keeps for a day. On the test node,
   * 2026-09-22, that was 4 019 288 rows and 395–399 ms per pass — on the
   * daemon's event loop, since better-sqlite3 is synchronous, so every RPC
   * the node answered could wait behind it, twice a minute, for as long as
   * the node ran. The cost grows with the table, and the table is largest
   * exactly when the node has been cut off from its master.
   *
   * Triggers, rather than figures kept in the process: the table is written
   * by more than one statement shape — inserts, the ack's update, the
   * routine delete and the eviction's subquery — and a count kept beside
   * the writer is right only for the writers somebody remembered. A trigger
   * sees every one of them, including a DELETE nobody has written yet.
   *
   * Recounted once whenever storage opens, in the same transaction that
   * (re)creates the triggers: the row is then exact from where the triggers
   * take over, whatever wrote the table before them — an older daemon
   * without them, a restore, a hand. That is one full pass per daemon start
   * instead of one per thirty seconds.
   */
  private async createBufferStats(): Promise<void> {
    if (!this.db) return;

    await this.db.transaction().execute(async (trx) => {
      await sql`
        CREATE TABLE IF NOT EXISTS sync_buffer_stats (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          totalBytes INTEGER NOT NULL,
          totalRows INTEGER NOT NULL,
          syncedRows INTEGER NOT NULL
        )
      `.execute(trx);

      await sql`
        CREATE TRIGGER IF NOT EXISTS sync_buffer_stats_insert AFTER INSERT ON sync_buffer
        BEGIN
          UPDATE sync_buffer_stats SET
            totalBytes = totalBytes + octet_length(NEW.payload),
            totalRows = totalRows + 1,
            syncedRows = syncedRows + (NEW.syncedAt IS NOT NULL)
          WHERE id = 1;
        END
      `.execute(trx);

      await sql`
        CREATE TRIGGER IF NOT EXISTS sync_buffer_stats_delete AFTER DELETE ON sync_buffer
        BEGIN
          UPDATE sync_buffer_stats SET
            totalBytes = totalBytes - octet_length(OLD.payload),
            totalRows = totalRows - 1,
            syncedRows = syncedRows - (OLD.syncedAt IS NOT NULL)
          WHERE id = 1;
        END
      `.execute(trx);

      await sql`
        CREATE TRIGGER IF NOT EXISTS sync_buffer_stats_update AFTER UPDATE OF payload, syncedAt ON sync_buffer
        BEGIN
          UPDATE sync_buffer_stats SET
            totalBytes = totalBytes - octet_length(OLD.payload) + octet_length(NEW.payload),
            syncedRows = syncedRows - (OLD.syncedAt IS NOT NULL) + (NEW.syncedAt IS NOT NULL)
          WHERE id = 1;
        END
      `.execute(trx);

      await sql`
        INSERT OR REPLACE INTO sync_buffer_stats (id, totalBytes, totalRows, syncedRows)
        SELECT 1, coalesce(sum(octet_length(payload)), 0), count(*), count(syncedAt) FROM sync_buffer
      `.execute(trx);
    });
  }
}
