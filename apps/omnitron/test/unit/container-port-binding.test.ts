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

  it('reads an absent address as loopback, not as every interface', async () => {
    // This assertion is the reverse of what it was. It used to read: absent
    // means "Docker's default", and that has to stay expressible rather than
    // becoming loopback by accident.
    //
    // What that reasoning missed is which way the omission fails. Docker's
    // default is every interface AND its iptables rules precede the host
    // firewall's, so "expressible by omission" meant the widest possible
    // exposure was the thing you got by not writing anything down. A
    // container that must be reachable can still say so — `bindHost:
    // '0.0.0.0'`, one line, visible in a diff. Nothing became inexpressible;
    // what changed is which answer you have to ask for.
    const { portArg } = await import('../../src/infrastructure/container-runtime.js');

    expect(portArg({ host: 5432, container: 5432 })).toBe('127.0.0.1:5432:5432');
    expect(portArg({ host: 5432, container: 5432, bindHost: '0.0.0.0' })).toBe('0.0.0.0:5432:5432');
  });
});

// =============================================================================
// Every managed container, not just the one that was found exposed
// =============================================================================

describe('a published port binds to loopback unless asked otherwise', () => {
  it('binds omnitron s own database to loopback', async () => {
    const { resolveOmnitronPg } = await import('../../src/infrastructure/service-resolver.js');

    const pg = resolveOmnitronPg();

    // Measured on the test server, whose ufw allows 22/tcp and nothing else:
    //
    //     nc -vz <node> 9700  → timed out (ufw, as configured)
    //     nc -vz <node> 5480  → OPEN      (docker, straight past it)
    //
    // Docker inserts its iptables rules ahead of ufw's, so a published port
    // is reachable from the internet whatever the host firewall says. An
    // operator who reads their firewall rules and concludes the database is
    // private is reading a control that does not cover it.
    expect(pg.ports?.[0]?.bindHost).toBe('127.0.0.1');
  });

  it('binds a service an application declared', async () => {
    const { resolveServiceRequirement } = await import('../../src/infrastructure/service-resolver.js');

    const container = resolveServiceRequirement('redis', {
      ports: { main: 6379 },
      env: {},
      docker: { image: 'redis:7-alpine' },
    } as never);

    // The applications that use these run on the same host and reach them
    // over loopback. Anything further away comes through omnitron's own
    // transport, which is authenticated — so the default costs nothing and
    // the exposure had no beneficiary.
    expect(container?.ports?.every((p) => p.bindHost === '127.0.0.1')).toBe(true);
  });

  it('leaves a deliberate exposure alone', async () => {
    const { applyManagedDefaults } = await import('../../src/infrastructure/service-resolver.js');

    const spec = applyManagedDefaults({
      name: 'public-thing',
      image: 'nginx',
      ports: [{ host: 443, container: 443, bindHost: '0.0.0.0' }],
      environment: {},
      volumes: [],
    } as never);

    // A container that genuinely must be reachable says so — a deliberate
    // line in a config, reviewable in a diff.
    expect(spec.ports?.[0]?.bindHost).toBe('0.0.0.0');
  });

  it('renders the bind into the docker argument', async () => {
    const { portArg } = await import('../../src/infrastructure/container-runtime.js');

    expect(portArg({ host: 5480, container: 5432, bindHost: '127.0.0.1' })).toBe('127.0.0.1:5480:5432');
    // This line used to assert `'5480:5432'`, under a comment saying that
    // publishing on every interface "is the behaviour this default exists to
    // stop". It described the danger and pinned it in the same breath — the
    // default was only ever as good as every caller's memory, and one caller
    // forgot.
    expect(portArg({ host: 5480, container: 5432 })).toBe('127.0.0.1:5480:5432');
  });
});

// =============================================================================
// The resolver that forgot
// =============================================================================

describe('the gateway is bound like everything else', () => {
  it('publishes the API gateway on loopback', async () => {
    const { resolveGateway } = await import('../../src/infrastructure/service-resolver.js');

    const spec = resolveGateway(
      { port: 8080 } as never,
      { host: 'localhost', port: 6379, db: 0 } as never,
      '/tmp/project',
    );

    // Three of the four container resolvers called `applyManagedDefaults`.
    // This one returned its object bare, and it is the container that faces
    // outward. Measured on the dev stand: `daos-dev-gateway` published on
    // 0.0.0.0:80 while the other ten managed containers were all on
    // 127.0.0.1, and a browser elsewhere on the LAN could sign in.
    expect(spec.ports?.every((p) => p.bindHost === '127.0.0.1')).toBe(true);
  });

  it('puts the binding where the spec hash can see it', async () => {
    const { resolveGateway } = await import('../../src/infrastructure/service-resolver.js');
    const { containerSpecHash } = await import('../../src/infrastructure/container-runtime.js');

    const loopback = resolveGateway(
      { port: 8080 } as never,
      { host: 'localhost', port: 6379, db: 0 } as never,
      '/tmp/project',
    );
    const exposed = { ...loopback, ports: loopback.ports?.map((p) => ({ ...p, bindHost: '0.0.0.0' })) };

    // `portArg` alone would bind correctly and leave the hash unchanged, so
    // a container already published on every interface would keep running.
    // The binding has to be IN the spec for the daemon to notice and
    // recreate it.
    expect(containerSpecHash(loopback as never)).not.toBe(containerSpecHash(exposed as never));
  });
});

// =============================================================================
// Where a gateway is published is not where it listens
// =============================================================================

