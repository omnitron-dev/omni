/**
 * "Infrastructure ready:" with nothing under it.
 *
 * `provision()` ended with `state.ready = true` and "Infrastructure
 * provisioned and healthy", unconditionally. Every service reconciles inside
 * a `Promise.all` whose per-service catch records `exited` and continues, so
 * a run in which every container failed ended exactly like one in which all
 * of them came up. `omnitron infra up` then printed its heading BEFORE
 * looking at anything and listed whatever `state.services` happened to hold.
 *
 * Observed three times in one shift on a host under memory pressure, with
 * `daos-dev-postgres` and `daos-dev-redis` absent from `docker ps -a`
 * altogether at the moment it said so. The cost is separate from the cause:
 * a colleague reverted a correct change after reading
 * `Module "TitanRedisModule" failed to initialize`, because the line above
 * it said the infrastructure was fine.
 *
 * Two of three states produced an empty list of complaints and so looked
 * identical: everything is fine, and nothing was ever attempted.
 */

import { describe, it, expect } from 'vitest';

import { summariseProvisioning, describeProvisioning } from '../../src/infrastructure/provisioning-outcome.js';
import type { ContainerState } from '../../src/infrastructure/types.js';

const up = (name: string): ContainerState => ({ name, image: `${name}:1`, status: 'running', health: 'healthy' });
const down = (name: string, error?: string): ContainerState => ({
  name, image: `${name}:1`, status: 'exited', ...(error ? { error } : {}),
});

describe('deciding whether infrastructure is ready', () => {
  it('is ready when everything declared is running', () => {
    const outcome = summariseProvisioning(
      [{ name: 'pg', image: 'pg:1' }, { name: 'redis', image: 'redis:1' }],
      { pg: up('pg'), redis: up('redis') },
    );

    expect(outcome.ready).toBe(true);
    expect(outcome.running).toHaveLength(2);
  });

  it('is NOT ready when a declared service left no trace', () => {
    // The state that reads as success: nothing tried, so nothing failed, so
    // nothing appears in any list of problems.
    const outcome = summariseProvisioning(
      [{ name: 'pg', image: 'pg:1' }, { name: 'redis', image: 'redis:1' }],
      { pg: up('pg') },
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.missing.map((s) => s.name)).toEqual(['redis']);
    expect(describeProvisioning(outcome)).toMatch(/NOT ready.*missing.*redis/i);
  });

  it('is NOT ready when a declared service failed', () => {
    const outcome = summariseProvisioning(
      [{ name: 'pg', image: 'pg:1' }],
      { pg: down('pg', 'no such image') },
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.failed[0]).toMatchObject({ name: 'pg', status: 'exited', error: 'no such image' });
    expect(describeProvisioning(outcome)).toMatch(/NOT ready.*not running.*pg/i);
  });

  it('counts a running container that reports unhealthy as failed', () => {
    // Docker's probe is the only thing here that looked inside.
    const outcome = summariseProvisioning(
      [{ name: 'pg', image: 'pg:1' }],
      { pg: { name: 'pg', image: 'pg:1', status: 'running', health: 'unhealthy' } },
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.failed[0]!.error).toMatch(/unhealthy/);
  });

  it('does not fail a container still inside its first probe window', () => {
    // `starting` is not yet a failure; treating it as one would make every
    // provisioning run report failure for the seconds before the first check.
    const outcome = summariseProvisioning(
      [{ name: 'pg', image: 'pg:1' }],
      { pg: { name: 'pg', image: 'pg:1', status: 'running', health: 'starting' } },
    );

    expect(outcome.ready).toBe(true);
  });

  it('separates "nothing declared" from "everything fine"', () => {
    const outcome = summariseProvisioning([], {});

    // Both produce an empty list. Only one of them is a reason to relax.
    expect(outcome.empty).toBe(true);
    expect(outcome.ready).toBe(false);
    expect(describeProvisioning(outcome)).toMatch(/nothing is declared/i);
  });

  it('counts a service provisioned outside the declared set', () => {
    // omnitron's own Postgres is provisioned separately and was left out of
    // this decision entirely. A master with no control-plane database is not
    // a healthy master.
    const outcome = summariseProvisioning(
      [{ name: 'pg', image: 'pg:1' }],
      { pg: up('pg'), 'omnitron-pg': down('omnitron-pg') },
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.failed.map((s) => s.name)).toEqual(['omnitron-pg']);
  });

  it('reports every bad service, not the first', () => {
    const outcome = summariseProvisioning(
      [{ name: 'pg', image: 'pg:1' }, { name: 'redis', image: 'redis:1' }, { name: 'minio', image: 'minio:1' }],
      { pg: down('pg') },
    );

    const said = describeProvisioning(outcome);
    expect(said).toContain('redis');
    expect(said).toContain('minio');
    expect(said).toContain('pg');
  });
});
