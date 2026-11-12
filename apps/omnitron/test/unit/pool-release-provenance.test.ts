import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

function observePool() {
  const handle = new AppHandle({ name: 'sample/prod/api', bootstrap: '/installed/bootstrap.js' }, 'bootstrap');
  handle.release = { state: 'confirmed', releaseId: 'sample-release', manifestSha256: 'a'.repeat(64),
    artifactSha256: 'b'.repeat(64), launchId: handle.generation, observedAt: new Date().toISOString(), basis: 'verified-launch' };
  const pool = new EventEmitter();
  const exits = new EventEmitter();
  const workers = new Map([['worker-1', { isAlive: () => true, onExit: (listener: () => void) => exits.on('exit', listener) }]]);
  // pm.pool() completes initial worker creation before returning the pool.
  pool.emit('worker:spawned', { workerId: 'worker-1' });
  const source = Object.assign(pool, { getWorkerIds: () => [...workers.keys()], getWorkerHandle: (id: string) => workers.get(id) });
  const orchestrator = Object.assign(Object.create(OrchestratorService.prototype), {
    installedLaunches: new WeakMap(), persistState: () => {}, pm: { getWorkerHandle: (id: string) => workers.get(id) },
  }) as {
    observePoolReleaseMembership(handle: AppHandle, pool: typeof source): void;
  };
  return { handle, pool, exits, workers, attach: () => orchestrator.observePoolReleaseMembership(handle, source) };
}

describe('topology pool launch identity', () => {
  it('preserves the initial launch proof and invalidates it when a replacement worker is admitted', () => {
    const f = observePool(); f.attach();
    expect(f.handle.release.state).toBe('confirmed');
    f.pool.emit('worker:spawned', { workerId: 'worker-2' });
    expect(f.handle.release.state).toBe('unreported');
  });

  it('invalidates on worker exit before delayed health replacement begins', () => {
    const f = observePool(); f.attach();
    f.exits.emit('exit');
    expect(f.handle.release.state).toBe('unreported');
  });

  it.each(['worker:shutdown', 'worker:replaced', 'pool:scaled', 'pool:destroyed'])('invalidates on %s', event => {
    const f = observePool(); f.attach();
    f.pool.emit(event);
    expect(f.handle.release.state).toBe('unreported');
  });

  it('does not confirm membership when an initial worker cannot report its exit', () => {
    const f = observePool(); f.workers.set('worker-1', {} as never); f.attach();
    expect(f.handle.release.state).toBe('unreported');
  });
});
