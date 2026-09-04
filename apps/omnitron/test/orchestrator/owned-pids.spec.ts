/**
 * What the orchestrator considers its own.
 *
 * `ProcessJanitor` kills every fork-worker absent from this set, so an
 * omission here is not a reporting gap — it is the janitor killing live
 * workers. The janitor's own suite cannot catch that: it supplies the owned
 * set as a fixture, which is precisely the shape of test that lets a defect
 * in the thing being faked survive a full green run.
 */

import { describe, it, expect } from 'vitest';

import { collectOwnedPids, type OwnedPidHandle } from '../../src/orchestrator/owned-pids.js';

/** A handle with `n` single-instance children and the pools given. */
function handle(children: Record<string, string>, pools: Record<string, string[]> = {}): OwnedPidHandle {
  return {
    supervisor: {
      getChildNames: () => Object.keys(children),
      getChildProcessId: (name) => children[name] ?? null,
    },
    topologyPools: new Map(Object.entries(pools).map(([name, ids]) => [name, { getWorkerIds: () => ids }])),
  };
}

/** Worker id → pid, with anything unlisted having no pid of its own. */
function pids(map: Record<string, number>) {
  return (workerId: string) => map[workerId];
}

describe('collectOwnedPids', () => {
  it('collects supervisor children', () => {
    const owned = collectOwnedPids([handle({ http: 'w-http' })], pids({ 'w-http': 101 }));
    expect([...owned]).toEqual([101]);
  });

  it('collects pool workers as well', () => {
    // The defect this file exists for. Topology entries declaring
    // `instances > 1` run in a pool the supervisor knows nothing about, so
    // walking only `getChildNames()` left every pool worker outside the
    // owned set — an orphan by construction. Observed live: two pools of
    // two were reaped every thirty seconds for as long as the daemon ran.
    const owned = collectOwnedPids(
      [handle({ http: 'w-http' }, { transform: ['w-t1', 'w-t2'] })],
      pids({ 'w-http': 101, 'w-t1': 201, 'w-t2': 202 })
    );

    expect([...owned].sort((a, b) => a - b)).toEqual([101, 201, 202]);
  });

  it('collects pool workers for an app with no supervisor children at all', () => {
    const owned = collectOwnedPids([handle({}, { worker: ['w-1'] })], pids({ 'w-1': 301 }));
    expect([...owned]).toEqual([301]);
  });

  it('spans every app the orchestrator supervises', () => {
    const owned = collectOwnedPids(
      [handle({ http: 'a-http' }, { pool: ['a-p'] }), handle({ http: 'b-http' }, { pool: ['b-p'] })],
      pids({ 'a-http': 1, 'a-p': 2, 'b-http': 3, 'b-p': 4 })
    );

    expect([...owned].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('omits a worker that has no pid of its own', () => {
    // A worker thread shares the daemon's pid rather than holding one. The
    // honest answer is to leave it out: adding the daemon's pid would make
    // every liveness check on that entry answer about the daemon, and the
    // janitor would then be reasoning about a process it must never touch.
    const owned = collectOwnedPids([handle({ http: 'w-http' }, { pool: ['w-thread'] })], pids({ 'w-http': 101 }));

    expect([...owned]).toEqual([101]);
  });

  it('skips a child the supervisor cannot resolve to a process', () => {
    const owned = collectOwnedPids([handle({ http: 'w-http', pending: '' })], pids({ 'w-http': 101 }));
    expect([...owned]).toEqual([101]);
  });

  it('deduplicates a pid reachable through more than one route', () => {
    const owned = collectOwnedPids([handle({ http: 'w-1' }, { pool: ['w-1'] })], pids({ 'w-1': 101 }));
    expect([...owned]).toEqual([101]);
  });

  it('is empty when nothing is running, rather than throwing', () => {
    expect(collectOwnedPids([], pids({}))).toEqual(new Set());
    expect(collectOwnedPids([{ supervisor: null, topologyPools: new Map() }], pids({}))).toEqual(new Set());
  });
});
