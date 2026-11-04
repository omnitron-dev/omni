import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once, EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { defineEcosystem } from '../../src/config/define-ecosystem.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { waitForReady } from '../../src/orchestrator/classic-launcher.js';
import type { IEcosystemAppEntry, IProcessEntry } from '../../src/config/types.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { ExecutionClient } from '../../src/daemon/execution-client.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { RELEASE_RECEIPT, releaseTreeDigest } from '../../src/release/runtime-provenance.js';

const scope = { project: 'sample', stack: 'prod' };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(bootstrapWorker = false) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omni-installed-start-')));
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const store = new DaemonStateStore(logger as never, path.join(dir, 'state.db'));
  const state = new StateStore(store);
  const handles = new Map<string, AppHandle>();
  const owner = new OrchestratorService(logger as never, {} as never, state, dir, { reapForeignOrphans: false });
  Object.assign(owner, { handles, ensureBootReconciled: vi.fn(), ensureMetricsPolling: vi.fn(), persistState: vi.fn() });
  if (bootstrapWorker) Object.assign(owner, {
    launchTopology: async (_entry: IEcosystemAppEntry, handle: AppHandle, _config: unknown, _bootstrap: string, children: IProcessEntry[]) => {
      handle.topologyProcesses = children;
      handle.declareChildren(children.map(child => child.name), 'server');
      for (const child of children) handle.childStarted(child.name, null);
    },
  });
  const config = defineEcosystem({ apps: [] });
  cleanups.push(async () => {
    for (const handle of handles.values()) {
      const child = handle.childProcess;
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        handle.markStopping();
        const done = once(child, 'exit');
        child.kill('SIGTERM');
        await done;
      }
    }
    await store.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });
  for (const app of ['api', 'worker']) {
    const root = path.join(dir, app);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'main.cjs'), "process.send({type:'ready'});setInterval(()=>{},1000);");
    const bootstrap = bootstrapWorker && app === 'worker';
    if (bootstrap) {
      await fs.writeFile(path.join(root, 'bootstrap.mjs'), "export default {name:'worker',version:'1',processes:[{name:'server',module:'./server.mjs'},{name:'jobs',module:'./jobs.mjs'}]}");
      for (const filename of ['server.mjs', 'jobs.mjs']) await fs.writeFile(path.join(root, filename), 'export default class Worker {}');
    }
    const origin = { app, releaseId: 'r1', manifestSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64),
      artifactBytes: 100, frameworkCommit: 'c'.repeat(40) };
    const receipt = { version: 1, root, origin, frameworkContentUnchanged: true, installedFrameworkCommit: origin.frameworkCommit,
      artifactPayloadUnchanged: true, treeSha256: await releaseTreeDigest(root) };
    await fs.writeFile(path.join(root, RELEASE_RECEIPT), JSON.stringify(receipt), { mode: 0o600 });
    const name = 'sample/prod/' + app;
    const appEntry = { name, cwd: root, releaseRoot: root, ...(bootstrap ? { bootstrap: 'bootstrap.mjs' } : { script: 'main.cjs' }),
      env: { NODE_OPTIONS: '', NODE_PATH: '', OMNITRON_STACK: 'prod' } };
    const handle = await owner.startApp(appEntry, config);
    if (bootstrap) {
      handle.childGone('jobs');
      handle.childStarted('jobs', null);
      expect(handle.release.state).toBe('unreported');
    }
  }
  await owner.stopStackExecution({ operationId: randomUUID(), plan: await owner.inspectStackExecution(scope) });
  return { state, owner, handles, dir };
}

