/**
 * NodeHealthRepository — Direct PG reads for health check history
 *
 * The health-monitor worker writes rows to `node_health_checks`.
 * This repository reads them for the RPC layer — no worker proxy needed.
 */

import { sql, type Kysely } from 'kysely';
import type { OmnitronDatabase } from '../database/schema.js';

export interface HealthCheckRow {
  nodeId: string;
  checkedAt: string;
  checkDurationMs: number;
  pingReachable: boolean;
  pingLatencyMs: number | null;
  pingError: string | null;
  sshConnected: boolean;
  sshLatencyMs: number | null;
  sshError: string | null;
  omnitronConnected: boolean;
  omnitronVersion: string | null;
  omnitronPid: number | null;
  omnitronUptime: number | null;
  omnitronRole: string | null;
  omnitronError: string | null;
  os: { platform: string; arch: string; hostname: string; release: string } | null;
}

/**
 * Uptime bar bucket — aggregated over `intervalMs`.
 *
 * `uptimePct`: 0.0 = fully down, 1.0 = fully up during this bucket.
 * Frontend maps this to a green→red color gradient.
 */
export interface UptimeBucket {
  /** Bucket start (ISO) */
  t: string;
  /** PING uptime 0.0–1.0 */
  ping: number;
  /**
   * OMNITRON uptime over the checks that could measure it, or -1 when none
   * could.
   *
   * Not every check is a measurement. One that found no omnitron installed is
   * not evidence of downtime — there is nothing there to be down — and one
   * whose SSH was refused did not get far enough to look. Both used to sit in
   * the denominator, where they pulled the figure towards zero in proportion
   * to how many of them there were, and the console painted the result red.
   * Observed: a node with 60 "not installed" checks and 13 SSH failures in one
   * day, summarised as "OMNITRON 0%" — which reads as an outage, of software
   * that was never installed.
   */
  omnitron: number;
  /** Total checks in this bucket, measurements or not. */
  checks: number;
  /** When `omnitron` is -1 and checks ran, what those checks actually found. */
  omnitronUnmeasured?: 'absent' | 'unreachable';
}

/** Min 5min, max 24h, must be multiple of 5min */
const MIN_INTERVAL_MS = 5 * 60_000;
const MAX_INTERVAL_MS = 24 * 60 * 60_000;
const STEP_MS = 5 * 60_000;

/**
 * The errors that mean "omnitron is not installed here" rather than
 * "omnitron is not running". Kept as one string so the SQL aggregate and the
 * console's dot state test the same thing.
 */
const NOT_INSTALLED_PATTERN = 'not found|command not found|no such file|ENOENT';

/** One row of the per-bucket aggregate. Postgres returns counts as strings. */
export interface UptimeAggregateRow {
  idx: number | string;
  checks: number | string;
  ping_up: number | string;
  omni_up: number | string;
  omni_measured: number | string;
  omni_absent: number | string;
}

export function clampUptimeInterval(ms: number): number {
  const clamped = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Number.isFinite(ms) ? ms : MIN_INTERVAL_MS));
  return Math.round(clamped / STEP_MS) * STEP_MS;
}

export class NodeHealthRepository {
  constructor(private readonly db: Kysely<OmnitronDatabase>) {}

  /** Get recent check history for a node (newest first) */
  async getHistory(nodeId: string, limit = 50): Promise<HealthCheckRow[]> {
    const rows = await this.db
      .selectFrom('node_health_checks')
      .selectAll()
      .where('nodeId', '=', nodeId)
      .orderBy('checkedAt', 'desc')
      .limit(limit)
      .execute();

    return rows.map(mapRow);
  }

