/**
 * Two of the three sync figures were literals.
 *
 *     syncSummary: {
 *       totalSlaves: stackConfig.nodes?.filter((n) => n.role !== 'master').length ?? 0,
 *       syncedSlaves: 0,
 *       totalPending: 0,
 *     }
 *
 * `totalSlaves` is counted. The other two are written down, and they sit
 * beside it — which is what makes them dangerous rather than merely useless.
 * A reader sees three numbers of the same shape from the same object and has
 * no way to tell that one was measured and two were typed. «0 pending» is a
 * reassuring thing to say about replication that has never moved.
 *
 * The same page has the matching hole: `IStackNodeStatus.syncStatus` is
 * assigned `null` at both sites that build it, while the «Sync» column of
 * `stack status` reads it. A column that can only ever be empty.
 *
 * And the data exists. `OmnitronSync.getSyncStatus` has answered since it was
 * written; `getNodeSyncStatus` already calls it, and its docblock records what
 * the absence cost: «47,407 entries buffered on one, none delivered, over
 * eleven hours, while the page showed it healthy». `pendingItems` climbing
 * while `lastSyncAt` stands still is the whole diagnosis, and it was one call
 * away the entire time.
 *
 * So: count what can be counted, and say nothing where nothing is known —
 * `null` rather than a confident zero.
 */

import { describe, it, expect } from 'vitest';

import { summariseSync, type NodeWithSync } from '../../src/services/sync-summary.js';
import type { ISyncStatus } from '../../src/shared/dto/project.js';

const sync = (over: Partial<ISyncStatus> = {}): ISyncStatus => ({
  connected: true,
  lastSyncAt: Date.now(),
  pendingItems: 0,
  bufferSize: 0,
  lastError: null,
  failedAttempts: 0,
  ...over,
});

describe('figures that were written rather than counted', () => {
  it('counts the slaves that are actually synced', () => {
    const nodes: NodeWithSync[] = [
      { role: 'master', syncStatus: null },
      { role: 'app', syncStatus: sync({ connected: true, pendingItems: 0 }) },
      { role: 'app', syncStatus: sync({ connected: true, pendingItems: 12 }) },
      { role: 'app', syncStatus: sync({ connected: false, pendingItems: 400 }) },
    ];

    const summary = summariseSync(nodes);

    expect(summary.totalSlaves, 'the master is not a slave').toBe(3);
    expect(summary.syncedSlaves, 'connected with nothing pending is synced').toBe(1);
  });

  it('adds up what is actually waiting', () => {
    const nodes: NodeWithSync[] = [
      { role: 'app', syncStatus: sync({ pendingItems: 47_407 }) },
      { role: 'app', syncStatus: sync({ pendingItems: 3 }) },
    ];

    expect(summariseSync(nodes).totalPending, 'a backlog reported as zero is worse than unknown').toBe(
      47_410,
    );
  });

  it('says nothing about a node it has not heard from', () => {
    // The point of the change: a node whose status is unknown must not be
    // counted as synced with nothing pending. Silence, not a confident zero.
    const nodes: NodeWithSync[] = [
      { role: 'app', syncStatus: null },
      { role: 'app', syncStatus: undefined },
    ];

    const summary = summariseSync(nodes);

    expect(summary.totalSlaves).toBe(2);
    expect(summary.syncedSlaves, 'unknown is not synced').toBe(0);
    expect(summary.totalPending, 'unknown contributes nothing to a total').toBe(0);
  });

  it('a stack with no slaves reports zeroes that mean it', () => {
    // Control: here the zeroes are counted, not typed, and they are correct.
    const summary = summariseSync([{ role: 'master', syncStatus: null }]);

    expect(summary).toEqual({ totalSlaves: 0, syncedSlaves: 0, totalPending: 0 });
  });
});
