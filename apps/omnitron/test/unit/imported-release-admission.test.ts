import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ProjectService } from '../../src/services/project.service.js';
const loaded = vi.hoisted(() => ({ manifest: { artifacts: [] as unknown[] } }));
vi.mock('../../src/release/load.js', () => ({ loadRelease: async () => loaded, treeEqualsCommit: () => { throw Error('Unexpected working-tree inspection'); } }));

describe('imported application remote boundary', () => {
  it.each([true, false])('refuses unsupported remote declarations before reading code or reaching a node (config import %s)', async (configured) => {
    const ref = { release: 'producer-1', manifestSha256: 'a'.repeat(64), app: 'api' };
    loaded.manifest.artifacts = [{ app: 'api', origin: ref }];
    const entries = [{ name: 'api', ...(configured ? { releaseFrom: ref } : { bootstrap: '/must-not-execute.js' }) }];
    const nodes = vi.fn(), readDefinitions = vi.fn();
    const service = Object.assign(Object.create(ProjectService.prototype) as ProjectService, {
      releaseStore: async () => '/unused', resolveStackApps: () => entries,
      askReleaseOwners: nodes, loadAppDefinitions: readDefinitions,
    });
    await expect(service['admitRelease']('consumer', 'test', { type: 'remote' }, { apps: entries }, 'consumer-1', 'check'))
      .rejects.toThrow('producer-captured deployment declarations');
    expect(nodes).not.toHaveBeenCalled();
    expect(readDefinitions).not.toHaveBeenCalled();
  });
});
