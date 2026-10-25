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
  return { name: d.name, image: d.image, status: 'running', labels: d.labels, specHash: containerSpecHash(d), ...extras };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); runtime.get.mockResolvedValue(null); });
describe('native monitoring ownership refresh', () => {
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
    const origin = desired('origin'), svc = service(origin); const removed = deferred<void>();
    runtime.get.mockResolvedValue(actual(origin, { health: 'unhealthy' }));
    svc.unhealthyTicks.set('origin', 1); runtime.remove.mockReturnValueOnce(removed.promise);
    svc.createAndStart = vi.fn().mockResolvedValue(undefined);
    const sweep = svc.healthSweep(); await Promise.resolve(); expect(runtime.remove).toHaveBeenCalledOnce();
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
  const svc: any = new ProjectService(logger, { list: () => [] } as any, {} as any);
  svc.registry = { get: () => ({ path: '/immutable/release' }) };
  svc.configRegistry.set('tenant', { stale: true });
  svc.loadProjectConfig = vi.fn(async () => { expect(svc.configRegistry.has('tenant')).toBe(false); return {}; });
  svc.resolveStacks = () => ({ prod: { type: 'remote', apps: [] } });
  await expect(svc.refreshInfrastructureOwnership('tenant', 'prod')).rejects.toThrow('declared local stack');
  expect(svc.loadProjectConfig).toHaveBeenCalledWith('tenant');
});
it('native project RPC forwards the qualified identity and records released/adopted names', async () => {
  const refresh = vi.fn().mockResolvedValue({ released: ['tenant-prod-origin'], adopted: [] });
  const record = vi.fn(); const rpc = new ProjectRpcService({ refreshInfrastructureOwnership: refresh } as any, { record } as any);
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
