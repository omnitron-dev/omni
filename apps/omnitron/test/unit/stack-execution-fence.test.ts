import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { ExecutionClient } from '../../src/daemon/execution-client.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';

const scope = { project: 'sample', stack: 'prod' };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-stop-fence-'));
  const logger: any = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const store = new DaemonStateStore(logger, path.join(directory, 'state.db'));
  cleanups.push(async () => { await store.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  const state = new StateStore(store);
  const handles = new Map<string, AppHandle>();
  for (const name of ['sample/prod/api', 'sample/prod/worker', 'other/prod/api']) {
    const handle = new AppHandle({ name, script: './app.js' }, 'classic');
    handle.status = 'online'; handles.set(name, handle);
  }
  const owner: any = Object.assign(Object.create(OrchestratorService.prototype), {
    stateStore: state, handles, startingApps: new Map(), stackStops: new Map(),
    lifecycleQueue: { isBusy: vi.fn(() => false) },
    stopApp: vi.fn(async (name: string) => handles.get(name)!.markStopped()),
  });
  return { owner, state, store, handles };
}

describe('durable stack execution fence', () => {
  it('stops only the accepted generations and requires an explicit new start', async () => {
    const { owner, state, handles } = fixture();
    const plan = await owner.inspectStackExecution(scope);
    const operationId = randomUUID();
    const receipt = await owner.stopStackExecution({ operationId, plan });
    expect(receipt).toMatchObject({ ...scope, operationId, revision: 1 });
    expect(handles.get('other/prod/api')!.status).toBe('online');
    expect(state.getStackIntent(scope).phase).toBe('stopped');
    expect(() => owner.assertAppStartAllowed('sample/prod/api')).toThrow('stack start');
    await expect(owner.enableStackExecution(scope, { automatic: true })).rejects.toThrow('deliberately stopped');
    expect(state.getStackIntent(scope).phase).toBe('stopped');
    await owner.enableStackExecution(scope);
    expect(() => owner.assertAppStartAllowed('sample/prod/api')).not.toThrow();
    expect(state.getStackIntent(scope).revision).toBe(2);
    await expect(owner.stopStackExecution({ operationId, plan })).rejects.toThrow('changed');
    expect(state.getStackIntent(scope).phase).toBe('running');
  });
  it('keeps the stop fence after a partial failure and retries the same identity', async () => {
    const { owner, state } = fixture();
    const plan = await owner.inspectStackExecution(scope);
    const request = { plan, operationId: randomUUID() };
    owner.stopApp.mockRejectedValueOnce(new Error('worker unresponsive'));
    await expect(owner.stopStackExecution(request)).rejects.toThrow('worker unresponsive');
    expect(state.getStackIntent(scope).phase).toBe('stopping');
    await expect(owner.enableStackExecution(scope)).rejects.toThrow('unconfirmed stop');
    await expect(owner.stopStackExecution(request)).resolves.toMatchObject({ operationId: request.operationId });
    expect(state.getStackIntent(scope).phase).toBe('stopped');
  });
  it('refuses a plan after an application has changed generation', async () => {
    const { owner, handles, state } = fixture();
    const plan = await owner.inspectStackExecution(scope);
    handles.set('sample/prod/api', new AppHandle({ name: 'sample/prod/api', script: './new.js' }, 'classic'));
    await expect(owner.stopStackExecution({ plan, operationId: randomUUID() })).rejects.toThrow('changed');
    expect(owner.stopApp).not.toHaveBeenCalled();
    expect(state.getStackIntent(scope).phase).toBe('running');
  });
  it('refuses an inventory while an app lifecycle mutation is active', async () => {
    const { owner } = fixture();
    owner.lifecycleQueue.isBusy.mockReturnValue(true);
    await expect(owner.inspectStackExecution(scope)).rejects.toThrow('active application operations');
    expect(owner.stopApp).not.toHaveBeenCalled();
  });
  it('fails before effects if the stop fence cannot be durably written', async () => {
    const { owner, state } = fixture();
    const plan = await owner.inspectStackExecution(scope);
    vi.spyOn(state, 'updateExecutionIntent').mockImplementation(() => { throw new Error('disk full'); });
    await expect(owner.stopStackExecution({ plan, operationId: randomUUID() })).rejects.toThrow('disk full');
    expect(owner.stopApp).not.toHaveBeenCalled();
  });
  it('retains intent across reopening SQLite and uses FULL durability for the acknowledgement', async () => {
    const { owner, state, store } = fixture();
    const plan = await owner.inspectStackExecution(scope);
    let synchronous = 0;
    const original = store.kvSetSync.bind(store);
    vi.spyOn(store, 'kvSetSync').mockImplementation((key, value) => {
      synchronous = Number(store.initSync().pragma('synchronous', { simple: true }));
      original(key, value);
    });
    await owner.stopStackExecution({ plan, operationId: randomUUID() });
    expect(synchronous).toBe(2);
    await store.dispose();
    expect(new StateStore(store).getStackIntent(scope)).toEqual(state.getStackIntent(scope));
    expect(state.getStackIntent(scope).phase).toBe('stopped');
    expect(store.initSync().pragma('synchronous', { simple: true })).toBe(1);
  });
  it('refuses corrupt durable intent rather than enabling crash recovery', () => {
    const { owner, store } = fixture();
    store.kvSetSync('execution:stack:sample/prod', { revision: 3, phase: 'unknown' });
    expect(() => owner.assertAppStartAllowed('sample/prod/api')).toThrow('Corrupt');
  });
});

describe('durable application execution scope', () => {
  const child = { ...scope, application: 'api' };

  it('retains the full parent prefix while a child requires an exact identity', async () => {
    const { owner, handles } = fixture();
    const nested = 'sample/prod/legacy/component';
    const handle = new AppHandle({ name: nested, script: './legacy.js' }, 'classic');
    handle.status = 'online'; handles.set(nested, handle);
    const childPlan = await owner.inspectExecution(child);
    expect(childPlan.apps.map((app: { name: string }) => app.name)).toEqual(['sample/prod/api']);
    const parent = await owner.inspectStackExecution(scope);
    expect(parent.apps.some((app: { name: string }) => app.name === nested)).toBe(true);
    await owner.stopStackExecution({ operationId: randomUUID(), plan: parent });
    expect(handle.status).toBe('stopped');
    expect(handles.get('other/prod/api')!.status).toBe('online');
    expect(() => owner.assertAppStartAllowed(nested)).toThrow('stack start');
    await expect(owner.startAppInternal(handle.entry)).rejects.toThrow('stack start');
    await owner.enableStackExecution(scope);
    expect(() => owner.assertAppStartAllowed(nested)).not.toThrow();
  });

  it('stops only its reviewed application and preserves sibling generations and parent intent', async () => {
    const { owner, handles, state } = fixture();
    const sibling = handles.get('sample/prod/worker')!;
    const generation = sibling.generation;
    const parent = state.getStackIntent(scope);
    const plan = await owner.inspectExecution(child);
    expect(plan.apps.map((app: { name: string }) => app.name)).toEqual(['sample/prod/api']);
    expect(plan.parentRevision).toBe(parent.revision);
    const receipt = await owner.stopExecution({ operationId: randomUUID(), plan });
    expect(receipt).toMatchObject({ ...child, revision: 1, stopped: ['sample/prod/api'] });
    expect(sibling.status).toBe('online'); expect(sibling.generation).toBe(generation);
    expect(state.getStackIntent(scope)).toEqual(parent);
    expect(() => owner.assertAppStartAllowed('sample/prod/worker')).not.toThrow();
    expect(() => owner.assertAppStartAllowed('sample/prod/api')).toThrow('fenced');
  });

  it('retains its fence across SQLite reopen and cannot be automatically admitted', async () => {
    const { owner, state, store } = fixture();
    await owner.stopExecution({ operationId: randomUUID(), plan: await owner.inspectExecution(child) });
    await store.dispose();
    owner.stateStore = new StateStore(store);
    expect(() => owner.assertAppStartAllowed('sample/prod/api')).toThrow('fenced');
    await expect(owner.enableExecution(child, { automatic: true, expectedRevision: 1 })).rejects.toThrow('deliberately stopped');
    await expect(owner.enableExecution(child, { expectedRevision: 0 })).rejects.toThrow('changed');
    await expect(owner.enableExecution(child)).rejects.toThrow('changed');
    await owner.enableExecution(child, { expectedRevision: 1 });
    expect(() => owner.assertAppStartAllowed('sample/prod/api')).not.toThrow();
    expect(state.getExecutionIntent(child)).toMatchObject({ phase: 'running', revision: 2 });
    expect(state.getStackIntent(scope).revision).toBe(0);
    await expect(owner.enableExecution(child, { expectedRevision: 1 })).rejects.toThrow('changed');
  });

  it('keeps an interrupted stop fenced and resumes the exact operation only', async () => {
    const { owner, state } = fixture();
    const request = { operationId: randomUUID(), plan: await owner.inspectExecution(child) };
    owner.stopApp.mockRejectedValueOnce(Error('process exit unknown'));
    await expect(owner.stopExecution(request)).rejects.toThrow('process exit unknown');
    expect(state.getExecutionIntent(child).phase).toBe('stopping');
    await expect(owner.enableExecution(child, { expectedRevision: 1 })).rejects.toThrow('unconfirmed');
    await expect(owner.stopExecution({ ...request, plan: { ...request.plan, application: 'worker' } })).rejects.toThrow('changed');
    await expect(owner.stopExecution(request)).resolves.toMatchObject({ operationId: request.operationId });
    expect(state.getExecutionIntent(child).phase).toBe('stopped');
  });

  it('refuses changed application generations and changed parent intent before effects', async () => {
    const { owner, handles, state } = fixture();
    const plan = await owner.inspectExecution(child);
    handles.set('sample/prod/api', new AppHandle({ name: 'sample/prod/api', script: './new.js' }, 'classic'));
    await expect(owner.stopExecution({ operationId: randomUUID(), plan })).rejects.toThrow('changed');
    const current = await owner.inspectExecution(child);
    state.updateStackIntent(scope, () => ({ phase: 'running', revision: 1 }));
    await expect(owner.stopExecution({ operationId: randomUUID(), plan: current })).rejects.toThrow('changed');
    expect(owner.stopApp).not.toHaveBeenCalled();
    expect(state.getExecutionIntent(child).phase).toBe('running');
  });

  it('never clears a child fence by enabling its parent, or bypasses a stopped parent', async () => {
    const { owner, state } = fixture();
    await owner.stopExecution({ operationId: randomUUID(), plan: await owner.inspectExecution(child) });
    await owner.stopStackExecution({ operationId: randomUUID(), plan: await owner.inspectStackExecution(scope) });
    await expect(owner.enableExecution(child, { expectedRevision: 1 })).rejects.toThrow('Parent stack');
    await owner.enableStackExecution(scope);
    expect(state.getExecutionIntent(child).phase).toBe('stopped');
    expect(() => owner.assertAppStartAllowed('sample/prod/api')).toThrow('fenced');
    expect(() => owner.assertAppStartAllowed('sample/prod/worker')).not.toThrow();
  });

  it('refuses unsafe scope identities and corrupt child state', async () => {
    const { owner, store } = fixture();
    for (const application of ['', '../worker', 'api/worker', '*', null]) {
      await expect(owner.inspectExecution({ ...scope, application })).rejects.toThrow('canonical application');
    }
    store.kvSetSync('execution:application:sample/prod/api', { revision: 1, phase: 'invalid' });
    expect(() => owner.assertAppStartAllowed('sample/prod/api')).toThrow('Corrupt');
    expect(() => owner.assertAppStartAllowed('sample/prod/worker')).not.toThrow();
  });

  it('requires durable acknowledgement before stopping its application', async () => {
    const { owner, state } = fixture();
    const plan = await owner.inspectExecution(child);
    vi.spyOn(state, 'updateExecutionIntent').mockImplementation(() => { throw Error('disk full'); });
    await expect(owner.stopExecution({ operationId: randomUUID(), plan })).rejects.toThrow('disk full');
    expect(owner.stopApp).not.toHaveBeenCalled();
  });

  it.each([undefined, { stackControl: 1 }, { executionScopes: 2 }])('refuses an older owner before changing recovery state or sending scoped commands', async capabilities => {
    const client = new ExecutionClient('/unused', {} as never);
    const remote = { read: vi.fn(), mutate: vi.fn() };
    Object.assign(client, { remote, inventory: { capabilities }, observedAt: performance.now() });
    const token = recoveryState.token();
    const plan = { ...child, revision: 0, parentRevision: 0, phase: 'running' as const, apps: [] };
    await expect(client.orchestrator.inspectExecution(child)).rejects.toThrow('owner upgrade');
    await expect(client.orchestrator.stopExecution({ operationId: randomUUID(), plan })).rejects.toThrow('owner upgrade');
    await expect(client.orchestrator.enableExecution(child, { expectedRevision: 0 })).rejects.toThrow('owner upgrade');
    expect(remote.read).not.toHaveBeenCalled(); expect(remote.mutate).not.toHaveBeenCalled();
    expect(recoveryState.token()).toBe(token);
  });
});
