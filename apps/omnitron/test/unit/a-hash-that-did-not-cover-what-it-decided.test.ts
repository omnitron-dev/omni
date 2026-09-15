/**
 * A corrected health check never reached anything already running.
 *
 * `containerSpecHash` is how the reconciler decides whether a container
 * matches its declaration. It covered image, env, ports, volumes, command,
 * entrypoint and extra hosts — and not the health check, not the bind host,
 * not the network.
 *
 * Docker reads `HEALTHCHECK` once, at creation, and never again. So a
 * corrected probe lands in the code, the reconciler sees no difference, and
 * the container goes on answering the old question forever.
 *
 * Measured: the gateway's probe was corrected from `curl` — absent from its
 * image — to one that also tries wget, the node was reprovisioned, and the
 * running container kept the curl-only check and kept reporting unhealthy.
 *
 * The same was true of `bindHost`, which is the difference between a
 * database on loopback and one on every interface.
 */

import { describe, it, expect } from 'vitest';

import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';

const base = {
  name: 'thing',
  image: 'postgres:17-alpine',
  ports: [{ host: 5432, container: 5432, bindHost: '127.0.0.1' }],
  environment: { A: '1' },
  volumes: [],
  labels: {},
  restart: 'unless-stopped',
} as never;

const withChange = (change: Record<string, unknown>) =>
  containerSpecHash({ ...(base as object), ...change } as never);

describe('what the hash has to notice', () => {
  it('notices a changed health check', () => {
    // Otherwise a fix to a probe is invisible to the thing whose job is to
    // notice differences.
    expect(withChange({ healthCheck: { test: ['CMD-SHELL', 'curl -sf x'] } })).not.toBe(
      withChange({ healthCheck: { test: ['CMD-SHELL', 'wget -q x'] } }),
    );
  });

  it('notices a health check appearing at all', () => {
    expect(withChange({ healthCheck: { test: ['CMD-SHELL', 'x'] } })).not.toBe(containerSpecHash(base));
  });

  it('notices a port moving off every interface', () => {
    // The difference between a database reachable only from the host and one
    // reachable from the internet.
    expect(withChange({ ports: [{ host: 5432, container: 5432, bindHost: '127.0.0.1' }] })).not.toBe(
      withChange({ ports: [{ host: 5432, container: 5432 }] }),
    );
  });

  it('notices a changed network', () => {
    // Not a detail of how a container runs but of what it can reach: a
    // service left on the old network resolves for nobody.
    expect(withChange({ network: 'a' })).not.toBe(withChange({ network: 'b' }));
  });

  it('notices a changed restart policy', () => {
    expect(withChange({ restart: 'no' })).not.toBe(withChange({ restart: 'unless-stopped' }));
  });

  it('is stable for a spec that did not change', () => {
    // Reconciling has to be safe to run on every deploy. A hash that moves
    // on its own recreates every container every pass.
    expect(containerSpecHash(base)).toBe(containerSpecHash(base));
    // And insensitive to the order keys happen to arrive in.
    expect(withChange({ environment: { A: '1', B: '2' } })).toBe(withChange({ environment: { B: '2', A: '1' } }));
  });
});
