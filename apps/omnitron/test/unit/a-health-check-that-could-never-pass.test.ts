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

const probeWith = (target: string, ports: Record<string, number>, check: Record<string, unknown> = {}) => {
  const container = resolveServiceRequirement('thing', {
    ports,
    env: {},
    docker: { image: 'openresty/openresty:alpine' },
    healthCheck: { type: 'http', target, interval: '10s', timeout: '5s', retries: 3, ...check },
  } as never);
  return container?.healthCheck?.test?.[1] ?? '';
};

const probeOf = (target: string) => probeWith(target, { http: 8080 });

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

describe('which port the probe knocks on', () => {
  it('is the service s own, not 80', () => {
    // The probe was `http://localhost<path>` — port 80, always. The gateway
    // listens on 8080, so the check connected to nothing:
    //
    //     wget: can't connect to remote host: Connection refused
    //
    // on a container serving correctly on its own port, behind an onion
    // address that answered 200.
    expect(probeWith('/nginx-health', { http: 8080 })).toContain('http://localhost:8080/nginx-health');
  });

  it('takes the only port a service declares', () => {
    // A service with one port cannot mean another.
    expect(probeWith('/health', { api: 9000 })).toContain('http://localhost:9000/health');
  });

  it('lets a check name its port when there are several', () => {
    const probe = probeWith('/health', { api: 9000, console: 9001 }, { port: 'console' });

    expect(probe).toContain('http://localhost:9001/health');
  });

  it('falls back to the convention rather than picking arbitrarily', () => {
    // Several ports and no way to choose: 80 is the convention, and an
    // arbitrary pick that happens to work once is worse than a stated
    // default.
    expect(probeWith('/health', { a: 1234, b: 5678 })).toContain('http://localhost:80/health');
  });
});

describe('a preset checking a config it does not own', () => {
  it('does not assert that a particular route exists', async () => {
    const { createDefaultRegistry } = await import('../../src/infrastructure/presets/index.js');

    const gateway = createDefaultRegistry().get('openresty');

    // The check asked for `/nginx-health`, an endpoint a reverse proxy's
    // config may or may not define — and the config is the operator's,
    // mounted from their repository. The one omnitron was pointed at has no
    // such location, so the check could never pass: a gateway reported
    // unhealthy for hours while serving an onion address that answered 200.
    expect(gateway?.defaultHealthCheck?.target).not.toContain('nginx-health');
    // What it can assert is that the server it started accepts connections
    // on the port it declares.
    expect(gateway?.defaultHealthCheck?.type).toBe('command');
    expect(gateway?.defaultHealthCheck?.target).toContain('80');
  });
});
