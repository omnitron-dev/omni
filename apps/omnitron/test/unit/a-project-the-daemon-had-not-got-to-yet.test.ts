/**
 * A project the daemon had not got to yet.
 *
 * In the first seconds after a daemon start, `getStack` found no loaded
 * config and threw «Project 'daos' config not loaded»; `listStacks` answered
 * `[]`, which reads as «no stacks». Measured on the master restarted at
 * 12:07:48 UTC: 20 ERROR lines from the console's polls, counted by `doctor`
 * as server failures, for a project that loads a moment later. Readers now
 * load it on demand, once however many arrive together.
 */
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';

import { ProjectService } from '../../src/services/project.service.js';

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
    const { ensure } = serviceWith(async () => ({ project: 'daos' }));
    await expect(ensure('daos')).resolves.toEqual({ project: 'daos' });
  });

  it('loads it once for readers that arrive together, and not again after', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { ensure, load } = serviceWith(async () => {
      await gate;
      return { project: 'daos' };
    });

    const both = Promise.all([ensure('daos'), ensure('daos')]);
    release();
    await both;
    await ensure('daos');

    expect(load).toHaveBeenCalledTimes(1);
  });
});
