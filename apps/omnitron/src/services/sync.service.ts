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
import {
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
      this.syncCycle().catch((err) => {
        this.logger.error({ error: (err as Error).message }, 'Sync cycle failed');
      });
    }, this.config.interval);
    this.syncTimer.unref();

    // Initial sync attempt
    this.syncCycle().catch(() => {});
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
      this.logger.warn({ category: entry.category, error: (err as Error).message }, 'Failed to buffer sync entry');
    }
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
      this.logger.warn({ count: entries.length, error: (err as Error).message }, 'Failed to buffer sync batch');
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

  private async syncCycle(): Promise<void> {
    if (this.disposed || this.isSyncing) return;
    if (!this.masterInvoke) return; // No master connection — skip

    // Respect backoff
    if (Date.now() < this.backoff.nextRetryAt) return;

    this.isSyncing = true;

    try {
      let totalSynced = 0;
      const seenThisCycle = new Set<string>();

      // Sync in batches until no more pending entries
      while (true) {
        const batch = await this.fetchPendingBatch();
        if (batch.entries.length === 0) break;

        const outcome = await this.pushBatch(batch);
        const delivered = deliveredIds(outcome);
        await this.markSynced(delivered);
        totalSynced += delivered.length;

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

      // Reset backoff on success
      this.backoff = { attempt: 0, nextRetryAt: 0 };
      this.lastSyncAt = Date.now();
      this.lastError = null;

      // Evict old synced entries
      await this.enforceBufferBounds();

    } catch (err) {
      const message = (err as Error).message;
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
    } finally {
      this.isSyncing = false;
    }
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
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
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
      return { accepted: allIds, duplicates: [], failed: [] };
    }
    return {
      accepted: response.acceptedIds,
      duplicates: Array.isArray(response.duplicateIds) ? response.duplicateIds : [],
      failed: Array.isArray(response.failedIds) ? response.failedIds : [],
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

  /** Size and row counts of the WAL, or null when the database cannot say. */
  private async bufferStats(): Promise<{ totalBytes: number; totalRows: number; syncedRows: number } | null> {
    const { sql } = await import('kysely');
    const row = await sql<{ total_bytes: string | number; total_rows: string | number; synced_rows: string | number }>`
      SELECT pg_total_relation_size('sync_buffer') AS total_bytes,
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

    // Rate limiting — prevent flood from misbehaving slaves
    if (!this.checkRateLimit(batch.nodeId)) {
      throw new Error(`Rate limit exceeded for node ${batch.nodeId}. Max ${RATE_LIMIT_PER_MINUTE} batches/min.`);
    }

    // Integrity verification — reject corrupted batches
    const expectedChecksum = await this.computeChecksum(batch.entries);
    if (!batch.checksum || batch.checksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch for batch ${batch.batchId}. Expected ${expectedChecksum}, got ${batch.checksum}. Batch rejected.`);
    }

    const outcome: IngestOutcome = { accepted: [], duplicates: [], failed: [] };

    for (const entry of batch.entries) {
      try {
        // Claim the entry, then ingest it, in one transaction. A failure
        // rolls the claim back, so the entry is retried rather than recorded
        // as taken; a conflicting claim means this batch repeats one already
        // applied, which is what "idempotent" was always supposed to mean.
        const result = await this.claimAndIngest(batch.nodeId, entry);
        if (result === 'duplicate') outcome.duplicates.push(entry.id);
        else outcome.accepted.push(entry.id);
      } catch (err) {
        // Not marked delivered. The slave keeps it and offers it again —
        // previously this warning was the only trace of an entry that had
        // just been dropped on both sides.
        outcome.failed.push(entry.id);
        this.logger.warn(
          { nodeId: batch.nodeId, entryId: entry.id, category: entry.category, error: (err as Error).message },
          'Failed to ingest sync entry — left unacknowledged for retry'
        );
      }
    }

    if (outcome.failed.length > 0) {
      this.logger.warn(
        { nodeId: batch.nodeId, batchId: batch.batchId, failed: outcome.failed.length, total: batch.entries.length },
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

  private async ingestMetric(db: SyncExecutor, nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void> {
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

  private async ingestAlert(db: SyncExecutor, _nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void> {
    await db.insertInto('alert_events').values({
      ruleId: (entry.payload['ruleId'] as string) ?? 'unknown',
      status: (entry.payload['status'] as string) ?? 'firing',
      value: entry.payload['value'] != null ? String(entry.payload['value']) : null,
      annotations: entry.payload['annotations'] ? JSON.stringify(entry.payload['annotations']) as any : null,
      firedAt: (entry.payload['firedAt'] as string) ?? entry.createdAt,
      resolvedAt: (entry.payload['resolvedAt'] as string) ?? null,
      acknowledgedAt: null,
      acknowledgedBy: null,
    }).execute();
  }

  private async ingestTrace(db: SyncExecutor, _nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void> {
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
      tags: JSON.stringify(entry.payload['tags'] ?? { nodeId: _nodeId }) as any,
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
