import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerState, IServiceRequirement, ResolvedContainer } from '../../src/infrastructure/types.js';

const runtime = vi.hoisted(() => ({
  inspect: vi.fn<(name: string) => Promise<ContainerState | null>>(), start: vi.fn<(id: string) => Promise<void>>(),
  create: vi.fn(), remove: vi.fn(),
}));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...await original<typeof import('../../src/infrastructure/container-runtime.js')>(),
  getContainerState: runtime.inspect, startContainer: runtime.start, createContainer: runtime.create, removeContainer: runtime.remove,
}));

import { containerResources, containerSpecHash } from '../../src/infrastructure/container-runtime.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { resolveInfrastructure, resolveOmnitronPg, withInfrastructureScope } from '../../src/infrastructure/service-resolver.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: logger }) as never;
const redis = { redis: { ports: { main: 6379 }, env: {}, docker: { image: 'redis:7' } } } satisfies Record<string, IServiceRequirement>;
const config = { services: redis };
const observed = new Map<string, ContainerState>();

function container(desired: ResolvedContainer, status: ContainerState['status'], id: string) {
  const state: ContainerState = {
    name: desired.name, image: desired.image, containerId: id.repeat(64),
    labels: desired.labels, status, health: status === 'running' ? 'healthy' : 'none',
    specHash: containerSpecHash(desired),
    resources: { memoryBytes: 0, memoryReservationBytes: 0, nanoCpus: 0, cpuQuota: 0, cpuPeriod: 0,
      shmBytes: 64 * 1024 ** 2, ...containerResources(desired) },
  };
  observed.set(state.name, state);
  return state;
}

function monitor(hostDatabase: boolean) {
  return withInfrastructureScope('sample', 'test', () => {
    const service = new InfrastructureService(logger(), config, redis, undefined, undefined, hostDatabase);
    const [desiredRedis] = resolveInfrastructure(config, redis);
    return { service, redis: container(desiredRedis!, 'running', 'b') };
  });
}

function sweep(service: InfrastructureService) {
  const health = service as unknown as { healthSweep(): Promise<void>; waitHealthy(id: string): Promise<void> };
  const healthy = vi.spyOn(health, 'waitHealthy').mockResolvedValue();
  return { run: () => health.healthSweep(), healthy };
}

beforeEach(() => {
  observed.clear();
  vi.resetAllMocks();
  runtime.inspect.mockImplementation(async name => observed.get(name) ?? null);
  runtime.start.mockImplementation(async id => {
    const item = [...observed.values()].find(item => item.containerId === id);
    if (!item || item.status !== 'exited') throw Error('Container is not stopped: ' + id);
    item.status = 'running';
    item.health = 'healthy';
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('infrastructure health sweep', () => {
  it('starts the stopped host PostgreSQL by its immutable ID and retains its existing container', async () => {
    const { service } = monitor(true);
    const pg = container(resolveOmnitronPg(), 'exited', 'a');
    const ready = sweep(service);
    await ready.run();
    expect(pg.name).toBe('omnitron-pg');
    expect(runtime.start).toHaveBeenCalledExactlyOnceWith(pg.containerId);
    expect(ready.healthy).toHaveBeenCalledExactlyOnceWith(pg.containerId);
    expect(service.getState().services[pg.name]).toMatchObject({ containerId: pg.containerId, status: 'running' });
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
  });

  it('leaves a healthy master database and stack Redis running', async () => {
    const { service, redis: redisContainer } = monitor(true);
    const pg = container(resolveOmnitronPg(), 'running', 'a');
    await sweep(service).run();
    expect(runtime.inspect.mock.calls.map(([name]) => name).sort()).toEqual([pg.name, redisContainer.name].sort());
    expect(runtime.start).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
  });

  it('reports a conflicting host database without operating on it', async () => {
    const { service } = monitor(true);
    const pg = container(resolveOmnitronPg(), 'exited', 'a');
    pg.labels = { ...pg.labels, 'omnitron.project': 'another-project' };
    await sweep(service).run();
    expect(service.getState().services[pg.name]).toMatchObject({
      status: 'unknown', error: expect.stringContaining('belongs to another allocation'),
    });
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.remove).not.toHaveBeenCalled();
  });

  it('on a node restores the stack’s stopped Redis and leaves host PostgreSQL to its owner', async () => {
    const { service, redis: redisContainer } = monitor(false);
    redisContainer.status = 'exited';
    const pg = container(resolveOmnitronPg(), 'exited', 'a');
    await sweep(service).run();
    expect(new Set(runtime.inspect.mock.calls.map(([name]) => name))).toEqual(new Set([redisContainer.name]));
    expect(runtime.start).toHaveBeenCalledExactlyOnceWith(redisContainer.containerId);
    expect(pg.status).toBe('exited');
  });

  it('a newly provisioned project manager monitors only its declared services', async () => {
    vi.spyOn(InfrastructureService.prototype, 'provision').mockResolvedValue({ services: {}, ready: true });
    const manager = new StackInfrastructureManager(logger());
    const service = await manager.provisionStack('tenant', 'prod', { type: 'local', apps: [] }, config);
    const [desiredRedis] = withInfrastructureScope('tenant', 'prod', () => resolveInfrastructure(config, redis));
    const redisContainer = container(desiredRedis!, 'exited', 'b');
    await sweep(service).run();
    expect(new Set(runtime.inspect.mock.calls.map(([name]) => name))).toEqual(new Set(['tenant-prod-redis']));
    expect(runtime.start).toHaveBeenCalledExactlyOnceWith(redisContainer.containerId);
  });
});