describe('installed stack process owner', () => {
  it('refuses a separately fenced application before opening an installed stack', async () => {
    const { owner, state, handles } = await fixture();
    const plan = await owner.inspectInstalledStack(scope);
    await owner.stopExecution({ operationId: randomUUID(), plan: await owner.inspectExecution({ ...scope, application: 'api' }) });
    await expect(owner.inspectInstalledStack(scope)).rejects.toThrow('fenced');
    await expect(owner.openInstalledStack({ operationId: randomUUID(), plan })).rejects.toThrow('fenced');
    expect(state.getStackIntent(scope).phase).toBe('stopped');
    expect([...handles.values()].every(handle => handle.status === 'stopped')).toBe(true);
  });

  it('refuses unverified sealed code before bootstrap introspection or a classic spawn', async () => {
    const { owner, dir } = await fixture();
    await owner.setWatchMode(true);
    const root = path.join(dir, 'unverified');
    await fs.mkdir(root);
    const marker = path.join(dir, 'executed');
    await fs.writeFile(path.join(root, 'bootstrap.mjs'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)},'executed'); export default {name:'unverified',processes:[]};`);
    await fs.writeFile(path.join(root, 'main.cjs'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed'); process.send?.({type:'ready'});`);
    for (const launch of [{ bootstrap: 'bootstrap.mjs' }, { script: 'main.cjs' }]) {
      await expect(owner.startApp({ name: 'unverified', cwd: root, releaseRoot: root,
        env: { NODE_OPTIONS: '', NODE_PATH: '' }, ...launch })).rejects.toThrow(/receipt|release|verified/i);
      await expect(fs.stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('forks only the sealed retained entries, closes the fence after every IPC ready signal and refuses replay', async () => {
    const { owner, handles, state } = await fixture();
    await owner.setWatchMode(true);
    const plan = await owner.inspectInstalledStack(scope);
    const first = plan.apps[0]!, second = plan.apps[1]!;
    expect(first.installed.releaseId).toBe('r1');
    const operation = { operationId: randomUUID(), plan };
    await owner.openInstalledStack(operation);
    expect(() => owner.assertAppStartAllowed(first.name)).toThrow('stack start');
    await expect(owner.enableStackExecution(scope)).rejects.toThrow('unfinished installed start');
    await expect(owner.redefineApp(first.name, handles.get(first.name)!.entry)).rejects.toThrow('cannot be changed');
    await owner.resumeInstalledApp({ ...operation, name: first.name });
    expect(handles.get(first.name)?.release.state).toBe('confirmed');
    expect(state.getStackIntent(scope).remaining).toEqual([second.name]);
    await expect(owner.restartApp(first.name)).rejects.toThrow('unfinished');
    await expect(owner.startApp(handles.get(second.name)!.entry)).rejects.toThrow('unfinished');
    await expect(owner.restartAppChild(first.name, 'server')).rejects.toThrow('unfinished');
    expect(handles.get(first.name)?.status).toBe('online');
    await expect(owner.resumeInstalledApp({ ...operation, name: first.name })).rejects.toThrow();
    await owner.resumeInstalledApp({ ...operation, name: second.name });
    expect(handles.get(second.name)?.status).toBe('online');
    expect(state.getStackIntent(scope)).toEqual({ phase: 'running', revision: 2 });
    await expect(owner.openInstalledStack(operation)).rejects.toThrow('changed');
  });

  it('keeps a generation’s original launch proof when process membership changes and the owner loads another project policy', async () => {
    const { owner, handles } = await fixture(true);
    const worker = handles.get('sample/prod/worker')!;
    expect(worker.release.state).toBe('unreported');
    const otherConfig = defineEcosystem({ apps: [] });
    otherConfig.supervision.maxRestarts += 10;
    Object.assign(owner, { config: otherConfig });
    const plan = await owner.inspectInstalledStack(scope);
    const expected = plan.apps.find(app => app.name === worker.name)!.installed;
    expect(expected.releaseId).toBe('r1');
    expect(expected.treeSha256).toMatch(/^[a-f0-9]{64}$/);
    const operation = { operationId: randomUUID(), plan };
    await owner.openInstalledStack(operation);
    for (const app of plan.apps) await owner.resumeInstalledApp({ ...operation, name: app.name });
    expect(handles.get(worker.name)?.release).toMatchObject({ state: 'confirmed', treeSha256: expected.treeSha256 });
  });

  it('rejects changed launch inputs before preflight even when the new tree has a valid private receipt', async () => {
    const { owner, handles, dir } = await fixture();
    const root = path.join(dir, 'api');
    const receiptPath = path.join(root, RELEASE_RECEIPT);
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    const handle = handles.get('sample/prod/api')!;
    const original = handle.entry;
    handle.redefine({ ...original, env: { ...original.env, PORT: '4321' } });
    await expect(owner.inspectInstalledStack(scope)).rejects.toThrow('configuration changed');
    handle.redefine(original);
    await fs.appendFile(path.join(root, 'main.cjs'), '// replaced and resealed');
    const changed = { ...receipt, treeSha256: await releaseTreeDigest(root) };
    await fs.writeFile(receiptPath, JSON.stringify(changed));
    await expect(owner.inspectInstalledStack(scope)).rejects.toThrow('release changed');
    await fs.writeFile(receiptPath, JSON.stringify({ ...changed, origin: { ...receipt.origin, releaseId: 'replacement' } }));
    await expect(owner.inspectInstalledStack(scope)).rejects.toThrow('release changed');
    handles.set(original.name, new AppHandle(original, 'classic'));
    await expect(owner.inspectInstalledStack(scope)).rejects.toThrow('no verified installed launch');
  });

  it('keeps an ambiguous launch consumed after a payload changes and permits a newly reviewed stop', async () => {
    const { owner, state, handles, dir } = await fixture();
    const plan = await owner.inspectInstalledStack(scope);
    const first = plan.apps[0]!;
    const operation = { operationId: randomUUID(), plan };
    await owner.openInstalledStack(operation);
    await fs.appendFile(path.join(dir, 'api/main.cjs'), '// changed');
    await expect(owner.resumeInstalledApp({ ...operation, name: first.name })).rejects.toThrow('changed');
    expect(handles.get(first.name)?.pid).toBeNull();
    expect(state.getStackIntent(scope)).toMatchObject({ phase: 'starting', pendingApp: first.name });
    await expect(owner.resumeInstalledApp({ ...operation, name: plan.apps[1]!.name })).rejects.toThrow('consumed');
    const stop = await owner.inspectStackExecution(scope);
    expect(stop.phase).toBe('starting');
  });

  it('refuses alias collisions and configuration drift before opening a stopped fence', async () => {
    const { owner, handles, state } = await fixture();
    const plan = await owner.inspectInstalledStack(scope);
    handles.set('api', new AppHandle({ name: 'api', script: './other' }, 'classic'));
    await expect(owner.inspectInstalledStack(scope)).rejects.toThrow('unambiguous');
    handles.delete('api');
    const api = handles.get('sample/prod/api')!;
    api.redefine({ ...api.entry, env: { ...api.entry.env, PUBLIC_PORT: '1234' } });
    await expect(owner.openInstalledStack({ operationId: randomUUID(), plan })).rejects.toThrow('changed');
    expect(state.getStackIntent(scope).phase).toBe('stopped');
  });

  it.each([undefined, { stackControl: 1 }, { stackControl: 1, installedStackStart: 2 }])(
    'refuses an incompatible resident owner before changing recovery state or sending any RPC', async capabilities => {
      const client = new ExecutionClient('/unused', {} as never);
      const remote = { read: vi.fn(), mutate: vi.fn() };
      Object.assign(client, { remote, inventory: { capabilities }, observedAt: performance.now() });
      const token = recoveryState.token();
      const plan = { ...scope, phase: 'stopped' as const, revision: 2, apps: [] };
      const operation = { operationId: randomUUID(), plan };
      await expect(client.orchestrator.inspectInstalledStack(scope)).rejects.toThrow('owner upgrade');
      await expect(client.orchestrator.openInstalledStack(operation)).rejects.toThrow('owner upgrade');
      await expect(client.orchestrator.resumeInstalledApp({ ...operation, name: 'sample/prod/api' })).rejects.toThrow('owner upgrade');
      expect(remote.read).not.toHaveBeenCalled();
      expect(remote.mutate).not.toHaveBeenCalled();
      expect(recoveryState.token()).toBe(token);
    },
  );

  it('cannot confirm a classic installed process from silence at the readiness deadline', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { pid: 12345 }) as ChildProcess;
    const handle = new AppHandle({ name: 'demo', script: 'demo.js' }, 'classic');
    const result = expect(waitForReady(child, handle, {} as never, true)).rejects.toThrow('did not confirm readiness');
    await vi.advanceTimersByTimeAsync(30_001);
    await result;
    expect(handle.status).toBe('errored');
  });
});
