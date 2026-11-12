import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { defineEcosystem } from '../../src/config/define-ecosystem.js';
import type { IEcosystemAppEntry } from '../../src/config/types.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { FileWatcher } from '../../src/orchestrator/file-watcher.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

type Subscription = { directory: string; emit: (event: string, file: string) => void; close: ReturnType<typeof vi.fn> };
type WatchFactory = { watchDirectory(directory: string, emit: Subscription['emit']): fs.FSWatcher };
type Boot = { pid: number; revision: string; url: string };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

// The platform event seam is deterministic; registration, lifecycle queue,
// actual forks, persisted owner state and HTTP responses use production code.
async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-classic-watch-')));
  const logger = createNullLogger();
  const database = new DaemonStateStore(logger, path.join(root, 'state.db'));
  const state = new StateStore(database);
  await state.init();
  const owner = new OrchestratorService(logger, {} as never, state, root, { reapForeignOrphans: false });
  const subscriptions: Subscription[] = [];
  vi.spyOn(FileWatcher.prototype as unknown as WatchFactory, 'watchDirectory').mockImplementation((directory, emit) => {
    const resource = new EventEmitter();
    const close = vi.fn();
    Object.assign(resource, { close });
    subscriptions.push({ directory, emit, close });
    return resource as fs.FSWatcher;
  });
  cleanups.push(async () => {
    for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
      const cwd = path.join(root, directory.name);
      for (const file of fs.readdirSync(cwd).filter(file => /^boot-\d+\.json$/.test(file))) {
        const boot = JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8')) as Boot;
        fs.writeFileSync(path.join(cwd, 'release-' + boot.revision), 'cleanup');
      }
    }
    await owner.stopAll(true);
    await state.flush();
    await database.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  owner.setConfig(defineEcosystem({ apps: [] }));
  await owner.setWatchMode(true);
  function application(directory: string, name = 'docs/dev/site'): IEcosystemAppEntry {
    const cwd = path.join(root, directory);
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'revision.json'), JSON.stringify({ value: directory }));
    fs.writeFileSync(path.join(cwd, 'main.cjs'), `
      const fs = require('node:fs');
      const http = require('node:http');
      const revision = JSON.parse(fs.readFileSync('revision.json', 'utf8'));
      const server = http.createServer((_req, res) => res.end(JSON.stringify({ pid: process.pid, revision: revision.value })));
      server.listen(0, '127.0.0.1', () => {
        fs.writeFileSync('boot-' + process.pid + '.json', JSON.stringify({ pid: process.pid,
          revision: revision.value, url: 'http://127.0.0.1:' + server.address().port }));
        if (!revision.hold) process.send({ type: 'ready' });
        else {
          const timer = setInterval(() => {
            if (fs.existsSync('release-' + revision.value)) {
              clearInterval(timer); process.send({ type: 'ready' });
            }
          }, 10);
        }
      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `);
    return { name, cwd, script: 'main.cjs', watch: { directory: '.', debounce: 10 }, restartPolicy: { enabled: false } };
  }
  const boots = (entry: IEcosystemAppEntry): Boot[] => fs.readdirSync(entry.cwd!).filter(file => /^boot-\d+\.json$/.test(file))
    .map(file => JSON.parse(fs.readFileSync(path.join(entry.cwd!, file), 'utf8')) as Boot);
  const revise = (entry: IEcosystemAppEntry, value: string, hold = false) =>
    fs.writeFileSync(path.join(entry.cwd!, 'revision.json'), JSON.stringify({ value, hold }));
  const currentHttp = async (entry: IEcosystemAppEntry) => {
    const handle = owner.getHandle(entry.name)!;
    const boot = boots(entry).find(item => item.pid === handle.pid);
    expect(handle.status).toBe('online');
    expect(boot).toBeDefined();
    const response = await fetch(boot!.url, { signal: AbortSignal.timeout(1000) });
    expect(response.status).toBe(200);
    return await response.json() as { pid: number; revision: string };
  };
  return { owner, subscriptions, application, boots, revise, currentHttp };
}

