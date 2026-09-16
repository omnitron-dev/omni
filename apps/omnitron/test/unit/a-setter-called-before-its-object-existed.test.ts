/**
 * An optional call is only safe where the object is known to exist.
 *
 * Three readers ask every node about itself — its titan-health indicators, its
 * replication status, its telemetry relay — and reach a remote node over the
 * mesh. A daemon has no mesh connection to itself, so each needs a local
 * source, handed to the RPC service by a setter.
 *
 * I wrote the first of them next to `new SyncService(...)`, as
 * `this.nodeManagerRpcService?.setSyncService(...)` — ninety lines ABOVE the
 * assignment of `this.nodeManagerRpcService`, inside the same function. The
 * `?.` made it type-check and made it silent: the call never happened, and the
 * local node would have answered "OmnitronSync is not wired on this daemon"
 * forever, which reads as a broken daemon rather than as a missing line.
 *
 * That is the shape of the defect this whole day has been about — a thing that
 * is complete, correct and never reached — arriving inside its own fix. The
 * guard is not "remember the order" but "don't write `?.` where the object is
 * supposed to be there": on the local instance, after it is assigned.
 *
 * This pins the daemon's wiring order, which is what no type can check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const daemonSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/daemon/daemon.ts'),
  'utf8',
);

/** Line of the first match, 1-based; -1 when absent. */
const lineOf = (needle: string) => daemonSrc.split('\n').findIndex((l) => l.includes(needle)) + 1;

describe('the local sources are handed over after the service exists', () => {
  it('assigns the RPC service before wiring its sync source', () => {
    const assigned = lineOf('this.nodeManagerRpcService = nodeManagerRpcService;');
    const wired = lineOf('.setSyncService(');

    expect(assigned).toBeGreaterThan(0);
    expect(wired).toBeGreaterThan(0);
    expect(wired).toBeGreaterThan(assigned);
  });

  it('wires sync on the local instance, not through an optional field', () => {
    // `this.nodeManagerRpcService?.setSyncService(...)` type-checks anywhere
    // and does nothing where the field is still undefined. The instance is in
    // scope at the point this runs, so there is nothing to be optional about.
    expect(daemonSrc).toContain('nodeManagerRpcService.setSyncService(');
    expect(daemonSrc).not.toContain('this.nodeManagerRpcService?.setSyncService(');
  });

  it('wires every local source exactly once', () => {
    // A second call would mean two places believe they own the wiring, and the
    // later one wins silently.
    for (const setter of ['setSyncService', 'setTelemetryRelay', 'setTitanHealth', 'setLeaderElection']) {
      const calls = daemonSrc.split(`.${setter}(`).length - 1;
      expect(calls, `${setter} is wired ${calls} times`).toBe(1);
    }
  });
});

describe('every local source has a setter and every setter a call', () => {
  const rpcSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/services/node-manager.rpc-service.ts'),
    'utf8',
  );

  it('declares no setter the daemon never calls', () => {
    // The readers degrade honestly when a source is missing — they answer
    // `reachable: false` with a reason — which is right for a node outside the
    // mesh and indistinguishable from a forgotten line for the local one.
    const setters = [...rpcSrc.matchAll(/^  set([A-Z][A-Za-z]*)\(/gm)].map((m) => `set${m[1]}`);
    const localSources = setters.filter((s) =>
      ['setSyncService', 'setTelemetryRelay', 'setTitanHealth', 'setLeaderElection'].includes(s));

    expect(localSources).toHaveLength(4);
    for (const s of localSources) {
      expect(daemonSrc, `${s} has no caller in the daemon`).toContain(`.${s}(`);
    }
  });
});
