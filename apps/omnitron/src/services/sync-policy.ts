/**
 * The decisions the slave→master replication makes, separated from the
 * database calls that carry them out.
 *
 * `sync.service.ts` opens with five numbered guarantees. Four of them were
 * not implemented, and each failure is silent by construction — replication
 * that drops data still reports success, because the thing that would have
 * noticed is the thing that is missing.
 *
 *   1. "Zero data loss"  The push path marked every entry synced after
 *      `receiveBatch` returned, and `receiveBatch` swallows per-entry
 *      ingestion failures into a warning. Forty rejected entries out of a
 *      hundred were marked delivered and evicted twenty-four hours later.
 *
 *      The pull path was worse: `drainBuffer` marked entries synced *before*
 *      returning them, so a response lost in transit, a checksum mismatch or
 *      a rate-limit rejection lost the data outright — and the caller logged
 *      the failure at debug level.
 *
 *   4. "Idempotent (safe to retry)"  There was no mechanism. `batchId` was
 *      generated, transmitted, and used only inside log and error strings.
 *      Retrying meant ingesting twice.
 *
 *   5. "Bounded buffer — oldest entries evicted when maxBufferSize reached"
 *      `maxBufferSize` was read from config, defaulted to 500 MB, and never
 *      referenced again. A slave that lost its master buffered until the
 *      disk filled.
 *
 * The three are entangled: making delivery honest (1) means entries are
 * retried, which requires deduplication (4) or the loss becomes duplication;
 * and retaining undelivered entries makes the unbounded buffer (5) reachable
 * rather than theoretical. They are fixed together or not at all.
 */

/** What the master did with each entry of a batch. */
export interface IngestOutcome {
  /** Claimed and dropped: the master can never store them. */
  discarded: string[];
  /** Entries ingested for the first time. */
  accepted: string[];
  /** Entries the master had already ingested — delivered, not re-applied. */
  duplicates: string[];
  /** Entries the master could not ingest. These must NOT be marked synced. */
  failed: string[];
}

/**
 * Which entries the slave may release.
 *
 * A duplicate counts as delivered: the master has it. A transient failure
 * does not, however many times it has been attempted — data the master
 * rejected because it was momentarily unable is still data the slave holds,
 * and dropping it here is the loss that guarantee 1 forbids.
 *
 * A DISCARD is different, and it is released. The master has said this entry
 * can never be stored — a malformed uuid, a foreign key it does not have —
 * and answered the same way for every attempt. Holding it does not preserve
 * it: it parks it at the head of the buffer with everything behind it
 * waiting, until the bound above eventually drops the lot. Releasing the one
 * entry the master named, loudly, costs that entry and saves the rest.
 */
export function deliveredIds(outcome: IngestOutcome): string[] {
  return [...outcome.accepted, ...outcome.duplicates, ...outcome.discarded];
}

/**
 * Should a pull sweep stop?
 *
 * `drainBuffer` no longer marks entries synced, so an entry the master keeps
 * rejecting comes back on the next fetch. Without this the sweep would
 * re-fetch and re-reject the same page forever.
 *
 * Returns true when the batch contains nothing the sweep has not already
 * seen — that is, when continuing cannot make progress.
 */
export function sweepMadeProgress(seen: Set<string>, batchIds: string[]): boolean {
  return batchIds.some((id) => !seen.has(id));
}

export interface EvictionPlan {
  /** Delete synced rows older than this many milliseconds. Always applied. */
  syncedOlderThanMs: number;
  /** Rows to delete beyond that, oldest first, to get back under budget. */
  overflowRows: number;
  /** True when the overflow deletion will discard entries never delivered. */
  discardsUndelivered: boolean;
}

