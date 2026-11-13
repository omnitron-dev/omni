import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager, ProcessStatus, type IProcessPool, type ISpawnOptions, type IWorkerHandle } from '@omnitron-dev/titan-pm';
import { defineEcosystem } from '../../src/config/define-ecosystem.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import * as provenance from '../../src/release/runtime-provenance.js';

type WorkerExit = Parameters<Parameters<NonNullable<IWorkerHandle['onExit']>>[0]>[0];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const cleanups: Array<() => Promise<unknown>> = [];
beforeEach(() => { vi.stubEnv('NODE_OPTIONS', ''); vi.stubEnv('NODE_PATH', ''); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

/** Real owner launch, verifier, supervisor and pool. Only the native spawner is
 * substituted so readiness, exit and admission races can be controlled exactly. */
async function fixture(shape: 'mixed' | 'pool-only' = 'mixed') {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'installed-membership-')));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'release');
  await fs.mkdir(root, { mode: 0o700 });
  const bootstrap = path.join(root, 'bootstrap.mjs');
  const processes = [
    ...(shape === 'mixed' ? [{ name: 'api', module: './worker.mjs', health: { enabled: false } }] : []),
    { name: 'jobs', module: './worker.mjs', instances: 2, health: { enabled: false } },
  ];
  await fs.writeFile(bootstrap, `export default ${JSON.stringify({ name: 'api', version: '1', processes })};`);
  await fs.writeFile(path.join(root, 'worker.mjs'), 'export default class Worker {}');
  await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}');
  const receipt = { version: 1, root, origin: { app: 'api', releaseId: 'fixture-release',
    manifestSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64), artifactBytes: 100, frameworkCommit: 'c'.repeat(40) },
  frameworkContentUnchanged: true, installedFrameworkCommit: 'c'.repeat(40), artifactPayloadUnchanged: true,
  treeSha256: await provenance.releaseTreeDigest(root) };
  await fs.writeFile(path.join(root, provenance.RELEASE_RECEIPT), JSON.stringify(receipt), { mode: 0o600 });
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const pm = new ProcessManager(logger as never, { livenessSweepIntervalMs: 0 });
  const native = new Map<string, { exit: (expected: boolean) => void; terminate: ReturnType<typeof vi.fn>; isAlive: () => boolean }>();
  const spawn = vi.fn(async (_source: unknown, options: ISpawnOptions) => {
    const id = options.processId!;
    let alive = true;
    const listeners = new Set<(exit: WorkerExit) => void>();
    const exit = (expected: boolean) => {
      if (!alive) return;
      alive = false;
      for (const listener of listeners) listener({ workerId: id, serviceName: 'worker', code: expected ? 0 : 1, signal: null, expected });
    };
    const worker = { id, transportUrl: 'fixture://worker', serviceName: 'worker', serviceVersion: '1',
      status: ProcessStatus.RUNNING, isAlive: () => alive,
      proxy: { __processId: id, __getHealth: async () => ({ status: 'healthy', checks: [], timestamp: Date.now() }),
        __getMetrics: async () => ({}) },
      onExit: (listener: (event: WorkerExit) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      terminate: vi.fn(async () => { exit(true); }),
    };
    native.set(id, { exit, terminate: worker.terminate, isAlive: worker.isAlive });
    return worker;
  });
  Object.assign(pm, { spawner: { spawn } });
  const store = new DaemonStateStore(logger as never, path.join(directory, 'state.sqlite'));
  cleanups.push(() => store.dispose());
  const owner = new OrchestratorService(logger as never, pm, new StateStore(store), root);
  Object.assign(owner, { ensureBootReconciled: vi.fn(), ensureMetricsPolling: vi.fn(), persistState: vi.fn(),
    syncClassicWatches: vi.fn(), startPostOnlineCooldown: vi.fn(), bootstrapRuntime: async () => bootstrap });
  const handle = await owner.startApp({ name: 'sample/prod/api', cwd: root, releaseRoot: root, bootstrap,
    env: { NODE_OPTIONS: '', NODE_PATH: '', OMNITRON_STACK: 'prod' } },
  defineEcosystem({ apps: [] }));
  const pool = handle.topologyPools.get('jobs') as IProcessPool<unknown>;
  cleanups.push(async () => { handle.markStopping(); await handle.supervisor?.stop(); await pm.shutdown(); });
  expect(handle.status).toBe('online'); expect(handle.release.state).toBe('confirmed');
  const replace = (id = pool.getWorkerIds()[0]!) => (pool as unknown as { replaceWorker(id: string): Promise<void> }).replaceWorker(id);
  const confirmed = async () => { await vi.waitFor(() => expect(handle.release.state).toBe('confirmed'), { timeout: 3_000 }); };
  const checked = async () => {
    const launches = (owner as unknown as { installedLaunches: WeakMap<object, { membership?: { checking?: Promise<void> } }> }).installedLaunches;
    await launches.get(handle)?.membership?.checking;
  };
  return { root, owner, handle, pool, pm, native, spawn, replace, confirmed, checked, receipt };
}

