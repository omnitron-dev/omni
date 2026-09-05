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

import { planRetention, batchesPerPass } from './log-retention.js';
import type { OmnitronDatabase } from '../database/schema.js';
import { EventEmitter } from 'node:events';
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { OMNITRON_DB_TOKEN } from '../shared/tokens.js';
import type { LogEntry, LogQueryFilter, LogEntryRow, LogQueryResult, LogStats } from '../shared/dto/logs.js';

// =============================================================================
// Types
// =============================================================================

export type { LogEntry, LogQueryFilter, LogEntryRow, LogQueryResult, LogStats } from '../shared/dto/logs.js';

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

/**
 * How often to prune old log rows. Hourly: the table grows over days, so a
 * pass more often than this is work for its own sake, and one much less often
 * lets a burst accumulate between passes.
 */
const RETENTION_INTERVAL_MS = 60 * 60 * 1_000;

/** Cadence while a backlog is still draining — see `scheduleRetention`. */
const RETENTION_BACKLOG_INTERVAL_MS = 60 * 1_000;
const FLUSH_THRESHOLD = 100;
/**
 * Hard ceiling on buffered entries. During a DB outage every flush fails and
 * requeues while new entries keep arriving — without a ceiling the buffer
 * grows for as long as the outage lasts. The 2026-07-11 daemon crash was
 * exactly this: hours of omnitron-pg downtime grew the buffer into the
 * hundreds of thousands, and the then-`unshift(...batch)` requeue blew the
 * argument-spread call-stack limit (RangeError → unhandled rejection →
 * daemon exit). Newest entries win; the oldest overflow is counted and
 * dropped.
 */
const MAX_BUFFER = 50_000;
/** Per-flush insert ceiling — bounds both the INSERT payload and the requeue. */
const FLUSH_BATCH_MAX = 5_000;

@Injectable()
export class LogCollectorService extends EventEmitter {
  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private disposed = false;
  /** Entries dropped to the MAX_BUFFER ceiling since the last successful flush. */
  private droppedSinceFlush = 0;
  /**
   * Lifetime counters, in memory.
   *
   * The console's "Log Ingestion" card was a hardcoded `0 lines/s`, and the
   * only alternative source is `getLogStats`, which runs three `count(*)`
   * over the whole table — 22.5 million rows on this host, so not something
   * to poll. A counter costs an addition per flush and answers the question
   * the card was asking.
   *
   * `droppedTotal` matters more than the rate. The buffer sheds its oldest
   * entries at the MAX_BUFFER ceiling during a database outage, and until
   * now that happened with no counter anyone could read — logs vanished and
   * the only trace was an event nobody was listening to.
   */
  private ingestedTotal = 0;
  private droppedTotal = 0;

  private retentionTimer: NodeJS.Timeout | null = null;
  /** Days of history to keep in the table. Zero or less disables pruning. */
  private retentionDays = 0;
  /**
   * Set alongside retention rather than injected.
   *
   * The service is registered with `useClass` and takes the database as its
   * only constructor dependency; adding a second is a change to the module's
   * wiring, and a wrong one there fails at runtime rather than at compile
   * time — twice today already. One setter, one call site, nothing to get out
   * of order.
   */
  private logger: {
    info?: (obj: object, msg?: string) => void;
    error?: (obj: object, msg?: string) => void;
  } | null = null;

  constructor(@Inject(OMNITRON_DB_TOKEN) private readonly db: Kysely<OmnitronDatabase>) {
    super();
    this.startFlushTimer();
  }

  /**
   * Turn on table retention.
   *
   * Off until called, because the number belongs to the daemon config and
   * this service is constructed before it is read. A default chosen here
   * would be a policy decision made in the wrong place — and a wrong one
   * deletes an operator's history.
   */
  setRetentionDays(days: number, logger?: LogCollectorService['logger']): void {
    this.retentionDays = days;
    if (logger) this.logger = logger;
    if (this.retentionTimer) {
      clearTimeout(this.retentionTimer);
      this.retentionTimer = null;
    }
    if (planRetention(days) === null) {
      this.logger?.info?.({ days }, 'Log table retention disabled');
      return;
    }
    this.scheduleRetention(0);
  }

