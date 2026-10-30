/**
 * Buffered node→master replication over Netron.
 *
 * Nodes persist configured telemetry in SQLite with FULL WAL durability.
 * Pull (and legacy push) releases only identified acknowledgements; failures
 * remain pending with bounded backoff. The PostgreSQL ledger deduplicates
 * entries within its retention window, using node identity and wire entry ID.
 *
 * Queue release, committed payloads, permanent rejections and eviction losses
 * are distinct durable evidence. Metrics and their receipts share one transaction;
 * unclassified older-peer receipts remain unverified, never retroactive commits.
 * Overflow evicts delivered rows first, then pending rows with a loss record.
 * Delivery is therefore bounded at-least-once, not an unlimited no-loss promise.
 */

import type { Insertable, Kysely, Transaction } from 'kysely';
import { createHash } from 'node:crypto';
import { prepareMetricSample, type MetricSample, type PostgresMetricsStorage } from '@omnitron-dev/titan-metrics';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { OmnitronDatabase } from '../database/schema.js';
import type { ISyncConfig, DaemonRole } from '../config/types.js';
import type { ISyncStatus } from '../shared/dto/project.js';
import { toIsoUtc } from '../database/sqlite-date-binding.js';
import { describeError } from '../shared/describe-error.js';
import { readReplicationEvidence, receiptGroups, type ReplicationReceipt } from './replication-evidence.js';
import {
  classifyIngestFailure,
  deliveredIds,
  sweepMadeProgress,
  planEviction,
  SYNCED_RETENTION_MS,
  LEDGER_WINDOW_DAYS,
  LEDGER_FIRST_PASS_DELAY_MS,
  LEDGER_INTERVAL_MS,
  LEDGER_BACKLOG_INTERVAL_MS,
  type IngestOutcome,
} from './sync-policy.js';
import { planRetention, batchesPerPass, type RetentionPlan } from './log-retention.js';

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
  timestamp: number;
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
  /** Durable payload receipts; omitted by older peers. */
  receiptVersion?: 1;
  committedIds?: string[];
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

/**
 * The most parameters one statement binds.
 *
 * Postgres takes 65 535 and SQLite 32 766 (better-sqlite3 13.0.3 / SQLite
 * 3.53.4, measured: 32 767 is refused with «too many SQL variables»). This
 * service writes to both — a master on Postgres, a slave on SQLite — so the
 * smaller one bounds every statement it builds from a list, with room.
 */
const MAX_BOUND_PARAMETERS = 30_000;

/** Rows split into statements that each stay within `MAX_BOUND_PARAMETERS`. */
function statementsOf<R extends object>(rows: R[]): R[][] {
  if (rows.length === 0) return [];
  const perRow = Math.max(1, Object.keys(rows[0]!).length);
  const size = Math.max(1, Math.floor(MAX_BOUND_PARAMETERS / perRow));
  const parts: R[][] = [];
  for (let i = 0; i < rows.length; i += size) parts.push(rows.slice(i, i + size));
  return parts;
}

// =============================================================================
// Master-Side: the row each entry becomes
// =============================================================================

type IngestEntry = SyncBatch['entries'][number];