  /**
   * Get uptime bar data — aggregated into fixed-size buckets.
   *
   * @param nodeId - Node to query
   * @param bucketCount - How many buckets to return (default: 60)
   * @param intervalMs - Bucket width in ms (will be clamped/rounded to 5min multiples)
   *
   * Returns oldest→newest for chart rendering.
   *
   * The aggregation happens in Postgres. It used to `SELECT` every row in the
   * window and count them in JavaScript, and the window is
   * `bucketCount × interval` — the console asks for 200 buckets of 24 hours,
   * so each of these calls pulled *every check row of the last 200 days for
   * that node* across the wire to produce 200 numbers, once per node, on
   * every poll. What comes back now is one row per bucket that actually has
   * data.
   */
  async getUptimeBar(nodeId: string, bucketCount = 60, intervalMs = MIN_INTERVAL_MS): Promise<UptimeBucket[]> {
    const interval = clampUptimeInterval(intervalMs);
    const count = Math.max(1, Math.floor(bucketCount));
    const totalSpanMs = count * interval;
    const now = Date.now();
    const bucketStart = now - totalSpanMs;
    const cutoff = new Date(bucketStart).toISOString();

    const { rows } = await sql<UptimeAggregateRow>`
      SELECT
        floor(
          (extract(epoch from "checkedAt") * 1000 - ${bucketStart}) / ${interval}
        )::int AS idx,
        count(*) AS checks,
        count(*) FILTER (WHERE "pingReachable") AS ping_up,
        count(*) FILTER (WHERE "omnitronConnected") AS omni_up,
        -- A measurement is a check that could have seen omnitron running:
        -- it either did, or it reached the machine and found omnitron absent
        -- from it in the "not running" sense rather than the "not installed"
        -- one. A check whose SSH was refused reached nothing and measured
        -- nothing.
        count(*) FILTER (
          WHERE "omnitronConnected"
             OR ("sshConnected" AND coalesce("omnitronError", '') !~* ${NOT_INSTALLED_PATTERN})
        ) AS omni_measured,
        count(*) FILTER (
          WHERE coalesce("omnitronError", '') ~* ${NOT_INSTALLED_PATTERN}
        ) AS omni_absent
      FROM node_health_checks
      WHERE "nodeId" = ${nodeId}
        AND "checkedAt" >= ${cutoff}::timestamptz
      GROUP BY idx
    `.execute(this.db);

    return assembleBuckets(rows, bucketStart, interval, count);
  }

  /**
   * Delete every check row for a node.
   *
   * A removed node's rows are not history any more — nothing can name the id
   * they belong to, they are never read again, and they keep accumulating in
   * a table whose retention sweep only looks at age. Called when a node
   * leaves the registry.
   */
  async deleteHistory(nodeId: string): Promise<number> {
    const result = await this.db
      .deleteFrom('node_health_checks')
      .where('nodeId', '=', nodeId)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
}

/**
 * Turn the per-bucket counts into the series the console draws.
 *
 * Its own function because this is where the arithmetic lives, and the
 * arithmetic is what was wrong: inside the method it could only be reached
 * with a live Postgres, so the one part worth checking was the one part no
 * test could see.
 */
export function assembleBuckets(
  rows: readonly UptimeAggregateRow[],
  bucketStart: number,
  interval: number,
  count: number,
): UptimeBucket[] {
  const buckets: UptimeBucket[] = [];
  for (let i = 0; i < count; i++) {
    buckets.push({ t: new Date(bucketStart + i * interval).toISOString(), ping: -1, omnitron: -1, checks: 0 });
  }

  for (const row of rows) {
    const idx = Number(row.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
    const checks = Number(row.checks);
    if (checks <= 0) continue;

    const bucket = buckets[idx]!;
    bucket.checks = checks;
    bucket.ping = Number(row.ping_up) / checks;

    // Uptime is measured over the checks that were measurements. The guard
    // below was here for the all-or-nothing case — "every check said not
    // installed" — and the proportion underneath it still divided by every
    // check, so a bucket that MIXED the two got the wrong number rather than
    // no number.
    const measured = Number(row.omni_measured);
    bucket.omnitron = measured > 0 ? Number(row.omni_up) / measured : -1;
    if (measured === 0) {
      // Nothing was measured, and which kind of nothing is the whole
      // difference between "there is no omnitron here" and "we could not get
      // to this machine".
      bucket.omnitronUnmeasured = Number(row.omni_absent) > 0 ? 'absent' : 'unreachable';
    }
  }

  return buckets;
}

function mapRow(row: any): HealthCheckRow {
  return {
    nodeId: row.nodeId,
    checkedAt: new Date(row.checkedAt).toISOString(),
    checkDurationMs: Number(row.checkDurationMs),
    pingReachable: !!row.pingReachable,
    pingLatencyMs: row.pingLatencyMs != null ? Number(row.pingLatencyMs) : null,
    pingError: row.pingError ?? null,
    sshConnected: !!row.sshConnected,
    sshLatencyMs: row.sshLatencyMs != null ? Number(row.sshLatencyMs) : null,
    sshError: row.sshError ?? null,
    omnitronConnected: !!row.omnitronConnected,
    omnitronVersion: row.omnitronVersion ?? null,
    omnitronPid: row.omnitronPid != null ? Number(row.omnitronPid) : null,
    omnitronUptime: row.omnitronUptime != null ? Number(row.omnitronUptime) : null,
    omnitronRole: row.omnitronRole ?? null,
    omnitronError: row.omnitronError ?? null,
    os: typeof row.os === 'string' ? JSON.parse(row.os) : row.os ?? null,
  };
}
