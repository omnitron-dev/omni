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
  /** Entries ingested for the first time. */
  accepted: string[];
  /** Entries the master had already ingested — delivered, not re-applied. */
  duplicates: string[];
  /** Entries the master could not ingest. These must NOT be marked synced. */
  failed: string[];
}

/**
 * Which entries the slave may mark as delivered.
 *
 * A duplicate counts as delivered: the master has it. A failure does not,
 * however many times it has been attempted — data the master rejected is
 * still data the slave holds, and dropping it here is the loss that
 * guarantee 1 forbids. If it is unacceptable forever, the buffer bound is
 * what removes it, loudly.
 */
export function deliveredIds(outcome: IngestOutcome): string[] {
  return [...outcome.accepted, ...outcome.duplicates];
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
