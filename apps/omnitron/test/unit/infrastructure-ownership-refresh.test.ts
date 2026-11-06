import { beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), remove: vi.fn(), start: vi.fn() }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<Record<string, unknown>>()), getContainerState: runtime.get,
  createContainer: runtime.create, removeContainer: runtime.remove, startContainer: runtime.start,
}));
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import * as normalizer from '../../src/infrastructure/config-normalizer.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';
const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
function desired(name: string): ResolvedContainer {
  return { name, image: 'nginx:1.27', ports: [], volumes: [], environment: {},
    labels: { 'omnitron.managed': 'true', 'omnitron.project': 'tenant', 'omnitron.stack': 'prod', 'omnitron.service': name },
    restart: 'unless-stopped', critical: false } as ResolvedContainer;
}
function service(...containers: ResolvedContainer[]): any {
  const svc = new InfrastructureService(logger, { services: {} } as any, {}, undefined, undefined, false);
  svc.addAppContainers(containers);
  return svc;
}
function actual(d: ResolvedContainer, extras: any = {}) {
  return { name: d.name, image: d.image, status: 'running', containerId: '1'.repeat(64), labels: d.labels, specHash: containerSpecHash(d), ...extras };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); runtime.get.mockResolvedValue(null); });
describe('native monitoring ownership refresh', () => {
  it('permanently relinquishes legacy control-plane and janitor ownership after every actor drains', async () => {
    const redis = desired('redis');
    const original: any = new InfrastructureService(logger, {} as any, {}, undefined, undefined, true);
    original.addAppContainers([redis]);
    const sweep = deferred<void>(), reconcile = deferred<void>(), janitor = deferred<void>();
    original.activeSweeps.add(sweep.promise); original.reconcileTasks.set('redis', reconcile.promise);
    const stop = vi.fn(), drain = vi.fn(() => janitor.promise);
    original.phantomJanitor = { stop, drain }; original.janitorNetworks = ['legacy-network'];
    original.handoffMonitoring = true;
    original.startHealthMonitor();
    const released = original.relinquishMonitoring(); let finished = false;
    void released.then(() => { finished = true; });
    expect(original.healthTimer).toBeNull();
    await expect(original.teardown()).rejects.toThrow('frozen');
    await expect(original.retireStack({ project: 'tenant', stack: 'prod' })).rejects.toThrow('frozen');
    expect(() => original.addAppContainers([redis])).toThrow('frozen');
    expect(() => original.resumeStack({ project: 'tenant', stack: 'prod' })).toThrow('frozen');
    sweep.resolve(); reconcile.resolve(); await Promise.resolve(); expect(finished).toBe(false);
    janitor.resolve();
    expect(await released).toEqual(expect.arrayContaining(['redis', original.omnitronPgContainer.name]));
    expect(drain).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce(); expect(original.janitorNetworks).toEqual([]);
    original.resumeAfterHandoff(); original.startHealthMonitor(); await original.healthSweep();
    expect(original.ownershipFrozen).toBe(true); expect(original.healthTimer).toBeNull();
    await expect(original.provision()).rejects.toThrow('relinquished');
    await expect(original.teardown()).rejects.toThrow('relinquished');
    expect(() => original.addAppContainers([redis])).toThrow('relinquished');
    expect(runtime.get).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
  });
  it('drains an admitted provision and its late janitor before permanently releasing authority', async () => {
    const original = service(desired('redis')), provision = deferred<any>(), janitor = deferred<void>();
    const drain = vi.fn(() => janitor.promise);
    original.provisionOwned = vi.fn(async () => {
      await provision.promise;
      original.phantomJanitor = { drain, stop: vi.fn() };
      return original.state;
    });
    const running = original.provision();
    const released = original.relinquishMonitoring(); let finished = false;
    void released.then(() => { finished = true; });
    await expect(original.provision()).rejects.toThrow('frozen');
    provision.resolve({}); await running; await Promise.resolve();
    expect(finished).toBe(false); janitor.resolve(); await released;
    expect(drain).toHaveBeenCalledOnce(); expect(original.phantomJanitor).toBeNull();
    expect(runtime.get).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
  });
  it('drains admitted provisioning and its late janitor before explicit teardown removes resources', async () => {
    const original = service(desired('redis')), provision = deferred<any>(), janitor = deferred<void>();
    runtime.get.mockResolvedValue(actual(desired('redis')));
    original.provisionOwned = vi.fn(async () => {
      await provision.promise;
      original.phantomJanitor = { drain: () => janitor.promise, stop: vi.fn() };
      return original.state;
    });
    const running = original.provision(), stopped = original.teardown();
    expect(runtime.remove).not.toHaveBeenCalled();
    provision.resolve({}); await running; await Promise.resolve();
    expect(runtime.remove).not.toHaveBeenCalled(); janitor.resolve(); await stopped;
    expect(runtime.remove).toHaveBeenCalledOnce();
    expect(runtime.remove).toHaveBeenCalledWith('1'.repeat(64), { graceful: true });
  });
  it('transfers a verified failed creation as absent, preserving its failure and desired service', async () => {
    const redis = desired('redis'), original = service(redis);
    original.state.services.redis = { name: 'redis', image: redis.image, status: 'exited', error: 'Image unavailable' };
    const checkpoint = await original.prepareHandoff();
    expect(checkpoint.nativeState).toEqual({ protocol: 1, observations: [{ name: 'redis', containerId: null }] });
    const restored = await InfrastructureService.adoptHandoff(logger, checkpoint);
    expect(restored.getState().services['redis']?.error).toBe('Image unavailable');
    expect(restored.getState().ready).toBe(false);
    expect(restored.getDesiredServices()).toEqual([{ name: 'redis', image: redis.image }]);
    expect(runtime.get).toHaveBeenCalledWith('redis', { orThrow: true, fullId: true });
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.start).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
    original.dispose(); restored.dispose();
  });
  it('refuses an absent observation that becomes a container before adoption', async () => {
    const redis = desired('redis'), original = service(redis);
    original.state.services.redis = { name: 'redis', image: redis.image, status: 'exited', error: 'Image unavailable' };
    const checkpoint = await original.prepareHandoff();
    runtime.get.mockResolvedValue(actual(redis));
    await expect(InfrastructureService.adoptHandoff(logger, checkpoint)).rejects.toThrow('identity or specification changed');
    original.dispose();
  });
  it.each([
    { status: 'running' }, { status: 'exited', containerId: '1'.repeat(64), error: 'Stopped previously' },
    { status: 'exited' },
  ])('refuses missing running, previously identified or unproven service %j', async previous => {
    const original = service(desired('redis')); original.state.services.redis = { name: 'redis', ...previous };
    await expect(original.prepareHandoff()).rejects.toThrow('identity or specification changed');
    expect(original.ownershipFrozen).toBe(false); original.dispose();
  });
  it('does not turn a Docker inspection failure into proof of absence', async () => {
    const original = service(desired('redis'));
    original.state.services.redis = { name: 'redis', status: 'exited', error: 'Image unavailable' };
    runtime.get.mockRejectedValue(new Error('Docker connection unavailable'));
    await expect(original.prepareHandoff()).rejects.toThrow('Docker connection unavailable');
    expect(original.ownershipFrozen).toBe(false); original.dispose();
  });
  it('refuses a replacement container even when its desired labels and spec match', async () => {
    const redis = desired('redis'), original = service(redis); runtime.get.mockResolvedValue(actual(redis));
    const checkpoint = await original.prepareHandoff();
    runtime.get.mockResolvedValue(actual(redis, { containerId: 'a'.repeat(64) }));
    await expect(InfrastructureService.adoptHandoff(logger, checkpoint)).rejects.toThrow('identity or specification changed');
    original.dispose();
  });
  it('keeps legacy snapshots strict and rejects incomplete native evidence', async () => {
    const original = service(desired('redis'));
    original.state.services.redis = { name: 'redis', status: 'exited', error: 'Image unavailable' };
    const checkpoint = await original.prepareHandoff();
    const legacy = structuredClone(checkpoint); delete legacy.nativeState;
    await expect(InfrastructureService.adoptHandoff(logger, legacy)).rejects.toThrow('identity or specification changed');
    checkpoint.nativeState!.observations = [];
    await expect(InfrastructureService.adoptHandoff(logger, checkpoint)).rejects.toThrow('Incomplete');
    original.dispose();
  });
  it('transfers restart backoff and unhealthy observations without Docker mutations', async () => {
    const redis = desired('redis'), original = service(redis);
    runtime.get.mockResolvedValue(actual(redis));
    original.unhealthyEvidence.set('redis', { containerId: '1'.repeat(64), startedAt: '2026-01-01T00:00:00Z', firstObservedAt: Date.now() - 30_000, lastProbeAt: Date.now(), confirmations: 1 });
    original.restartBackoff.set('redis', { failures: 4, nextAttemptAt: Date.now() + 120_000 });
    const checkpoint = await original.prepareHandoff();
    const restored = await InfrastructureService.adoptHandoff(logger, checkpoint);
    const second = await (async () => { restored.resumeAfterHandoff(); return restored.prepareHandoff(); })();
    expect(second.unhealthyTicks).toEqual([]);
    expect(second.unhealthyEvidence).toEqual(checkpoint.unhealthyEvidence);
    expect(second.restartBackoff).toEqual(checkpoint.restartBackoff);
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled(); expect(runtime.start).not.toHaveBeenCalled();
    original.dispose(); restored.dispose();
  });
  it('refuses a checkpoint whose native container identity no longer matches', async () => {
    const redis = desired('redis'), original = service(redis);
    runtime.get.mockResolvedValue(actual(redis));
    const checkpoint = await original.prepareHandoff();
    runtime.get.mockResolvedValue(actual(redis, { specHash: 'another-release' }));
    await expect(InfrastructureService.adoptHandoff(logger, checkpoint)).rejects.toThrow('identity or specification changed');
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
    original.resumeAfterHandoff(); original.dispose();
  });
  it('refuses mismatched native ownership before retiring the existing backend', async () => {
    const original = service(desired('redis'));
    await expect(original.prepareHandoff()).rejects.toThrow('identity or specification changed');
    expect(original.ownershipFrozen).toBe(false);
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
    original.dispose();
  });
  it('releases only omitted names and never mutates Docker', async () => {
    const origin = desired('origin'), redis = desired('redis'); const svc = service(origin, redis);
    svc.state.services.origin = actual(origin);
    expect(await svc.refreshOwnershipFrom(service(redis))).toEqual({ released: ['origin'], adopted: [] });
    expect(svc.getDesiredServices().map((x: any) => x.name)).toEqual(['redis']);
    expect(svc.getState().services.origin).toBeUndefined();
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled(); expect(runtime.start).not.toHaveBeenCalled();
  });
  it('drains a stale health snapshot before acknowledging release; remaining services remain monitored', async () => {
    const origin = desired('origin'), redis = desired('redis'); const svc = service(origin, redis);
    const state = deferred<any>(); runtime.get.mockReturnValueOnce(state.promise);
    const sweep = svc.healthSweep(); const refresh = svc.refreshOwnershipFrom(service(redis));
    let done = false; void refresh.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    state.resolve(null); await sweep; await refresh;
    expect(runtime.remove).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
    runtime.get.mockImplementation(async (name: string) => name === 'redis' ? actual(redis) : null);
    await svc.healthSweep(); expect(runtime.get.mock.calls.slice(1).every(([name]) => name === 'redis')).toBe(true);
  });
  it('drains an inspect already in reconcile before releasing its service', async () => {
    const origin = desired('origin'), svc = service(origin); const state = deferred<any>();
    runtime.get.mockReturnValueOnce(state.promise); const reconcile = svc.reconcileService(origin);
    const refresh = svc.refreshOwnershipFrom(service()); state.resolve(null); await reconcile; await refresh;
    expect(runtime.create).not.toHaveBeenCalled(); expect(svc.getDesiredServices()).toEqual([]);
  });
  it('waits for an already-started unhealthy restart before handing off', async () => {
    const origin = desired('origin'), svc = service(origin); const removed = deferred<void>(), removing = deferred<void>();
    const now = Date.now(), startedAt = new Date(now - 120_000).toISOString();
    runtime.get.mockResolvedValue(actual(origin, { health: 'unhealthy', startedAt,
      healthCheck: { completedAt: new Date(now).toISOString(), exitCode: 1 } }));
    svc.unhealthyEvidence.set('origin', { containerId: '1'.repeat(64), startedAt,
      firstObservedAt: now - 60_000, lastProbeAt: now - 30_000, confirmations: 1 });
    runtime.remove.mockImplementationOnce(() => { removing.resolve(); return removed.promise; });
    svc.createAndStart = vi.fn().mockResolvedValue(undefined);
    const sweep = svc.healthSweep(); await removing.promise; expect(runtime.remove).toHaveBeenCalledOnce();
    const refresh = svc.refreshOwnershipFrom(service()); let done = false; void refresh.then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false); removed.resolve(); await sweep; await refresh;
    expect(svc.createAndStart).toHaveBeenCalledOnce(); expect(svc.getDesiredServices()).toEqual([]);
  });
  it('rejects retained spec changes without losing monitoring ownership', async () => {
    const origin = desired('origin'), svc = service(origin);
    await expect(svc.refreshOwnershipFrom(service({ ...origin, image: 'nginx:other' }))).rejects.toThrow('retained service spec');
    expect(svc.getDesiredServices()).toEqual([{ name: 'origin', image: 'nginx:1.27' }]);
  });
  it('re-adopts an exact running native container after rollback, without restarting it', async () => {
    const origin = desired('origin'), svc = service(); runtime.get.mockResolvedValue(actual(origin));
    expect(await svc.refreshOwnershipFrom(service(origin))).toEqual({ released: [], adopted: ['origin'] });
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.start).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'exited' }, { specHash: 'different' }, { labels: { 'omnitron.managed': 'true', 'omnitron.project': 'other' } }, { networkAttached: false },
  ])('rejects unproven adoption %j and keeps previous ownership', async extras => {
    const origin = desired('origin'), svc = service(); runtime.get.mockResolvedValue(actual(origin, extras));
    await expect(svc.refreshOwnershipFrom(service(origin))).rejects.toThrow('Cannot adopt'); expect(svc.getDesiredServices()).toEqual([]);
  });
  it('fresh stack resolution uses the existing manager and never provisions a second service', async () => {
    const provision = vi.spyOn(InfrastructureService.prototype, 'provision').mockResolvedValue({ services: {}, ready: true });
    try {
      const manager = new StackInfrastructureManager(logger);
      const cfg: any = { services: { origin: { docker: { image: 'nginx:1.27' }, env: {}, ports: {} } } };
      const svc = await manager.provisionStack('tenant', 'prod', { type: 'local', apps: [] }, cfg);
      expect(await manager.refreshOwnership('tenant', 'prod', { type: 'local', apps: [] }, { services: {} } as any)).toEqual({ released: ['tenant-prod-origin'], adopted: [] });
      expect(manager.getInstance('tenant', 'prod')).toBe(svc); expect(provision).toHaveBeenCalledOnce();
    } finally { provision.mockRestore(); }
  });
});

