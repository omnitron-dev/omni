/**
 * Which interface a managed container publishes on.
 *
 * The daemon binds its own HTTP transport to 127.0.0.1. The console's nginx
 * container published `-p 9800:80` — Docker's default, which is every
 * interface — and its config proxies `/netron/` straight to that daemon
 * port. So the whole RPC surface was reachable from the network, and the
 * methods carrying `allowAnonymous` were reachable without credentials.
 *
 * Verified against the running daemon before the fix:
 *
 *   OmnitronMetrics.getSnapshot   → CPU and memory for every managed app
 *   OmnitronTelemetry.pushBatch   → {"ackd":1}, and the row was in `logs`
 *
 * The second is the serious one. It is an unauthenticated write into the
 * table an operator reads during an incident: rows can be attributed to any
 * app, at any level, with any message — and the table had no size bound at
 * all until earlier today, on a host that has already lost its database to a
 * full disk. The probe row was deleted after the check.
 *
 * Loopback is the default because a control plane should not be on the
 * network by accident. `daemon.consoleBindHost` publishes it deliberately,
 * for a deployment where something else authenticates.
 */

import { describe, it, expect } from 'vitest';

import { resolveOmnitronNginx } from '../../src/infrastructure/service-resolver.js';

describe('console port binding', () => {
  it('publishes on loopback by default', () => {
    const spec = resolveOmnitronNginx({ port: 9800 });

    expect(spec.ports).toHaveLength(1);
    expect(spec.ports[0]).toMatchObject({ host: 9800, container: 80, bindHost: '127.0.0.1' });
  });

  it('publishes where it is told to', () => {
    const spec = resolveOmnitronNginx({ port: 9800, bindHost: '0.0.0.0' });
    expect(spec.ports[0]?.bindHost).toBe('0.0.0.0');
  });

  it('keeps the daemon reachable from inside the container', () => {
    // The container talks to the daemon over `host.docker.internal`, which is
    // unaffected by the publish address — binding to loopback must not cost
    // the console its backend. This is the half a narrower fix would break.
    const spec = resolveOmnitronNginx({ port: 9800, internalApiPort: 9801 });

    expect(spec.environment['OMNITRON_API_HOST']).toBe('host.docker.internal');
    expect(spec.environment['OMNITRON_API_PORT']).toBe('9801');
    expect(spec.extraHosts).toContain('host.docker.internal:host-gateway');
  });
});

describe('the -p value itself', () => {
  it('prefixes the bind address when one is given', async () => {
    // The shape `docker run` expects. Asserted against the builder rather
    // than restated, because this string is the whole difference between
    // loopback and the network.
    const { portArg } = await import('../../src/infrastructure/container-runtime.js');

    expect(portArg({ host: 9800, container: 80, bindHost: '127.0.0.1' })).toBe('127.0.0.1:9800:80');
    expect(portArg({ host: 9800, container: 80, bindHost: '0.0.0.0' })).toBe('0.0.0.0:9800:80');
  });

  it('omits the address when there is none, as Docker does', async () => {
    // Not every managed container wants loopback — a database reached from
    // another host, say. Absent means "Docker's default", and that has to
    // stay expressible rather than becoming loopback by accident.
    const { portArg } = await import('../../src/infrastructure/container-runtime.js');

    expect(portArg({ host: 5432, container: 5432 })).toBe('5432:5432');
  });
});
