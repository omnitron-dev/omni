import fs from 'node:fs';
import path from 'node:path';
import { validateLogQuery } from './log-query.js';
/**
 * Log Collector Service
 *
 * Writes structured logs to omnitron-pg instead of (or alongside) files.
 * Uses a private durable journal and bounded, idempotent database transactions.
 *
 * Designed to be wired into orchestrator.onAppLog() to capture all child
 * process log lines, parse pino JSON, and persist to the logs table.
 */

import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { LogJournal } from '../monitoring/log-journal.js';
import { logEntryOf } from '../monitoring/log-entry.js';
import { assertLogDurability } from '../database/log-durability.js';
import type { LogIngestionStats } from '../shared/dto/logs.js';
import type { ProcessOutputContext } from '@omnitron-dev/titan-pm';
import { type Kysely, type ExpressionBuilder, type Expression, type SqlBool, type Transaction } from 'kysely';

import { planRetention, batchesPerPass } from './log-retention.js';
import { jsonContains, dialectOf, type SqlDialect } from '../database/dialect.js';
import type { OmnitronDatabase } from '../database/schema.js';
import { EventEmitter } from 'node:events';
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { OMNITRON_DB_TOKEN } from '../shared/tokens.js';
import type { LogEntry, LogQueryFilter, LogEntryRow, LogQueryResult, LogStats } from '../shared/dto/logs.js';
import type { LogEntryDto } from '../config/types.js';
import { LineAssembler, type LogRecord } from '../monitoring/log-line.js';

// =============================================================================
// Types
// =============================================================================

export type { LogEntry, LogQueryFilter, LogEntryRow, LogQueryResult, LogStats } from '../shared/dto/logs.js';

// =============================================================================
// Log Collector Service
// =============================================================================

/** Escape LIKE pattern metacharacters to prevent injection */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

/** A JSON column read back as text (SQLite), or nothing if it is not an object. */
function safeJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}


function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** PostgreSQL decodes JSON; SQLite stores it as text. RPC exposes one shape. */
function decodedLogRows(rows: unknown[]): LogEntryRow[] {
  return (rows as LogEntryRow[]).map(row => ({ ...row,
    labels: typeof row.labels === 'string' ? safeJson(row.labels) : row.labels,
    metadata: typeof row.metadata === 'string' ? safeJson(row.metadata) : row.metadata,
  }));
}

/** Preserve full source-time precision in conflict checks, even when a driver returns a Date. */
function prepareEntry(entry: LogEntry): LogEntry & { id: string; timestamp: string } {
  const { _omnitronPayloadSha256: _previousProof, ...metadata } = entry.metadata ?? {};
  const prepared = { ...entry, id: entry.id ?? randomUUID(),
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp ?? new Date().toISOString(), metadata };
  const proofInput = { ...prepared };
  const capture = metadata['_omnitron'] as Record<string, unknown> | undefined;
  if (capture?.['timeBasis'] === 'observed') {
    proofInput.timestamp = 'legacy-observation';
    proofInput.metadata = { ...metadata, _omnitron: { ...capture, capturedAt: null, eventTime: null } };
  }
  return { ...prepared, metadata: { ...metadata, _omnitronPayloadSha256: createHash('sha256').update(JSON.stringify(canonical(proofInput))).digest('hex') } };
}

const FLUSH_INTERVAL_MS = 1_000;

/**
 * How often to prune old log rows. Hourly: the table grows over days, so a
 * pass more often than this is work for its own sake, and one much less often
 * lets a burst accumulate between passes.
 */
const RETENTION_INTERVAL_MS = 60 * 60 * 1_000;

/**
 * How long to wait before the FIRST retention pass.
 *
 * Long enough for migrations to have created the table. See
 * `setRetentionDays` for what firing at zero produced.
 */
const RETENTION_FIRST_PASS_DELAY_MS = 60_000;

