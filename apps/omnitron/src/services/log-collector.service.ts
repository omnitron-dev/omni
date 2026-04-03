/**
 * Log Collector Service
 *
 * Writes structured logs to omnitron-pg instead of (or alongside) files.
 * Buffers entries in memory and flushes periodically for efficiency.
 *
 * Designed to be wired into orchestrator.onAppLog() to capture all child
 * process log lines, parse pino JSON, and persist to the logs table.
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { OmnitronDatabase } from '../database/schema.js';
import { EventEmitter } from 'node:events';

// =============================================================================
// Types
// =============================================================================

export interface LogEntry {
  app: string;
  level: string;
  message: string;
  timestamp?: Date | string;
  nodeId?: string;
  labels?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  metadata?: Record<string, unknown>;
}

export interface LogQueryFilter {
  app?: string | undefined;
  level?: string | string[] | undefined;
  search?: string | undefined;
  labels?: Record<string, string> | undefined;
  traceId?: string | undefined;
  from?: Date | string | undefined;
  to?: Date | string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface LogQueryResult {
  entries: LogEntryRow[];
  total: number;
  hasMore: boolean;
}

export interface LogEntryRow {
  id: string;
  timestamp: Date;
  nodeId: string | null;
  app: string;
  level: string;
  message: string;
  labels: Record<string, unknown> | null;
  traceId: string | null;
  spanId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface LogStats {
  byApp: Array<{ app: string; count: number }>;
  byLevel: Array<{ level: string; count: number }>;
  totalCount: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

// =============================================================================
// Pino Level Map (numeric → string)
// =============================================================================

const PINO_LEVELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

// =============================================================================
// Log Collector Service
// =============================================================================

/** Escape LIKE pattern metacharacters to prevent injection */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

const FLUSH_INTERVAL_MS = 1_000;
const FLUSH_THRESHOLD = 100;

export class LogCollectorService extends EventEmitter {
  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private disposed = false;

  constructor(private readonly db: Kysely<OmnitronDatabase>) {
    super();
    this.startFlushTimer();
  }

  // ===========================================================================
  // Ingestion
  // ===========================================================================