  /**
   * Arm the next retention pass.
   *
   * The per-pass ceiling exists to keep each statement short; it should not
   * also decide how long a backlog takes to clear. A pass that hits its
   * ceiling means there is more waiting, so the next one comes in a minute
   * rather than an hour — thirteen million stale rows drain in half an hour
   * instead of a day, with every individual statement still bounded. A pass
   * that finishes early returns to the hourly cadence.
   *
   * `setTimeout` chained rather than `setInterval`, so the cadence is a
   * decision made after each pass with its result in hand.
   */
  private scheduleRetention(delayMs: number): void {
    if (this.retentionTimer) clearTimeout(this.retentionTimer);
    if (this.disposed) return;

    this.retentionTimer = setTimeout(() => {
      void this.pruneOldLogs().then((removed) => {
        const plan = planRetention(this.retentionDays);
        if (!plan || this.disposed) return;
        this.scheduleRetention(
          removed >= plan.maxThisPass ? RETENTION_BACKLOG_INTERVAL_MS : RETENTION_INTERVAL_MS
        );
      });
    }, delayMs);
    this.retentionTimer.unref();
  }

  /**
   * Delete rows past the retention window, in bounded batches.
   *
   * Batched because a single `DELETE` over 13 GB holds its transaction for
   * the duration and blocks the flush path behind it — a retention pass would
   * show up as the log pipeline stalling, which is the opposite of the point.
   */
  async pruneOldLogs(): Promise<number> {
    const plan = planRetention(this.retentionDays);
    if (!plan || this.disposed) return 0;

    let removed = 0;
    try {
      for (let i = 0; i < batchesPerPass(plan); i++) {
        if (this.disposed) break;
        const doomed = await this.db
          .selectFrom('logs')
          .select('id')
          .where('timestamp', '<', plan.cutoff)
          .limit(plan.batchSize)
          .execute();

        if (doomed.length === 0) break;
        await this.db
          .deleteFrom('logs')
          .where('id', 'in', doomed.map((r) => String(r.id)))
          .execute();
        removed += doomed.length;
      }

      if (removed > 0) {
        this.logger?.info?.(
          { removed, cutoff: plan.cutoff.toISOString(), retentionDays: this.retentionDays },
          'Pruned log rows past retention'
        );
      }
    } catch (err) {
      // Reported rather than swallowed: a retention pass that keeps failing
      // is the disk filling up in slow motion, and the only warning of it.
      this.logger?.error?.({ error: (err as Error).message, removed }, 'Log retention pass failed');
    }
    return removed;
  }

  // ===========================================================================
  // Ingestion
  // ===========================================================================

  /** Drop the oldest overflow so the buffer never exceeds MAX_BUFFER. */
  private enforceCap(): void {
    const overflow = this.buffer.length - MAX_BUFFER;
    if (overflow > 0) {
      this.buffer.splice(0, overflow);
      this.droppedSinceFlush += overflow;
      this.droppedTotal += overflow;
    }
  }

  /** Ingest a single log entry into the buffer */
  ingestLog(entry: LogEntry): void {
    if (this.disposed) return;

    this.buffer.push(entry);
    this.enforceCap();

    if (this.buffer.length >= FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  /** Ingest a batch of log entries */
  ingestBatch(entries: LogEntry[]): void {
    if (this.disposed) return;

    // concat, not push(...entries) — spreading a large array as arguments
    // risks the same call-stack blowup the flush requeue hit.
    this.buffer = this.buffer.concat(entries);
    this.enforceCap();

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

  /**
   * In-memory counters. No database work, so it is safe to poll.
   *
   * `ingestedTotal` counts rows actually written, not rows accepted: a caller
   * sampling it twice gets a real write rate, and a stalled flush shows as a
   * rate of zero with a growing `bufferSize` beside it — which is the state
   * an operator needs to be able to tell from "nothing is being logged".
   */
  getIngestionStats(): { ingestedTotal: number; droppedTotal: number; bufferSize: number } {
    return {
      ingestedTotal: this.ingestedTotal,
      droppedTotal: this.droppedTotal,
      bufferSize: this.buffer.length,
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
    // Bounded batch — caps the INSERT payload AND the requeue-on-failure so
    // an outage backlog drains in chunks instead of one giant statement.
    // The 1s flush timer + threshold-triggered flushes drain the remainder.
    const batch = this.buffer.splice(0, FLUSH_BATCH_MAX);

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

      if (this.droppedSinceFlush > 0) {
        this.emit('dropped', this.droppedSinceFlush);
        this.droppedSinceFlush = 0;
      }
      this.ingestedTotal += batch.length;
      this.emit('flushed', batch.length);
    } catch (err) {
      // On failure, put the batch back at the FRONT of the buffer so order
      // is preserved. concat (never unshift(...batch)) — spreading a large
      // batch as arguments overflows the call stack, which is precisely how
      // the 2026-07-11 daemon crash happened. The ceiling then drops the
      // oldest overflow.
      this.buffer = batch.concat(this.buffer);
      this.enforceCap();
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

    if (this.retentionTimer) {
      clearTimeout(this.retentionTimer);
      this.retentionTimer = null;
    }

    // Wait for any in-progress flush to complete before final flush
    while (this.flushing) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Final flush of remaining buffered entries
    await this.flush();
  }
}
