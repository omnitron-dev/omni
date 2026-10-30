import { sql, type Kysely } from 'kysely';
import type { ReplicationEvidence } from '../shared/dto/project.js';
import { toIsoUtc } from '../database/sqlite-date-binding.js';

export interface ReplicationReceipt {
  version: 1;
  committedIds: string[];
  discardedIds: string[];
}

/** Bound input before SQL construction. Missing classifications mean unverified. */
export function receiptGroups(ids: string[], receipt?: ReplicationReceipt) {
  const validate = (values: unknown): values is string[] => Array.isArray(values) && values.length <= 10_000 &&
    values.every(id => typeof id === 'string' && id.length > 0 && id.length <= 64);
  if (!validate(ids)) throw new Error('Replication acknowledgement requires at most 10000 bounded entry IDs');
  const all = new Set(ids);
  if (receipt && (receipt.version !== 1 || !validate(receipt.committedIds) || !validate(receipt.discardedIds))) {
    throw new Error('Unsupported replication receipt');
  }
  const committed = new Set(receipt?.committedIds ?? []);
  const discarded = new Set(receipt?.discardedIds ?? []);
  for (const id of committed) if (!all.has(id) || discarded.has(id)) throw new Error('Conflicting replication receipt');
  for (const id of discarded) if (!all.has(id)) throw new Error('Replication receipt names an unacknowledged entry');
  return { committed: [...committed], discarded: [...discarded], unverified: [...all].filter(id => !committed.has(id) && !discarded.has(id)) };
}

interface EvidenceRow {
  epoch: string; startedAt: string; firstTrackedId: string; namespaceFrom: string; producedThrough: string;
  releasedThrough: string; committedThrough: string;
  committedRows: number; discardedRows: number; unverifiedRows: number; evictedRows: number;
  lastReleasedAt: string | null; lastCommittedAt: string | null; lastLossAt: string | null;
  totalBytes: number; totalRows: number; syncedRows: number; pendingBytes: number;
  oldest: string | null;
}

function time(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(toIsoUtc(value));
  if (!Number.isFinite(parsed)) throw new Error('Replication evidence contains an invalid timestamp');
  return parsed;
}

/** A singleton plus two indexed seeks, independent of the queue length. */
export async function readReplicationEvidence(db: Kysely<unknown>) {
  const result = await sql<EvidenceRow>`SELECT
    r.epoch, r.startedAt, cast(r.firstTrackedId AS TEXT) AS firstTrackedId, cast(r.namespaceFrom AS TEXT) AS namespaceFrom,
    cast(r.producedThrough AS TEXT) AS producedThrough,
    cast(min(r.producedThrough + 1, coalesce((SELECT id FROM sync_buffer WHERE syncedAt IS NULL ORDER BY id LIMIT 1), r.producedThrough + 1)) - 1 AS TEXT) AS releasedThrough,
    cast(min(r.producedThrough + 1, coalesce(r.firstUncommittedId, r.producedThrough + 1),
      coalesce((SELECT id FROM sync_buffer WHERE syncedAt IS NULL ORDER BY id LIMIT 1), r.producedThrough + 1)) - 1 AS TEXT) AS committedThrough,
    r.committedRows, r.discardedRows, r.unverifiedRows, r.evictedRows, r.lastReleasedAt, r.lastCommittedAt, r.lastLossAt,
    s.totalBytes, s.totalRows, s.syncedRows, s.pendingBytes,
    (SELECT createdAt FROM sync_buffer WHERE syncedAt IS NULL ORDER BY createdAt LIMIT 1) AS oldest
    FROM sync_replication_state r JOIN sync_buffer_stats s ON r.id = s.id WHERE r.id = 1`.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error('Replication evidence singleton is missing; queue state is unavailable');
  if ([row.totalRows, row.syncedRows, row.totalBytes, row.pendingBytes, row.committedRows, row.discardedRows,
    row.unverifiedRows, row.evictedRows].some(value => !Number.isSafeInteger(value) || value < 0) ||
    row.syncedRows > row.totalRows || row.pendingBytes > row.totalBytes) {
    throw new Error('Replication evidence counters disagree; queue state is unavailable');
  }
  const evidence: ReplicationEvidence = {
    epoch: row.epoch, since: row.startedAt, firstTrackedId: row.firstTrackedId, producedThrough: row.producedThrough,
    releasedThrough: row.releasedThrough, committedThrough: row.committedThrough,
    committedRows: row.committedRows, discardedRows: row.discardedRows, unverifiedRows: row.unverifiedRows, evictedRows: row.evictedRows,
    lastCommittedAt: time(row.lastCommittedAt), lastLossAt: time(row.lastLossAt),
  };
  return { evidence, namespaceFrom: row.namespaceFrom, pendingItems: row.totalRows - row.syncedRows, bufferSize: row.pendingBytes,
    retainedBufferSize: row.totalBytes, lastSyncAt: time(row.lastReleasedAt),
    oldestPendingAgeMs: row.oldest === null ? null : Math.max(0, Date.now() - time(row.oldest)!) };
}