/** Synced entries are kept this long for debugging before routine eviction. */
export const SYNCED_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * How much to remove from the WAL.
 *
 * Routine eviction of old synced rows happens every cycle. The overflow pass
 * runs only when the table is over budget, and it is estimated rather than
 * exact: rows are deleted oldest-first until the projected size fits, using
 * the table's own average row size. An estimate is the right instrument here
 * — the alternative to deleting approximately enough is a full disk.
 *
 * `discardsUndelivered` is the caller's cue to log at warning level. Dropping
 * undelivered data is correct when the disk is the alternative, and it is
 * never something to do quietly.
 */
export function planEviction(params: {
  totalBytes: number;
  maxBytes: number;
  totalRows: number;
  syncedRows: number;
}): EvictionPlan {
  const { totalBytes, maxBytes, totalRows, syncedRows } = params;
  const plan: EvictionPlan = {
    syncedOlderThanMs: SYNCED_RETENTION_MS,
    overflowRows: 0,
    discardsUndelivered: false,
  };

  if (!(totalBytes > maxBytes) || totalRows <= 0 || maxBytes <= 0) return plan;

  const bytesPerRow = totalBytes / totalRows;
  if (!(bytesPerRow > 0)) return plan;

  // Target 90% of the budget so the next cycle is not immediately over
  // again — evicting exactly to the line means evicting every cycle.
  const targetBytes = maxBytes * 0.9;
  const rowsToDrop = Math.ceil((totalBytes - targetBytes) / bytesPerRow);

  plan.overflowRows = Math.min(rowsToDrop, totalRows);
  plan.discardsUndelivered = plan.overflowRows > syncedRows;
  return plan;
}

// =============================================================================
// Permanent vs transient ingest failure
// =============================================================================

/**
 * Can retrying this entry ever work?
 *
 * `receiveBatch` leaves a failed entry unacknowledged so the slave offers it
 * again, which is right when the master is momentarily unable — a dropped
 * connection, a deadlock, a full disk. It is wrong when the DATA cannot be
 * stored, because the answer will be the same every time and the entry sits
 * at the head of the buffer forever with everything behind it.
 *
 * That is not hypothetical. `alert_events.ruleId` is a `uuid` with a foreign
 * key to `alert_rules`, and `ingestAlert` writes `payload.ruleId ?? 'unknown'`
 * — so an alert whose rule the master does not have, or one with no ruleId at
 * all, is refused:
 *
 *     select 'unknown'::uuid;
 *     ERROR:  invalid input syntax for type uuid: "unknown"
 *
 * A slave's alert rules are its own. The first alert a node raises would
 * therefore wedge that node's entire replication, and the only symptom is one
 * "Sync pull stalled" line per sweep.
 *
 * The same function already draws this distinction for an unknown category —
 * "retrying cannot make it known" — and drops it. This extends that to the
 * failures the database itself calls permanent.
 *
 * Unrecognised errors are TRANSIENT. Getting this wrong in that direction
 * costs a retry; getting it wrong the other way discards data.
 */
export type IngestFailureKind = 'permanent' | 'transient';

/** Postgres classes 22 (data exception) and 23 (integrity violation). */
const PERMANENT_PG_PREFIXES = ['22', '23'];

/** better-sqlite3 spells the same thing differently. */
const PERMANENT_SQLITE = /^SQLITE_(CONSTRAINT|MISMATCH)/;

export function classifyIngestFailure(err: unknown): IngestFailureKind {
  const code = (err as { code?: unknown })?.code;

  if (typeof code === 'string') {
    if (PERMANENT_SQLITE.test(code)) return 'permanent';
    // Postgres SQLSTATE is five characters; the first two are the class.
    if (/^[0-9A-Z]{5}$/.test(code) && PERMANENT_PG_PREFIXES.includes(code.slice(0, 2))) {
      return 'permanent';
    }
  }

  // A driver that reports no code at all still says this much in its text,
  // and the two that matter here are the ones a malformed payload produces.
  const message = (err as { message?: unknown })?.message;
  if (typeof message === 'string' && /invalid input syntax|violates (foreign key|not-null|check) constraint/i.test(message)) {
    return 'permanent';
  }

  return 'transient';
}
