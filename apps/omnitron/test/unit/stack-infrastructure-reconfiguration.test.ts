import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
const runtime = vi.hoisted(() => ({ available: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn(), image: vi.fn(), volume: vi.fn() }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<Record<string, unknown>>()), isDockerAvailable: runtime.available, getContainerState: runtime.get,
  createContainer: runtime.create, removeContainer: runtime.remove, ensureImage: runtime.image, createVolume: runtime.volume,
}));
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';
import { assertReplacementVolumes } from '../../src/infrastructure/owned-container.js';
import * as normalizer from '../../src/infrastructure/config-normalizer.js';
import type { ContainerState, InfrastructureConfig, ResolvedContainer } from '../../src/infrastructure/types.js';

const logger = createNullLogger();
let manager: StackInfrastructureManager;
const containers = new Map<string, ContainerState>();
let sequence = 0;
const scope = { type: 'local' as const, apps: [] };
const definition = (target = 'http://localhost/health'): InfrastructureConfig => ({ services: {
  gateway: { docker: { image: 'nginx:1' }, ports: {}, env: {}, healthCheck: { type: 'command', target: `wget -q -O /dev/null ${target}` } },
  storage: { docker: { image: 'storage:1', volumes: { data: { source: 'retained-data', target: '/data' } } }, ports: {}, env: {} },
} });
const read = (name: string) => containers.has(name) ? structuredClone(containers.get(name)!) : null;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); containers.clear(); sequence = 0;
  manager = new StackInfrastructureManager(logger);
  runtime.available.mockResolvedValue(true);
  runtime.get.mockImplementation(async name => read(name));
  runtime.create.mockImplementation(async (desired: ResolvedContainer) => {
    const id = (++sequence).toString(16).padStart(64, '0');
    containers.set(desired.name, { name: desired.name, image: desired.image, containerId: id,
      status: 'running', health: 'healthy', startedAt: new Date().toISOString(),
      mounts: desired.volumes.map(v => ({ type: 'volume', name: v.source, source: '/volumes/' + v.source, target: v.target })),
      labels: desired.labels, specHash: containerSpecHash(desired) });
    return id;
  });
  runtime.remove.mockImplementation(async id => {
    for (const [name, state] of containers) if (state.containerId === id) containers.delete(name);
  });
  vi.spyOn(InfrastructureService.prototype as any, 'waitHealthy').mockResolvedValue(undefined);
});
afterEach(() => { manager.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('a repeated stack start applies current infrastructure declarations', () => {
  it('refuses immutable drift on a cold automatic start before touching any retained container or creating siblings', async () => {
    await manager.provisionStack('tenant', 'dev', scope, definition());
    const before = [...containers];
    manager.dispose();
    manager = new StackInfrastructureManager(logger);
    const changed = definition('http://127.0.0.1/new-health');
    changed.services!['new'] = { docker: { image: 'new:1' }, env: {}, ports: {} };
    await expect(manager.provisionStack('tenant', 'dev', scope, changed, undefined, undefined, 'automatic'))
      .rejects.toThrow(/Automatic start would replace tenant-dev-gateway: config drift/);
    expect([...containers]).toEqual(before);
    expect(runtime.remove).not.toHaveBeenCalled(); expect(runtime.create).toHaveBeenCalledTimes(2);
    expect(manager.getInstance('tenant', 'dev')).toBeNull();
    await manager.provisionStack('tenant', 'dev', scope, changed, undefined, undefined, 'reconcile');
    expect(runtime.remove).toHaveBeenCalledExactlyOnceWith(before.find(([key]) => key === 'tenant-dev-gateway')![1].containerId, { graceful: true });
    expect(read('tenant-dev-storage')).toEqual(before.find(([key]) => key === 'tenant-dev-storage')![1]);
  });
  it('reconciles the changed health check once, preserving the owner, other containers and volumes', async () => {
    const service = await manager.provisionStack('tenant--dev', 'portal', scope, definition());
    const before = read('tenant--dev-portal-gateway')!, storage = read('tenant--dev-portal-storage')!;
    const timer = (service as any).healthTimer, janitor = (service as any).phantomJanitor;
    const changed = definition('http://127.0.0.1/health');
    const again = await manager.provisionStack('tenant--dev', 'portal', scope, changed);
    expect(again).toBe(service);
    expect(read(before.name)!.containerId).not.toBe(before.containerId);
    expect(read(storage.name)).toEqual(storage);
    expect(runtime.remove).toHaveBeenCalledExactlyOnceWith(before.containerId, { graceful: true });
    expect(runtime.create).toHaveBeenCalledTimes(3);
    expect(service.getState().ready).toBe(true);
    expect((service as any).healthTimer).toBe(timer);
    expect(janitor.timer).toBeNull();
    expect((service as any).phantomJanitor).not.toBe(janitor);
    expect(manager.captureRecoveryState()[0]!.infrastructure.containers.find(c => c.name === before.name)?.healthCheck?.test.join(' '))
      .toContain('http://127.0.0.1/health');
    await manager.provisionStack('tenant--dev', 'portal', scope, changed);
    expect(runtime.remove).toHaveBeenCalledOnce(); expect(runtime.create).toHaveBeenCalledTimes(3);
  });

  it('keeps the old database if its replacement image cannot be prepared', async () => {
    await manager.provisionStack('tenant', 'dev', scope, definition());
    const before = [...containers];
    runtime.image.mockRejectedValueOnce(Error('registry unavailable'));
    const service = await manager.provisionStack('tenant', 'dev', scope, definition('new-check'));
    expect(service.getState().ready).toBe(false);
    expect([...containers]).toEqual(before); expect(runtime.remove).not.toHaveBeenCalled();
  });

  it('never detaches an anonymous data volume during an ordinary reconciliation', async () => {
    await manager.provisionStack('tenant', 'dev', scope, definition());
    const gateway = containers.get('tenant-dev-gateway')!;
    gateway.mounts = [{ type: 'volume', name: 'a'.repeat(64), source: '/docker/volumes/retained', target: '/archive' }];
    const service = await manager.provisionStack('tenant', 'dev', scope, definition('new-check'), undefined, undefined, 'reconcile');
    expect(service.getState().services[gateway.name]?.error).toContain('explicit data transition');
    expect(read(gateway.name)?.containerId).toBe(gateway.containerId);
    expect(runtime.remove).not.toHaveBeenCalled();
  });

  it('holds a replacement that would detach a writable host data directory', async () => {
    const config = definition();
    const mount = { source: '/fixture/database', target: '/data' };
    config.services!['storage']!.docker!.volumes = { data: mount };
    await manager.provisionStack('tenant', 'dev', scope, config);
    const storage = containers.get('tenant-dev-storage')!;
    storage.mounts = [{ type: 'bind', ...mount }];
    const next = definition();
    next.services!['storage']!.docker!.volumes = { data: { ...mount, source: '/fixture/empty' } };

    const service = await manager.provisionStack('tenant', 'dev', scope, next, undefined, undefined, 'reconcile');
    expect(service.getState().ready).toBe(false);
    expect(service.getState().services[storage.name]?.error).toContain('explicit data transition');
    expect(read(storage.name)?.containerId).toBe(storage.containerId);
    expect(runtime.remove).not.toHaveBeenCalled();
  });

  it('can retain writable bind storage and exchange a confirmed read-only release mount', async () => {
    const service = await manager.provisionStack('tenant', 'dev', scope, definition());
    const desired = service.getDesiredContainers().find(c => c.name.endsWith('-storage'))!;
    const actual = containers.get(desired.name)!;
    desired.volumes = [
      { source: '/fixture/db', target: '/data' },
      { source: '/fixture/site-v2', target: '/site', readonly: true },
    ];
    actual.mounts = [
      { type: 'bind', source: '/fixture/db', target: '/data', readOnly: false },
      { type: 'bind', source: '/fixture/site-v1', target: '/site', readOnly: true },
    ];
    expect(() => assertReplacementVolumes(desired, actual)).not.toThrow();
    delete actual.mounts[1]!.readOnly;
    expect(() => assertReplacementVolumes(desired, actual)).toThrow('explicit data transition');
  });

  it('rejects invalid fresh resolution without changing the previous definition, allocation or monitoring', async () => {
    const service = await manager.provisionStack('tenant', 'dev', scope, definition());
    const desired = service.getDesiredContainers(), allocation = manager.getPortAllocation('tenant', 'dev');
    const before = [...containers];
    vi.spyOn(normalizer, 'normalizeInfraConfig').mockImplementationOnce(() => { throw Error('invalid declaration'); });
    await expect(manager.provisionStack('tenant', 'dev', scope, definition('changed'))).rejects.toThrow('invalid declaration');
    expect(manager.getInstance('tenant', 'dev')).toBe(service);
    expect(service.getDesiredContainers()).toEqual(desired);
    expect(manager.getPortAllocation('tenant', 'dev')).toEqual(allocation);
    expect([...containers]).toEqual(before); expect((service as any).healthTimer).not.toBeNull();
  });

  it('drains an old health read before the new specification may remove a container', async () => {
    const service: any = await manager.provisionStack('tenant', 'dev', scope, definition());
    const old = read('tenant-dev-gateway')!, held = deferred<ContainerState | null>(), reading = deferred<void>();
    runtime.get.mockImplementationOnce(async () => { reading.resolve(); return held.promise; });
    const sweep = service.healthSweep(); await reading.promise;
    const retry = manager.provisionStack('tenant', 'dev', scope, definition('http://127.0.0.1/health'));
    await expect(manager.provisionStack('tenant', 'dev', scope, definition('other'))).rejects.toThrow('already in progress');
    await Promise.resolve(); expect(runtime.remove).not.toHaveBeenCalled();
    held.resolve(old); await sweep; await retry;
    expect(runtime.remove).toHaveBeenCalledExactlyOnceWith(old.containerId, { graceful: true });
    expect(service.getState().ready).toBe(true);
  });

  it('retains the same observer and failed declaration when Docker goes away, then retries normally', async () => {
    const service: any = await manager.provisionStack('tenant', 'dev', scope, definition());
    const before = [...containers]; runtime.available.mockResolvedValueOnce(false);
    const config = definition('http://127.0.0.1/health');
    await expect(manager.provisionStack('tenant', 'dev', scope, config)).rejects.toThrow('Docker is not available');
    expect(manager.getInstance('tenant', 'dev')).toBe(service);
    expect(service.getDesiredContainers().find((c: ResolvedContainer) => c.name === 'tenant-dev-gateway').healthCheck.test.join(' '))
      .toContain('http://127.0.0.1/health');
    expect(service.getState().ready).toBe(false);
    expect([...containers]).toEqual(before); expect(service.healthTimer).not.toBeNull();
    await manager.provisionStack('tenant', 'dev', scope, config);
    expect(service.getState().ready).toBe(true); expect(runtime.remove).toHaveBeenCalledOnce();
  });

  it('does not destroy a container when its declaration is removed', async () => {
    const service = await manager.provisionStack('tenant', 'dev', scope, definition());
    const storage = read('tenant-dev-storage')!;
    await manager.provisionStack('tenant', 'dev', scope, { services: { gateway: definition().services!['gateway']! } });
    expect(service.getDesiredServices().map(s => s.name)).toEqual(['tenant-dev-gateway']);
    expect(service.getState().services[storage.name]).toBeUndefined();
    expect(read(storage.name)).toEqual(storage); expect(runtime.remove).not.toHaveBeenCalled();
  });

  it('reserves the stack throughout asynchronous resolution, excluding stop, ownership transfer and snapshots', async () => {
    const service = await manager.provisionStack('tenant', 'dev', scope, definition());
    const before = [...containers], entered = deferred<void>(), release = deferred<void>();
    const resolve = (manager as any).resolveStackDefinition.bind(manager);
    vi.spyOn(manager as any, 'resolveStackDefinition').mockImplementationOnce(async (...args: unknown[]) => {
      entered.resolve(); await release.promise; return resolve(...args);
    });
    const retry = manager.provisionStack('tenant', 'dev', scope, definition()); await entered.promise;
    await expect(manager.teardownStack('tenant', 'dev', [])).rejects.toThrow('already in progress');
    await expect(manager.refreshOwnership('tenant', 'dev', { ...scope, infrastructureOwnership: 'external' }, {})).rejects.toThrow('already in progress');
    await expect(manager.teardownAll()).rejects.toThrow('ownership is changing');
    await expect(manager.prepareHandoff()).rejects.toThrow('ownership is changing');
    expect(() => manager.captureRecoveryState()).toThrow('ownership is changing');
    expect([...containers]).toEqual(before); expect(manager.getInstance('tenant', 'dev')).toBe(service);
    release.resolve(); await retry;
    const snapshot = await manager.prepareHandoff(); expect(snapshot).toHaveLength(1);
    await expect(manager.provisionStack('tenant', 'dev', scope, definition())).rejects.toThrow('frozen');
    manager.resumeAfterHandoff(); await manager.provisionStack('tenant', 'dev', scope, definition());
    expect([...containers]).toEqual(before); expect(runtime.remove).not.toHaveBeenCalled();
  });

  it('cannot transfer retained native identities to another ownership label', async () => {
    const service = await manager.provisionStack('tenant', 'dev', scope, definition());
    const before = service.getDesiredContainers(), candidate = new InfrastructureService(logger, {}, {}, undefined, undefined, false);
    candidate.addAppContainers(before.map(container => ({ ...container, labels: { ...container.labels, 'omnitron.project': 'other' } })));
    await expect(service.provision(candidate)).rejects.toThrow('cannot change retained ownership');
    expect(service.getDesiredContainers()).toEqual(before);
    expect(service.getState().ready).toBe(true);
    expect((service as any).healthTimer).not.toBeNull(); expect((service as any).phantomJanitor.timer).not.toBeNull();
    expect(runtime.remove).not.toHaveBeenCalled(); expect(runtime.create).toHaveBeenCalledTimes(2);
  });
});