/** Preserve the real verifier result but delay its return to expose owner races. */
function pauseVerification(call = 1) {
  const entered = deferred(), resume = deferred();
  const verify = provenance.verifyLaunchRelease;
  let count = 0;
  vi.spyOn(provenance, 'verifyLaunchRelease').mockImplementation(async (...args) => {
    const result = await verify(...args);
    if (++count === call) { entered.resolve(); await resume.promise; }
    return result;
  });
  return { entered, resume };
}

describe('installed application membership recovery', () => {
  it.each(['mixed', 'pool-only'] as const)('re-verifies %s topology replacements and observes the replacement’s later exit', async shape => {
    const f = await fixture(shape); const before = f.pool.getWorkerIds();
    await f.replace(before[0]); await f.confirmed();
    const replacement = f.pool.getWorkerIds().find(id => !before.includes(id))!;
    expect(replacement).toBeTruthy(); expect(f.native.get(before[0]!)!.isAlive()).toBe(false);
    f.native.get(replacement)!.exit(false);
    expect(f.handle.release.state).toBe('unreported');
    await f.replace(replacement); await f.confirmed();
    expect(f.pool.getWorkerIds()).not.toContain(replacement);
    expect(f.handle.release).toMatchObject({ treeSha256: f.receipt.treeSha256, launchId: f.handle.generation });
  });

  it('uses the same admission for a single supervisor replacement in a mixed topology', async () => {
    const f = await fixture(); const name = `${f.handle.name}/api`;
    const previous = f.handle.supervisor!.getChildProcessId(name);
    await f.handle.supervisor!.restartChild(name); await f.confirmed();
    expect(f.handle.supervisor!.getChildProcessId(name)).not.toBe(previous);
    await f.replace(); await f.confirmed();
  });

  it('rejects changed release bytes before replacement and keeps the old native worker alive', async () => {
    const f = await fixture(); const before = f.pool.getWorkerIds(), spawned = f.spawn.mock.calls.length;
    await fs.writeFile(path.join(f.root, 'worker.mjs'), 'export default class Changed {}');
    await expect(f.replace()).rejects.toThrow(/changed|verified/i);
    expect(f.spawn).toHaveBeenCalledTimes(spawned); expect(f.pool.getWorkerIds()).toEqual(before);
    for (const id of before) expect(f.native.get(id)!.isAlive()).toBe(true);
    expect(f.handle.release.state).not.toBe('confirmed');
  });

  it.each(['LD_PRELOAD', 'DYLD_INSERT_LIBRARIES'])('rejects changed parent %s before any replacement effects', async key => {
    const f = await fixture(); const before = f.pool.getWorkerIds(), spawned = f.spawn.mock.calls.length;
    vi.stubEnv(key, '/unverified/library');
    await expect(f.replace()).rejects.toThrow(key);
    expect(f.spawn).toHaveBeenCalledTimes(spawned); expect(f.pool.getWorkerIds()).toEqual(before);
    for (const id of before) expect(f.native.get(id)!.isAlive()).toBe(true);
    expect(f.handle.release.state).not.toBe('confirmed');
  });

  it.each(['definition', 'ABA', 'stop'] as const)('revokes an admission awaiting verification after %s change', async change => {
    const f = await fixture(); const spawned = f.spawn.mock.calls.length; const barrier = pauseVerification();
    const replacing = f.replace(); const rejected = expect(replacing).rejects.toThrow('lifecycle changed');
    await barrier.entered.promise;
    if (change === 'stop') f.handle.markStopping();
    else {
      const original = f.handle.entry;
      f.handle.redefine({ ...original, cwd: f.root + '/next' });
      if (change === 'ABA') f.handle.redefine(original);
    }
    barrier.resume.resolve(); await rejected;
    expect(f.spawn).toHaveBeenCalledTimes(spawned);
    for (const id of f.pool.getWorkerIds()) expect(f.native.get(id)!.isAlive()).toBe(true);
    expect(f.handle.release.state).not.toBe('confirmed');
  });

  it('does not publish a late receipt after another pool membership change, then verifies the final composition', async () => {
    const f = await fixture();
    const first = { entered: deferred(), resume: deferred() }, final = { entered: deferred(), resume: deferred() };
    const verify = provenance.verifyLaunchRelease; let calls = 0;
    vi.spyOn(provenance, 'verifyLaunchRelease').mockImplementation(async (...args) => {
      const result = await verify(...args);
      const barrier = ++calls === 2 ? first : calls === 4 ? final : undefined;
      if (barrier) { barrier.entered.resolve(); await barrier.resume.promise; }
      return result;
    });
    await f.replace(); await first.entered.promise;
    await f.pool.scale(3);
    expect(f.handle.release.state).not.toBe('confirmed');
    first.resume.resolve(); await final.entered.promise;
    expect(f.handle.release.state).not.toBe('confirmed');
    final.resume.resolve(); await f.confirmed();
    expect(f.pool.getWorkerIds()).toHaveLength(3); expect(f.pool.membershipChanging).toBe(false);
  });

  it('refuses the same process ID bound to another native handle while a proof awaits', async () => {
    const f = await fixture(); const barrier = pauseVerification(2);
    await f.replace(); await barrier.entered.promise;
    const id = f.pool.getWorkerIds()[0]!;
    const nativeHandles = (f.pm as unknown as { workers: Map<string, IWorkerHandle> }).workers;
    const original = nativeHandles.get(id)!;
    nativeHandles.set(id, { ...original });
    barrier.resume.resolve();
    await f.checked();
    expect(f.handle.release.state).not.toBe('confirmed');
    expect(f.handle.release).toMatchObject({ reason: expect.stringContaining('membership changed') });
    nativeHandles.set(id, original);
  });

  it('keeps uncertain retirement unconfirmed and reuses its already admitted replacement on retry', async () => {
    const f = await fixture(); const old = f.pool.getWorkerIds()[0]!;
    f.native.get(old)!.terminate.mockRejectedValueOnce(new Error('exit not confirmed'));
    await expect(f.replace(old)).rejects.toThrow('exit not confirmed');
    expect(f.pool.getWorkerIds()).toHaveLength(3); expect(f.pool.membershipChanging).toBe(true);
    expect(f.handle.release.state).not.toBe('confirmed');
    const spawned = f.spawn.mock.calls.length;
    await f.replace(old); await f.confirmed();
    expect(f.spawn).toHaveBeenCalledTimes(spawned); expect(f.pool.getWorkerIds()).toHaveLength(2);
  });

  it('verifies surviving composition after a partial resize rejects without claiming the requested count', async () => {
    const f = await fixture();
    f.spawn.mockRejectedValueOnce(new Error('native capacity unavailable'));
    await expect(f.pool.scale(4)).rejects.toThrow('native capacity unavailable');
    expect(f.pool.size).toBe(3);
    await f.confirmed();
    expect(f.pool.size).not.toBe(4); expect(f.pool.membershipChanging).toBe(false);
    for (const id of f.pool.getWorkerIds()) expect(f.pm.getWorkerHandle(id)!.isAlive()).toBe(true);
  });

  it('does not restore a receipt if teardown starts while the final verification awaits', async () => {
    const f = await fixture(); const barrier = pauseVerification(2);
    await f.replace(); await barrier.entered.promise;
    f.handle.markStopping(); await f.pool.destroy();
    barrier.resume.resolve();
    await f.checked();
    expect(f.handle.release.state).not.toBe('confirmed'); expect(f.pool.getWorkerIds()).toEqual([]);
  });

  it('detects changed bytes between admitted spawn and composition verification', async () => {
    const f = await fixture(); const realSpawn = f.spawn.getMockImplementation()!;
    f.spawn.mockImplementationOnce(async (...args) => {
      const worker = await realSpawn(...args);
      await fs.writeFile(path.join(f.root, 'worker.mjs'), 'export default class ChangedAfterAdmission {}');
      return worker;
    });
    await f.replace();
    await f.checked();
    expect(f.handle.release.state).not.toBe('confirmed');
    expect(f.handle.release).toMatchObject({ reason: expect.stringMatching(/changed|verified/i) });
  });
});
