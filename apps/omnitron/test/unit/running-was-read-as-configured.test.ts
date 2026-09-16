/**
 * The daemon's own database was adopted without being looked at.
 *
 * Every app service goes through `reconcileService`, which compares
 * `containerSpecHash` against the running container and recreates it when
 * they differ. The control plane's own Postgres took a different branch:
 *
 *     } else if (isGlobalPgRunning) {
 *       this.usingGlobalOmnitronPg = true;
 *       this.logger.info('Using existing omnitron-pg (already running)');
 *
 * "Already running" read as "configured as declared". Its spec was compared
 * to nothing, so a correction could not reach it.
 *
 * Measured: `omnitron-pg`, created 2026-09-04, before published ports were
 * bound to loopback. The fix that bound every other managed container reached
 * eleven of twelve; this one kept `HostIp: ""` on port 5480 and still
 * answered `nc -vz 192.168.1.144 5480 → open` from another machine on the
 * LAN, while `daos-dev-postgres` two lines below it in `docker ps` was
 * correctly on 127.0.0.1. The drift was detectable the whole time — the
 * running label said `216e704765d0272c` and the resolver computed
 * `7da6ee6f997509f4` — and nothing compared them.
 *
 * The subtlety that made the first attempt at this fix correct nothing: the
 * control-plane database is ONE container per host — it owns port 5480 — but
 * each daemon resolves a name carrying its own project prefix. A daemon on
 * the `daos/dev` stack computes `daos-dev-pg` while the container that exists
 * is `omnitron-pg`. Reconciling the running container against a spec under
 * the other name creates a second one and collides on the port. The name to
 * reconcile is the name of the container that is there; the spec is
 * everything else.
 *
 * A differing name is also not evidence of another owner — only omnitron
 * creates this container, and it carries omnitron's own `omnitron.internal`
 * label. Treating the mismatch as "borrowed, do not touch" was the first
 * version of this fix, and it left the port open.
 */

import { describe, it, expect } from 'vitest';

import { decideControlPlaneDatabase } from '../../src/infrastructure/infrastructure.service.js';

describe('a running container is not a configured one', () => {
  it('reconciles a running control-plane database', () => {
    const d = decideControlPlaneDatabase({
      needsControlPlaneDatabase: true,
      running: { name: 'omnitron-pg', status: 'running', specHash: '216e704765d0272c' },
      desiredName: 'omnitron-pg',
    });

    expect(d).toEqual({ action: 'reconcile', reconcileName: 'omnitron-pg' });
  });

  it('reconciles it even when the hashes already agree', () => {
    // Not conditional on drift: `reconcileService` is what decides, and it
    // also covers a container that is present but stopped, or running
    // detached from every network. Deciding here what that function exists to
    // decide is how two answers to one question drift apart.
    const d = decideControlPlaneDatabase({
      needsControlPlaneDatabase: true,
      running: { name: 'omnitron-pg', status: 'running', specHash: 'same' },
      desiredName: 'omnitron-pg',
    });

    expect(d.action).toBe('reconcile');
  });
});

describe('the name to reconcile is the name that exists', () => {
  it('uses the running container’s name, not this daemon’s prefix', () => {
    // This assertion is the whole fix. The daemon on `daos/dev` resolves
    // `daos-dev-pg`; the container holding port 5480 is `omnitron-pg`.
    // Reconciling `daos-dev-pg` creates a SECOND postgres and collides —
    // which is what the first version of this fix did, leaving 0.0.0.0:5480
    // exactly as it was.
    const d = decideControlPlaneDatabase({
      needsControlPlaneDatabase: true,
      running: { name: 'omnitron-pg', status: 'running', specHash: 'drifted' },
      desiredName: 'daos-dev-pg',
    });

    expect(d).toEqual({ action: 'reconcile', reconcileName: 'omnitron-pg' });
  });

  it('falls back to the declared name when the running one is unnamed', () => {
    const d = decideControlPlaneDatabase({
      needsControlPlaneDatabase: true,
      running: { status: 'running' },
      desiredName: 'daos-dev-pg',
    });

    expect(d).toEqual({ action: 'reconcile', reconcileName: 'daos-dev-pg' });
  });
});

describe('the other two cases', () => {
  it('provisions when nothing is running', () => {
    for (const state of [null, { status: 'exited' }, { status: 'created' }]) {
      expect(
        decideControlPlaneDatabase({
          needsControlPlaneDatabase: true,
          running: state,
          desiredName: 'omnitron-pg',
        }).action,
      ).toBe('provision');
    }
  });

  it('skips entirely on a node that keeps its state in SQLite', () => {
    // A slave daemon reads this database never. Creating it anyway gave every
    // provisioned node a Postgres nobody queries, on default credentials —
    // and that is the container measured answering on 0.0.0.0:5480 on a host
    // whose firewall allows only SSH.
    const d = decideControlPlaneDatabase({
      needsControlPlaneDatabase: false,
      running: { name: 'omnitron-pg', status: 'running' },
      desiredName: 'omnitron-pg',
    });

    expect(d.action).toBe('skip');
  });
});
