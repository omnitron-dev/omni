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

/**
 * And then I built the figure on the one field that cannot be true.
 *
 * `summariseSync` counted a slave as synced when `connected && pendingItems
 * === 0`, which reads correctly and is unreachable. `ISyncStatus.connected`
 * is `this.masterInvoke !== null` — whether the slave holds a PUSH channel to
 * the master — and that channel has no production caller. The file says so
 * itself, in `sync.rpc-service.ts`:
 *
 *     «the other end, `SyncService.setMasterConnection()`, has no production
 *      caller either»
 *
 * Replication does work: the MASTER pulls, through `drainBuffer` /
 * `ackDrained`, and `ackDrained` is what advances `lastSyncAt`. So a node
 * that is perfectly up to date reports `connected: false`, and the column
 * could never print «synced» no matter how empty the buffer got — a second
 * unreachable state, one level down from the literal it replaced.
 *
 * Three of the six fields are fed only by that dead path:
 *
 *     connected       masterInvoke !== null     always false
 *     lastError       noteSyncFailure()         always null
 *     failedAttempts  backoff.attempt           always 0
 *
 * The two that are alive — `pendingItems` and `lastSyncAt` — are the two the
 * pull path writes, and they are the ones to count on. A slave with nothing
 * left to deliver IS synced; whether it also holds a push socket it never
 * uses is not the question anyone is asking of that column.
 */
describe('a figure built on a field that cannot be true', () => {
  it('counts a slave with an empty buffer as synced', () => {
    // `connected: false` is what EVERY node reports, so it must not be what
    // decides this.
    const nodes: NodeWithSync[] = [
      { role: 'app', syncStatus: sync({ connected: false, pendingItems: 0 }) },
      { role: 'app', syncStatus: sync({ connected: false, pendingItems: 40 }) },
    ];

    const summary = summariseSync(nodes);

    expect(summary.syncedSlaves, 'nothing left to deliver is synced').toBe(1);
    expect(summary.totalPending).toBe(40);
  });

  it('does not count a node it has not heard from', () => {
    // Control, restated against the new rule: the absence of a status must
    // still not be read as an empty buffer.
    expect(summariseSync([{ role: 'app', syncStatus: null }]).syncedSlaves).toBe(0);
  });

  it('a backlog is not synced even on a node that claims a channel', () => {
    // Control the other way: if `connected` ever starts being true, it must
    // not make a node with 47 407 entries look finished.
    const nodes: NodeWithSync[] = [{ role: 'app', syncStatus: sync({ connected: true, pendingItems: 47_407 }) }];

    expect(summariseSync(nodes).syncedSlaves).toBe(0);
  });
});
