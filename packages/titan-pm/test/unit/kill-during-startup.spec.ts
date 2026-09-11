/**
 * Killing a process that has not finished starting must actually kill it.
 *
 * `kill()` terminates `this.workers.get(processId)`, and that entry is written
 * only after `spawner.spawn()` resolves — which is after the child has booted
 * its whole Application. For the whole of that window (tens of seconds for a
 * real backend) `kill()` found nothing to terminate, deleted the bookkeeping
 * anyway and returned `true`. The child went on booting, bound its port, and
 * then the tail of `spawn()` — still running — registered it as RUNNING.
 *
 * `shutdown()` kills every entry in `this.processes`, PENDING ones included,
 * so a stack stopped while anything was still coming up reported success and
 * left that child alive.
 */
import { describe, it, expect, vi } from 'vitest';

import { ProcessManager } from '../../src/process-manager.js';
import { ProcessStatus } from '../../src/types.js';

const noopLogger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
};

class SlowService {
  ping() {
    return 'pong';
  }
}

/** A spawner that hands back its handle only when the test says so. */
function gatedSpawner() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const terminate = vi.fn(async () => undefined);
  const handle: any = {
    id: 'worker-1',
    pid: 4242,
    status: ProcessStatus.RUNNING,
    terminate,
    onExit: () => undefined,
    proxy: { ping: async () => 'pong' },
  };
  const spawner: any = {
    spawn: vi.fn(async () => {
      await gate;
      return handle;
    }),
  };
  return { spawner, release, terminate, handle };
}

function makeManager(spawner: any) {
  const pm = new ProcessManager(noopLogger, { livenessSweepIntervalMs: 1_000_000 } as any);
  (pm as any).spawner = spawner;
  return pm;
}

describe('kill() during startup', () => {
  it('terminates the child once the spawn produces a handle, and reports it stopped', async () => {
    const { spawner, release, terminate } = gatedSpawner();
    const pm = makeManager(spawner);

    let processId = '';
    pm.on('process:spawn', (info: any) => {
      processId = info.id;
    });

    const spawning = pm.spawn(SlowService as any, { name: 'slow' }).catch((e) => e);
    await Promise.resolve();
    expect(processId).not.toBe('');
    expect(pm.getProcess(processId)?.status).toBe(ProcessStatus.STARTING);

    // The kill lands while the child is still booting — nothing to terminate yet.
    const killing = pm.kill(processId);
    await Promise.resolve();
    expect(terminate).not.toHaveBeenCalled();

    // The spawn completes. The kill must be honoured here or never.
    release();
    const killed = await killing;

    expect(killed).toBe(true);
    expect(terminate).toHaveBeenCalledTimes(1);

    const err = await spawning;
    expect(err).toBeInstanceOf(Error);
    expect((err as any).stoppedDuringStartup).toBe(true);

    // Not FAILED — nothing failed. And above all not RUNNING.
    expect(pm.getProcess(processId)?.status).toBe(ProcessStatus.STOPPED);
    expect(pm.listProcesses().filter((p) => p.status === ProcessStatus.RUNNING)).toHaveLength(0);
  });

  it('does not resolve kill() before the child is really dead', async () => {
    const { spawner, release, terminate } = gatedSpawner();
    const pm = makeManager(spawner);

    let processId = '';
    pm.on('process:spawn', (info: any) => {
      processId = info.id;
    });
    void pm.spawn(SlowService as any, { name: 'slow' }).catch(() => undefined);
    await Promise.resolve();

    let killSettled = false;
    const killing = pm.kill(processId).then((r) => {
      killSettled = true;
      return r;
    });

    // Give the event loop several turns: with no handle to terminate, the
    // unfixed kill() ran straight to `return true` here.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(killSettled).toBe(false);

    release();
    await killing;
    expect(killSettled).toBe(true);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('shutdown() waits for a child that is still starting', async () => {
    const { spawner, release, terminate } = gatedSpawner();
    const pm = makeManager(spawner);

    void pm.spawn(SlowService as any, { name: 'slow' }).catch(() => undefined);
    await Promise.resolve();

    let down = false;
    const shutting = pm.shutdown({ timeout: 5_000 }).then(() => {
      down = true;
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(down).toBe(false);

    release();
    await shutting;
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(pm.listProcesses().some((p) => p.status === ProcessStatus.RUNNING)).toBe(false);
  });

  it('leaves an ordinary spawn untouched', async () => {
    const { spawner, release, terminate } = gatedSpawner();
    const pm = makeManager(spawner);

    let processId = '';
    pm.on('process:spawn', (info: any) => {
      processId = info.id;
    });
    const spawning = pm.spawn(SlowService as any, { name: 'slow' });
    await Promise.resolve();
    release();
    await spawning;

    expect(terminate).not.toHaveBeenCalled();
    expect(pm.getProcess(processId)?.status).toBe(ProcessStatus.RUNNING);
  });
});
