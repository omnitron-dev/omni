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
 * A node is synced when it has nothing left to deliver.
 *
 * NOT `connected && pendingItems === 0`, which is what this said first and
 * which can never be true. `ISyncStatus.connected` is `masterInvoke !==
 * null` — whether the slave holds a PUSH channel to the master — and that
 * channel has no production caller; `sync.rpc-service.ts` says so in as many
 * words. Replication runs the other way: the master PULLS, through
 * `drainBuffer`/`ackDrained`, and `ackDrained` is what advances
 * `lastSyncAt`. So a node that is perfectly up to date reports
 * `connected: false`, and requiring it made «synced» a state the column
 * could never print — an unreachable figure one level down from the literal
 * zero it replaced.
 *
 * Of the six fields, three are written only by that dead path — `connected`,
 * `lastError` and `failedAttempts`. `pendingItems` and `lastSyncAt` are the
 * two the pull path maintains, and they are the two to count on.
 */
function isSynced(status: ISyncStatus): boolean {
  return status.pendingItems === 0;
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
