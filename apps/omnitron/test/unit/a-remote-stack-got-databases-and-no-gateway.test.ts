/**
 * Everything declared at the ecosystem level was absent from every remote
 * deployment.
 *
 * The ecosystem level is where things shared by all stacks live — the API
 * gateway, the Tor hidden services that make a deployment reachable, the
 * tile server. The stack level is where one deployment differs. A local
 * stack merged them. The remote path sent a node `stackConfig.infrastructure`
 * and nothing else, so a node got its databases and no gateway — and the
 * onion addresses that are the only way to reach a host whose firewall
 * allows nothing but SSH were never asked for.
 *
 * One function now, because two merges are two answers to the question
 * "what does this stack run".
 */

import { describe, it, expect } from 'vitest';

import { mergeInfrastructure } from '../../src/services/project.service.js';

const ecosystem = {
  infrastructure: {
    postgres: { port: 5432 },
    services: {
      gateway: { preset: 'openresty', ports: { http: 8080 } },
      tor: { preset: 'tor', config: { hiddenServices: [{ name: 'portal', virtualPort: 80, target: 'x:8080' }] } },
    },
  },
} as never;

describe('what a stack runs', () => {
  it('carries the ecosystem s services into a stack that declares none', () => {
    const merged = mergeInfrastructure(ecosystem, { infrastructure: { redis: { port: 6379 } } } as never);

    // The gateway and the onion are the deployment's front door. A node that
    // gets neither is reachable by nothing.
    expect(Object.keys(merged?.services ?? {}).sort()).toEqual(['gateway', 'tor']);
    expect(merged?.redis).toEqual({ port: 6379 });
    expect(merged?.postgres).toEqual({ port: 5432 });
  });

  it('lets a stack add a service without removing the others', () => {
    const merged = mergeInfrastructure(ecosystem, {
      infrastructure: { services: { tiles: { preset: 'tiles' } } },
    } as never);

    // `services` is a map of named things; a stack adding one must not
    // silently drop the rest.
    expect(Object.keys(merged?.services ?? {}).sort()).toEqual(['gateway', 'tiles', 'tor']);
  });

  it('lets a stack replace one of them by name', () => {
    const merged = mergeInfrastructure(ecosystem, {
      infrastructure: { services: { tor: { preset: 'tor', config: { hiddenServices: [] } } } },
    } as never);

    expect((merged?.services?.['tor'] as { config: { hiddenServices: unknown[] } }).config.hiddenServices).toEqual([]);
    expect(merged?.services?.['gateway']).toBeTruthy();
  });

  it('lets a stack replace a top-level block outright', () => {
    const merged = mergeInfrastructure(ecosystem, { infrastructure: { postgres: { port: 15432 } } } as never);

    // A stack that declares `postgres` means its own, not a merge of two
    // database configurations.
    expect(merged?.postgres).toEqual({ port: 15432 });
  });

  it('answers nothing when neither level declares anything', () => {
    expect(mergeInfrastructure({}, {})).toBeUndefined();
  });
});

describe('a node names its containers the way a local stack would', () => {
  it('uses the project and stack, not a fixed prefix', async () => {
    const { setContainerPrefix, getContainerPrefix } = await import('../../src/infrastructure/service-resolver.js');

    setContainerPrefix('daos', 'test');

    // Without this a node prefixes everything `omnitron-`: fine for one
    // stack and a collision for two, where the second stack's Postgres finds
    // the first one's container under the name it wants and reconciles it
    // towards its own spec. It also makes the names unpredictable from the
    // master's side — and a hidden service that has to name the gateway
    // container cannot guess.
    expect(getContainerPrefix()).toBe('daos-test');
  });
});

describe('a service a stack turned off', () => {
  it('is not provisioned', async () => {
    const { resolveInfrastructure } = await import('../../src/infrastructure/service-resolver.js');

    const services = {
      redis: { ports: { main: 6379 }, env: {}, docker: { image: 'redis:7-alpine' } },
      tiles: { ports: { http: 8081 }, env: {}, docker: { image: 'tiles:1' } },
    } as never;

    const containers = resolveInfrastructure({}, services, { tiles: { disabled: true } });

    // `serviceOverrides` was honoured for services an APPLICATION declares
    // and read by nothing for the ones a stack declares — an operator
    // writing `tiles: { disabled: true }` got tiles. Measured on the test
    // server: a stack that disabled the geocoder and the tile server
    // provisioned both, and a geocoding database can reach tens of
    // gigabytes.
    expect(containers.map((c) => c.name.split('-').pop())).toEqual(['redis']);
  });

  it('is not provisioned when it points at something that already exists', async () => {
    const { resolveInfrastructure } = await import('../../src/infrastructure/service-resolver.js');

    const services = { monero: { ports: { rpc: 28082 }, env: {}, docker: { image: 'monero:1' } } } as never;

    const containers = resolveInfrastructure({}, services, {
      monero: { external: { host: '192.168.100.2', ports: { rpc: 28082 } } },
    });

    // There is nothing to create; the address reaches the application
    // through its environment instead.
    expect(containers).toEqual([]);
  });

  it('provisions everything when nothing is overridden', async () => {
    const { resolveInfrastructure } = await import('../../src/infrastructure/service-resolver.js');

    const services = { redis: { ports: { main: 6379 }, env: {}, docker: { image: 'redis:7-alpine' } } } as never;

    expect(resolveInfrastructure({}, services).length).toBe(1);
  });
});
