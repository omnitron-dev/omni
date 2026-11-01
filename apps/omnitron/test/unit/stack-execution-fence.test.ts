import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';

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
    vi.spyOn(state, 'updateStackIntent').mockImplementation(() => { throw new Error('disk full'); });
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
