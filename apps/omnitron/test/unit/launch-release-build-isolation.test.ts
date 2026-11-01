import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

describe('precompiled release launch', () => {
  it('discards a prior source build and its watcher before selecting the installed executable', async () => {
    const name = 'sample/test/api';
    const unwatchApp = vi.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(OrchestratorService.prototype), {
      devMode: false,
      buildService: { unwatchApp },
      buildResults: new Map([[name, { bootstrapPath: '/old/generated/bootstrap.js' }]]),
      bootstrapSources: new Map([[name, { path: '/old/source/bootstrap.ts' }]]),
    });
    await service.prepareBootstrapBuild({ name, bootstrap: '/installed/dist/bootstrap.js' }, '/installed/dist/bootstrap.js', {
      processes: [{ name: 'server', module: './server.js' }],
    });
    expect(unwatchApp).toHaveBeenCalledWith(name);
    expect(service.buildResults.has(name)).toBe(false);
    expect(service.bootstrapSources.has(name)).toBe(false);
  });
});
