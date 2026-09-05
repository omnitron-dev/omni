/**
 * Defaults for a container health check.
 *
 * `IServiceHealthCheck` documents four: interval '30s', timeout '10s',
 * retries 5, startPeriod '30s'. Three of them were applied; the timeout got
 * the interval's, because one helper — `parseInterval = (s) => s ?? '30s'` —
 * served every duration field on the type. Its name said interval and its
 * default was the interval's, and it was called for the timeout too.
 *
 * That is not a cosmetic difference. Docker treats the timeout as the
 * deadline for a single probe and the interval as the gap between probes;
 * setting them equal lets probes overlap, and it delays the unhealthy
 * verdict on a wedged service by three times what the type promises.
 */

import { describe, it, expect } from 'vitest';

import { resolveServiceRequirement } from '../../src/infrastructure/service-resolver.js';
import type { IServiceRequirement } from '../../src/infrastructure/types.js';

/** Minimal service that reaches `convertHealthCheck` with nothing set. */
function withHealthCheck(healthCheck: IServiceRequirement['healthCheck']): IServiceRequirement {
  return {
    ports: { main: 5432 },
    env: {},
    healthCheck,
    docker: { image: 'postgres:17-alpine' },
  } as IServiceRequirement;
}

describe('health check defaults', () => {
  it('gives the probe deadline its own default, not the interval’s', () => {
    const resolved = resolveServiceRequirement(
      'pg',
      withHealthCheck({ type: 'command', target: 'pg_isready' })
    );

    expect(resolved?.healthCheck).toMatchObject({
      interval: '30s',
      timeout: '10s',
      retries: 5,
      startPeriod: '30s',
    });
  });

  it('applies the same defaults for every check type', () => {
    // The four branches of the switch are copies of one another, so a fix
    // applied to one and missed in another would look correct in review.
    for (const check of [
      { type: 'command', target: 'true' },
      { type: 'tcp', target: 'main' },
      { type: 'http', target: '/healthz' },
      { type: 'jsonrpc', target: 'get_info' },
    ] as const) {
      const resolved = resolveServiceRequirement('svc', withHealthCheck({ ...check }));
      expect(resolved?.healthCheck?.timeout, check.type).toBe('10s');
      expect(resolved?.healthCheck?.interval, check.type).toBe('30s');
      expect(resolved?.healthCheck?.retries, check.type).toBe(5);
    }
  });

  it('passes explicit values through untouched', () => {
    const resolved = resolveServiceRequirement(
      'pg',
      withHealthCheck({
        type: 'command',
        target: 'pg_isready',
        interval: '5s',
        timeout: '2s',
        retries: 30,
        startPeriod: '0s',
      })
    );

    expect(resolved?.healthCheck).toMatchObject({
      interval: '5s',
      timeout: '2s',
      retries: 30,
      startPeriod: '0s',
    });
  });
});
