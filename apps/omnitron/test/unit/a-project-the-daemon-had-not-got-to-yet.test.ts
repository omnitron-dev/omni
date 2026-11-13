/**
 * A project the daemon had not got to yet.
 *
 * In the first seconds after a daemon start, `getStack` found no loaded
 * config and threw «Project 'sample' config not loaded»; `listStacks` answered
 * `[]`, which reads as «no stacks». Measured on the master restarted at
 * 12:07:48 UTC: 20 ERROR lines from the console's polls, counted by `doctor`
 * as server failures, for a project that loads a moment later. Readers now
 * load it on demand, once however many arrive together.
 */
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';

import { ProjectService } from '../../src/services/project.service.js';
import * as loader from '../../src/config/loader.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';

describe('ensureConfig', () => {
  const serviceWith = (load: () => Promise<unknown>) => {
    const self: Record<string, unknown> = {
      configRegistry: new Map(),
      configLoads: new Map(),
      loadProjectConfig: vi.fn(async (name: string) => {
        const config = await load();
        (self['configRegistry'] as Map<string, unknown>).set(name, { config, loadedAt: 0 });
        return config;
      }),
    };
    self['getLoadedConfig'] = (name: string) => ProjectService.prototype.getLoadedConfig.call(self as never, name);
    const ensure = (name: string) => ProjectService.prototype.ensureConfig.call(self as never, name);
    return { ensure, load: self['loadProjectConfig'] as ReturnType<typeof vi.fn> };
  };

  it('loads a project nobody has loaded yet, instead of refusing', async () => {
    const { ensure } = serviceWith(async () => ({ project: 'sample' }));
    await expect(ensure('sample')).resolves.toEqual({ project: 'sample' });
  });

  it('loads it once for readers that arrive together, and not again after', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { ensure, load } = serviceWith(async () => {
      await gate;
      return { project: 'sample' };
    });

    const both = Promise.all([ensure('sample'), ensure('sample')]);
    release();
    await both;
    await ensure('sample');

    expect(load).toHaveBeenCalledTimes(1);
  });
});

it('keeps the certificate on identical reads and fences a changed configuration before writing it', async () => {
  const existing = { config: { project: 'sample' }, loadedAt: 42 };
  const sel = { path: '/sample', registeredAt: '2026-01-01' };
  const self = { registry: { get: () => sel }, configRegistry: new Map([['sample', existing]]), ownershipFrozen: false };
  const load = () => ProjectService.prototype.loadProjectConfig.call(self as never, 'sample');
  const source = vi.spyOn(loader, 'loadEcosystemConfig');
  let refuseWrites = false;
  const invalidations: string[] = [];
  const detach = recoveryState.attach(reason => {
    invalidations.push(reason);
    if (refuseWrites) throw Error('journal unavailable');
  });
  invalidations.length = 0;
  try {
    source.mockResolvedValueOnce({ ...existing.config } as never);
    expect(await load()).toBe(existing.config);
    expect(self.configRegistry.get('sample')).toBe(existing);
    expect(invalidations).toEqual([]);
    source.mockRejectedValueOnce(Error('source unavailable'));
    await expect(load()).rejects.toThrow('source unavailable');
    expect(invalidations).toEqual([]);
    source.mockResolvedValue({ project: 'changed' } as never);
    self.ownershipFrozen = true;
    await expect(load()).rejects.toThrow('ownership');
    expect(invalidations).toEqual([]);
    self.ownershipFrozen = false;
    refuseWrites = true;
    await expect(load()).rejects.toThrow('journal unavailable');
    expect(self.configRegistry.get('sample')).toBe(existing);
    refuseWrites = false;
    await expect(load()).resolves.toEqual({ project: 'changed' });
    expect(invalidations).toEqual(['loadProjectConfig', 'loadProjectConfig']);
    expect(self.configRegistry.get('sample')?.config).toEqual({ project: 'changed' });
  } finally { source.mockRestore(); detach(); }
});
