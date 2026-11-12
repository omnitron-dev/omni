import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { defineEcosystem } from '../../src/config/define-ecosystem.js';
import type { IEcosystemAppEntry } from '../../src/config/types.js';

function fixture() {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const state = { save: vi.fn() };
  const owner = new OrchestratorService(logger as never, {} as never, state as never);
  const effects = { ensureBootReconciled: vi.fn(), ensureMetricsPolling: vi.fn(), persistState: vi.fn(),
    launchClassicMode: vi.fn(), launchBootstrapMode: vi.fn(), tearDownApp: vi.fn(), stopAppQueued: vi.fn(),
    syncClassicWatches: vi.fn(), syncBootstrapWatch: vi.fn() };
  Object.assign(owner, effects);
  const handles = (owner as unknown as { handles: Map<string, AppHandle> }).handles;
  return { owner, effects, state, handles };
}

function historical(mode: 'classic' | 'bootstrap', instances: unknown): IEcosystemAppEntry {
  // Persisted JSON can contain fields that are no longer in the authoring API.
  return JSON.parse(JSON.stringify({ name: 'sample',
    ...(mode === 'classic' ? { script: './main.js' } : { bootstrap: './bootstrap.js' }), instances })) as IEcosystemAppEntry;
}

describe('application instance admission', () => {
  for (const mode of ['classic', 'bootstrap'] as const) {
    it.each([0, 2, -1, 1.5, '2', null])(`refuses ${mode} multiplier %j before lifecycle, metadata or process effects`, async count => {
      const f = fixture();
      await expect(f.owner.startApp(historical(mode, count), defineEcosystem({ apps: [] })))
        .rejects.toThrow('Declare process.instances');
      for (const effect of Object.values(f.effects)) expect(effect).not.toHaveBeenCalled();
      expect(f.state.save).not.toHaveBeenCalled(); expect(f.handles.size).toBe(0);
    });

    it.each([undefined, 1])(`admits the ${mode} default %j without inventing an application multiplier`, async count => {
      const f = fixture();
      const handle = await f.owner.startApp(historical(mode, count), defineEcosystem({ apps: [] }));
      expect(f.effects[mode === 'classic' ? 'launchClassicMode' : 'launchBootstrapMode']).toHaveBeenCalledOnce();
      expect(handle.instanceCount).toBe(1); expect(f.owner.getApp(handle.name)?.instances).toBe(1);
    });
  }

  it('preflights all enabled declarations before startAll can reconcile or start a sibling', async () => {
    const f = fixture();
    const config = { ...defineEcosystem({ apps: [] }), apps: [{ name: 'valid', script: './main.js' }, historical('bootstrap', 2)] };
    // A retained observation can still contain historical fields; admission must validate it.
    expect(config.apps[1]).toMatchObject({ instances: 2 });
    await expect(f.owner.startAll(config)).rejects.toThrow('app-level instances');
    for (const effect of Object.values(f.effects)) expect(effect).not.toHaveBeenCalled();
    expect(f.handles.size).toBe(0);
  });

  it('refuses restarting an unsupported persisted entry before stopping its current process', async () => {
    const f = fixture(); const handle = new AppHandle(historical('classic', 2), 'classic');
    handle.status = 'online'; f.handles.set(handle.name, handle);
    expect(f.owner.getHandle(handle.name)?.entry).toMatchObject({ instances: 2 });
    expect(f.owner.getApp(handle.name)?.status).toBe('online');
    await expect(f.owner.restartApp(handle.name)).rejects.toThrow('app-level instances');
    expect(f.effects.stopAppQueued).not.toHaveBeenCalled(); expect(f.effects.tearDownApp).not.toHaveBeenCalled();
    expect(handle.status).toBe('online'); expect(f.handles.get(handle.name)).toBe(handle);
  });

  it('refuses redefining a running entry without touching its next-start definition or watcher', async () => {
    const f = fixture(); const entry = historical('bootstrap', undefined);
    const handle = new AppHandle(entry, 'bootstrap'); handle.status = 'online'; f.handles.set(handle.name, handle);
    await expect(f.owner.redefineApp(handle.name, historical('bootstrap', 2))).rejects.toThrow('app-level instances');
    expect(handle.entry).toBe(entry); expect(handle.definitionRevision).toBe(0);
    expect(f.effects.syncClassicWatches).not.toHaveBeenCalled(); expect(f.effects.syncBootstrapWatch).not.toHaveBeenCalled();
  });

  it('revalidates an entry changed while the ordinary start awaited boot reconciliation', async () => {
    const f = fixture(); let release!: () => void;
    f.effects.ensureBootReconciled.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const entry = historical('classic', 1);
    const starting = f.owner.startApp(entry, defineEcosystem({ apps: [] }));
    const refused = expect(starting).rejects.toThrow('app-level instances');
    Object.assign(entry, { instances: 2 }); release(); await refused;
    expect(f.effects.launchClassicMode).not.toHaveBeenCalled(); expect(f.effects.tearDownApp).not.toHaveBeenCalled();
    expect(f.handles.size).toBe(0);
  });
});
