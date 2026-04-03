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

    const dialect = new SqliteDialect({ database });
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
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        syncedAt TEXT
      )
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_sync_pending
      ON sync_buffer (syncedAt, createdAt)
    `.execute(this.db);

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
}
