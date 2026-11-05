import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { ExecutionClient } from '../../src/daemon/execution-client.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { StackExecutionPlan } from '../../src/shared/dto/stack-execution.js';

const scope = { project: 'sample', stack: 'local' };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-stack-reconcile-'));
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const db = new DaemonStateStore(logger as never, path.join(directory, 'state.db'));
  const state = new StateStore(db);
  const owner = new OrchestratorService(logger as never, {} as never, state, directory, { reapForeignOrphans: false });
  const handles = new Map(['sample/local/science', 'sample/local/web', 'other/local/science'].map(name =>
    [name, new AppHandle({ name, script: './original.cjs' }, 'classic')]));
  handles.get('other/local/science')!.status = 'online';
  Object.assign(owner, { handles });
  const retired = vi.fn();
  owner.on('app:retired', retired);
  const history = path.join(directory, 'history.log');
  fs.writeFileSync(history, 'scientific results and application history\n');
  await owner.stopStackExecution({ operationId: randomUUID(), plan: await owner.inspectStackExecution(scope) });
  const plan = await owner.inspectStackExecution(scope);
  const entries = [{ ...handles.get('sample/local/science')!.entry, script: './sealed.cjs', watch: false as const }];
  const request = { operationId: randomUUID(), plan, entries };
  cleanup.push(async () => { await state.flush(); await db.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { owner, handles, state, db, plan, request, retired, history };
}

it('reconciles the stopped graph without restarting processes, losing history or changing another stack', async () => {
  const f = await fixture();
  const science = f.handles.get('sample/local/science')!;
  const receipt = await f.owner.reconcileStoppedStack(f.request);
  expect(receipt).toMatchObject({ ...scope, revision: f.plan.revision + 1,
    retained: ['sample/local/science'], retired: ['sample/local/web'], added: [] });
  expect(f.handles.get(science.name)).toBe(science);
  expect(science.entry.script).toBe('./sealed.cjs');
  expect(science.status).toBe('stopped');
  expect(f.owner.getHandle('sample/local/web')).toBeUndefined();
  expect(await f.owner.startKnownApp('sample/local/web')).toBeUndefined();
  expect(f.handles.get('other/local/science')!.status).toBe('online');
  expect(f.retired).toHaveBeenCalledExactlyOnceWith('sample/local/web');
  expect(fs.readFileSync(f.history, 'utf8')).toBe('scientific results and application history\n');
  expect(f.state.load()!.apps.map(app => app.name)).toEqual(['sample/local/science', 'other/local/science']);
  await expect(f.owner.enableStackExecution(scope, { automatic: true })).rejects.toThrow('deliberately stopped');
  await f.db.dispose();
  expect(new StateStore(f.db).getStackIntent(scope)).toMatchObject({ revision: receipt.revision, phase: 'stopped' });
});

it.each(['generation', 'inventory', 'revision'])('refuses a stale %s before changing the owner', async change => {
  const f = await fixture();
  if (change === 'generation') f.handles.set('sample/local/web', new AppHandle({ name: 'sample/local/web', script: 'new.cjs' }, 'classic'));
  if (change === 'inventory') f.request.plan.apps.pop();
  if (change === 'revision') await f.owner.stopStackExecution({ operationId: randomUUID(), plan: f.plan });
  const revision = f.state.getStackIntent(scope).revision;
  await expect(f.owner.reconcileStoppedStack(f.request)).rejects.toThrow('Stack changed');
  expect(f.state.getStackIntent(scope).revision).toBe(revision);
  expect(f.handles.size).toBe(3);
  expect(f.retired).not.toHaveBeenCalled();
});

it.each(['status', 'pid', 'childProcess', 'supervisor', 'topology', 'topologyPools'])('refuses an unconfirmed %s even behind a stopped intent', async field => {
  const f = await fixture();
  const handle = f.handles.get('sample/local/web')!;
  if (field === 'status') handle.status = 'online';
  else if (field === 'pid') handle.pid = 123;
  else if (field === 'topologyPools') handle.topologyPools.set('worker', {} as never);
  else Object.assign(handle, { [field]: {} });
  await expect(f.owner.reconcileStoppedStack(f.request)).rejects.toThrow('fully stopped generation');
  expect(f.state.getStackIntent(scope).revision).toBe(f.plan.revision);
  expect(f.retired).not.toHaveBeenCalled();
});

it.each(['foreign', 'duplicate', 'nested', 'child', 'running'])('refuses an invalid %s target or scope before writes', async kind => {
  const f = await fixture();
  if (kind === 'foreign') f.request.entries[0]!.name = 'other/local/science';
  if (kind === 'duplicate') f.request.entries.push({ ...f.request.entries[0]! });
  if (kind === 'nested') f.request.entries[0]!.name = 'sample/local/nested/science';
  if (kind === 'child') Object.assign(f.request.plan, { application: 'science' });
  if (kind === 'running') f.request.plan.phase = 'running';
  await expect(Promise.resolve().then(() => f.owner.reconcileStoppedStack(f.request))).rejects.toThrow();
  expect(f.state.getStackIntent(scope)).toMatchObject({ revision: 1, phase: 'stopped' });
  expect(f.handles.size).toBe(3);
});

it('refuses reconciliation during global shutdown without changing the stopped fence', async () => {
  const f = await fixture();
  Object.assign(f.owner, { stoppingApps: true });
  await expect(f.owner.reconcileStoppedStack(f.request)).rejects.toThrow('Global application shutdown');
  expect(f.state.getStackIntent(scope).revision).toBe(f.plan.revision);
  expect(f.handles.size).toBe(3);
  expect(f.retired).not.toHaveBeenCalled();
});

it('refuses disk failure before discarding source watches or registrations', async () => {
  const f = await fixture();
  const unwatchApp = vi.fn();
  Object.assign(f.owner, { buildService: { unwatchApp } });
  vi.spyOn(f.state, 'updateStackIntent').mockImplementationOnce(() => { throw new Error('disk full'); });
  await expect(f.owner.reconcileStoppedStack(f.request)).rejects.toThrow('disk full');
  expect(unwatchApp).not.toHaveBeenCalled();
  expect(f.handles.size).toBe(3);
});

it('keeps the stop fence and retries from fresh generations after watcher disposal fails', async () => {
  const f = await fixture();
  const unwatchApp = vi.fn().mockRejectedValueOnce(new Error('watch disposal failed'));
  Object.assign(f.owner, { buildService: { unwatchApp } });
  await expect(f.owner.reconcileStoppedStack(f.request)).rejects.toThrow('watch disposal failed');
  expect(f.handles.size).toBe(3);
  expect(f.state.getStackIntent(scope).phase).toBe('stopped');
  await expect(f.owner.reconcileStoppedStack(f.request)).rejects.toThrow('Stack changed');
  const receipt = await f.owner.reconcileStoppedStack({ ...f.request, operationId: randomUUID(), plan: await f.owner.inspectStackExecution(scope) });
  expect(receipt.retired).toEqual(['sample/local/web']);
  expect(unwatchApp.mock.calls.map(call => call[0])).toContain('sample/local/web');
});

it('blocks concurrent admission and redefinition while disposing watches, with one result for an identical request', async () => {
  const f = await fixture();
  const disposing = Promise.withResolvers<void>(), proceed = Promise.withResolvers<void>();
  Object.assign(f.owner, { buildService: { unwatchApp: vi.fn(async () => { disposing.resolve(); await proceed.promise; }) } });
  const pending = f.owner.reconcileStoppedStack(f.request);
  expect(f.owner.reconcileStoppedStack(f.request)).toBe(pending);
  await disposing.promise;
  try {
    await expect(f.owner.enableStackExecution(scope)).rejects.toThrow('busy');
    await expect(f.owner.redefineApp('sample/local/science', f.request.entries[0]!)).rejects.toThrow('busy');
    expect(() => f.owner.assertAppStartAllowed('sample/local/web')).toThrow('busy');
    expect(() => f.owner.assertAppStartAllowed('other/local/science')).not.toThrow();
    expect(f.handles.size).toBe(3);
  } finally { proceed.resolve(); }
  await pending;
  expect(f.retired).toHaveBeenCalledTimes(1);
});

it('keeps retirement and watcher notifications observable after a failed snapshot acknowledgement', async () => {
  const f = await fixture();
  vi.spyOn(f.state, 'flush').mockRejectedValueOnce(new Error('snapshot write failed'));
  await expect(f.owner.reconcileStoppedStack(f.request)).rejects.toThrow('snapshot write failed');
  expect(f.owner.getHandle('sample/local/web')).toBeUndefined();
  expect(f.retired).toHaveBeenCalledExactlyOnceWith('sample/local/web');
  expect(f.state.getStackIntent(scope).phase).toBe('stopped');
  const result = await f.owner.reconcileStoppedStack({ ...f.request, operationId: randomUUID(), plan: await f.owner.inspectStackExecution(scope) });
  expect(result.retired).toEqual([]);
  expect(f.retired).toHaveBeenCalledTimes(1);
});

it('retires a legacy nested registration only within the reviewed parent prefix', async () => {
  const f = await fixture();
  f.handles.set('sample/local/legacy/worker', new AppHandle({ name: 'sample/local/legacy/worker', script: 'old.cjs' }, 'classic'));
  const result = await f.owner.reconcileStoppedStack({ ...f.request, plan: await f.owner.inspectStackExecution(scope) });
  expect(result.retired).toEqual(['sample/local/legacy/worker', 'sample/local/web']);
  expect(f.handles.get('other/local/science')!.status).toBe('online');
});

it.each([undefined, { stackControl: 1 }, { stoppedStackReconciliation: 2 }])('refuses an unsupported owner before RPC or recovery state changes', async capabilities => {
  const client = new ExecutionClient('/unused', {} as never);
  const remote = { read: vi.fn(), mutate: vi.fn() };
  Object.assign(client, { remote, inventory: { capabilities }, observedAt: performance.now() });
  const token = recoveryState.token();
  const plan: StackExecutionPlan = { ...scope, phase: 'stopped', revision: 1, apps: [] };
  await expect(client.orchestrator.reconcileStoppedStack({ operationId: randomUUID(), plan, entries: [] })).rejects.toThrow('owner upgrade');
  expect(remote.mutate).not.toHaveBeenCalled();
  expect(recoveryState.token()).toBe(token);
});
