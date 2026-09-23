/**
 * Whether a node's replication is keeping up — one reading for `omnitron
 * stack status` and the console's stack pages.
 *
 * The master PULLS: on each heartbeat sweep (15 s by default) it drains the
 * slave's `sync_buffer`, and `ackDrained` advances `lastSyncAt`. So entries
 * are always waiting between two pulls — 275 to 515 on the test node,
 * sampled every 10 s on 2026-09-23 while `lastSyncAt` moved every 15 s —
 * and a node is behind only when entries wait and no pull has come.
 *
 * `connected` is not read: it is the slave's PUSH channel, which no
 * production code opens (`ISyncStatus.connected`). The stack page read it
 * anyway, so every node there said «Buffering», in amber, for ever; the
 * stack list counted the nodes whose daemon answered and called them
 * «synced».
 *
 * Imported by the console through `@omnitron-dev/omnitron/sync-reading`, so
 * nothing here may need Node.
 */

import type { ISyncStatus } from './dto/project.js';

/** Entries waiting and no pull for this long is a node falling behind: four missed default sweeps. */
export const PULL_OVERDUE_MS = 60_000;

export type SyncFinding =
  /** Nothing waiting. */
  | { readonly state: 'synced' }
  /** Entries since the last pull, and that pull recent: keeping up. */
  | { readonly state: 'pulling'; readonly pending: number; readonly lastPullMs: number }
  /** Entries waiting, and no pull for `PULL_OVERDUE_MS` — or none ever (`lastPullMs: null`). */
  | { readonly state: 'behind'; readonly pending: number; readonly lastPullMs: number | null };

export function syncFinding(
  status: Pick<ISyncStatus, 'pendingItems' | 'lastSyncAt'>,
  now: number = Date.now()
): SyncFinding {
  if (status.pendingItems === 0) return { state: 'synced' };
  const lastPullMs = status.lastSyncAt === null ? null : Math.max(0, now - status.lastSyncAt);
  return lastPullMs !== null && lastPullMs < PULL_OVERDUE_MS
    ? { state: 'pulling', pending: status.pendingItems, lastPullMs }
    : { state: 'behind', pending: status.pendingItems, lastPullMs };
}

/** Keeping up: nothing waiting, or only what arrived since a recent pull. */
export const inSync = (finding: SyncFinding): boolean => finding.state !== 'behind';

/** The finding in words, as `stack status` and the stack pages print it. */
export function syncWords(finding: SyncFinding): string {
  if (finding.state === 'synced') return 'in sync';
  if (finding.state === 'pulling') return `in sync · ${finding.pending} since the last pull`;
  return finding.lastPullMs === null
    ? `behind · ${finding.pending} waiting, never pulled`
    : `behind · ${finding.pending} waiting, last pull ${Math.round(finding.lastPullMs / 1000)} s ago`;
}
