/**
 * The sync figures a stack reports.
 *
 * Two of the three used to be literals:
 *
 *     syncedSlaves: 0,
 *     totalPending: 0,
 *
 * sitting beside a `totalSlaves` that was counted, in one object, with the
 * same shape — so a reader had no way to tell the measurement from the
 * assertion. «0 pending» reads as «replication is up to date», and it said
 * that whether replication was up to date, stopped, or had never started.
 *
 * The data was there the whole time: `OmnitronSync.getSyncStatus` answers per
 * node, and `getNodeSyncStatus` already calls it. What that call sees is the
 * diagnosis — `pendingItems` climbing while `lastSyncAt` stands still — and
 * the cost of not seeing it is recorded in that method: 47,407 entries
 * buffered on one node, none delivered, over eleven hours, while the page
 * reported it healthy.
 *
 * Which decides the one real question here: what a node we have NOT heard
 * from contributes. Nothing. It is not synced, and its backlog is unknown
 * rather than zero — the same mistake as the literal, made a level down.
 */

import type { ISyncStatus } from '../shared/dto/project.js';

export interface SyncSummary {
  /** Nodes that are not the master. Counted from the stack's own roster. */
  totalSlaves: number;
  /** Slaves connected with nothing waiting. Silence does not count as synced. */
  syncedSlaves: number;
  /** Entries waiting across the slaves we have a status for. */
  totalPending: number;
}

export interface NodeWithSync {
  role?: string | undefined;
  syncStatus?: ISyncStatus | null | undefined;
}

/**
 * A node is synced when it is connected AND has nothing left to deliver.
 * Connected with a backlog is not synced — that is the eleven-hour case.
 */
function isSynced(status: ISyncStatus): boolean {
  return status.connected && status.pendingItems === 0;
}

export function summariseSync(nodes: readonly NodeWithSync[]): SyncSummary {
  const slaves = nodes.filter((node) => node.role !== 'master');

  let syncedSlaves = 0;
  let totalPending = 0;

  for (const slave of slaves) {
    const status = slave.syncStatus;
    // No status means we have not heard from it, which is not the same as
    // hearing that it is fine. Both counters stay where they are.
    if (!status) continue;

    if (isSynced(status)) syncedSlaves += 1;
    totalPending += status.pendingItems;
  }

  return { totalSlaves: slaves.length, syncedSlaves, totalPending };
}