describe('classic watches follow the authoritative application lifecycle', () => {
  it('watches dynamically started apps even when autostart is disabled, and obeys global selection', async () => {
    const f = await fixture();
    const site = { ...f.application('site'), enabled: false };
    const frozen: IEcosystemAppEntry = { ...f.application('frozen', 'docs/dev/frozen'), watch: false };
    expect(f.owner.getWatchedApps()).toEqual([]);
    const handle = await f.owner.startApp(site);
    await f.owner.startApp(frozen);
    expect(await f.currentHttp(site)).toEqual({ pid: handle.pid, revision: 'site' });
    expect(f.owner.getWatchedApps()).toEqual([{ name: site.name, directory: site.cwd,
      generation: handle.generation, definitionRevision: handle.definitionRevision }]);
    const subscription = f.subscriptions[0]!;
    await f.owner.setWatchMode(false);
    expect(subscription.close).toHaveBeenCalledTimes(1);
    expect(f.owner.getWatchedApps()).toEqual([]);
    expect(f.owner.getAppStatus(site.name)).toBe('online');
    await f.owner.setWatchMode(true, [frozen.name]);
    expect(f.owner.getWatchedApps()).toEqual([]);
    await f.owner.setWatchMode(true, [site.name]);
    expect(f.owner.getWatchedApps().map(item => item.name)).toEqual([site.name]);
    await f.owner.stopApp(site.name);
    expect(f.owner.getWatchedApps()).toEqual([]);
    subscription.emit('change', 'revision.json');
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(f.boots(site)).toHaveLength(1);
  });

  it('revokes stale source events on retargeting, redefinition and installed release policy', async () => {
    const f = await fixture();
    const first = f.application('first');
    const second = f.application('second');
    const initial = await f.owner.startApp(first);
    const old = f.subscriptions[0]!;
    old.emit('change', 'revision.json');
    await f.owner.redefineApp(first.name, second);
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(f.owner.getWatchedApps()[0]).toMatchObject({ directory: second.cwd, definitionRevision: 1 });
    old.emit('change', 'revision.json');
    const replacement = f.subscriptions[1]!;
    replacement.emit('change', 'revision.json');
    await f.owner.redefineApp(second.name, { ...second, env: { NEW_DEFINITION: '1' } });
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(f.owner.getHandle(second.name)?.pid).toBe(initial.pid);
    const sameEntry = f.owner.getHandle(second.name)!.entry;
    replacement.emit('change', 'revision.json');
    await f.owner.redefineApp(second.name, sameEntry);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(f.owner.getHandle(second.name)?.pid).toBe(initial.pid);
    expect(f.owner.getWatchedApps()[0]?.definitionRevision).toBe(3);
    replacement.emit('change', 'revision.json');
    await vi.waitFor(async () => expect((await f.currentHttp(second)).revision).toBe('second'), { timeout: 10000 });
    const pid = f.owner.getHandle(second.name)?.pid;
    await f.owner.redefineApp(second.name, { ...second, releaseRoot: second.cwd! });
    expect(f.owner.getWatchedApps()).toEqual([]);
    expect(replacement.close).toHaveBeenCalledTimes(1);
    replacement.emit('change', 'revision.json');
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(f.owner.getHandle(second.name)?.pid).toBe(pid);
  });

  it('keeps the native subscription and the trailing edit while a replacement child awaits readiness', async () => {
    const f = await fixture();
    const site = f.application('initial');
    await f.owner.startApp(site);
    await f.owner.redefineApp(site.name, { ...site, env: { DEFINITION: 'updated' } });
    const subscription = f.subscriptions[0]!;
    f.revise(site, 'one', true);
    subscription.emit('change', 'revision.json');
    await vi.waitFor(() => {
      expect(f.owner.getAppStatus(site.name)).toBe('starting');
      expect(f.boots(site).some(boot => boot.revision === 'one')).toBe(true);
    }, { timeout: 10000 });
    expect(subscription.close).not.toHaveBeenCalled();
    expect(f.subscriptions).toHaveLength(1);
    f.revise(site, 'two');
    subscription.emit('change', 'revision.json');
    await new Promise(resolve => setTimeout(resolve, 30));
    fs.writeFileSync(path.join(site.cwd!, 'release-one'), 'ready');
    await vi.waitFor(async () => expect((await f.currentHttp(site)).revision).toBe('two'), { timeout: 10000 });
    expect(f.boots(site).map(boot => boot.revision).sort()).toEqual(['initial', 'one', 'two']);
    expect(f.subscriptions).toHaveLength(1);
    expect(subscription.close).not.toHaveBeenCalled();
  });

  it('retargets a mutated entry object to its new directory through canonical redefinition', async () => {
    const f = await fixture();
    const entry = f.application('source-a');
    const original = { ...entry };
    const target = f.application('source-b');
    const initial = await f.owner.startApp(entry);
    const old = f.subscriptions[0]!;
    expect((await f.currentHttp(entry)).revision).toBe('source-a');

    entry.cwd = target.cwd!;
    await f.owner.redefineApp(entry.name, entry);
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(f.subscriptions).toHaveLength(2);
    expect(f.subscriptions[1]!.directory).toBe(target.cwd);
    expect(f.owner.getWatchedApps()).toEqual([{ name: entry.name, directory: target.cwd,
      generation: initial.generation, definitionRevision: 1 }]);

    f.revise(original, 'retired-source');
    old.emit('change', 'revision.json');
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(f.owner.getHandle(entry.name)?.pid).toBe(initial.pid);
    expect(f.boots(target)).toEqual([]);

    f.revise(target, 'new-source');
    f.subscriptions[1]!.emit('change', 'revision.json');
    await vi.waitFor(async () => expect((await f.currentHttp(entry)).revision).toBe('new-source'), { timeout: 10000 });
    expect(f.owner.getHandle(entry.name)?.pid).not.toBe(initial.pid);
    expect(f.boots(original)).toHaveLength(1);
    expect(f.boots(target)).toHaveLength(1);
  });

  it('removes bare aliases and stopped registrations, and never advertises a failed launch', async () => {
    const f = await fixture();
    const bare = f.application('alias', 'site');
    await f.owner.startApp(bare);
    const old = f.subscriptions[0]!;
    const qualified = { ...bare, name: 'docs/dev/site' };
    await f.owner.startApp(qualified);
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(f.owner.getWatchedApps().map(item => item.name)).toEqual([qualified.name]);
    await f.owner.stopApp(qualified.name);
    expect(f.owner.getWatchedApps()).toEqual([]);
    await expect(f.owner.startApp({ ...qualified, script: 'missing.cjs' })).rejects.toThrow('exited during startup');
    expect(f.owner.getAppStatus(qualified.name)).toBe('errored');
    expect(f.owner.getWatchedApps()).toEqual([]);
  });
});
