/**
 * Why a container is not running.
 *
 * `ContainerState.error` has been part of the type all along and nothing ever
 * filled it, while `docker inspect` carries both an exit code and a
 * human-readable reason. So `omnitron doctor` could say "Container
 * omnitron-nginx is created" and no more — while the answer sat one field
 * away: "Bind for 0.0.0.0:9800 failed: port is already allocated".
 *
 * Observed exactly that this session: the console was unreachable, the
 * container had been in `created` since a daemon restart raced the previous
 * container's port release, and every diagnostic said only what state it was
 * in, never why.
 */

import { describe, it, expect } from 'vitest';

import { __test__ } from '../../src/infrastructure/container-runtime.js';

const { describeContainerFailure } = __test__;

describe('describeContainerFailure', () => {
  it('reports the reason Docker gives for a refused start', () => {
    // The real payload from the incident, trimmed.
    expect(
      describeContainerFailure({
        Status: 'created',
        ExitCode: 128,
        Error: 'driver failed programming external connectivity: Bind for 0.0.0.0:9800 failed: port is already allocated',
      })
    ).toContain('port is already allocated');
  });

  it('carries the exit code alongside the reason', () => {
    const described = describeContainerFailure({ Status: 'exited', ExitCode: 137, Error: '' });
    expect(described).toBe('exit code 137');
  });

  it('names an OOM kill, which an exit code alone does not', () => {
    const described = describeContainerFailure({ Status: 'exited', ExitCode: 137, OOMKilled: true });
    expect(described).toContain('OOM');
    expect(described).toContain('137');
  });

  it('says nothing about a running container', () => {
    // A running container carries a stale ExitCode from its previous run;
    // reporting it would invent a fault out of history.
    expect(describeContainerFailure({ Status: 'running', ExitCode: 137 })).toBeUndefined();
  });

  it('says nothing about a clean stop', () => {
    // Exit 0 is an operator stopping a container, not a failure.
    expect(describeContainerFailure({ Status: 'exited', ExitCode: 0 })).toBeUndefined();
  });

  it('handles an inspect payload with no state at all', () => {
    expect(describeContainerFailure(undefined)).toBeUndefined();
    expect(describeContainerFailure({})).toBeUndefined();
  });
});