/** Cadence while a backlog is still draining — see `scheduleRetention`. */
const RETENTION_BACKLOG_INTERVAL_MS = 60 * 1_000;
const FLUSH_THRESHOLD = 100;
/** Maximum rows considered by one journal drain; payload bytes are bounded separately. */
const FLUSH_BATCH_MAX = 5_000;

@Injectable()
export class LogCollectorService extends EventEmitter {
  private startupDirectory: string | null = null;
  setStartupDirectory(directory: string): void { this.startupDirectory = directory; }
  private sourceJournal: LogJournal<{ app: string; record: LogRecord }> | null = null;
  setSourceJournal(journal: LogJournal<{ app: string; record: LogRecord }>): void { this.sourceJournal = journal; }
  private journal = new LogJournal<LogEntry>(':memory:');
  private ownsJournal = true;
  private sourceStats: (() => LogIngestionStats['journal'] | null) | null = null;
  setSourceStats(read: () => LogIngestionStats['journal'] | null): void { this.sourceStats = read; }
  private startupError: string | null = null;
  private lastCommitAt: string | null = null;
  private lastError: string | null = null;
  private durability: LogIngestionStats['durability'] = 'unknown';
  private capture: LogIngestionStats['capture'] = 'unknown';
  private ownerPending: number | null = null;
  private ownerError: string | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private disposed = false;
  /** Committed local rows; drops remain zero because unacknowledged records are never evicted. */
  private ingestedTotal = 0;
  private droppedTotal = 0;

  /** The slave replication enqueue participates in the same transaction as its log rows. */
  private syncSink: ((entries: LogEntry[], transaction: Transaction<OmnitronDatabase>) => Promise<unknown>) | null = null;

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

  /** Lines become records here exactly as they do for the files — `log-line.ts`. */
  private readonly assembler = new LineAssembler((app, record) => this.ingestRecord(app, record), {
    onPending: (app, record) => this.journal.put(record.id!, logEntryOf(app, record), false),
    onError: error => { this.lastError = String(error); },
  });

  private dialect: SqlDialect | null = null;

  constructor(@Inject(OMNITRON_DB_TOKEN) private readonly db: Kysely<OmnitronDatabase>) {
    super();
    this.startFlushTimer();
  }

  /** Configure transactional replication; never acknowledge a fire-and-forget sink. */
  setSyncSink(sink: ((entries: LogEntry[], transaction: Transaction<OmnitronDatabase>) => Promise<unknown>) | null): void {
    this.syncSink = sink;
  }

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
    // Not zero. A pass fired the instant the collector is configured races
    // the migrations that create the table it reads: measured on a daemon
    // start, `Log retention pass failed — relation "logs" does not exist`,
    // once, at 03:27:03. Harmless in itself — the next pass an hour later
    // succeeds — but it is an error-level line about a subsystem that is
    // fine, and an error nobody can act on is one they learn to scroll past.
    //
    // The first pass has nothing urgent to do anyway: rows become eligible
    // for deletion by ageing past the window, so a minute's delay costs
    // nothing and a backlog is still drained at the faster cadence once the
    // first pass sees one.
    this.scheduleRetention(RETENTION_FIRST_PASS_DELAY_MS);
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

  useJournal(journal: LogJournal<LogEntry>, ownsJournal = true): void {
    this.assembler.sealAll();
    for (const item of this.journal.peek(1_000_000, Number.MAX_SAFE_INTEGER)) journal.put(item.id, item.value);
    this.journal.close();
    this.journal = journal;
    this.ownsJournal = ownsJournal;
  }

  setCaptureStatus(capture: LogIngestionStats['capture'], ownerPending: number | null = null, ownerError: string | null = null): void {
    this.capture = capture;
    this.ownerPending = ownerPending;
    this.ownerError = ownerError;
  }

