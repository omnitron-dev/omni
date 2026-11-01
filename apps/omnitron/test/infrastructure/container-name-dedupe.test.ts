/**
 * Regression tests for T#76 — `InfrastructureService.addAppContainers`
 * silently accepted duplicates and the provisioning loop later
 * tried to `docker run` the same name twice. Docker's name-
 * uniqueness check rejected the second create; the second
 * caller observed a failure even though the SHARED service was
 * actually fine.
 *
 * The intended semantics for shared infrastructure is "all apps
 * that declare `postgres` use the same container", so
 * identical declarations are deduplicated. Conflicting specifications
 * refuse the plan before provisioning; order cannot choose the configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/infrastructure/container-runtime.js', async (original) => ({
  ...await original<typeof import('../../src/infrastructure/container-runtime.js')>(),
  getContainerState: vi.fn().mockResolvedValue(null),
  removeContainer: vi.fn().mockResolvedValue(undefined),
  startContainer: vi.fn().mockResolvedValue(undefined),
  isDockerAvailable: vi.fn().mockResolvedValue(true),
  createContainer: vi.fn().mockResolvedValue('cid'),
  inspectContainer: vi.fn().mockResolvedValue(null),
  pullImage: vi.fn().mockResolvedValue(undefined),
  createVolume: vi.fn().mockResolvedValue(undefined),
  imageExists: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/infrastructure/service-resolver.js', () => ({
  resolveInfrastructure: vi.fn().mockImplementation(() => []),
  resolveOmnitronPg: vi.fn().mockReturnValue({
    name: 'omnitron-pg',
    image: 'postgres:16',
    environment: {},
    ports: [],
    volumes: [],
    network: undefined,
  }),
  getManagedNetwork: vi.fn().mockReturnValue('omnitron_default'),
}));

import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';

function spec(over: Partial<ResolvedContainer> = {}): ResolvedContainer {
  return {
    name: 'omni-dev-postgres',
    image: 'postgres:16',
    ports: [{ host: 5432, container: 5432 }],
    environment: { POSTGRES_PASSWORD: 'secret' },
    volumes: [],
    ...over,
  } as ResolvedContainer;
}

describe('InfrastructureService.addAppContainers — T#76 dedupe', () => {
  let warnings: any[];
  let logger: any;

  beforeEach(() => {
    warnings = [];
    logger = {
      info: () => undefined,
      warn: (obj: any, msg: string) => warnings.push({ obj, msg }),
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      child: () => logger,
    };
  });

  it('silently dedupes identical declarations from multiple apps', () => {
    const svc: any = new InfrastructureService(logger, { services: {} } as any);
    svc.addAppContainers([spec()]);
    svc.addAppContainers([spec()]);
    svc.addAppContainers([spec()]);

    expect(svc.desiredContainers).toHaveLength(1);
    // Identical shape — no operator-facing warning.
    expect(warnings).toHaveLength(0);
  });

  it('refuses when a follow-up declaration differs in image', () => {
    const svc: any = new InfrastructureService(logger, { services: {} } as any);
    svc.addAppContainers([spec({ image: 'postgres:16' })]);
    expect(() => svc.addAppContainers([spec({ image: 'postgres:15' })])).toThrow('Conflicting infrastructure declarations');

    expect(svc.desiredContainers).toHaveLength(1);
    // First declaration wins.
    expect(svc.desiredContainers[0].image).toBe('postgres:16');
    // Refusal happens before provisioning; the existing declaration is retained.
    expect(warnings).toHaveLength(0);
  });

  it('refuses when a follow-up declaration differs in port mapping', () => {
    const svc: any = new InfrastructureService(logger, { services: {} } as any);
    svc.addAppContainers([spec({ ports: [{ host: 5432, container: 5432 }] })]);
    expect(() => svc.addAppContainers([spec({ ports: [{ host: 5433, container: 5432 }] })])).toThrow('Conflicting infrastructure declarations');

    expect(svc.desiredContainers).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('refuses when a follow-up declaration differs in env', () => {
    const svc: any = new InfrastructureService(logger, { services: {} } as any);
    svc.addAppContainers([spec({ environment: { POSTGRES_PASSWORD: 'a' } })]);
    expect(() => svc.addAppContainers([spec({ environment: { POSTGRES_PASSWORD: 'b' } })])).toThrow('Conflicting infrastructure declarations');

    expect(svc.desiredContainers).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('keeps containers with different NAMES (distinct services)', () => {
    const svc: any = new InfrastructureService(logger, { services: {} } as any);
    svc.addAppContainers([spec({ name: 'omni-dev-postgres' })]);
    svc.addAppContainers([spec({ name: 'omni-dev-redis', image: 'redis:7' })]);

    expect(svc.desiredContainers.map((c: ResolvedContainer) => c.name).sort()).toEqual([
      'omni-dev-postgres',
      'omni-dev-redis',
    ]);
    expect(warnings).toHaveLength(0);
  });
});