function logRow(nodeId: string, entry: IngestEntry): Insertable<OmnitronDatabase['logs']> {
  return {
    timestamp: (entry.payload['timestamp'] as string) ?? entry.createdAt,
    nodeId,
    app: (entry.payload['app'] as string) ?? 'unknown',
    level: (entry.payload['level'] as string) ?? 'info',
    message: (entry.payload['message'] as string) ?? '',
    labels: JSON.stringify(entry.payload['labels'] ?? {}) as any,
    traceId: (entry.payload['traceId'] as string) ?? null,
    spanId: (entry.payload['spanId'] as string) ?? null,
    metadata: entry.payload['metadata'] ? JSON.stringify(entry.payload['metadata']) as any : null,
  };
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
function alertRow(nodeId: string, entry: IngestEntry): Insertable<OmnitronDatabase['alert_events']> {
  const annotations = {
    ...(entry.payload['annotations'] as Record<string, unknown> | undefined),
    node: nodeId,
  };
  return {
    ruleId: (entry.payload['ruleId'] as string) ?? 'unknown',
    status: (entry.payload['status'] as string) ?? 'firing',
    value: entry.payload['value'] != null ? String(entry.payload['value']) : null,
    annotations: JSON.stringify(annotations) as any,
    firedAt: (entry.payload['firedAt'] as string) ?? entry.createdAt,
    resolvedAt: (entry.payload['resolvedAt'] as string) ?? null,
    acknowledgedAt: null,
    acknowledgedBy: null,
  };
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
function traceRow(nodeId: string, entry: IngestEntry): Insertable<OmnitronDatabase['traces']> {
  return {
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
  };
}

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
  private metricsStorage: PostgresMetricsStorage<OmnitronDatabase> | null = null;
  /** Set on a master; see `setMetricsSink`. */
  private metricsSink: MetricsSink | null = null;

  private readonly config: ResolvedSyncConfig;
  private syncTimer: NodeJS.Timeout | null = null;
  /** The master's ledger pruning, re-armed after each pass. See `pruneLedger`. */
  private ledgerTimer: NodeJS.Timeout | null = null;
  /** Whether this database keeps the buffer's figures; null until asked. See `keptBufferStats`. */
  private bufferStatsKept: boolean | null = null;
  private evidenceKept: boolean | null = null;
  private isSyncing = false;
  private backoff: SyncBackoffState = { attempt: 0, nextRetryAt: 0 };
  private lastSyncAt: number | null = null;
  /** At most 60 one-second buckets, independent of batch size and polling rate. */
  private readonly deliveries = new Map<number, number>();
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
   *
   * On a slave, the buffer's pass: bound it, then try to drain it. On a
   * master, the ledger's: `sync_ingested` pruned to its dedup window. The
   * master used to return here, and its half of the pipeline was never
   * maintained at all.
   */
  start(): void {
    if (this.role === 'master') {
      this.scheduleLedgerPrune(LEDGER_FIRST_PASS_DELAY_MS);
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
    if (this.ledgerTimer) {
      clearTimeout(this.ledgerTimer);
      this.ledgerTimer = null;
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

  /** Optional post-commit exposition observer. It is never the durable destination. */
  setMetricsSink(sink: MetricsSink | null): void {
    this.metricsSink = sink;
  }

  /** Required for metric ingestion. The adapter writes inside the receipt transaction. */
  setMetricsStorage(storage: PostgresMetricsStorage<OmnitronDatabase>): void {
    this.metricsStorage = storage;
  }

  /**
   * Buffer multiple entries at once (batch optimization).
   */
  async bufferBatch(entries: SyncEntry[], transaction?: Transaction<OmnitronDatabase>): Promise<void> {
    if (this.role !== 'slave' || entries.length === 0) return;

    const filteredEntries = entries.filter((e) => this.config.categories.includes(e.category));
    if (filteredEntries.length === 0) return;

    try {
      await (transaction ?? this.db).insertInto('sync_buffer').values(
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
      throw err;
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
  async ackDrained(ids: string[], receipt?: ReplicationReceipt): Promise<{ released: number }> {
    return { released: await this.markSynced(ids, receipt) };
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
        totalSynced += await this.markSynced(delivered, outcome.receipt);
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
    const requested = limit ?? this.config.batchSize;
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > 10_000) throw new Error('Replication batch limit must be between 1 and 10000');
    const tracked = await this.replicationEvidence();
    const { sql } = await import('kysely');
    const rows = await this.db
      .selectFrom('sync_buffer')
      .select(['category', 'payload', 'createdAt'])
      .select(sql<string>`cast(id as text)`.as('id'))
      .where('syncedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .limit(requested)
      .execute();

    const batchId = `${this.nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const entries = rows.map((r) => ({
      id: tracked && BigInt(r.id) >= BigInt(tracked.namespaceFrom) ? `${tracked.evidence.epoch}:${r.id}` : String(r.id),
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
   * without ID lists can release a batch only when its counts cover every
   * offered entry. Such a receipt still cannot certify durable payloads.
   */
  private async pushBatch(batch: SyncBatch): Promise<IngestOutcome & { receipt?: ReplicationReceipt }> {
    if (!this.masterInvoke) throw new Error('No master connection');

    const response = (await this.masterInvoke('OmnitronSync', 'receiveBatch', [batch])) as
      | Partial<IngestBatchResult>
      | undefined;

    const allIds = batch.entries.map((e) => e.id);
    if (!response || !Array.isArray(response.acceptedIds)) {
      if (!response || !Number.isSafeInteger(response.accepted) || Number(response.accepted) < 0 ||
          !Number.isSafeInteger(response.duplicates ?? 0) || Number(response.duplicates ?? 0) < 0 ||
          Number(response.accepted) + Number(response.duplicates ?? 0) !== allIds.length) {
        throw new Error('The master did not identify all delivered entries; the batch remains pending');
      }
      return { accepted: allIds, duplicates: [], failed: [], discarded: [] };
    }
    return {
      accepted: response.acceptedIds,
      duplicates: Array.isArray(response.duplicateIds) ? response.duplicateIds : [],
      failed: Array.isArray(response.failedIds) ? response.failedIds : [],
      // An older master answers without this field. Treating a missing list
      // as an empty one is right: it discarded nothing.
      discarded: Array.isArray(response.discardedIds) ? response.discardedIds : [],
      ...(response.receiptVersion === 1 && Array.isArray(response.committedIds) && { receipt: {
        version: 1 as const, committedIds: response.committedIds, discardedIds: response.discardedIds ?? [],
      } }),
    };
  }

  private async replicationEvidence() {
    if (this.evidenceKept === false) return null;
    try {
      const reading = await readReplicationEvidence(this.db as Kysely<unknown>);
      this.evidenceKept = true;
      return reading;
    } catch (error) {
      // An older schema is compatible. Corrupt state and I/O errors are not
      // evidence of an empty queue and must reach the caller.
      if (/no such table: sync_replication_state|relation ["']?sync_replication_state["']? does not exist/i.test(describeError(error))) {
        this.evidenceKept = false;
        return null;
      }
      throw error;
    }
  }

  private async markSynced(ids: string[], receipt?: ReplicationReceipt): Promise<number> {
    const groups = receiptGroups(ids, receipt);
    if (ids.length === 0) return 0;
    const now = Date.now();
    const tracked = await this.replicationEvidence();
    let released: number;
    if (tracked) {
      // Classification, queue release and durable evidence commit together.
      released = await this.db.transaction().execute(async transaction => {
        let count = 0;
        for (const [outcome, wireIds] of Object.entries(groups)) {
          if (!wireIds.length) continue;
          const values = wireIds.map(id => {
            if (!id.includes(':')) {
              if (!/^[1-9]\d*$/.test(id) || BigInt(id) >= BigInt(tracked.namespaceFrom)) {
                throw new Error('Replication receipt is missing its buffer epoch');
              }
              return id; // IDs offered before migration retain their original wire representation.
            }
            const [epoch, sequence, extra] = id.split(':');
            if (epoch !== tracked.evidence.epoch || !sequence || !/^[1-9]\d*$/.test(sequence) || extra !== undefined ||
                BigInt(sequence) < BigInt(tracked.namespaceFrom) || BigInt(sequence) > 9223372036854775807n) {
              throw new Error('Replication receipt belongs to a different buffer epoch');
            }
            return sequence;
          });
          const result = await transaction.updateTable('sync_buffer')
            .set({ syncedAt: new Date(now), syncOutcome: outcome as 'committed' | 'discarded' | 'unverified' })
            .where('id', 'in', values).where('syncedAt', 'is', null).executeTakeFirst();
          count += Number(result.numUpdatedRows);
        }
        return count;
      });
    } else {
      const result = await this.db.updateTable('sync_buffer').set({ syncedAt: new Date(now) })
        .where('id', 'in', [...new Set(ids)]).where('syncedAt', 'is', null).executeTakeFirst();
      released = Number(result.numUpdatedRows);
    }
    if (released > 0) {
      this.lastSyncAt = now;
      const second = Math.floor(now / 1000);
      this.deliveries.set(second, (this.deliveries.get(second) ?? 0) + released);
      this.deliveryRate(now);
    }
    return released;
  }

  private deliveryRate(now: number): number {
    const cutoff = Math.floor(now / 1000) - 59;
    let count = 0;
    for (const [second, entries] of this.deliveries) {
      if (second < cutoff) this.deliveries.delete(second);
      else count += entries;
    }
    return count / 60;
  }

  /**
   * Keep the WAL inside `maxBufferSize`.
   *
   * The original bounded-buffer promise had no implementation:
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

      // Delivered before undelivered, oldest first within each — so an
      // overflow small enough to be absorbed by rows the master already has
      // costs nothing.
      const delivered = await this.dropOldest('delivered', plan.overflowRows);
      const undelivered =
        delivered < plan.overflowRows ? await this.dropOldest('undelivered', plan.overflowRows - delivered) : 0;
      const dropped = delivered + undelivered;
      if (dropped === 0) return;

      // Counted, not predicted: the level follows what was actually dropped.
      const level = undelivered > 0 ? 'warn' : 'info';
      this.logger[level](
        {
          dropped,
          undelivered,
          totalBytes: stats.totalBytes,
          maxBytes: this.config.maxBufferSize,
        },
        undelivered > 0
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
   * Delete up to `limit` of the oldest rows of one kind; say how many went.
   *
   * By a subquery, not by a list. The ids used to be read into memory and
   * deleted with `WHERE id IN (…)` — one bound parameter per row, where
   * SQLite takes 32 766. So the pass worked for a small overflow and refused
   * exactly the large one, which is the only kind a buffer cut off from its
   * master produces. Measured on the test node, 2026-09-22: «too many SQL
   * variables» on 558 passes in a row, 13:03–17:42 UTC, against 4 019 288
   * rows and 555 MB of payload over a 500 MB budget. The bound bounded
   * nothing, and said so every thirty seconds in a log nobody on the master
   * reads.
   *
   * Two queries rather than one ordered `syncedAt DESC`, which put NULLs —
   * the undelivered rows — last on SQLite and FIRST on Postgres, and among
   * the delivered took the most recently delivered first, against the
   * comment above it. Both of these are served by `idx_sync_pending
   * (syncedAt, createdAt)`: delivered rows in the order they were delivered,
   * which is the order the routine pass retires them in, only sooner; and
   * undelivered ones in the order they were buffered.
   */
  private async dropOldest(which: 'delivered' | 'undelivered', limit: number): Promise<number> {
    const oldest =
      which === 'delivered'
        ? this.db
            .selectFrom('sync_buffer')
            .select('id')
            .where('syncedAt', 'is not', null)
            .orderBy('syncedAt', 'asc')
            .orderBy('createdAt', 'asc')
            .limit(limit)
        : this.db
            .selectFrom('sync_buffer')
            .select('id')
            .where('syncedAt', 'is', null)
            .orderBy('createdAt', 'asc')
            .limit(limit);

    const result = await this.db.deleteFrom('sync_buffer').where('id', 'in', oldest).executeTakeFirst();
    return Number(result.numDeletedRows);
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
    const kept = await this.keptBufferStats();
    if (kept) return kept;

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

  /**
   * The buffer's figures as its triggers keep them, or null when this
   * database keeps none (see `SlaveStorageService.createBufferStats`).
   *
   * One row instead of a pass over the table: 395–399 ms on the test node's
   * 4 million rows, every thirty seconds, on the daemon's event loop. Null
   * sends `bufferStats` back to that pass, and is remembered, so a database
   * without the row — one this service did not create — costs one refused
   * query per process rather than one per pass.
   */
  private async keptBufferStats(): Promise<{ totalBytes: number; totalRows: number; syncedRows: number } | null> {
    if (this.bufferStatsKept === false) return null;
    try {
      const { sql } = await import('kysely');
      const row = await sql<{ totalBytes: number | string; totalRows: number | string; syncedRows: number | string }>`
        SELECT totalBytes, totalRows, syncedRows FROM sync_buffer_stats WHERE id = 1
      `.execute(this.db);
      const first = row.rows[0];
      this.bufferStatsKept = Boolean(first);
      if (!first) return null;
      return {
        totalBytes: Number(first.totalBytes),
        totalRows: Number(first.totalRows),
        syncedRows: Number(first.syncedRows),
      };
    } catch (err) {
      // Remembered only when the table is not there. Any other refusal is
      // this pass's, and the next one asks again.
      if (/no such table|does not exist/i.test(describeError(err))) this.bufferStatsKept = false;
      return null;
    }
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
    if (!Array.isArray(batch.entries) || batch.entries.length > 10_000 || batch.entries.some(entry =>
      !entry || typeof entry.id !== 'string' || !entry.id.length || entry.id.length > 64 ||
      typeof entry.category !== 'string' || !entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload))) {
      throw new Error('Sync batch rejected: at most 10000 entries with bounded IDs and object payloads are required');
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

    const { outcome, causes } = await this.ingest(batch.nodeId, batch.entries);

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

    const released = deliveredIds(outcome);
    const receipts = released.length ? await this.db.selectFrom('sync_ingested').select(['entryId', 'outcome'])
      .where('nodeId', '=', batch.nodeId).where('entryId', 'in', released).execute() : [];
    const discarded = new Set(receipts.filter(row => row.outcome === 'discarded').map(row => row.entryId));
    const acceptedIds = outcome.accepted.filter(id => !discarded.has(id));
    const duplicateIds = outcome.duplicates.filter(id => !discarded.has(id));
    return {
      receiptVersion: 1,
      committedIds: receipts.filter(row => row.outcome === 'committed').map(row => row.entryId),
      // Kept as a number for the existing RPC contract; the id lists are
      // what the slave needs to know which entries it may release.
      accepted: acceptedIds.length,
      duplicates: duplicateIds.length,
      acceptedIds,
      duplicateIds,
      failedIds: outcome.failed,
      // Released, not stored. The slave must let these go or it offers them
      // forever; the ERROR beside each one is the only record that they
      // existed.
      discardedIds: [...discarded],
    };
  }

  /**
   * Take a batch: as one transaction, or — when the database refuses it as
   * a whole — one entry at a time, which is what finds the entry it refused.
   *
   * Every batch used to take the second road. Each entry was claimed and
   * ingested in a transaction of its own, so that one entry the database
   * refuses costs that entry and not its thousand neighbours — and so every
   * batch cost a thousand `BEGIN … COMMIT`s, on a master whose omnitron-pg
   * runs `synchronous_commit = on`: a WAL flush per entry, a thousand per
   * pull. While the machine was idle that was 800–1 100 entries a second
   * against 38 produced on the test node. Under load a pull outlasted the
   * 15 s heartbeat, and the next heartbeat started another over the same
   * entries (see `pullSyncData`). Measured 2026-09-22: nine pulls of the
   * same 7 918 entries finishing within 122 ms of each other.
   *
   * The isolation is kept, and paid for only where it buys something: a
   * batch the database refuses — a malformed uuid, a foreign key the master
   * does not have — is retried entry by entry, and that path classifies
   * each refusal exactly as it always has. The fast path is never worse
   * than the old one; it falls back to it.
   */
  private async ingest(
    nodeId: string,
    entries: SyncBatch['entries'],
  ): Promise<{ outcome: IngestOutcome; causes: Map<string, number> }> {
    try {
      return { outcome: await this.ingestAsOne(nodeId, entries), causes: new Map() };
    } catch (err) {
      // Debug: the path below says, per entry and at the right level, what
      // was refused and why. That the batch had to take it is not news.
      this.logger.debug(
        { nodeId, entries: entries.length, error: describeError(err) },
        'Sync batch refused as a whole — ingesting it entry by entry',
      );
      return this.ingestEntryByEntry(nodeId, entries);
    }
  }

  /**
   * The whole batch in one transaction: the claims in one statement, each
   * destination table's rows in one more.
   *
   * An id that appears twice in a batch is taken once and its second
   * occurrence reported a duplicate — what the per-entry path does, because
   * there the first occurrence's claim is committed before the second's is
   * tried.
   */
  private async ingestAsOne(nodeId: string, entries: SyncBatch['entries']): Promise<IngestOutcome> {
    const outcome: IngestOutcome = { accepted: [], duplicates: [], failed: [], discarded: [] };
    const taken: SyncBatch['entries'] = [];

    await this.db.transaction().execute(async (trx) => {
      const claimed = await this.claimAll(trx, nodeId, entries);
      for (const entry of entries) {
        if (claimed.delete(entry.id)) {
          outcome.accepted.push(entry.id);
          taken.push(entry);
        } else {
          outcome.duplicates.push(entry.id);
        }
      }
      await this.writeRows(trx, nodeId, taken);
    });

    this.recordMetrics(nodeId, taken);
    return outcome;
  }

  /**
   * One transaction per entry: the road for a batch the database refused.
   *
   * Slow on purpose. Each entry succeeds or fails on its own, so the one the
   * database will never store is named, discarded and released, and a
   * failure that may pass is left for the next pull — while everything else
   * in the batch is taken.
   */
  private async ingestEntryByEntry(
    nodeId: string,
    entries: SyncBatch['entries'],
  ): Promise<{ outcome: IngestOutcome; causes: Map<string, number> }> {
    const outcome: IngestOutcome = { accepted: [], duplicates: [], failed: [], discarded: [] };
    // Why entries were refused, and how many times each reason came up. A
    // thousand entries failing on one dead database is ONE event; naming the
    // reason per entry buried the cause under its own repetitions.
    const causes = new Map<string, number>();

    for (const entry of entries) {
      try {
        // Claim the entry, then ingest it, in one transaction. A failure
        // rolls the claim back, so the entry is retried rather than recorded
        // as taken; a conflicting claim means this batch repeats one already
        // applied, which is what "idempotent" was always supposed to mean.
        const result = await this.claimAndIngest(nodeId, entry);
        if (result === 'duplicate') outcome.duplicates.push(entry.id);
        else if (result === 'discarded') outcome.discarded.push(entry.id);
        else {
          outcome.accepted.push(entry.id);
          this.recordMetrics(nodeId, [entry]);
        }
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
          { nodeId, entryId: entry.id, category: entry.category, error: cause },
          'Failed to ingest sync entry — left unacknowledged for retry'
        );
      }
    }

    return { outcome, causes };
  }

  /**
   * Claim entries for this node; the ids that come back are the new ones.
   *
   * Sorted, so that two transactions claiming overlapping batches take the
   * ledger's rows in the same order and cannot deadlock on each other.
   */
  private async claimAll(db: SyncExecutor, nodeId: string, entries: SyncBatch['entries']): Promise<Set<string>> {
    const byId = new Map<string, IngestEntry>();
    for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
    const rows = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
      .map(entry => ({ nodeId, entryId: entry.id, outcome: this.receiptOutcome(entry.category) }));
    const claimed = new Set<string>();
    for (const part of statementsOf(rows)) {
      const taken = await db
        .insertInto('sync_ingested')
        .values(part)
        .onConflict((oc) => oc.columns(['nodeId', 'entryId']).doNothing())
        .returning('entryId')
        .execute();
      for (const row of taken) claimed.add(String(row.entryId));
    }
    return claimed;
  }

  /**
   * Store claimed entries in the tables the console reads, one statement per
   * table (per `MAX_BOUND_PARAMETERS` rows). Both roads write through here,
   * so an entry lands as the same row whichever one took it.
   */
  private async writeRows(db: Transaction<OmnitronDatabase>, nodeId: string, entries: SyncBatch['entries']): Promise<void> {
    const metrics: MetricSample[] = [];
    const logs: Insertable<OmnitronDatabase['logs']>[] = [];
    const alerts: Insertable<OmnitronDatabase['alert_events']>[] = [];
    const traces: Insertable<OmnitronDatabase['traces']>[] = [];
    const unknown: IngestEntry[] = [];

    for (const entry of entries) {
      switch (entry.category) {
        case 'metrics':
          metrics.push(this.metricSample(nodeId, entry));
          break;
        case 'logs':
          logs.push(logRow(nodeId, entry));
          break;
        case 'alerts':
          alerts.push(alertRow(nodeId, entry));
          break;
        case 'traces':
          traces.push(traceRow(nodeId, entry));
          break;
        case 'events':
        case 'state':
          // Stored as logs. The category itself is not kept: `logs` has no
          // column for it, and the `_category` this path once added to the
          // payload reached none.
          logs.push(logRow(nodeId, entry));
          break;
        default:
          unknown.push(entry);
          break;
      }
    }

    for (const part of statementsOf(logs)) await db.insertInto('logs').values(part).execute();
    for (const part of statementsOf(alerts)) await db.insertInto('alert_events').values(part).execute();
    for (const part of statementsOf(traces)) await db.insertInto('traces').values(part).execute();
    if (metrics.length) {
      if (!this.metricsStorage) throw new Error('Persistent metric storage is unavailable; payloads remain pending on the node');
      await this.metricsStorage.writeInTransaction(db, metrics);
    }

    if (unknown.length > 0) {
      // An unknown category is not a failure to retry — retrying cannot make
      // it known. It is claimed and dropped, so the slave releases it, and
      // said at warning level rather than debug: a category the master does
      // not understand means the two are out of step.
      this.logger.warn(
        {
          nodeId,
          entries: unknown.length,
          categories: [...new Set(unknown.map((e) => e.category))],
          firstEntryId: unknown[0]!.id,
        },
        'Unknown sync category — entries discarded'
      );
    }
  }

  /** Update live exposition after the payload and receipt commit atomically. */
  private recordMetrics(nodeId: string, entries: SyncBatch['entries']): void {
    if (!this.metricsSink) return;
    try {
      for (const entry of entries) {
        if (entry.category !== 'metrics') continue;
        const sample = this.metricSample(nodeId, entry);
        this.metricsSink({
          node: nodeId,
          ...sample,
          app: sample.labels['app']!,
        });
      }
    } catch (err) {
      // The entries are stored and will be acknowledged; a sink that throws
      // must not turn that into a retry the ledger then calls a duplicate.
      this.logger.warn({ nodeId, error: describeError(err) }, 'Stored remote metrics could not be recorded for the console');
    }
  }

  /**
   * Record the entry as taken and ingest it, atomically.
   *
   * Returns `'duplicate'` when the master already holds it — a retry after a
   * lost acknowledgement, which is delivery, not failure. Throws when
   * ingestion fails, leaving nothing recorded.
   */
  private receiptOutcome(category: SyncCategory): 'committed' | 'discarded' | 'unverified' {
    return ['metrics', 'logs', 'alerts', 'traces', 'events', 'state'].includes(category) ? 'committed' : 'discarded';
  }

  private metricSample(nodeId: string, entry: IngestEntry): MetricSample {
    try {
      const labels = entry.payload['labels'] ?? {};
      if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) throw new TypeError('Invalid metric labels');
      const timestamp = entry.payload['timestamp'] ?? entry.createdAt;
      return prepareMetricSample({
        id: `replicated:${createHash('sha256').update(JSON.stringify([nodeId, entry.id])).digest('hex')}`,
        name: entry.payload['name'] as string,
        value: entry.payload['value'] as number,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.parse(String(timestamp)),
        labels: { ...labels as Record<string, string>,
          ...entry.payload['app'] !== undefined ? { app: entry.payload['app'] as string } : {}, node: nodeId },
      });
    } catch (cause) {
      // Malformed telemetry is a permanent refusal; database/network failures are retryable.
      throw Object.assign(new Error(`Invalid replicated metric: ${describeError(cause)}`), { code: '22023' });
    }
  }

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
      const recorded = await this.db
        .insertInto('sync_ingested')
        .values({ nodeId, entryId: entry.id, outcome: 'discarded' })
        .onConflict((oc) => oc.columns(['nodeId', 'entryId']).doNothing())
        .returning('entryId').executeTakeFirst();
      if (!recorded) return 'duplicate'; // The canonical receipt decides which outcome won.


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
        .values({ nodeId, entryId: entry.id, outcome: this.receiptOutcome(entry.category) })
        .onConflict((oc) => oc.columns(['nodeId', 'entryId']).doNothing())
        .returning('entryId')
        .executeTakeFirst();

      if (!claim) return 'duplicate';

      await this.writeRows(trx, nodeId, [entry]);
      return 'accepted';
    });
  }

  // ===========================================================================
  // Master-Side: the ledger's window
  // ===========================================================================

  /**
   * Arm the next ledger pass: in an hour, or in a minute when the last one
   * hit its ceiling and more is waiting. Chained rather than an interval, so
   * the cadence is decided with the last pass's result in hand.
   */
  private scheduleLedgerPrune(delayMs: number): void {
    if (this.ledgerTimer) clearTimeout(this.ledgerTimer);
    if (this.disposed) return;

    this.ledgerTimer = setTimeout(() => {
      void this.pruneLedger().then((removed) => {
        if (this.disposed) return;
        const plan = planRetention(LEDGER_WINDOW_DAYS);
        this.scheduleLedgerPrune(plan && removed >= plan.maxThisPass ? LEDGER_BACKLOG_INTERVAL_MS : LEDGER_INTERVAL_MS);
      });
    }, delayMs);
    this.ledgerTimer.unref();
  }

  /**
   * Forget claims older than the dedup window (`LEDGER_WINDOW_DAYS`), in
   * bounded batches, and say how many went.
   *
   * `sync_ingested` was written on every entry and pruned by nothing: 9.9
   * million rows, 2.2 GB, and ~3.3 million more a day per node, beside an
   * index on `ingestedAt` whose migration says it is there «for pruning». A
   * claim is needed only while its node may offer the entry again — see the
   * window's own comment for why a day covers that.
   *
   * By a subquery on the key, like the buffer's eviction, so no statement
   * binds a parameter per row; `batchSize` rows at a time, so no statement
   * holds the ingest path's inserts behind it for long.
   *
   * Said at info whenever it removed something, with the oldest claim left:
   * a month from now, «the ledger is stable» must be tellable from «the
   * pruner never ran» by reading the log rather than the code.
   */
  async pruneLedger(plan: RetentionPlan | null = planRetention(LEDGER_WINDOW_DAYS)): Promise<number> {
    if (!plan || this.disposed) return 0;

    let removed = 0;
    try {
      for (let i = 0; i < batchesPerPass(plan); i++) {
        if (this.disposed) break;
        const oldest = this.db
          .selectFrom('sync_ingested')
          .select(['nodeId', 'entryId'])
          .where('ingestedAt', '<', plan.cutoff)
          .limit(plan.batchSize);
        const result = await this.db
          .deleteFrom('sync_ingested')
          .where(({ eb, refTuple }) => eb(refTuple('nodeId', 'entryId'), 'in', oldest.$asTuple('nodeId', 'entryId')))
          .executeTakeFirst();
        const n = Number(result.numDeletedRows);
        removed += n;
        if (n < plan.batchSize) break;
      }

      if (removed > 0) {
        const left = await this.db
          .selectFrom('sync_ingested')
          .select((eb) => eb.fn.min('ingestedAt').as('oldest'))
          .executeTakeFirst();
        this.logger.info(
          {
            removed,
            cutoff: plan.cutoff.toISOString(),
            oldestKept: left?.oldest ? toIsoUtc(left.oldest) : null,
            windowDays: LEDGER_WINDOW_DAYS,
          },
          'Pruned sync ledger claims past the dedup window'
        );
      } else {
        this.logger.debug({ cutoff: plan.cutoff.toISOString() }, 'Sync ledger holds nothing past the dedup window');
      }
    } catch (err) {
      // A pruner that keeps failing is the ledger growing again, quietly.
      this.logger.error({ error: describeError(err), removed }, 'Sync ledger prune failed');
    }
    return removed;
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
    let oldestPendingAgeMs: number | null = null;
    let lastSyncAt = this.lastSyncAt;
    let tracked: Awaited<ReturnType<typeof readReplicationEvidence>> | null = null;

    if (this.role === 'slave') {
      tracked = await this.replicationEvidence();
      if (tracked) {
        ({ pendingItems, bufferSize, oldestPendingAgeMs, lastSyncAt } = tracked);
      } else {
        const { sql } = await import('kysely');
        const result = await this.db.selectFrom('sync_buffer').select(eb => [
          eb.fn.count('id').as('count'), eb.fn.min('createdAt').as('oldest'),
          sql<number>`coalesce(sum(octet_length(cast(payload as text))), 0)`.as('bytes'),
        ]).where('syncedAt', 'is', null).executeTakeFirst();
        pendingItems = Number(result?.count ?? 0);
        bufferSize = Number(result?.bytes ?? 0);
        if (result?.oldest != null) oldestPendingAgeMs = Math.max(0, Date.now() - Date.parse(toIsoUtc(result.oldest)));
      }
    }

    return {
      connected: this.masterInvoke !== null,
      lastSyncAt, pendingItems, oldestPendingAgeMs,
      lastSyncAgeMs: lastSyncAt === null ? null : Math.max(0, Date.now() - lastSyncAt),
      deliveryRatePerSecond: this.deliveryRate(Date.now()),
      bufferSize, bufferSizeAccuracy: 'measured',
      ...(tracked && { evidence: tracked.evidence, retainedBufferSize: tracked.retainedBufferSize }),
      lastError: this.lastError,
      failedAttempts: this.backoff.attempt,
    };
  }
}
