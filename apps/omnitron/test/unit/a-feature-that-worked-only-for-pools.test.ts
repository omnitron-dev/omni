import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

const service = Object.assign(Object.create(OrchestratorService.prototype), { logger: createNullLogger() });
afterEach(() => vi.useRealTimers());

describe('topology provider discovery for pools and single processes', () => {
  it('waits for callable services rather than treating an empty startup response as ready', async () => {
    vi.useFakeTimers();
    const ask = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'Worker', methods: [] }])
      .mockResolvedValue([{ name: 'Worker', version: '1.0.0', methods: ['status'] }]);
    const pending = service.discoverTopologyServices('sample/dev/quotes', 'worker', ask);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual([{ name: 'Worker', version: '1.0.0', methods: ['status'] }]);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('reports the application and provider when startup never exposes a callable service', async () => {
    vi.useFakeTimers();
    const pending = service.discoverTopologyServices('sample/dev/quotes', 'collector', async () => []);
    const assertion = expect(pending).rejects.toThrow("sample/dev/quotes' topology provider 'collector' exposed no callable services");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('rejects invalid metadata and preserves the underlying RPC failure', async () => {
    await expect(service.discoverTopologyServices('app', 'worker', async () => [{ name: 'Worker', methods: [null] }]))
      .rejects.toThrow('invalid service metadata');
    await expect(service.discoverTopologyServices('app', 'worker', async () => { throw new Error('peer disconnected'); }))
      .rejects.toThrow("Application 'app' topology provider 'worker' discovery failed: Error: peer disconnected");
  });

  it('discovers only declared single providers and resolves their current child per call', async () => {
    const metadata = [{ name: 'Worker', version: '2.0.0', methods: ['status'] }];
    let child = { getExposedServices: vi.fn(async () => metadata) };
    const supervisor = { getChildProxy: vi.fn(() => child) };
    const router = { exposeChildService: vi.fn(async () => {}) };
    await service.exposeChildTopologyServices({ name: 'app' }, supervisor, router, [
      { name: 'hidden' }, { name: 'provider', topology: { expose: true } },
    ]);
    expect(supervisor.getChildProxy).toHaveBeenCalledWith('app/provider');
    expect(router.exposeChildService).toHaveBeenCalledTimes(1);
    const [processName, name, version, getProxy, methods] = router.exposeChildService.mock.calls[0] as unknown as
      [string, string, string, () => unknown, string[]];
    expect([processName, name, version, methods]).toEqual(['provider', 'Worker', '2.0.0', ['status']]);
    child = { getExposedServices: vi.fn(async () => metadata) };
    expect(getProxy()).toBe(child);
  });
});