import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
it('project refresh rereads validated config and refuses absent or remote stacks', async () => {
  const svc: any = new ProjectService(logger, { list: () => [] } as any, { selectProjectsSync: () => [], kvGetSync: () => null } as any);
  svc.registry = { get: () => ({ path: '/immutable/release' }) };
  svc.configRegistry.set('tenant', { stale: true });
  svc.loadProjectConfig = vi.fn(async () => { expect(svc.configRegistry.has('tenant')).toBe(false); return {}; });
  svc.resolveStacks = () => ({ prod: { type: 'remote', apps: [] } });
  await expect(svc.refreshInfrastructureOwnership('tenant', 'prod')).rejects.toThrow('declared local stack');
  expect(svc.loadProjectConfig).toHaveBeenCalledWith('tenant');
});
it('native project RPC forwards the qualified identity and records released/adopted names', async () => {
  const refresh = vi.fn().mockResolvedValue({ released: ['tenant-prod-origin'], adopted: [] });
  const record = vi.fn(); const rpc = new ProjectRpcService({ resolveProjectStack: async (scope: unknown) => scope, refreshInfrastructureOwnership: refresh } as any, { record } as any);
  await expect(rpc.refreshInfrastructureOwnership({ project: 'tenant', stack: 'prod' })).resolves.toEqual({ released: ['tenant-prod-origin'], adopted: [] });
  expect(refresh).toHaveBeenCalledWith('tenant', 'prod');
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'tenant', details: { stack: 'prod', released: ['tenant-prod-origin'], adopted: [] } }));
});

it('failed fresh preset normalization refuses the refresh without releasing current services', async () => {
  const provision = vi.spyOn(InfrastructureService.prototype, 'provision').mockResolvedValue({ services: {}, ready: true });
  const manager = new StackInfrastructureManager(logger);
  try {
    const svc = await manager.provisionStack('tenant', 'prod', { type: 'local', apps: [] }, { services: { origin: { docker: { image: 'nginx:1.27' }, env: {}, ports: {} } } } as any);
    const normalize = vi.spyOn(normalizer, 'normalizeInfraConfig').mockImplementation(() => { throw Error('invalid preset'); });
    try {
      await expect(manager.refreshOwnership('tenant', 'prod', { type: 'local', apps: [] }, { services: {} } as any)).rejects.toThrow('invalid preset');
      expect(svc.getDesiredServices().map(x => x.name)).toEqual(['tenant-prod-origin']);
    } finally { normalize.mockRestore(); }
  } finally { provision.mockRestore(); }
});
