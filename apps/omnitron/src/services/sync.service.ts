/**
 * SyncService — Ultra-reliable slave→master data replication
 *
 * Architecture:
 * - Every slave daemon collects ALL metrics, logs, events, alerts locally
 * - Data is buffered in a local append-only WAL (write-ahead log) in omnitron-pg
 * - Periodically, slave attempts to push buffered data to master via Netron TCP
 * - On success: the entries the master confirms are marked as synced
 * - On failure: exponential backoff, retry later — the entries stay pending
 * - Sync batches are idempotent: the master keeps a ledger of what it took
 *
 * Guarantees:
 * 1. No loss on delivery failure — an entry is released only once the master
 *    has confirmed it holds it. Bounded by (5): when the buffer is over
 *    budget, undelivered entries are dropped oldest-first, loudly.
 * 2. Autonomous operation — slave works normally without master
 * 3. Eventual consistency — master sees all data when connectivity restores
 * 4. Conflict-free — operational data is append-only, config uses master-wins
 * 5. Bounded buffer — oldest entries evicted when maxBufferSize reached
 *
 * Four of these were stated here long before anything implemented them, and
 * every one of the failures was silent: replication that drops data still
 * reports a successful cycle, because what would have noticed is what was
 * missing. Guarantee 1 said "zero data loss" while both transports discarded
 * whatever the master rejected; the batches were called idempotent with
 * `batchId` used only inside log strings; and `maxBufferSize` was read from
 * config, defaulted to 500 MB, and never referenced again.
 *
 * Guarantee 1 is now stated as what it can be. "Zero data loss" was not
 * achievable alongside a bounded buffer, and writing it down did not make it
 * so — a slave that cannot reach its master eventually has to choose between
 * dropping data and filling the disk. It drops, oldest first, at warning
 * level with a count. See `sync-policy.ts`.
 *
 * WAL table: `sync_buffer` in slave's local omnitron-pg
 * Each entry: { id, category, payload (jsonb), createdAt, syncedAt (null until synced) }
 * Dedup ledger (master side): `sync_ingested`, keyed on (nodeId, slave entry id)
 */

import type { Kysely, Transaction } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { OmnitronDatabase } from '../database/schema.js';
import type { ISyncConfig, DaemonRole } from '../config/types.js';
import type { ISyncStatus } from '../shared/dto/project.js';
import { toIsoUtc } from '../database/sqlite-date-binding.js';
import { describeError } from '../shared/describe-error.js';
import {
  classifyIngestFailure,
  deliveredIds,
  sweepMadeProgress,
  planEviction,
  SYNCED_RETENTION_MS,
  type IngestOutcome,
} from './sync-policy.js';

// =============================================================================
// Types
// =============================================================================

export type SyncCategory = 'metrics' | 'logs' | 'events' | 'alerts' | 'traces' | 'state';

/**
 * Records one ingested remote metric into the store the console reads.
 *
 * `node` is separate from `labels` in the signature so it cannot be left out
 * by a caller building the label map — which is the failure this exists to
 * prevent.
 */
export type MetricsSink = (sample: {
  node: string;
  name: string;
  app: string;
  labels: Record<string, string>;
  value: number;
}) => void;

export interface SyncEntry {
  category: SyncCategory;
  payload: Record<string, unknown>;
}

export interface SyncBatch {
  nodeId: string;
  batchId: string;
  /** SHA-256 checksum of JSON.stringify(entries) — verified on master */
  checksum: string;
  entries: Array<{ id: string; category: SyncCategory; payload: Record<string, unknown>; createdAt: string }>;
}

/**
 * Either the pooled connection or a transaction handle. Ingestion runs
 * inside the transaction that claims the entry, so it cannot take `this.db`.
 */
export type SyncExecutor = Kysely<OmnitronDatabase> | Transaction<OmnitronDatabase>;

/**
 * What the master did with a batch.
 *
 * `accepted` stays a number so the existing RPC contract is unchanged; the
 * id lists are the addition. Without them the slave could only learn *how
 * many* entries survived, never *which* — and so marked all of them
 * delivered, which is how the "zero data loss" guarantee was losing data.
 */
export interface IngestBatchResult {
  accepted: number;
  duplicates: number;
  acceptedIds: string[];
  duplicateIds: string[];
  failedIds: string[];
  /**
   * Entries the master will never accept, and the slave should release.
   *
   * Distinct from `failedIds`, which are worth offering again. An entry the
   * database refuses on its content — a malformed uuid, a foreign key the
   * master does not have — answers the same way every time, and leaving it
   * unacknowledged parks it at the head of the buffer with everything behind
   * it waiting.
   */
  discardedIds: string[];
}

interface SyncBackoffState {
  attempt: number;
  nextRetryAt: number;
}

/** Rate limiter state per nodeId */
interface RateLimitEntry {
  windowStart: number;
  count: number;
}