describe('the preset separates the container port from the host mapping', () => {
  it('reads a config port as a host mapping, leaving the container port alone', async () => {
    const { createDefaultRegistry } = await import('../../src/infrastructure/presets/index.js');

    const expanded = createDefaultRegistry().expand('gateway', { preset: 'openresty', ports: { http: 8080 } } as never);

    // openresty listens on 80 because that is what the image does; 8080 is
    // where the stack wants it reachable. Reading `ports.http` as "the host
    // port" takes the first for the second, and publishes the gateway on 80.
    expect(expanded.ports?.['http']).toBe(80);
    expect(expanded.docker?.portMappings?.['http']).toBe(8080);
  });

  it('treats a port the preset does not know as a container port', async () => {
    const { createDefaultRegistry } = await import('../../src/infrastructure/presets/index.js');

    const expanded = createDefaultRegistry().expand('gateway', { preset: 'openresty', ports: { metrics: 9145 } } as never);

    // Nothing to map it onto: the config is naming a port the image listens
    // on, not where to publish one the preset already declared.
    expect(expanded.ports?.['metrics']).toBe(9145);
    expect(expanded.docker?.portMappings?.['metrics']).toBeUndefined();
  });
});

describe('the gateway is published where the stack asked', () => {
  it('reads the host mapping, not the container port', async () => {
    const { gatewayHostPort } = await import('../../src/infrastructure/service-resolver.js');
    const { createDefaultRegistry } = await import('../../src/infrastructure/presets/index.js');

    // The real expansion, not a hand-built shape: this is the exact object
    // the manager receives, and the point of the defect was that its two
    // port fields answer two different questions.
    const expanded = createDefaultRegistry().expand('gateway', { preset: 'openresty', ports: { http: 8080 } } as never);

    expect(gatewayHostPort(expanded as never, undefined)).toBe(8080);
  });

  it('falls back to the container port when nothing maps it', async () => {
    const { gatewayHostPort } = await import('../../src/infrastructure/service-resolver.js');

    // A port the preset never declared IS a container port, and publishing it
    // on the same number is the same answer `resolveServiceRequirement` gives.
    expect(gatewayHostPort({ ports: { http: 9999 } }, undefined)).toBe(9999);
  });

  it('still honours the legacy field, and its own default', async () => {
    const { gatewayHostPort } = await import('../../src/infrastructure/service-resolver.js');

    expect(gatewayHostPort(undefined, { port: 7000 })).toBe(7000);
    expect(gatewayHostPort(undefined, undefined)).toBe(8080);
  });

  it('prefers an explicit mapping over a config port', async () => {
    const { gatewayHostPort } = await import('../../src/infrastructure/service-resolver.js');

    // `portMappings` says the same thing more precisely, and the preset
    // expansion already lets it win. This must not undo that.
    expect(gatewayHostPort({ ports: { http: 80 }, docker: { portMappings: { http: 8081 } } }, { port: 7000 })).toBe(8081);
  });
});

describe('the frontend the gateway serves', () => {
  const redis = { host: 'h', port: 6379, db: 1 };

  it('is not mounted when the stack declares none', async () => {
    const { resolveGateway } = await import('../../src/infrastructure/service-resolver.js');

    const spec = resolveGateway({ port: 8080 } as never, redis as never, '/proj');

    // A stack with no frontend must not acquire an empty mount: docker
    // creates the missing source as a directory, and the gateway would then
    // serve an empty one — indistinguishable from a broken build.
    expect(spec.volumes.some((v) => v.target === '/var/www/portal')).toBe(false);
  });

  it('mounts a declared build at the path nginx serves from', async () => {
    const { resolveGateway } = await import('../../src/infrastructure/service-resolver.js');

    const spec = resolveGateway(
      { port: 8080, staticDir: 'apps/portal/dist' } as never,
      redis as never,
      '/proj',
    );

    // `/var/www/portal` is not a choice made here — it is where the stack's
    // own nginx.conf serves `/` from whenever PORTAL_DEV_UPSTREAM is unset,
    // which is every deployment with no Vite beside it.
    const mount = spec.volumes.find((v) => v.target === '/var/www/portal');
    expect(mount?.source).toBe('/proj/apps/portal/dist');
    expect(mount?.readonly).toBe(true);
  });

  it('takes an absolute path as the node’s own copy', async () => {
    const { resolveGateway } = await import('../../src/infrastructure/service-resolver.js');

    // A node names a path on itself. Resolving it against a project root it
    // does not have would produce a path that exists nowhere.
    const spec = resolveGateway(
      { port: 8080, staticDir: '/opt/omnitron/stack-static/gateway/abc123' } as never,
      redis as never,
      '/proj',
    );

    expect(spec.volumes.find((v) => v.target === '/var/www/portal')?.source).toBe(
      '/opt/omnitron/stack-static/gateway/abc123',
    );
  });

  it('changes the spec hash, so a new build recreates the container', async () => {
    const { resolveGateway } = await import('../../src/infrastructure/service-resolver.js');
    const { containerSpecHash } = await import('../../src/infrastructure/container-runtime.js');

    // The directory is named by the build's content hash, so a changed build
    // is a changed path. If that did not reach the spec hash, the node would
    // hold the new files on disk and keep the old ones mounted.
    const a = resolveGateway({ port: 8080, staticDir: '/opt/omnitron/stack-static/gateway/aaa' } as never, redis as never, '/p');
    const b = resolveGateway({ port: 8080, staticDir: '/opt/omnitron/stack-static/gateway/bbb' } as never, redis as never, '/p');

    expect(containerSpecHash(a)).not.toBe(containerSpecHash(b));
  });
});