  /** Ingest a single log entry into the buffer */
  ingestLog(entry: LogEntry): void {
    if (this.disposed) return;

    this.buffer.push(entry);

    if (this.buffer.length >= FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  /** Ingest a batch of log entries */
  ingestBatch(entries: LogEntry[]): void {
    if (this.disposed) return;

    this.buffer.push(...entries);

    if (this.buffer.length >= FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  /**
   * Parse a raw pino JSON log line from a child process and ingest it.
   * This is the primary integration point with orchestrator.onAppLog().
   */
  ingestPinoLine(appName: string, line: string): void {
    try {
      const parsed = JSON.parse(line);

      const level = typeof parsed.level === 'number'
        ? (PINO_LEVELS[parsed.level] ?? 'info')
        : (parsed.level ?? 'info');

      const message = parsed.msg ?? parsed.message ?? '';

      // Extract well-known fields, put the rest into metadata
      const { level: _l, msg: _m, message: _msg, time, pid: _pid, hostname: _hostname, ...rest } = parsed;

      // Extract labels if present
      const labels = parsed.labels ?? undefined;
      const traceId = parsed.traceId ?? parsed.trace_id ?? undefined;
      const spanId = parsed.spanId ?? parsed.span_id ?? undefined;

      // Everything else goes into metadata
      const metadata = Object.keys(rest).length > 0 ? rest : undefined;

      this.ingestLog({
        app: appName,
        level,
        message: String(message),
        timestamp: time ? new Date(time) : new Date(),
        labels,
        traceId,
        spanId,
        metadata,
      });
    } catch {
      // Not valid JSON — ingest as raw text
      this.ingestLog({
        app: appName,
        level: 'info',
        message: line,
        timestamp: new Date(),
      });
    }
  }

  // ===========================================================================
  // Querying
  // ===========================================================================

  async queryLogs(filter: LogQueryFilter): Promise<LogQueryResult> {
    const limit = Math.min(filter.limit ?? 100, 1000);
    const offset = filter.offset ?? 0;

    let query = this.db.selectFrom('logs').selectAll();

    // Apply filters
    if (filter.app) {
      query = query.where('app', '=', filter.app);
    }

    if (filter.level) {
      if (Array.isArray(filter.level)) {
        query = query.where('level', 'in', filter.level);
      } else {
        query = query.where('level', '=', filter.level);
      }
    }

    if (filter.search) {
      query = query.where('message', 'like', `%${escapeLike(filter.search)}%`);
    }

    if (filter.traceId) {
      query = query.where('traceId', '=', filter.traceId);
    }

    if (filter.from) {
      const fromDate = typeof filter.from === 'string' ? new Date(filter.from) : filter.from;
      query = query.where('timestamp', '>=', fromDate);
    }

    if (filter.to) {
      const toDate = typeof filter.to === 'string' ? new Date(filter.to) : filter.to;
      query = query.where('timestamp', '<=', toDate);
    }

    // Get total count for pagination
    let countQuery = this.db.selectFrom('logs').select(
      this.db.fn.countAll<string>().as('count')
    );

    if (filter.app) countQuery = countQuery.where('app', '=', filter.app);
    if (filter.level) {
      if (Array.isArray(filter.level)) {
        countQuery = countQuery.where('level', 'in', filter.level);
      } else {
        countQuery = countQuery.where('level', '=', filter.level);
      }
    }
    if (filter.search) countQuery = countQuery.where('message', 'like', `%${escapeLike(filter.search)}%`);
    if (filter.traceId) countQuery = countQuery.where('traceId', '=', filter.traceId);
    if (filter.from) {
      const fromDate = typeof filter.from === 'string' ? new Date(filter.from) : filter.from;
      countQuery = countQuery.where('timestamp', '>=', fromDate);
    }
    if (filter.to) {
      const toDate = typeof filter.to === 'string' ? new Date(filter.to) : filter.to;
      countQuery = countQuery.where('timestamp', '<=', toDate);
    }

    const [entries, countResult] = await Promise.all([
      query.orderBy('timestamp', 'desc').limit(limit).offset(offset).execute(),
      countQuery.executeTakeFirst(),
    ]);

    const total = Number(countResult?.count ?? 0);

    return {
      entries: entries as unknown as LogEntryRow[],
      total,
      hasMore: offset + limit < total,
    };
  }

  async getLogStats(): Promise<LogStats> {
    const [byApp, byLevel, bounds] = await Promise.all([
      this.db
        .selectFrom('logs')
        .select(['app', this.db.fn.countAll<string>().as('count')])
        .groupBy('app')
        .orderBy('count', 'desc')
        .execute(),

      this.db
        .selectFrom('logs')
        .select(['level', this.db.fn.countAll<string>().as('count')])
        .groupBy('level')
        .orderBy('count', 'desc')
        .execute(),

      this.db
        .selectFrom('logs')
        .select([
          this.db.fn.countAll<string>().as('totalCount'),
          this.db.fn.min('timestamp').as('oldest'),
          this.db.fn.max('timestamp').as('newest'),
        ])
        .executeTakeFirst(),
    ]);

    return {
      byApp: byApp.map((r) => ({ app: r.app, count: Number(r.count) })),
      byLevel: byLevel.map((r) => ({ level: r.level, count: Number(r.count) })),
      totalCount: Number(bounds?.totalCount ?? 0),
      oldestEntry: bounds?.oldest ? new Date(bounds.oldest as unknown as string) : null,
      newestEntry: bounds?.newest ? new Date(bounds.newest as unknown as string) : null,
    };
  }

  /**
   * Get recent logs for real-time tailing.
   * Returns the last N entries matching the filter, ordered oldest-first
   * (so the caller can append them in chronological order).
   */
  async getRecentLogs(filter: LogQueryFilter & { tail?: number }): Promise<LogEntryRow[]> {
    const tail = filter.tail ?? 50;

    let query = this.db.selectFrom('logs').selectAll();

    if (filter.app) query = query.where('app', '=', filter.app);
    if (filter.level) {
      if (Array.isArray(filter.level)) {
        query = query.where('level', 'in', filter.level);
      } else {
        query = query.where('level', '=', filter.level);
      }
    }
    if (filter.search) query = query.where('message', 'like', `%${escapeLike(filter.search)}%`);

    // Range filters — critical for efficient live polling (since parameter)
    if (filter.from) {
      const from = typeof filter.from === 'string' ? new Date(filter.from) : filter.from;
      query = query.where('timestamp', '>', from);
    }
    if (filter.to) {
      const to = typeof filter.to === 'string' ? new Date(filter.to) : filter.to;
      query = query.where('timestamp', '<=', to);
    }

    // Get the last N entries, then reverse for chronological order
    const entries = await query
      .orderBy('timestamp', 'desc')
      .limit(tail)
      .execute();

    return (entries as unknown as LogEntryRow[]).reverse();
  }

  // ===========================================================================
  // Buffer Flush
  // ===========================================================================

  /** Flush buffered entries to the database */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;

    this.flushing = true;
    const batch = this.buffer.splice(0);

    try {
      if (batch.length === 0) return;

      const rows = batch.map((entry) => ({
        id: randomUUID(),
        timestamp: entry.timestamp
          ? (typeof entry.timestamp === 'string' ? new Date(entry.timestamp) : entry.timestamp)
          : new Date(),
        nodeId: entry.nodeId ?? null,
        app: entry.app,
        level: entry.level,
        message: entry.message,
        labels: entry.labels ? JSON.stringify(entry.labels) : null,
        traceId: entry.traceId ?? null,
        spanId: entry.spanId ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      }));

      await this.db.insertInto('logs').values(rows).execute();

      this.emit('flushed', batch.length);
    } catch (err) {
      // On failure, put entries back at the front of the buffer
      // (drop if buffer is too large to avoid unbounded growth)
      if (this.buffer.length < 10_000) {
        this.buffer.unshift(...batch);
      }
      this.emit('flush_error', err);
    } finally {
      this.flushing = false;
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref();
  }

  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Wait for any in-progress flush to complete before final flush
    while (this.flushing) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Final flush of remaining buffered entries
    await this.flush();
  }
}
