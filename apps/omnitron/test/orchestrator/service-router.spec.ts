import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Netron } from '@omnitron-dev/titan/netron';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ServiceRouter } from '../../src/orchestrator/service-router.js';

const logger = createNullLogger();
let netron: Netron;
let router: ServiceRouter;
const pool = (result: unknown = 'first') => ({ execute: vi.fn(async () => result) });
const instance = (name: string) => netron.services.get(name)!.instance as Record<string, (...args: unknown[]) => Promise<unknown>>;

beforeEach(() => { netron = new Netron(logger); router = new ServiceRouter(netron, logger); });
afterEach(async () => { vi.restoreAllMocks(); await router.releaseAll(); await netron.stop(); });

describe('application service ownership', () => {
  it('routes pool methods through BootstrapApp and preserves arguments and errors', async () => {
    const workers = pool();
    await router.exposePoolService('workers', 'Worker', '2.0.0', workers as never, ['run', 'stats']);
    expect(router.getService('Worker@2.0.0')).toMatchObject({ type: 'pool', processName: 'workers' });
    await expect(instance('Worker@2.0.0')['run']!('input', 42)).resolves.toBe('first');
    expect(workers.execute).toHaveBeenLastCalledWith('callExposedService', 'Worker', 'run', ['input', 42]);
    workers.execute.mockRejectedValueOnce(new Error('worker unavailable'));
    await expect(instance('Worker@2.0.0')['stats']!()).rejects.toThrow('worker unavailable');
    const metadata = Reflect.getMetadata('netron:service', instance('Worker@2.0.0').constructor);
    expect(metadata).toMatchObject({ name: 'Worker', version: '2.0.0', properties: {},
      methods: { run: { type: 'Promise', arguments: [] }, stats: { type: 'Promise', arguments: [] } } });
  });

  it('routes to the current child after its restart without replacing the service definition', async () => {
    let child: { callExposedService: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>> } | null = { callExposedService: vi.fn(async () => 'first') };
    await router.exposeChildService('collector', 'Collector', '1.0.0', () => child, ['status']);
    const stub = netron.services.get('Collector@1.0.0');
    const proxy = instance('Collector@1.0.0');
    await expect(proxy['status']!()).resolves.toBe('first');
    child = null;
    await expect(proxy['status']!()).rejects.toThrow('is not running');
    child = { callExposedService: vi.fn(async () => 'restarted') };
    await expect(proxy['status']!('argument')).resolves.toBe('restarted');
    expect(child.callExposedService).toHaveBeenCalledWith('Collector', 'status', ['argument']);
    expect(netron.services.get('Collector@1.0.0')).toBe(stub);
    expect(router.getService('Collector@1.0.0')?.type).toBe('single');
  });

  it.each(['original', 'other'])('rejects duplicate provider %s without invalidating existing consumers', async provider => {
    await router.exposePoolService('original', 'Worker', '1.0.0', pool() as never, ['run']);
    const before = netron.services.get('Worker@1.0.0');
    await expect(router.exposePoolService(provider, 'Worker', '1.0.0', pool('other') as never, ['run']))
      .rejects.toThrow("conflicts with provider 'original'");
    expect(netron.services.get('Worker@1.0.0')).toBe(before);
    await expect(instance('Worker@1.0.0')['run']!()).resolves.toBe('first');
  });

  it('does not take over or remove a registration owned by another router', async () => {
    const other = new ServiceRouter(netron, logger);
    await router.exposePoolService('original', 'Worker', '1.0.0', pool() as never, ['run']);
    await expect(other.exposePoolService('other', 'Worker', '1.0.0', pool('other') as never, ['run']))
      .rejects.toThrow('already exposed');
    await other.releaseAll();
    expect(other.getServiceNames()).toEqual([]);
    await expect(instance('Worker@1.0.0')['run']!()).resolves.toBe('first');
  });

  it('retains partially published services when an expose notification fails', async () => {
    const expose = netron.peer.exposeService.bind(netron.peer);
    vi.spyOn(netron.peer, 'exposeService').mockImplementationOnce(async (...args) => {
      await expose(...args); throw new Error('notification failed');
    });
    await expect(router.exposePoolService('worker', 'Worker', '1.0.0', pool() as never, ['run']))
      .rejects.toThrow('notification failed');
    expect(router.getServiceNames()).toEqual(['Worker@1.0.0']);
    await router.releaseAll();
    expect(netron.services.size).toBe(0);
  });

  it('attempts every removal and retains failed registrations for retry', async () => {
    await router.exposePoolService('a', 'Alpha', '1.0.0', pool() as never, ['run']);
    await router.exposePoolService('b', 'Beta', '', pool() as never, ['run']);
    vi.spyOn(netron.peer, 'unexposeService').mockRejectedValueOnce(new Error('listener cleanup failed'));
    await expect(router.releaseAll()).rejects.toThrow('Alpha@1.0.0');
    expect(netron.services.has('Beta')).toBe(false);
    expect(router.getServiceNames()).toEqual(['Alpha@1.0.0']);
    await router.releaseAll();
    await router.releaseAll();
    expect(netron.services.size).toBe(0);
    expect(router.getServiceNames()).toEqual([]);
  });

  it('accepts an already removed owned service and ignores unknown names', async () => {
    await router.exposePoolService('worker', 'Worker', '', pool() as never, ['run']);
    await netron.peer.unexposeService('Worker');
    await router.unexposeService('Worker');
    await router.unexposeService('Unknown', '1.0.0');
    expect(router.getServiceNames()).toEqual([]);
  });

  it('refuses to remove a service that was replaced outside its ownership', async () => {
    await router.exposePoolService('worker', 'Worker', '', pool() as never, ['run']);
    await netron.peer.unexposeService('Worker');
    const other = new ServiceRouter(netron, logger);
    await other.exposePoolService('other', 'Worker', '', pool('other') as never, ['run']);
    await expect(router.releaseAll()).rejects.toThrow('remain registered');
    await expect(instance('Worker')['run']!()).resolves.toBe('other');
    await other.releaseAll();
    await router.releaseAll();
  });
});
