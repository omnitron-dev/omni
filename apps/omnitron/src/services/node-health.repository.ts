/**
 * NodeHealthRepository — Direct PG reads for health check history
 *
 * The health-monitor worker writes rows to `node_health_checks`.
 * This repository reads them for the RPC layer — no worker proxy needed.
 */

import type { Kysely } from 'kysely';
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

export function clampUptimeInterval(ms: number): number {
  const clamped = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, ms));
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
   */
  async getUptimeBar(nodeId: string, bucketCount = 60, intervalMs = MIN_INTERVAL_MS): Promise<UptimeBucket[]> {
    const interval = clampUptimeInterval(intervalMs);
    const totalSpanMs = bucketCount * interval;
    const cutoff = new Date(Date.now() - totalSpanMs).toISOString();

    const rows = await this.db
      .selectFrom('node_health_checks')
      .select(['checkedAt', 'pingReachable', 'omnitronConnected', 'omnitronError'])
      .where('nodeId', '=', nodeId)
      .where('checkedAt', '>=', cutoff as any)
      .orderBy('checkedAt', 'asc')
      .execute();

    // Build time-bucketed aggregation
    const now = Date.now();
    const bucketStart = now - totalSpanMs;
    const buckets: UptimeBucket[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const from = bucketStart + i * interval;
      buckets.push({
        t: new Date(from).toISOString(),
        ping: -1,   // will be set below
        omnitron: -1,
        checks: 0,
      });
    }

    // Assign each row to its bucket
    for (const row of rows) {
      const ts = new Date((row as any).checkedAt).getTime();
      const idx = Math.floor((ts - bucketStart) / interval);
      if (idx < 0 || idx >= bucketCount) continue;

      const bucket = buckets[idx]!;
      bucket.checks++;

      // Accumulate ping
      if (bucket.ping === -1) bucket.ping = 0;
      if ((row as any).pingReachable) bucket.ping++;

      // Accumulate omnitron
      const err = (row as any).omnitronError ?? '';
      const notInstalled = /not found|command not found|no such file|ENOENT/i.test(err);

      if (notInstalled) {
        // Mark as not-installed only if ALL checks in bucket are not-installed
        if (bucket.omnitron === -1) bucket.omnitron = -2; // sentinel: all not-installed so far
        // If previously had real data, leave it
      } else {
        if (bucket.omnitron === -1 || bucket.omnitron === -2) bucket.omnitron = 0;
        if ((row as any).omnitronConnected) bucket.omnitron++;
      }
    }

    // Convert counts to percentages
    for (const b of buckets) {
      if (b.checks === 0) {
        b.ping = -1;    // no data
        b.omnitron = -1;
      } else {
        b.ping = b.ping < 0 ? 0 : b.ping / b.checks;
        if (b.omnitron === -2) {
          b.omnitron = -1; // all not-installed
        } else {
          b.omnitron = b.omnitron < 0 ? 0 : b.omnitron / b.checks;
        }
      }
    }

    return buckets;
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
