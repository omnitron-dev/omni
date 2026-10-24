import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { BuildService } from '../../src/orchestrator/build-service.js';
import type { IEcosystemAppEntry, IAppDefinition } from '../../src/config/types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
function harness() {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = () => logger;
  const service = new OrchestratorService(logger, {} as never, {} as never, process.cwd());
  service.devMode = true;
  const internals = service as any;
  cleanups.push(async () => { await internals.buildService?.dispose(); });
  const add = (entry: IEcosystemAppEntry) => {
    const handle = new AppHandle(entry, entry.bootstrap ? 'bootstrap' : 'classic');
    handle.status = 'online';
    internals.handles.set(entry.name, handle);
    return handle;
  };
  return { service, internals, add };
}

describe('watch policy at execution time', () => {
  it('revokes a queued automatic restart even after watch is enabled again', async () => {
    vi.useFakeTimers();
    const { service, internals, add } = harness();
    const entry = { name: 'lab/local/worker', script: 'worker.js' };
    const handle = add(entry);
    const restart = vi.fn(async () => handle);
    internals.restartAppNow = restart;
    internals.getCoalescerState(entry.name).cooldownUntil = Date.now() + 3000;
    const queued = service.restartAfterChange(entry.name);
    await service.redefineApp(entry.name, { ...entry, watch: false });
    await service.redefineApp(entry.name, entry);
    await vi.advanceTimersByTimeAsync(3100);
    await queued;
    expect(restart).not.toHaveBeenCalled();
    await service.restartAfterChange(entry.name);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('cancels a trailing watch request without dropping a manual restart', async () => {
    const { service, internals, add } = harness();
    const entry = { name: 'lab/local/worker', script: 'worker.js' }, handle = add(entry);
    let finish!: (value: AppHandle) => void;
    const restart = vi.fn().mockImplementationOnce(() => new Promise((r) => { finish = r; })).mockResolvedValue(handle);
    internals.restartAppNow = restart;
    const first = service.restartApp(entry.name);
    const watch = service.restartAfterChange(entry.name);
    await service.redefineApp(entry.name, { ...entry, watch: false });
    finish(handle);
    await Promise.all([first, watch]);
    expect(restart).toHaveBeenCalledTimes(1);
    await service.restartApp(entry.name);
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('global disable cancels cooldown requests; manual restart still works', async () => {
    vi.useFakeTimers();
    const { service, internals, add } = harness();
    const entry = { name: 'lab/local/worker', script: 'worker.js' }, handle = add(entry);
    const restart = vi.fn(async () => handle);
    internals.restartAppNow = restart;
    internals.getCoalescerState(entry.name).cooldownUntil = Date.now() + 3000;
    const queued = service.restartAfterChange(entry.name);
    await service.setWatchMode(false);
    await vi.advanceTimersByTimeAsync(3100);
    await queued;
    expect(restart).not.toHaveBeenCalled();
    await service.restartApp(entry.name);
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

describe('shared source edits, real esbuild and real child processes', () => {
  it('keeps watch:false PIDs and artifacts stable, reconfigures watching and permits manual rebuilds', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-watch-policy-'));
    cleanups.push(async () => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 1;');
    const { service, internals, add } = harness();
    const workers = new Map<string, { child: ChildProcess; value: number }>();
    const definitions = new Map<string, IAppDefinition>();
    const entries: IEcosystemAppEntry[] = [];
    async function stop(name: string) {
      const child = workers.get(name)?.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        const exit = once(child, 'exit'); child.kill(); await exit;
      }
    }
    cleanups.push(async () => { await internals.buildService?.dispose(); await Promise.all([...workers.keys()].map(stop)); });
    async function launch(entry: IEcosystemAppEntry) {
      await stop(entry.name);
      await internals.prepareBootstrapBuild(entry, entry.bootstrap, definitions.get(entry.name));
      const bundle = internals.buildResults.get(entry.name).modulePaths.get('worker');
      const child = fork(bundle, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
      workers.set(entry.name, { child, value: -1 });
      const [message] = await once(child, 'message');
      workers.set(entry.name, { child, value: (message as any).value });
      return service.getHandle(entry.name)!;
    }
    internals.restartAppNow = (name: string) => launch(service.getHandle(name)!.entry);
    for (const name of ['frozen', 'live', 'switchable']) {
      const dir = path.join(root, name); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
      const definition = { name, processes: [{ name: 'worker', module: './worker.ts' }] };
      fs.writeFileSync(path.join(dir, 'bootstrap.ts'), 'export default ' + JSON.stringify(definition));
      fs.writeFileSync(path.join(dir, 'worker.ts'), "import {value} from '../source.ts'; process.send?.({value}); setInterval(() => {}, 1000);");
      const entry = { name, bootstrap: path.join(dir, 'bootstrap.ts'), watch: name === 'frozen' ? false as const : undefined };
      definitions.set(name, definition); entries.push(entry); add(entry); await launch(entry);
    }
    const frozenPid = workers.get('frozen')!.child.pid;
    const frozenBundle = internals.buildResults.get('frozen').modulePaths.get('worker');
    const frozenBytes = fs.readFileSync(frozenBundle, 'utf8');
    expect(service.getBuildWatchedApps().map((a) => a.name).sort()).toEqual(['live', 'switchable']);
    await pause(400); // initial watch builds; positive control below proves event delivery
    fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 2;');
    await vi.waitFor(() => {
      expect(workers.get('live')!.value).toBe(2);
      expect(workers.get('switchable')!.value).toBe(2);
    }, { timeout: 10000 });
    expect(workers.get('frozen')!.child.pid).toBe(frozenPid);
    expect(workers.get('frozen')!.value).toBe(1);
    expect(fs.readFileSync(frozenBundle, 'utf8')).toBe(frozenBytes);

    // Reconfiguration must stop rebuilding, not merely suppress the restart log.
    await service.redefineApp('switchable', { ...entries[2]!, watch: false });
    const switchedPid = workers.get('switchable')!.child.pid;
    const switchedBundle = internals.buildResults.get('switchable').modulePaths.get('worker');
    const switchedBytes = fs.readFileSync(switchedBundle, 'utf8');
    fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 3;');
    await vi.waitFor(() => expect(workers.get('live')!.value).toBe(3), { timeout: 10000 });
    expect(workers.get('switchable')!.child.pid).toBe(switchedPid);
    expect(fs.readFileSync(switchedBundle, 'utf8')).toBe(switchedBytes);
    expect(workers.get('frozen')!.child.pid).toBe(frozenPid);

    await service.restartApp('frozen');
    expect(workers.get('frozen')!.value).toBe(3);
    expect(workers.get('frozen')!.child.pid).not.toBe(frozenPid);
    expect(service.getBuildWatchedApps().map((a) => a.name)).toEqual(['live']);

    await service.setWatchMode(false);
    expect(service.getBuildWatchedApps()).toEqual([]);
    const livePid = workers.get('live')!.child.pid;
    const liveBundle = internals.buildResults.get('live').modulePaths.get('worker');
    const liveBytes = fs.readFileSync(liveBundle, 'utf8');
    fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 4;');
    await pause(1000);
    expect(workers.get('live')!.child.pid).toBe(livePid);
    expect(fs.readFileSync(liveBundle, 'utf8')).toBe(liveBytes);
    await service.setWatchMode(true, ['live']);
    await pause(400);
    fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 5;');
    await vi.waitFor(() => expect(workers.get('live')!.value).toBe(5), { timeout: 10000 });
    expect(workers.get('switchable')!.child.pid).toBe(switchedPid);
  }, 30000);

  it('cancels an already scheduled debounce and an unfinished watch registration', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-watch-cancel-'));
    cleanups.push(async () => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    const source = path.join(root, 'bootstrap.ts');
    fs.writeFileSync(source, 'export default 1;');
    const definition = { name: 'probe', processes: [] };
    const service = new BuildService(true), callback = vi.fn();
    cleanups.push(() => service.dispose());
    await service.watchApp('probe', source, definition, callback);
    await pause(300);
    fs.writeFileSync(source, 'export default 2;');
    const output = path.join(root, '.omnitron-build/bootstrap.js');
    await vi.waitFor(() => expect(fs.readFileSync(output, 'utf8')).toContain('= 2'), { timeout: 5000, interval: 10 });
    await service.unwatchApp('probe');
    await pause(1000);
    expect(callback).not.toHaveBeenCalled();
    const pending = service.watchApp('probe', source, definition, callback);
    await service.unwatchApp('probe');
    await pending;
    expect(service.isWatching('probe')).toBe(false);
    const bytes = fs.readFileSync(output, 'utf8');
    fs.writeFileSync(source, 'export default 3;');
    await pause(1000);
    expect(fs.readFileSync(output, 'utf8')).toBe(bytes);
    expect(callback).not.toHaveBeenCalled();
  });
});
