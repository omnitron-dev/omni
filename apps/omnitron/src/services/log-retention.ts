/**
 * How much log history to keep, and how to remove the rest.
 *
 * The `logs` table had no retention at all. Every line from every app went
 * into Postgres and stayed: 22.5 million rows and 13 GB on this host, 17 GB
 * for the whole schema, growing at whatever rate the platform logs. The
 * daemon's `logging.maxSize` and `logging.maxFiles` govern the rotated files
 * on disk and say nothing about the table — two settings that read like
 * retention and are not.
 *
 * This machine has already lost its database, its infrastructure containers
 * and its Tor onion to a full disk once. Unbounded log growth is a path back
 * to that, and it is the kind that arrives quietly: nothing degrades until
 * everything does.
 *
 * The deletion is deliberately incremental. A single
 * `DELETE FROM logs WHERE timestamp < cutoff` over 13 GB holds a transaction
 * open for as long as it takes and blocks the flush path behind it, so a
 * retention pass would show up as the log pipeline stalling. Batches of a
 * bounded size, with a ceiling per pass, keep each statement short and let
 * the next pass finish the job.
 */

/** Rows removed per statement. Small enough to stay out of the flush path's way. */
export const RETENTION_BATCH = 10_000;

/** Ceiling per pass, so a first run against years of history cannot monopolise the daemon. */
export const RETENTION_MAX_PER_PASS = 500_000;

export interface RetentionPlan {
  /** Nothing older than this survives. */
  cutoff: Date;
  /** Rows per DELETE statement. */
  batchSize: number;
  /** Most rows this pass will remove, however many are eligible. */
  maxThisPass: number;
}

/**
 * Plan a retention pass.
 *
 * @param retentionDays how much history to keep. Zero or negative disables
 *        retention entirely — returning `null` rather than a cutoff of "now",
 *        because a misconfigured zero must not be read as "delete everything".
 */
export function planRetention(retentionDays: number, now: Date = new Date()): RetentionPlan | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;

  return {
    cutoff: new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000),
    batchSize: RETENTION_BATCH,
    maxThisPass: RETENTION_MAX_PER_PASS,
  };
}

/**
 * How many batches a pass may run, given how many rows it is allowed to take.
 *
 * Split out so the loop bound is a value that can be asserted rather than an
 * arithmetic expression buried in a `while`.
 */
export function batchesPerPass(plan: RetentionPlan): number {
  return Math.max(1, Math.ceil(plan.maxThisPass / plan.batchSize));
}
