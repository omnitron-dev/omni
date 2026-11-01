import { describe, expect, it, vi, beforeEach } from 'vitest';

const fixture = vi.hoisted(() => ({ detected: null as { name: string } | null, registered: [] as Array<{ name: string }>,
  file: null as string | null, load: vi.fn(), fallback: vi.fn() }));
vi.mock('../../src/project/registry.js', () => ({ ProjectRegistry: { open: () => ({ autoDetect: () => fixture.detected,
  list: () => fixture.registered, getConfigPath: () => fixture.file }) } }));
vi.mock('../../src/config/loader.js', () => ({ loadEcosystemConfigFile: fixture.load, loadDaemonBootConfig: fixture.fallback }));
vi.mock('../../src/config/saved.js', () => ({ readSavedDaemonConfig: () => ({ role: 'slave' }), savedDaemonOverrides: () => ({ role: 'slave' }), ensurePersistedJwtSecret: () => 'test-only' }));
import { loadStartupConfig } from '../../src/daemon/startup-config.js';

beforeEach(() => { fixture.detected = null; fixture.registered = []; fixture.file = null; fixture.load.mockReset(); fixture.fallback.mockReset(); });
describe('registered cold-start identity', () => {
  it('retains the registered project for generated configs without a project field', async () => {
    fixture.registered = [{ name: 'sample' }]; fixture.file = '/registered/omnitron.config.mjs';
    fixture.load.mockResolvedValue({ apps: [{ name: 'api', bootstrap: '/artifact/bootstrap.js' }], stacks: { deployed: {} } });
    const result = await loadStartupConfig('/root');
    expect(result.config.project).toBe('sample');
    expect(fixture.load).toHaveBeenCalledWith(fixture.file);
    expect(fixture.fallback).not.toHaveBeenCalled();
  });
  it('preserves a configuration runtime alias rather than renaming its processes to the public project', async () => {
    fixture.detected = { name: 'sample--test' }; fixture.file = '/registered/test/omnitron.config.mjs';
    fixture.load.mockResolvedValue({ project: 'sample', apps: [], stacks: { dev: {} } });
    expect((await loadStartupConfig('/registered/test')).config.project).toBe('sample--test');
  });
  it('refuses a disappeared registered config rather than loading an unrelated cwd config', async () => {
    fixture.registered = [{ name: 'sample' }]; fixture.file = '/registered/missing.mjs';
    fixture.load.mockRejectedValue(new Error('registered configuration missing'));
    await expect(loadStartupConfig('/another-project')).rejects.toThrow('configuration missing');
    expect(fixture.fallback).not.toHaveBeenCalled();
  });
  it('leaves an unregistered raw config unscoped', async () => {
    fixture.fallback.mockResolvedValue({ apps: [] });
    expect((await loadStartupConfig('/unregistered')).config.project).toBeUndefined();
    expect(fixture.fallback).toHaveBeenCalledWith(null, '/unregistered');
  });
});