  ingestLog(entry: LogEntry): void {
    if (this.disposed) throw new Error('Log collector has closed; capture must retain the record');
    const prepared = { ...entry, id: entry.id ?? randomUUID(),
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp ?? new Date().toISOString() };
    this.journal.put(prepared.id, prepared);
    if (this.journal.stats().pending >= FLUSH_THRESHOLD) void this.flush();
  }

  ingestBatch(entries: LogEntry[]): void { for (const entry of entries) this.ingestLog(entry); }

  ingestPinoLine(appName: string, line: string, context?: ProcessOutputContext): void {
    if (this.disposed) throw new Error('Log collector has closed');
    this.assembler.push(appName, line, context);
  }

  ingestRecord(appName: string, record: LogRecord): void { this.ingestLog(logEntryOf(appName, record)); }

  // ===========================================================================
  // Querying
  // ===========================================================================

  /**
   * The two filters the schema was built for and no query used.
   *
   * `logs.nodeId` is a uuid column that `SyncService.ingestLog` fills for every
   * entry a slave sends up, and `logs.labels` is jsonb carrying a GIN index
   * that `001_initial_schema` created with the intended query written in its
   * own comment: `WHERE labels @> '{"env":"prod"}'`. Neither `queryLogs` nor
   * `getRecentLogs` referenced either one.
   *
   * The visible consequence was in the console: its cluster node filter put the
   * node id inside `labels`, sent it, and the daemon dropped the whole field —
   * so selecting a node narrowed nothing while the chip stayed lit. A filter
   * that silently does nothing is worse than one that is missing, because the
   * operator reads the unnarrowed result as an answer about that node.
   *
   * Applied in BOTH paths deliberately. A filter honoured by the paginated
   * query and not by the live tail is how a viewer changes its answer when you
   * press Live.
   */
  async queryLogs(filter: LogQueryFilter): Promise<LogQueryResult> {
    validateLogQuery(filter);
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    // One definition of "which rows", used by both queries.
    //
    // There were two, and they had drifted: the rows honoured `nodeId` and
    // `labels`, the count did not. So a log view filtered to one node showed
    // that node's lines under a total counting every node's — a pager
    // offering pages that hold nothing, and a number an operator reads as
    // how much that node said. The two lists were written together and
    // maintained apart, which is the failure mode of writing them twice.
    const matching = (eb: ExpressionBuilder<OmnitronDatabase, 'logs'>) => {
      const clauses: Expression<SqlBool>[] = [];

      if (filter.app) clauses.push(eb('app', '=', filter.app));

      if (filter.level) {
        clauses.push(
          Array.isArray(filter.level)
            ? eb('level', 'in', filter.level)
            : eb('level', '=', filter.level),
        );
      }

      if (filter.search) clauses.push(eb('message', 'like', `%${escapeLike(filter.search)}%`));
      if (filter.traceId) clauses.push(eb('traceId', '=', filter.traceId));
      if (filter.nodeId) clauses.push(eb('nodeId', '=', filter.nodeId));

      if (filter.labels && Object.keys(filter.labels).length > 0) {
        // Containment, asked the way each engine understands it. Written as
        // `labels @> ?::jsonb`, this was a syntax error on every slave —
        // SQLite reads `@` as an unrecognized token and refuses the whole
        // statement — so a log query carrying a label filter threw on the
        // exact nodes whose logs you go looking for. See `jsonContains`.
        clauses.push(jsonContains(this.db, 'labels', filter.labels) as Expression<SqlBool>);
      }

      if (filter.from) {
        const fromDate = typeof filter.from === 'string' ? new Date(filter.from) : filter.from;
        clauses.push(eb('timestamp', '>=', fromDate));
      }

      if (filter.to) {
        const toDate = typeof filter.to === 'string' ? new Date(filter.to) : filter.to;
        clauses.push(eb('timestamp', '<=', toDate));
      }

      // No filter at all is not "match nothing" — the unfiltered view is
      // the default one. `lit`, not `val`: a bound `true` is a JS boolean,
      // and better-sqlite3 binds "numbers, strings, bigints, buffers, and
      // null", so a parameter here would refuse every unfiltered log query
      // on every slave. `true` as a keyword is understood by both engines.
      return clauses.length > 0 ? eb.and(clauses) : eb.lit(true);
    };

    const query = this.db.selectFrom('logs').selectAll().where(matching);
    // The total and its breakdown by level, counted by one query: the total
    // is their sum. The console printed the total beside `getLogStats`'s
    // levels — the whole table's, filtered by nothing — so on the master
    // (2026-09-23) «Showing 100 of 48 991» sat beside «error: 42 650» for an
    // hour that held 149 errors among 9 159 730 rows since 09-09.
    const levelsQuery = this.db
      .selectFrom('logs')
      .select(['level', this.db.fn.countAll<string>().as('count')])
      .where(matching)
      .groupBy('level');

    const [entries, levels] = await Promise.all([
      query.orderBy('timestamp', 'desc').orderBy('id', 'desc').limit(limit).offset(offset).execute(),
      levelsQuery.execute(),
    ]);

    const byLevel = levels.map((r) => ({ level: r.level, count: Number(r.count) }));
    const total = byLevel.reduce((sum, { count }) => sum + count, 0);

    return {
      entries: decodedLogRows(entries),
      total,
      byLevel,
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
  getIngestionStats(): LogIngestionStats {
    const journal = this.journal.stats();
    return { ingestedTotal: this.ingestedTotal, droppedTotal: this.droppedTotal, bufferSize: journal.pending,
      durability: this.durability, journal, capture: this.capture, ownerPending: this.ownerPending, ownerError: this.ownerError,
      lastCommitAt: this.lastCommitAt, lastError: this.lastError ?? this.startupError };
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
  async getRecentLogs(filter: LogQueryFilter & { tail?: number }, localOnly = false): Promise<LogEntryRow[]> {
    validateLogQuery(filter);
    const tail = filter.tail ?? 50;

    let query = this.db.selectFrom('logs').selectAll();
    if (localOnly) query = query.where('nodeId', 'is', null);

    if (filter.app) query = query.where('app', '=', filter.app);
    if (filter.level) {
      if (Array.isArray(filter.level)) {
        query = query.where('level', 'in', filter.level);
      } else {
        query = query.where('level', '=', filter.level);
      }
    }
    if (filter.search) query = query.where('message', 'like', `%${escapeLike(filter.search)}%`);
    if (filter.traceId) query = query.where('traceId', '=', filter.traceId);

    if (filter.nodeId) query = query.where('nodeId', '=', filter.nodeId);
    if (filter.labels && Object.keys(filter.labels).length > 0) {
      // Both paths, deliberately: a filter honoured by the paginated query
      // and not by the live tail is how a viewer changes its answer when you
      // press Live.
      query = query.where(jsonContains(this.db, 'labels', filter.labels));
    }

    // Range filters — critical for efficient live polling (since parameter)
    if (filter.from) {
      const from = typeof filter.from === 'string' ? new Date(filter.from) : filter.from;
      query = query.where('timestamp', '>=', from);
    }
    if (filter.to) {
      const to = typeof filter.to === 'string' ? new Date(filter.to) : filter.to;
      query = query.where('timestamp', '<=', to);
    }

    // Get the last N entries, then reverse for chronological order
    const entries = await query
      .orderBy('timestamp', 'desc')
      .orderBy('id', 'desc')
      .limit(tail)
      .execute();

    return decodedLogRows(entries).reverse();
  }

  /**
   * The last `lines` stored records of one app, as the daemon's `getLogs`
   * answers — oldest first, each saying which machine it came from.
   *
   * `sourceNode` is the row's `nodeId`: the node that synced it, or `null` for
   * a line this machine captured itself. Under its own key in `data` because
   * the rest of `data` is the record's fields, and records carry `nodeId`s of
   * their own (the daemon logs them).
   */
  async storedEntries(app: string, lines: number, localOnly = false): Promise<LogEntryDto[]> {
    const rows = await this.getRecentLogs({ app, tail: Math.max(1, Math.min(lines, 10_000)) }, localOnly);
    return rows.map((row) => {
      const metadata = typeof row.metadata === 'string' ? safeJson(row.metadata) : row.metadata;
      return {
        timestamp: new Date(row.timestamp as unknown as string).getTime(),
        app: row.app,
        level: row.level,
        message: row.message,
        data: { ...(metadata ?? {}), sourceNode: row.nodeId ?? null },
      };
    });
  }

  // ===========================================================================
  // Buffer Flush
  // ===========================================================================

  /** Commit records and the replication outbox atomically. Replays verify identities. */
  async persistCaptured(batch: LogEntry[], requirePersistent = true): Promise<void> {
    if (!batch.length) return;
    // A repeated ID inside one RPC batch must not enqueue replication twice.
    const unique = new Map<string, ReturnType<typeof prepareEntry>>();
    for (const entry of batch) {
      const prepared = prepareEntry(entry), previous = unique.get(prepared.id);
      if (previous && previous.metadata!['_omnitronPayloadSha256'] !== prepared.metadata!['_omnitronPayloadSha256']) {
        this.lastError = `Log identity conflict: ${prepared.id}; conflicting batch retained`;
        throw new Error(this.lastError);
      }
      unique.set(prepared.id, previous ?? prepared);
    }
    const prepared = [...unique.values()];
    this.dialect ??= dialectOf(this.db);
    let written = 0;
    await this.db.transaction().execute(async trx => {
      this.durability = await assertLogDurability(trx);
      if (requirePersistent && this.durability !== 'persistent') throw new Error('Volatile storage cannot acknowledge durable captured logs');
      for (let offset = 0; offset < prepared.length; offset += 500) {
        const part = prepared.slice(offset, offset + 500);
        const rows = part.map(entry => ({ id: entry.id,
          timestamp: this.dialect === 'postgres' ? entry.timestamp : new Date(entry.timestamp),
          nodeId: entry.nodeId ?? null, app: entry.app, level: entry.level, message: entry.message,
          labels: entry.labels ? JSON.stringify(entry.labels) : null,
          traceId: entry.traceId ?? null, spanId: entry.spanId ?? null,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null }));
        const inserted = await trx.insertInto('logs').values(rows).onConflict(oc => oc.column('id').doNothing()).returning('id').execute();
        const ids = new Set(inserted.map(row => row.id));
        const duplicates = rows.filter(row => !ids.has(row.id));
        if (duplicates.length) {
          const existing = await trx.selectFrom('logs').selectAll().where('id', 'in', duplicates.map(row => row.id)).execute();
          const normalize = (row: Record<string, unknown>) => ({ ...row,
            timestamp: new Date(row['timestamp'] as string).toISOString(),
            labels: typeof row['labels'] === 'string' ? JSON.parse(row['labels']) : row['labels'],
            metadata: typeof row['metadata'] === 'string' ? JSON.parse(row['metadata']) : row['metadata'] });
          for (const row of duplicates) {
            const old = existing.find(value => value.id === row.id);
            const before = old ? normalize(old) : null;
            const incoming = normalize(row);
            for (const value of [before, incoming]) {
              const capture = value?.metadata?._omnitron;
              if (capture?.timeBasis === 'observed') {
                value!.timestamp = 'legacy-observation';
                value!.metadata = { ...value!.metadata, _omnitron: { ...capture, capturedAt: null, eventTime: null } };
              }
            }
            if (!before || !isDeepStrictEqual(before, incoming)) throw new Error(`Log identity conflict: ${row.id}; original and pending records preserved`);
          }
        }
        // An outbox failure rolls back the local rows as well. No fire-and-forget replication.
        if (this.syncSink && ids.size) await this.syncSink(part.filter(entry => ids.has(entry.id)), trx);
        written += ids.size;
      }
    }).catch(error => { this.lastError = error instanceof Error ? error.message : String(error); throw error; });
    this.ingestedTotal += written;
    this.lastCommitAt = new Date().toISOString();
    this.lastError = null;
    // Observer failures cannot turn a committed batch into another write attempt.
    try { this.emit('flushed', written); } catch { /* the commit remains authoritative */ }
  }

  private recoverStartupFailures(): void {
    if (!this.startupDirectory) return;
    let files: string[];
    try { files = fs.readdirSync(this.startupDirectory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    let recovered = 0;
    const failures: string[] = [];
    for (const name of files) {
      const match = /^([a-f0-9-]{36})\.(json|partial)$/.exec(name);
      if (!match) continue;
      // A complete fsynced file may survive before its atomic rename. Both
      // names share one import checkpoint; evidence files are never removed.
      const id = match[1]!, key = `${id}.json`;
      if (this.journal.importedFile(key)) continue;
      try {
        const filename = path.join(this.startupDirectory, name);
        const stat = fs.lstatSync(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || (stat.mode & 0o077)) throw new Error('must be a private bounded file');
        const bytes = fs.readFileSync(filename);
        const source = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
        const capture = source['_omnitron'] as Record<string, unknown> | undefined;
        if (capture?.['id'] !== id || source['event'] !== 'runtime.startup_failed'
          || typeof source['time'] !== 'string' || !Number.isFinite(Date.parse(source['time']))) throw new Error('invalid startup evidence');
        const entry: LogEntry = { id, app: 'omnitron', level: 'fatal',
          message: String(source['msg']), timestamp: source['time'],
          metadata: { component: source['component'], event: source['event'], err: source['err'], _omnitron: capture } };
        this.journal.importFile(key, createHash('sha256').update(bytes).digest('hex'), id, entry);
        if (++recovered >= 100) break;
      } catch (error) {
        // One damaged evidence file must not block valid files or ordinary
        // application capture. Report its name, never its potentially secret bytes.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failures.push(name);
      }
    }
    if (failures.length) throw new Error(`Startup evidence needs inspection: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? ` and ${failures.length - 5} more` : ''}; originals retained`);
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      try { this.recoverStartupFailures(); this.startupError = null; }
      catch (error) { this.startupError = error instanceof Error ? error.message : String(error); }
      if (this.sourceJournal) {
        const source = this.sourceJournal.peek();
        const stats = this.sourceStats?.() ?? this.sourceJournal.stats();
        this.ownerPending = stats.pending;
        this.ownerError = stats.error;
        if (source.length) {
          await this.persistCaptured(source.map(item => logEntryOf(item.value.app, item.value.record)));
          this.sourceJournal.acknowledge(source);
        }
      }
      const batch = this.journal.peek(FLUSH_BATCH_MAX);
      if (!batch.length) return;
      await this.persistCaptured(batch.map(item => item.value), this.journal.filename !== ':memory:');
      this.journal.acknowledge(batch);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      try { this.emit('flush_error', error); } catch { /* journal still retains the batch */ }
    } finally { this.flushing = false; }
  }

  /** A legacy owner cannot release its event cursor before every received line commits. */
  async confirmPending(): Promise<void> {
    this.assembler.sealAll();
    while (this.flushing) await new Promise(resolve => setTimeout(resolve, 10));
    while (this.journal.peek(1).length || this.sourceJournal?.peek(1).length) {
      await this.flush();
      if (this.lastError) throw new Error(this.lastError);
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
    if (this.disposed) return;
    // Seal pending multiline records before the final durable drain.
    this.assembler.dispose();
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

    // Drain all batches. During an outage retain them for the next process.
    try { await this.confirmPending(); } finally { if (this.ownsJournal) this.journal.close(); }
  }
}