/** Max batches per node per minute */
const RATE_LIMIT_PER_MINUTE = 60;

// =============================================================================
// SyncService
// =============================================================================

/** ISyncConfig with all fields (including nested backoff) required and non-optional. */
interface ResolvedSyncConfig {
  interval: number;
  batchSize: number;
  backoff: { initial: number; max: number; factor: number };
  categories: Array<'metrics' | 'logs' | 'events' | 'alerts' | 'traces' | 'state'>;
  bufferPath: string;
  maxBufferSize: number;
}

export class SyncService {
  /** Set on a master; see `setMetricsSink`. */
  private metricsSink: MetricsSink | null = null;

  private readonly config: ResolvedSyncConfig;
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private backoff: SyncBackoffState = { attempt: 0, nextRetryAt: 0 };
  private lastSyncAt: number | null = null;
  private lastError: string | null = null;
  private disposed = false;

  /** Master RPC invoke function — injected at connect time */
  private masterInvoke: ((service: string, method: string, args: unknown[]) => Promise<unknown>) | null = null;

  /** Rate limiter state per nodeId (master-side) */
  private readonly rateLimits = new Map<string, RateLimitEntry>();

  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly logger: ILogger,
    private readonly nodeId: string,
    private readonly role: DaemonRole,
    syncConfig?: ISyncConfig,
  ) {
    this.config = {
      interval: syncConfig?.interval ?? 30_000,
      batchSize: syncConfig?.batchSize ?? 1000,
      backoff: {
        initial: syncConfig?.backoff?.initial ?? 5_000,
        max: syncConfig?.backoff?.max ?? 300_000, // 5 min max
        factor: syncConfig?.backoff?.factor ?? 2,
      },
      categories: syncConfig?.categories ?? ['metrics', 'logs', 'events', 'alerts', 'traces', 'state'],
      bufferPath: syncConfig?.bufferPath ?? '~/.omnitron/sync-buffer/',
      maxBufferSize: syncConfig?.maxBufferSize ?? 500 * 1024 * 1024, // 500MB
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the sync loop.
   * Only runs on slave daemons — master is a no-op.
   */
  start(): void {
    if (this.role !== 'slave') {
      this.logger.debug({ role: this.role }, 'Sync not needed for this daemon role');
      return;
    }

    this.logger.info(
      { interval: this.config.interval, batchSize: this.config.batchSize, categories: this.config.categories },
      'Starting sync service'
    );

    this.syncTimer = setInterval(() => {
      this.syncTick().catch((err) => {
        this.logger.error({ error: (err as Error).message }, 'Sync cycle failed');
      });
    }, this.config.interval);
    this.syncTimer.unref();

    // Initial sync attempt — reported like every other one. The recurring
    // call four lines above logs its failure; this one swallowed it, and it
    // is the more informative of the two: it is the first evidence that a
    // slave can reach its master at all.
    this.syncTick().catch((err) => {
      this.logger.error({ error: (err as Error).message }, 'Initial sync cycle failed');
    });
  }

  /**
   * Stop the sync loop and flush remaining buffer.
   */
  async stop(): Promise<void> {
    this.disposed = true;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Final sync attempt before shutdown
    if (this.role === 'slave' && this.masterInvoke) {
      try {
        await this.syncCycle();
      } catch {
        this.logger.warn('Final sync attempt failed — data preserved in local WAL');
      }
    }
  }

  /**
   * Set the master RPC connection.
   * Called when slave establishes Netron TCP connection to master.
   */
  setMasterConnection(invoke: (service: string, method: string, args: unknown[]) => Promise<unknown>): void {
    this.masterInvoke = invoke;
    this.backoff = { attempt: 0, nextRetryAt: 0 };
    this.logger.info('Master connection established — sync enabled');
  }

  /**
   * Clear master connection (disconnect/failure).
   */
  clearMasterConnection(): void {
    this.masterInvoke = null;
    this.logger.warn('Master connection lost — buffering locally');
  }

  // ===========================================================================
  // Buffer Operations (write to local WAL)
  // ===========================================================================

  /**
   * Buffer a single entry for sync to master.
   * Called by local collectors (metrics, logs, alerts, events).
   * Returns immediately — never blocks the caller.
   */
  async buffer(entry: SyncEntry): Promise<void> {
    if (this.role !== 'slave') return;
    if (!this.config.categories.includes(entry.category)) return;

    try {
      await this.db.insertInto('sync_buffer').values({
        category: entry.category,
        payload: JSON.stringify(entry.payload),
      }).execute();
    } catch (err) {
      this.logger.error(
        { nodeId: this.nodeId, category: entry.category, error: (err as Error).message },
        'Failed to buffer sync entry — it will not reach the master',
      );
    }
  }

  /**
   * Where ingested remote metrics are recorded, on a master.
   *
   * Set by the daemon to `MetricsService.recordTyped`. Without it, remote
   * metrics only reach `metrics_raw` — a table nothing in this repository
   * reads, and the console's charts query titan-metrics storage instead. A
   * remote node's readings would arrive, persist, and be invisible.
   *
   * A sink rather than a constructor dependency: this service is built by
   * hand in `daemon.ts` with five positional arguments, and a sixth is a
   * change every caller has to get right at runtime rather than at compile
   * time.
   */
  setMetricsSink(sink: MetricsSink | null): void {
    this.metricsSink = sink;
  }

  /**
   * Buffer multiple entries at once (batch optimization).
   */
  async bufferBatch(entries: SyncEntry[]): Promise<void> {
    if (this.role !== 'slave' || entries.length === 0) return;

    const filteredEntries = entries.filter((e) => this.config.categories.includes(e.category));
    if (filteredEntries.length === 0) return;

    try {
      await this.db.insertInto('sync_buffer').values(
        filteredEntries.map((e) => ({
          category: e.category,
          payload: JSON.stringify(e.payload),
        }))
      ).execute();
    } catch (err) {
      // ERROR, with the node and the size. A buffer that refuses is data
      // this node will never replicate, and on the master it looks exactly
      // like a node that had nothing to say — someone reads an empty screen
      // and draws a conclusion about the system rather than about the pipe.
      this.logger.error(
        { nodeId: this.nodeId, count: filteredEntries.length, category: filteredEntries[0]?.category, error: (err as Error).message },
        'Failed to buffer sync batch — these entries will not reach the master',
      );
    }
  }

  // ===========================================================================
  // Pull API (master pulls buffered data from slave)
  // ===========================================================================

  /**
   * Hand pending entries to the master — called by the master via RPC.
   *
   * This used to mark the entries synced before returning them, and called
   * that idempotent. It is the opposite: a response lost in transit, a
   * checksum mismatch or a rate-limit rejection left the data marked
   * delivered on the slave and absent on the master, to be evicted twenty-
   * four hours later. The caller logged the failure at debug level.
   *
   * Entries are released only by `ackDrained`, after the master has them.
   * Re-draining before that returns the same entries, which is correct and
   * is what the deduplication ledger on the master side is for.
   */
  async drainBuffer(limit?: number): Promise<SyncBatch> {
    return this.fetchPendingBatch(limit);
  }

  /**
   * Release entries the master has confirmed it holds.
   *
   * Called after `receiveBatch` succeeds. Split from `drainBuffer` so that
   * everything between the two — the network, the checksum, the ingestion —
   * can fail without the slave forgetting the data.
   */
  async ackDrained(ids: string[]): Promise<{ released: number }> {
    if (ids.length === 0) return { released: 0 };
    await this.markSynced(ids);
    this.lastSyncAt = Date.now();
    return { released: ids.length };
  }

  // ===========================================================================
  // Sync Cycle (push to master — legacy, kept for backward compatibility)
  // ===========================================================================

  /**
   * One scheduled pass: bound the buffer, then try to drain it.
   *
   * The order is the whole point. `enforceBufferBounds` used to be the last
   * statement of `syncCycle`'s `try`, which meant it ran on a SUCCESSFUL
   * cycle and on nothing else — and a successful cycle is the one case where
   * the buffer is being drained and needs no bound. Every path that leaves it
   * growing skipped it:
   *
   *   - no master configured at all → `syncCycle` returns at its second line;
   *   - master unreachable → the push throws and control leaves via `catch`;
   *   - and then the backoff, which saturates at five minutes, returns at the
   *     third line for most ticks after that.
   *
   * So the guarantee in this file's header — "bounded buffer, oldest entries
   * evicted when maxBufferSize is reached" — held only while it was not
   * needed. A slave that lost its master still buffered until the disk filled,
   * which is the exact failure the bound was written to prevent and the
   * reason it is not read as a replication bug when it happens: what fills is
   * the disk, and what breaks is everything else sharing it.
   *
   * The bound is a local database operation. It needs no master, so it does
   * not belong behind a check for one.
   */
  private async syncTick(): Promise<void> {
    if (this.disposed) return;
    await this.enforceBufferBounds();
    await this.syncCycle();
  }

  private async syncCycle(): Promise<void> {
    if (this.disposed || this.isSyncing) return;
    if (!this.masterInvoke) return; // No master connection — skip

    // Respect backoff
    if (Date.now() < this.backoff.nextRetryAt) return;

    this.isSyncing = true;

    try {
      let totalSynced = 0;
      let totalRefused = 0;
      const seenThisCycle = new Set<string>();

      // Sync in batches until no more pending entries
      while (true) {
        const batch = await this.fetchPendingBatch();
        if (batch.entries.length === 0) break;

        const outcome = await this.pushBatch(batch);
        const delivered = deliveredIds(outcome);
        await this.markSynced(delivered);
        totalSynced += delivered.length;
        totalRefused += outcome.failed.length;

        // Entries the master rejected stay pending, so the next fetch
        // returns them again. Stop the sweep when a page yields nothing new
        // — otherwise a permanently unacceptable entry loops here forever.
        if (!sweepMadeProgress(seenThisCycle, batch.entries.map((e) => e.id))) {
          this.logger.warn(
            { nodeId: this.nodeId, pending: batch.entries.length },
            'Sync sweep stalled — the master is rejecting the oldest pending entries'
          );
          break;
        }
        for (const e of batch.entries) seenThisCycle.add(e.id);

        // Don't monopolize — yield after each batch
        if (totalSynced >= this.config.batchSize * 5) break;
      }

      if (totalSynced > 0) {
        this.logger.info({ synced: totalSynced }, 'Sync cycle completed');
      }

      // A cycle that delivered NOTHING and was refused everything is not a
      // success, even though nothing threw.
      //
      // Only one of the two ways to fail used to reach the backoff. An
      // unreachable master makes the push throw, and the `catch` below grows
      // the delay to five minutes. But a master that ANSWERS and says no to
      // every entry returns normally — and control arrived here, at a reset
      // of a backoff that had never been set. That is how 1000 entries were
      // offered 94 times in 37 minutes while the master's own Postgres was
      // down behind a stopped Docker: the RPC succeeded on every attempt,
      // and only the ingest failed. The configured delay (5 s, doubling, to
      // 300 s) would have made that about a dozen attempts; it was never
      // consulted.
      if (totalSynced === 0 && totalRefused > 0) {
        this.noteSyncFailure(`master refused every entry (${totalRefused})`);
        return;
      }

      // Reset backoff on success
      this.backoff = { attempt: 0, nextRetryAt: 0 };
      this.lastSyncAt = Date.now();
      this.lastError = null;
    } catch (err) {
      this.noteSyncFailure(describeError(err));
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Grow the retry delay and record why.
   *
   * Shared by both ways a cycle can fail — a master that cannot be reached,
   * and a master that answers no — because the buffer does not care which
   * one it was, and neither does the disk it is filling.
   */
  private noteSyncFailure(message: string): void {
    this.lastError = message;
    this.backoff.attempt++;

    const delay = Math.min(
      this.config.backoff.initial * Math.pow(this.config.backoff.factor, this.backoff.attempt),
      this.config.backoff.max,
    );
    this.backoff.nextRetryAt = Date.now() + delay;

    this.logger.warn(
      { error: message, attempt: this.backoff.attempt, nextRetryMs: delay },
      'Sync failed — will retry'
    );
  }

  private async fetchPendingBatch(limit?: number): Promise<SyncBatch> {
    const rows = await this.db
      .selectFrom('sync_buffer')
      .selectAll()
      .where('syncedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .limit(limit ?? this.config.batchSize)
      .execute();

    const batchId = `${this.nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const entries = rows.map((r) => ({
      id: String(r.id),
      category: r.category as SyncCategory,
      payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
      // Whatever spelling the local column holds, the master receives a
      // timestamp that states its zone. See `toIsoUtc`.
      createdAt: toIsoUtc(r.createdAt),
    }));

    // Compute integrity checksum
    const checksum = await this.computeChecksum(entries);

    return { nodeId: this.nodeId, batchId, checksum, entries };
  }

  private async computeChecksum(entries: SyncBatch['entries']): Promise<string> {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(entries));
    return hash.digest('hex');
  }

  /**
   * Push a batch and report what the master kept.
   *
   * The return value used to be discarded, and `receiveBatch` swallows
   * per-entry ingestion failures into a warning — so the caller marked every
   * entry delivered whether or not any of them arrived. A master response
   * without the id lists is treated as "all delivered", which is what an
   * older master would mean by it; that is the only reading that does not
   * silently retry everything against a peer that cannot tell us otherwise.
   */
  private async pushBatch(batch: SyncBatch): Promise<IngestOutcome> {
    if (!this.masterInvoke) throw new Error('No master connection');

    const response = (await this.masterInvoke('OmnitronSync', 'receiveBatch', [batch])) as
      | Partial<IngestBatchResult>
      | undefined;

    const allIds = batch.entries.map((e) => e.id);
    if (!response || !Array.isArray(response.acceptedIds)) {
      return { accepted: allIds, duplicates: [], failed: [], discarded: [] };
    }
    return {
      accepted: response.acceptedIds,
      duplicates: Array.isArray(response.duplicateIds) ? response.duplicateIds : [],
      failed: Array.isArray(response.failedIds) ? response.failedIds : [],
      // An older master answers without this field. Treating a missing list
      // as an empty one is right: it discarded nothing.
      discarded: Array.isArray(response.discardedIds) ? response.discardedIds : [],
    };
  }

  private async markSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .updateTable('sync_buffer')
      .set({ syncedAt: new Date() })
      .where('id', 'in', ids)
      .execute();
  }

  /**
   * Keep the WAL inside `maxBufferSize`.
   *
   * Guarantee 5 in the header of this file — "bounded buffer, oldest entries
   * evicted when maxBufferSize reached" — had no implementation:
   * `maxBufferSize` was read from config, defaulted to 500 MB, and never
   * referenced again. The only eviction was of *synced* rows older than a
   * day, so a slave that lost its master buffered until the disk filled. The
   * failure lands on everything else sharing that disk, which is why it
   * would never have been read as a replication bug.
   *
   * Two passes. The routine one removes delivered entries past their
   * retention. The overflow one runs only when the table is still over
   * budget and removes oldest-first regardless of delivery — at which point
   * data is being dropped, so it is said at warning level with the count.
   */
  private async enforceBufferBounds(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - SYNCED_RETENTION_MS);
      await this.db
        .deleteFrom('sync_buffer')
        .where('syncedAt', 'is not', null)
        .where('syncedAt', '<', cutoff)
        .execute();

      const stats = await this.bufferStats();
      if (!stats) return;

      const plan = planEviction({
        totalBytes: stats.totalBytes,
        maxBytes: this.config.maxBufferSize,
        totalRows: stats.totalRows,
        syncedRows: stats.syncedRows,
      });
      if (plan.overflowRows === 0) return;

      // Oldest first, delivered before undelivered — so an overflow that is
      // small enough to be absorbed by already-synced rows costs nothing.
      const doomed = await this.db
        .selectFrom('sync_buffer')
        .select('id')
        .orderBy('syncedAt', 'desc')
        .orderBy('createdAt', 'asc')
        .limit(plan.overflowRows)
        .execute();

      if (doomed.length === 0) return;
      await this.db
        .deleteFrom('sync_buffer')
        .where('id', 'in', doomed.map((r) => String(r.id)))
        .execute();

      const level = plan.discardsUndelivered ? 'warn' : 'info';
      this.logger[level](
        {
          dropped: doomed.length,
          totalBytes: stats.totalBytes,
          maxBytes: this.config.maxBufferSize,
          undelivered: plan.discardsUndelivered,
        },
        plan.discardsUndelivered
          ? 'Sync buffer over budget — dropped entries the master never received'
          : 'Sync buffer over budget — dropped delivered entries'
      );
    } catch (err) {
      // Losing a retention pass is survivable; losing it in silence is how
      // the unbounded growth stayed invisible in the first place.
      this.logger.warn({ error: (err as Error).message }, 'Sync buffer retention pass failed');
    }
  }

  /**
   * Size and row counts of the WAL, or null when the database cannot say.
   *
   * This asked `pg_total_relation_size('sync_buffer')` — a Postgres function,
   * about the one table that only ever exists where the database is SQLite.
   * A slave buffers and a master receives, so the measurement the bound above
   * depends on threw `no such function: pg_total_relation_size` on every
   * pass, on every slave. Observed on a provisioned node, every thirty
   * seconds, immediately behind the `Date`-binding fix that let the pass get
   * this far:
   *
   *     05:58:48  Sync buffer retention pass failed
   *       error: "no such function: pg_total_relation_size"
   *
   * Three defects stacked on one guarantee: the bound ran only on the cycle
   * that did not need it, then could not bind its own cutoff, and then could
   * not measure. Each fix revealed the next, and only the last one makes
   * "bounded buffer" true. The routine delete of synced rows sits before this
   * call and was unaffected throughout.
   *
   * The replacement measures the same quantity in the same terms on both
   * dialects: the bytes of the buffered payloads. That is deliberately not
   * the relation's on-disk footprint — it excludes indexes, row headers and
   * Postgres's TOAST compression — because one definition of `maxBufferSize`
   * that means the same thing on a master and on a slave is worth more than
   * two that each drift by whatever their storage engine adds. The payload is
   * the term that grows.
   *
   * `cast(payload as text)` is required by both: the column is `jsonb` on
   * Postgres, where `length()` has no jsonb form, and TEXT on SQLite, where
   * the cast costs nothing. `octet_length` rather than `length` because the
   * second counts CHARACTERS — a buffer of Cyrillic log lines measures at
   * half its size, and a budget is about bytes. Verified against both engines
   * (postgres:17-alpine, better-sqlite3 13.0.3 / SQLite 3.53.4).
   */
  private async bufferStats(): Promise<{ totalBytes: number; totalRows: number; syncedRows: number } | null> {
    const { sql } = await import('kysely');
    const row = await sql<{ total_bytes: string | number; total_rows: string | number; synced_rows: string | number }>`
      SELECT coalesce(sum(octet_length(cast(payload as text))), 0) AS total_bytes,
             count(*) AS total_rows,
             count(*) FILTER (WHERE "syncedAt" IS NOT NULL) AS synced_rows
      FROM sync_buffer
    `.execute(this.db);

    const first = row.rows[0];
    if (!first) return null;
    return {
      totalBytes: Number(first.total_bytes),
      totalRows: Number(first.total_rows),
      syncedRows: Number(first.synced_rows),
    };
  }

  // ===========================================================================
  // Master-Side: Receive Batch
  // ===========================================================================

  /**
   * Receive a sync batch from a slave.
   * Called on the master daemon via RPC.
   * Ingests data into the master's omnitron-pg.
   */
  async receiveBatch(batch: SyncBatch): Promise<IngestBatchResult> {
    if (this.role !== 'master') {
      throw new Error('Only master daemon can receive sync batches');
    }

    // A batch has to say which node it came from, and this is the only place
    // that can insist. Everything downstream labels the data with `nodeId`:
    // logs are stored under it, and metrics are recorded with it as a label
    // that separates this node's readings from the master's own. An empty or
    // missing value does not fail there — it quietly merges two machines into
    // one, and a chart then shows the sum of both under a single name.
    // Refused by name rather than defaulted.
    if (typeof batch.nodeId !== 'string' || batch.nodeId.trim() === '') {
      throw new Error('Sync batch rejected: `nodeId` is required and must be a non-empty string.');
    }

    // Rate limiting — prevent flood from misbehaving slaves
    if (!this.checkRateLimit(batch.nodeId)) {
      throw new Error(`Rate limit exceeded for node ${batch.nodeId}. Max ${RATE_LIMIT_PER_MINUTE} batches/min.`);
    }

    // Integrity verification — reject corrupted batches
    const expectedChecksum = await this.computeChecksum(batch.entries);
    if (!batch.checksum || batch.checksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch for batch ${batch.batchId}. Expected ${expectedChecksum}, got ${batch.checksum}. Batch rejected.`);
    }

    const outcome: IngestOutcome = { accepted: [], duplicates: [], failed: [], discarded: [] };
    // Why entries were refused, and how many times each reason came up. A
    // thousand entries failing on one dead database is ONE event; naming the
    // reason per entry buried the cause under its own repetitions.
    const causes = new Map<string, number>();

    for (const entry of batch.entries) {
      try {
        // Claim the entry, then ingest it, in one transaction. A failure
        // rolls the claim back, so the entry is retried rather than recorded
        // as taken; a conflicting claim means this batch repeats one already
        // applied, which is what "idempotent" was always supposed to mean.
        const result = await this.claimAndIngest(batch.nodeId, entry);
        if (result === 'duplicate') outcome.duplicates.push(entry.id);
        else if (result === 'discarded') outcome.discarded.push(entry.id);
        else outcome.accepted.push(entry.id);
      } catch (err) {
        // Not marked delivered. The slave keeps it and offers it again —
        // previously this warning was the only trace of an entry that had
        // just been dropped on both sides.
        outcome.failed.push(entry.id);
        // `(err as Error).message` was the empty string for the commonest
        // failure of all — an unreachable database arrives as an
        // `AggregateError` whose reasons live in `.errors`. 76 659 records in
        // one hour carried `error: ""`, while the cause was named in three
        // lines of the file next to it.
        const cause = describeError(err);
        causes.set(cause, (causes.get(cause) ?? 0) + 1);
        this.logger.debug(
          { nodeId: batch.nodeId, entryId: entry.id, category: entry.category, error: cause },
          'Failed to ingest sync entry — left unacknowledged for retry'
        );
      }
    }

    if (outcome.failed.length > 0) {
      this.logger.warn(
        {
          nodeId: batch.nodeId,
          batchId: batch.batchId,
          failed: outcome.failed.length,
          total: batch.entries.length,
          causes: [...causes.entries()].map(([cause, count]) => `${cause} ×${count}`),
        },
        'Sync batch partially ingested'
      );
    } else {
      this.logger.debug(
        {
          nodeId: batch.nodeId,
          batchId: batch.batchId,
          accepted: outcome.accepted.length,
          duplicates: outcome.duplicates.length,
          total: batch.entries.length,
        },
        'Sync batch received'
      );
    }

    return {
      // Kept as a number for the existing RPC contract; the id lists are
      // what the slave needs to know which entries it may release.
      accepted: outcome.accepted.length,
      duplicates: outcome.duplicates.length,
      acceptedIds: outcome.accepted,
      duplicateIds: outcome.duplicates,
      failedIds: outcome.failed,
      // Released, not stored. The slave must let these go or it offers them
      // forever; the ERROR beside each one is the only record that they
      // existed.
      discardedIds: outcome.discarded,
    };
  }

  /**
   * Record the entry as taken and ingest it, atomically.
   *
   * Returns `'duplicate'` when the master already holds it — a retry after a
   * lost acknowledgement, which is delivery, not failure. Throws when
   * ingestion fails, leaving nothing recorded.
   */
  private async claimAndIngest(
    nodeId: string,
    entry: { id: string; category: SyncCategory; payload: Record<string, unknown>; createdAt: string }
  ): Promise<'accepted' | 'duplicate' | 'discarded'> {
    try {
      return await this.claimAndIngestOnce(nodeId, entry);
    } catch (err) {
      if (classifyIngestFailure(err) !== 'permanent') throw err;

      // The database says this entry can never be stored. Leaving it
      // unacknowledged would offer it again on every sweep, forever, with
      // everything behind it in the buffer waiting — and the only symptom is
      // one "Sync pull stalled" line per pull.
      //
      // The claim is made in its own transaction because the one above rolled
      // back with the failure, taking the claim with it. Claiming it here is
      // what stops it coming back.
      await this.db
        .insertInto('sync_ingested')
        .values({ nodeId, entryId: entry.id })
        .onConflict((oc) => oc.columns(['nodeId', 'entryId']).doNothing())
        .execute()
        .catch(() => undefined);

      // ERROR, with everything needed to find the entry: this is data that
      // will never arrive, and the node has been told to forget it.
      this.logger.error(
        { nodeId, entryId: entry.id, category: entry.category, error: (err as Error).message },
        'Sync entry rejected permanently — discarded so the buffer can drain',
      );
      return 'discarded';
    }
  }

  private async claimAndIngestOnce(
    nodeId: string,
    entry: { id: string; category: SyncCategory; payload: Record<string, unknown>; createdAt: string }
  ): Promise<'accepted' | 'duplicate'> {
    return this.db.transaction().execute(async (trx) => {
      const claim = await trx
        .insertInto('sync_ingested')
        .values({ nodeId, entryId: entry.id })
        .onConflict((oc) => oc.columns(['nodeId', 'entryId']).doNothing())
        .returning('entryId')
        .executeTakeFirst();

      if (!claim) return 'duplicate';

      switch (entry.category) {
        case 'metrics':
          await this.ingestMetric(trx, nodeId, entry);
          break;
        case 'logs':
          await this.ingestLog(trx, nodeId, entry);
          break;
        case 'alerts':
          await this.ingestAlert(trx, nodeId, entry);
          break;
        case 'traces':
          await this.ingestTrace(trx, nodeId, entry);
          break;
        case 'events':
        case 'state':
          // Events and state changes stored as logs with category label
          await this.ingestLog(trx, nodeId, {
            ...entry,
            payload: { ...entry.payload, _category: entry.category },
          });
          break;
        default:
          // An unknown category is not a failure to retry — retrying cannot
          // make it known. It is claimed and dropped, so the slave releases
          // it, and said once at warning level rather than debug: a category
          // the master does not understand means the two are out of step.
          this.logger.warn(
            { nodeId, entryId: entry.id, category: entry.category },
            'Unknown sync category — entry discarded'
          );
          break;
      }
      return 'accepted';
    });
  }

  // ===========================================================================
  // Master-Side: Data Ingestion
  // ===========================================================================

  /**
   * Store one remote metric sample.
   *
   * Two destinations while the second is being proven. `metrics_raw` is where
   * this always went — and nothing in this repository reads that table, so a
   * connected pipeline would have filled it invisibly. The sink records the
   * same sample into titan-metrics, which is what the console's `getSnapshot`
   * and `querySeries` actually read, tagged with `node` so a remote reading
   * is a label dimension rather than a second table.
   *
   * The `metrics_raw` write stays until the console is observed showing the
   * label. Removing the old path before the new one is seen working is how
   * you end up with neither.
   */
  private async ingestMetric(db: SyncExecutor, nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void> {
    if (this.metricsSink) {
      const labels = (entry.payload['labels'] ?? {}) as Record<string, string>;
      this.metricsSink({
        node: nodeId,
        name: String(entry.payload['name'] ?? 'unknown'),
        app: String(entry.payload['app'] ?? 'unknown'),
        labels,
        value: Number(entry.payload['value'] ?? 0),
      });
    }

    await db.insertInto('metrics_raw').values({
      timestamp: entry.createdAt,
      nodeId,
      app: (entry.payload['app'] as string) ?? 'unknown',
      name: (entry.payload['name'] as string) ?? 'unknown',
      value: Number(entry.payload['value'] ?? 0),
      labels: JSON.stringify(entry.payload['labels'] ?? {}) as any,
    }).execute();
  }

  private async ingestLog(db: SyncExecutor, nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void> {
    await db.insertInto('logs').values({
      timestamp: (entry.payload['timestamp'] as string) ?? entry.createdAt,
      nodeId,
      app: (entry.payload['app'] as string) ?? 'unknown',
      level: (entry.payload['level'] as string) ?? 'info',
      message: (entry.payload['message'] as string) ?? '',
      labels: JSON.stringify(entry.payload['labels'] ?? {}) as any,
      traceId: (entry.payload['traceId'] as string) ?? null,
      spanId: (entry.payload['spanId'] as string) ?? null,
      metadata: entry.payload['metadata'] ? JSON.stringify(entry.payload['metadata']) as any : null,
    }).execute();
  }

  /**
   * A remote alert, with the machine that raised it.
   *
   * `nodeId` was `_nodeId` here: accepted and discarded. `alert_events` has
   * no node column, so it goes into `annotations`, which is the jsonb this
   * table already carries context in — an alert that says "disk above 90%"
   * and cannot say whose disk is an alert an operator cannot act on.
   *
   * `ruleId` keeps its `?? 'unknown'` only so the shape is unchanged; the
   * column is a `uuid` with a foreign key to `alert_rules`, so that literal
   * is refused by the database and the entry is now discarded by
   * `classifyIngestFailure` instead of being offered forever. A slave's
   * rules are its own, so the same is true of any real ruleId the master
   * does not share — which is what makes the permanent-failure path the
   * important half of this.
   */
  private async ingestAlert(db: SyncExecutor, nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void> {
    const annotations = {
      ...(entry.payload['annotations'] as Record<string, unknown> | undefined),
      node: nodeId,
    };
    await db.insertInto('alert_events').values({
      ruleId: (entry.payload['ruleId'] as string) ?? 'unknown',
      status: (entry.payload['status'] as string) ?? 'firing',
      value: entry.payload['value'] != null ? String(entry.payload['value']) : null,
      annotations: JSON.stringify(annotations) as any,
      firedAt: (entry.payload['firedAt'] as string) ?? entry.createdAt,
      resolvedAt: (entry.payload['resolvedAt'] as string) ?? null,
      acknowledgedAt: null,
      acknowledgedBy: null,
    }).execute();
  }

  /**
   * A remote span, with the machine that produced it.
   *
   * The node went into `tags` as `entry.payload['tags'] ?? { nodeId }` — a
   * fallback, so it was recorded ONLY for a span that carried no tags at
   * all, and dropped for every span that carried any. The `??` fires exactly
   * when there is nothing to lose and is skipped exactly when there is.
   * Merged now, and the node wins the key, because the span's own view of
   * which node it ran on is the one thing about it the master can check.
   */
  private async ingestTrace(db: SyncExecutor, nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void> {
    await db.insertInto('traces').values({
      traceId: (entry.payload['traceId'] as string) ?? 'unknown',
      spanId: (entry.payload['spanId'] as string) ?? 'unknown',
      parentSpanId: (entry.payload['parentSpanId'] as string) ?? null,
      operationName: (entry.payload['operationName'] as string) ?? 'unknown',
      serviceName: (entry.payload['serviceName'] as string) ?? 'unknown',
      startTime: (entry.payload['startTime'] as string) ?? entry.createdAt,
      endTime: (entry.payload['endTime'] as string) ?? entry.createdAt,
      duration: Number(entry.payload['duration'] ?? 0),
      status: (entry.payload['status'] as string) ?? 'ok',
      tags: JSON.stringify({ ...(entry.payload['tags'] as Record<string, unknown> | undefined), node: nodeId }) as any,
      logs: entry.payload['logs'] ? JSON.stringify(entry.payload['logs']) as any : null,
    }).execute();
  }

  // ===========================================================================
  // Rate Limiting (master-side)
  // ===========================================================================

  private checkRateLimit(nodeId: string): boolean {
    const now = Date.now();
    let entry = this.rateLimits.get(nodeId);

    if (!entry || now - entry.windowStart > 60_000) {
      entry = { windowStart: now, count: 0 };
      this.rateLimits.set(nodeId, entry);
    }

    entry.count++;
    this.cleanupRateLimits();
    return entry.count <= RATE_LIMIT_PER_MINUTE;
  }

  /** Remove rate limit entries older than 2 minutes to prevent memory leaks. */
  private cleanupRateLimits(): void {
    const cutoff = Date.now() - 120_000;
    for (const [nodeId, entry] of this.rateLimits) {
      if (entry.windowStart < cutoff) {
        this.rateLimits.delete(nodeId);
      }
    }
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  async getStatus(): Promise<ISyncStatus> {
    let pendingItems = 0;
    let bufferSize = 0;

    if (this.role === 'slave') {
      try {
        const result = await this.db
          .selectFrom('sync_buffer')
          .select((eb) => [
            eb.fn.count('id').as('count'),
          ])
          .where('syncedAt', 'is', null)
          .executeTakeFirst();
        pendingItems = Number(result?.count ?? 0);
        // Estimate buffer size: pending rows * ~256 bytes average row size
        bufferSize = pendingItems * 256;
      } catch {
        // Table may not exist yet
      }
    }

    return {
      connected: this.masterInvoke !== null,
      lastSyncAt: this.lastSyncAt,
      pendingItems,
      bufferSize,
      lastError: this.lastError,
      failedAttempts: this.backoff.attempt,
    };
  }
}
