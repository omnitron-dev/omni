import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import type { IEcosystemAppEntry } from '../../src/config/types.js';

interface RefreshInternals {
  handles: Map<string, AppHandle>;
  getCoalescerState(name: string): { cooldownUntil: number };
  tearDownApp(handle: AppHandle): Promise<void>;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function fixture() {
  const store = { save: vi.fn(), getExecutionIntent: () => ({ phase: 'running', revision: 0 }),
    getStackIntent: () => ({ phase: 'running', revision: 0 }) };
  const service = new OrchestratorService(createNullLogger(), {} as never, store as never, process.cwd());
  service.devMode = true;
  const internals = service as unknown as RefreshInternals;
  const entry: IEcosystemAppEntry = { name: 'fixture/local/site', cwd: '/fixture/source-a', script: 'main.js' };
  function register(next: IEcosystemAppEntry) {
    const handle = new AppHandle(next, 'classic');
    handle.status = 'online';
    internals.handles.set(next.name, handle);
    return handle;
  }
  const original = register(entry);
  const expected = { generation: original.generation, definitionRevision: original.definitionRevision };
  // Keep the actual admission, lifecycle queue, stop intent and coalescer.
  // Replace only OS process teardown and spawn; this fixture has no live processes.
  const stop = vi.spyOn(internals, 'tearDownApp').mockResolvedValue(undefined);
  const start = vi.spyOn(service, 'startApp').mockImplementation(async next => register(next));
  // Native subscriptions have their own lifecycle tests. Observe this fixture's
  // simulated resources through the same owner API, with current handle bindings.
  const watching = vi.spyOn(service, 'getWatchedApps').mockImplementation(() => [...internals.handles.values()]
    .filter(handle => service.devMode && handle.entry.watch !== false && !handle.entry.releaseRoot)
    .map(handle => ({ name: handle.name, directory: handle.entry.cwd!, generation: handle.generation,
      definitionRevision: handle.definitionRevision })));
  return { service, internals, entry, original, expected, stop, start, watching, register };
}

function outcome<T>(promise: Promise<T>) {
  return promise.then(value => ({ value }), error => ({ error }));
}

describe('owner source-refresh binding and queued policy', () => {
  it('rejects a source-binding alias before replacing the canonical application', async () => {
    const run = fixture();
    await expect(run.service.restartAfterChange('site', run.expected)).rejects.toThrow(/canonical application name/);
    expect(run.stop).not.toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
    expect(run.original.status).toBe('online');
  });

  it.each(['generation', 'definition revision'] as const)('refuses a stale %s before process effects', async stale => {
    const run = fixture();
    const expected = { ...run.expected, ...(stale === 'generation'
      ? { generation: 'retired-generation' } : { definitionRevision: run.expected.definitionRevision + 1 }) };
    await expect(run.service.restartAfterChange(run.entry.name, expected)).rejects.toThrow(/source binding changed/);
    expect(run.stop).not.toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
    expect(run.service.getHandle(run.entry.name)).toBe(run.original);
    expect(run.original.status).toBe('online');
  });

  it.each(['new path', 'same definition', 'A to B to A'] as const)(
    'revokes a queued refresh on redefinition, including %s', async change => {
      vi.useFakeTimers();
      const run = fixture();
      run.internals.getCoalescerState(run.entry.name).cooldownUntil = Date.now() + 1000;
      const pending = outcome(run.service.restartAfterChange(run.entry.name, run.expected));
      await run.service.redefineApp(run.entry.name, change === 'same definition' ? run.entry
        : { ...run.entry, cwd: '/fixture/source-b' });
      if (change === 'A to B to A') await run.service.redefineApp(run.entry.name, run.entry);
      await vi.advanceTimersByTimeAsync(1100);
      expect(await pending).toHaveProperty('error');
      expect(run.stop).not.toHaveBeenCalled();
      expect(run.start).not.toHaveBeenCalled();
      expect(run.service.getHandle(run.entry.name)).toBe(run.original);
      expect(run.original.status).toBe('online');
    });

  it.each(['global disable', 'watch false', 'installed release'] as const)(
    'does not turn a revoked %s request into a manual restart', async policy => {
      vi.useFakeTimers();
      const run = fixture();
      run.internals.getCoalescerState(run.entry.name).cooldownUntil = Date.now() + 1000;
      const pending = outcome(run.service.restartAfterChange(run.entry.name, run.expected));
      if (policy === 'global disable') {
        await run.service.setWatchMode(false);
        await run.service.setWatchMode(true);
      } else {
        await run.service.redefineApp(run.entry.name, { ...run.entry,
          ...(policy === 'watch false' ? { watch: false } : { releaseRoot: '/fixture/installed' }) });
      }
      await vi.advanceTimersByTimeAsync(1100);
      expect(await pending).toHaveProperty('error');
      expect(run.stop).not.toHaveBeenCalled();
      expect(run.start).not.toHaveBeenCalled();
      expect(run.original.status).toBe('online');
      if (policy === 'global disable') {
        await run.service.restartApp(run.entry.name);
        expect(run.start).toHaveBeenCalledExactlyOnceWith(run.entry);
      }
    });

  it('does not resurrect an app removed while the source request waits', async () => {
    vi.useFakeTimers();
    const run = fixture();
    run.internals.getCoalescerState(run.entry.name).cooldownUntil = Date.now() + 1000;
    const pending = outcome(run.service.restartAfterChange(run.entry.name, run.expected));
    run.internals.handles.delete(run.entry.name);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await pending).toHaveProperty('error');
    expect(run.stop).not.toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
    expect(run.service.getHandle(run.entry.name)).toBeUndefined();
  });

  it('allows a genuine new source event without reviving the older request', async () => {
    vi.useFakeTimers();
    const run = fixture();
    run.internals.getCoalescerState(run.entry.name).cooldownUntil = Date.now() + 1000;
    const oldRequest = outcome(run.service.restartAfterChange(run.entry.name, run.expected));
    const next = { ...run.entry, cwd: '/fixture/source-b' };
    await run.service.redefineApp(run.entry.name, next);
    const currentBinding = { generation: run.original.generation, definitionRevision: run.original.definitionRevision };
    const newRequest = outcome(run.service.restartAfterChange(run.entry.name, currentBinding));
    await vi.advanceTimersByTimeAsync(1100);
    expect(await oldRequest).toHaveProperty('error');
    expect(await newRequest).toMatchObject({ value: {
      process: { status: 'online', name: next.name }, source: { directory: next.cwd },
    } });
    expect(run.stop).toHaveBeenCalledTimes(1);
    expect(run.start).toHaveBeenCalledExactlyOnceWith(next);
    expect(run.service.getHandle(next.name)!.generation).not.toBe(currentBinding.generation);
  });

  it('refuses a no-op result even when the old generation remains online', async () => {
    const run = fixture();
    run.start.mockImplementationOnce(async () => { run.original.status = 'online'; return run.original; });
    await expect(run.service.restartAfterChange(run.entry.name, run.expected)).rejects.toThrow(/cancelled|binding changed/);
    expect(run.original.status).toBe('online');
    expect(run.original.generation).toBe(run.expected.generation);
  });

  it('does not acknowledge a native source event revoked during cooldown', async () => {
    vi.useFakeTimers();
    const run = fixture();
    run.internals.getCoalescerState(run.entry.name).cooldownUntil = Date.now() + 1000;
    const pending = run.service.restartAfterChange(run.entry.name);
    await run.service.redefineApp(run.entry.name, run.entry);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(pending).resolves.toBeUndefined();
    expect(run.stop).not.toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
    expect(run.original.status).toBe('online');
  });

  it('rejects a vanished watcher before process effects', async () => {
    const run = fixture();
    run.watching.mockReturnValue([]);
    await expect(run.service.restartAfterChange(run.entry.name, run.expected)).rejects.toThrow(/watch/i);
    expect(run.stop).not.toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
    expect(run.original.status).toBe('online');
  });

  it('does not certify SDK readiness when the replacement has lost its watcher', async () => {
    const run = fixture();
    run.start.mockImplementationOnce(async next => {
      const handle = run.register(next);
      run.watching.mockReturnValue([]);
      return handle;
    });
    await expect(run.service.restartAfterChange(run.entry.name, run.expected)).rejects.toThrow(/watch/i);
    expect(run.stop).toHaveBeenCalledTimes(1);
    expect(run.start).toHaveBeenCalledExactlyOnceWith(run.entry);
    const current = run.service.getHandle(run.entry.name)!;
    expect(current.status).toBe('online');
    expect(current.generation).not.toBe(run.expected.generation);
  });

  it('finishes an admitted child replacement but refuses readiness after global watch revocation', async () => {
    const run = fixture();
    let enteredStop!: () => void, finishStop!: () => void;
    const stopping = new Promise<void>(resolve => { enteredStop = resolve; });
    run.stop.mockImplementationOnce(async () => {
      enteredStop();
      await new Promise<void>(resolve => { finishStop = resolve; });
    });
    const pending = outcome(run.service.restartAfterChange(run.entry.name, run.expected));
    await stopping;
    await run.service.setWatchMode(false);
    finishStop();
    expect(await pending).toHaveProperty('error');
    expect(run.start).toHaveBeenCalledExactlyOnceWith(run.entry);
    expect(run.service.getHandle(run.entry.name)!.status).toBe('online');
    expect(run.service.devMode).toBe(false);
  });

  it('preserves a second source event received while the replacement is starting', async () => {
    const run = fixture();
    let enteredSpawn!: () => void, finishSpawn!: () => void;
    const spawning = new Promise<void>(resolve => { enteredSpawn = resolve; });
    run.start.mockImplementationOnce(async next => {
      const handle = run.register(next);
      handle.markStarting();
      enteredSpawn();
      await new Promise<void>(resolve => { finishSpawn = resolve; });
      handle.status = 'online';
      return handle;
    });
    const first = outcome(run.service.restartAfterChange(run.entry.name));
    await spawning;
    const intermediate = run.service.getHandle(run.entry.name)!;
    const second = outcome(run.service.restartAfterChange(run.entry.name));
    finishSpawn();
    expect(await first).toHaveProperty('value');
    expect(await second).toHaveProperty('value');
    expect(run.stop).toHaveBeenCalledTimes(2);
    expect(run.start).toHaveBeenCalledTimes(2);
    expect(run.start).toHaveBeenNthCalledWith(1, run.entry);
    expect(run.start).toHaveBeenNthCalledWith(2, run.entry);
    const final = run.service.getHandle(run.entry.name)!;
    expect(final.status).toBe('online');
    expect(final.generation).not.toBe(run.original.generation);
    expect(final.generation).not.toBe(intermediate.generation);
  });

  it('confirms a new online generation from the same admitted source', async () => {
    const run = fixture();
    const refreshed = await run.service.restartAfterChange(run.entry.name, run.expected);
    expect(refreshed?.process).toEqual(run.service.getApp(run.entry.name));
    expect(refreshed?.process.status).toBe('online');
    expect(refreshed?.source).toEqual(run.service.getWatchedApps()[0]);
    expect(refreshed?.source.generation).not.toBe(run.expected.generation);
    expect(run.service.getHandle(run.entry.name)?.entry).toBe(run.entry);
    expect(run.stop).toHaveBeenCalledExactlyOnceWith(run.original, false, 10_000);
    expect(run.start).toHaveBeenCalledExactlyOnceWith(run.entry);
  });
});
