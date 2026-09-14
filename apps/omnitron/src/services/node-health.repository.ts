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
  /** OMNITRON uptime 0.0–1.0 (-1 = not installed, all checks returned "not found") */
  omnitron: number;
  /** Total checks in this bucket */
  checks: number;
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

    const { rows } = await sql<{
      idx: number | string;
      checks: number | string;
      ping_up: number | string;
      omni_up: number | string;
      omni_applicable: number | string;
    }>`
      SELECT
        floor(
          (extract(epoch from "checkedAt") * 1000 - ${bucketStart}) / ${interval}
        )::int AS idx,
        count(*) AS checks,
        count(*) FILTER (WHERE "pingReachable") AS ping_up,
        count(*) FILTER (WHERE "omnitronConnected") AS omni_up,
        count(*) FILTER (
          WHERE coalesce("omnitronError", '') !~* ${NOT_INSTALLED_PATTERN}
        ) AS omni_applicable
      FROM node_health_checks
      WHERE "nodeId" = ${nodeId}
        AND "checkedAt" >= ${cutoff}::timestamptz
      GROUP BY idx
    `.execute(this.db);

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
      // A bucket in which every check said "omnitron is not installed" is not
      // 0% uptime — it is a node that was never meant to run one. `-1` is the
      // console's "no data" shade; 0 would paint it red.
      bucket.omnitron = Number(row.omni_applicable) > 0 ? Number(row.omni_up) / checks : -1;
    }

    return buckets;
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
