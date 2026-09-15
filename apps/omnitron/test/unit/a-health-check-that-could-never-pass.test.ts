/**
 * A container serving traffic correctly reported `unhealthy` for its whole
 * life.
 *
 * The generic HTTP health check was `curl -sf http://localhost<path>`, and
 * alpine-based images do not ship curl. Measured on the gateway:
 *
 *     /bin/sh: curl: not found        (exit 1, every ten seconds)
 *
 * while the onion service in front of it answered HTTP 200. The container
 * was fine; the question was unanswerable. `provisionStack` then reported
 * the whole stack NOT ready because of it.
 *
 * The lesson was already learned once in this file — `resolveOmnitronNginx`
 * uses wget and says in a comment that curl is not in the image. It was
 * learned for one container and not for the generic path every other
 * service takes, which is the shape of defect that outlives its own fix.
 */

import { describe, it, expect } from 'vitest';

import { resolveServiceRequirement } from '../../src/infrastructure/service-resolver.js';

const probeOf = (target: string) => {
  const container = resolveServiceRequirement('thing', {
    ports: { http: 8080 },
    env: {},
    docker: { image: 'openresty/openresty:alpine' },
    healthCheck: { type: 'http', target, interval: '10s', timeout: '5s', retries: 3 },
  } as never);
  return container?.healthCheck?.test?.[1] ?? '';
};

describe('an HTTP health probe', () => {
  it('does not depend on a tool the image may not have', () => {
    const probe = probeOf('/nginx-health');

    // Both, because neither is universal: curl is absent from alpine, wget
    // from many debian-slim images.
    expect(probe).toContain('curl');
    expect(probe).toContain('wget');
    expect(probe).toContain('/nginx-health');
  });

  it('fails when neither can reach the endpoint', () => {
    // A probe that cannot run must not report success — that would turn an
    // unanswerable question into a healthy answer, which is worse than the
    // defect it replaces.
    expect(probeOf('/health')).toMatch(/\|\| exit 1$/);
  });

  it('bounds each attempt, so a hung endpoint is a failure and not a wait', () => {
    const probe = probeOf('/health');

    expect(probe).toMatch(/--max-time \d+/);
    expect(probe).toMatch(/-T \d+/);
  });
});
