/**
 * Reading the log table as a symptom.
 *
 * A message repeated far more often than anything else is not noise — it is
 * a loop that cannot make progress, and it is invisible from every surface
 * an operator normally looks at. The logs page shows the most recent lines,
 * which are all the same line; the alerts page shows rules nobody wrote for
 * a failure nobody predicted; and the daemon reports itself healthy the
 * whole time, because it is.
 *
 * This host carried 2.5 million copies of "Failed to process outbox event"
 * across three days in May — one event with a `retryCount` of 799 289 — and
 * nothing anywhere said so. The table was also 13 GB, and most of that was
 * this.
 *
 * The rules here are deliberately about SHAPE rather than volume. "More than
 * N errors an hour" is a threshold someone has to tune per deployment and
 * will eventually raise rather than investigate. "One message is most of the
 * errors" is scale-free: it means the same thing on a quiet host and a busy
 * one, and it is exactly the signature of a retry loop.
 */

export interface MessageCount {
  app: string;
  message: string;
  count: number;
}

export interface LogHealthFinding {
  kind: 'dominant-error' | 'retry-loop' | 'duplicate-ingest';
  app: string;
  message: string;
  count: number;
  /** Share of the window's errors, 0..1. Only for `dominant-error`. */
  share?: number;
  /** Highest retry count seen on the offending events. Only for `retry-loop`. */
  retryCount?: number;
}

/**
 * A single message has to be this much of the error volume, and occur this
 * many times, before it is worth an operator's attention.
 *
 * Both are needed. The share alone fires on a host with four errors all
 * morning, three of them the same; the count alone is the tunable threshold
 * this is trying not to be.
 */
export const DOMINANCE_SHARE = 0.5;
export const DOMINANCE_MIN_COUNT = 100;

/** A retry count past this is a loop, not a retry policy. */
export const RETRY_LOOP_THRESHOLD = 1_000;

/**
 * Find messages that dominate the error volume of a window.
 *
 * @param counts per-message error counts for the window, any order
 */
export function findDominantErrors(counts: MessageCount[]): LogHealthFinding[] {
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return [];

  // Grouped by message, not by (app, message).
  //
  // Every child log line is currently stored twice — once under the app's
  // own name and once under `omnitron`, because titan-pm re-logs child output
  // through the parent logger while the orchestrator is already capturing it.
  // Per-app grouping splits one message into two rows of half the size each,
  // so a message that is 100% of the errors measures as 50% and slips under
  // any threshold at or above that. Found by running this check against the
  // window where the loop actually happened.
  //
  // Grouping by message is right either way: the same failure reported by
  // two components is still one failure.
  const byMessage = new Map<string, { apps: Set<string>; count: number }>();
  for (const c of counts) {
    const entry = byMessage.get(c.message) ?? { apps: new Set<string>(), count: 0 };
    entry.apps.add(c.app);
    entry.count += c.count;
    byMessage.set(c.message, entry);
  }

  return [...byMessage.entries()]
    .filter(([, e]) => e.count >= DOMINANCE_MIN_COUNT && e.count / total >= DOMINANCE_SHARE)
    .map(([message, e]) => ({
      kind: 'dominant-error' as const,
      app: [...e.apps].sort().join(', '),
      message,
      count: e.count,
      share: e.count / total,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The share of a window that must be duplicated before this is a finding.
 *
 * A pair of identical (timestamp, message) rows under two app names is not
 * automatically a defect: several apps going through a coordinated shutdown
 * log "Application stopping" in the same millisecond, and that is two apps
 * doing the same thing rather than one line stored twice.
 *
 * Measured on this host: the systematic duplication was around half the
 * table; the coincidences that remain after fixing it are 1.4% — eighteen
 * rows in twelve hundred, every one of them a lifecycle phase shared
 * between apps. Ten percent sits an order of magnitude above the noise and
 * well below the defect.
 *
 * The first version of this check had no threshold at all and fired on
 * those eighteen rows, which is how a guard becomes something people
 * switch off.
 */
export const DUPLICATION_SHARE = 0.1;

/**
 * Messages recorded under more than one app name at the same instant.
 *
 * Not a nicety when it is systematic: it doubles the log table, and this
 * host's was 13 GB. It also makes every per-app count wrong by a factor that
 * depends on which component happened to emit the line, which is the kind of
 * error that survives because each number looks plausible on its own.
 */
export function findDuplicatedLogs(
  pairs: Array<{ app: string; otherApp: string; count: number }>,
  totalRows: number
): LogHealthFinding[] {
  const duplicated = pairs.reduce((sum, p) => sum + p.count, 0);
  if (duplicated === 0 || totalRows === 0) return [];
  if (duplicated / totalRows < DUPLICATION_SHARE) return [];

  return [
    {
      kind: 'duplicate-ingest' as const,
      app: [...new Set(pairs.flatMap((p) => [p.app, p.otherApp]))].sort().join(', '),
      message: `${duplicated.toLocaleString('en-US')} of ${totalRows.toLocaleString('en-US')} recent rows are stored twice`,
      count: duplicated,
      share: duplicated / totalRows,
    },
  ];
}

/**
 * Turn a retry count into a finding.
 *
 * A retry policy has a ceiling; a number in the hundreds of thousands means
 * the ceiling is missing, and the work is not being done either way. The
 * event will never succeed and the loop will never stop.
 */
export function findRetryLoops(counts: Array<MessageCount & { retryCount: number }>): LogHealthFinding[] {
  return counts
    .filter((c) => c.retryCount >= RETRY_LOOP_THRESHOLD)
    .map((c) => ({
      kind: 'retry-loop' as const,
      app: c.app,
      message: c.message,
      count: c.count,
      retryCount: c.retryCount,
    }))
    .sort((a, b) => b.retryCount - a.retryCount);
}

/** One line an operator can act on. */
export function describeFinding(finding: LogHealthFinding): string {
  if (finding.kind === 'duplicate-ingest') return `${finding.message} (${finding.app})`;
  if (finding.kind === 'retry-loop') {
    return `${finding.app}: "${finding.message}" — an event has been retried ${finding.retryCount!.toLocaleString('en-US')} times`;
  }
  const percent = Math.round((finding.share ?? 0) * 100);
  return `${finding.app}: "${finding.message}" — ${finding.count.toLocaleString('en-US')} occurrences, ${percent}% of all errors`;
}
