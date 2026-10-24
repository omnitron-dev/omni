import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { launchClassic } from '../../src/orchestrator/classic-launcher.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function harness() {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const pm = { shutdown: vi.fn(async () => {}) };
  const service = new OrchestratorService(logger, pm as never, { save: vi.fn() } as never, process.cwd());
  const state = service as any;
  return { service, state, logger, pm };
}

describe('shutdown owns all registered projects', () => {
  it('reaps real classic processes outside the root ecosystem', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-shutdown-'));
    cleanups.push(async () => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'server.cjs');
    fs.writeFileSync(file, `process.on('SIGTERM', () => process.exit(0)); process.send({type:'ready'}); setInterval(() => {}, 1000);`);
    const { service, state, logger } = harness();
    state.config = { apps: [{ name: 'root/local/api', script: file }] };
    const pids: number[] = [];
    for (const name of ['root/local/api', 'registered/local/core']) {
      const handle = new AppHandle({ name, script: file }, 'classic');
      state.handles.set(name, handle);
      const child = await launchClassic(handle.entry, handle, root, logger);
      handle.markOnline(child.pid!);
      pids.push(child.pid!);
      cleanups.push(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill('SIGKILL'); await ended;
        }
      });
    }
    expect(await service.stopAll()).toBe(2);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    expect([...state.handles.values()].map((h: AppHandle) => h.status)).toEqual(['stopped', 'stopped']);
  });

  it('stops bootstrap supervision and pools without a root config', async () => {
    const { service, state, pm } = harness();
    const handle = new AppHandle({ name: 'project/local/worker' }, 'bootstrap');
    handle.status = 'online';
    const stop = vi.fn(async () => {}), destroy = vi.fn(async () => {});
    handle.supervisor = { stop } as never;
    handle.topologyPools.set('pool', { destroy } as never);
    state.handles.set(handle.name, handle);
    expect(await service.stopAll()).toBe(1);
    expect(stop).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
    expect(pm.shutdown).toHaveBeenCalledOnce(); expect(handle.status).toBe('stopped');
  });

  it('resolves dependencies in their own project and stops consumers first', async () => {
    const { service, state } = harness();
    const stopped: string[] = [];
    for (const project of ['first', 'second']) {
      for (const name of ['core', 'api']) {
        const entry = { name: `${project}/local/${name}`, dependsOn: name === 'api' ? ['core', 'not-started'] : [] };
        const handle = new AppHandle(entry, 'bootstrap'); handle.status = 'online';
        handle.supervisor = { stop: async () => { stopped.push(entry.name); } } as never;
        state.handles.set(entry.name, handle);
      }
    }
    expect(await service.stopAll()).toBe(4);
    for (const project of ['first', 'second']) expect(stopped.indexOf(`${project}/local/api`)).toBeLessThan(stopped.indexOf(`${project}/local/core`));
  });

  it('does not leak owned processes if a redefinition introduces a dependency cycle', async () => {
    const { service, state, logger } = harness();
    const stopped: string[] = [];
    for (const [name, dependency] of [['a', 'b'], ['b', 'a']]) {
      const handle = new AppHandle({ name, dependsOn: [dependency] }, 'bootstrap'); handle.status = 'online';
      handle.supervisor = { stop: async () => { stopped.push(name); } } as never;
      state.handles.set(name, handle);
    }
    expect(await service.stopAll()).toBe(2);
    expect(stopped.sort()).toEqual(['a', 'b']); expect(logger.error).toHaveBeenCalledOnce();
  });
});
