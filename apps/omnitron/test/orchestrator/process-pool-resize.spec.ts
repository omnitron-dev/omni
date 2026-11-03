import { describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { IProcessEntry } from '../../src/config/types.js';

function fixture(scaling?: IProcessEntry['scaling']) {
  const pm = { getWorkerHandle: () => ({ pid: process.pid }), getProcess: () => ({ startTime: Date.now() }) };
  const save = vi.fn();
  const owner = new OrchestratorService(createNullLogger(), pm as never, { save } as never, '/tmp', { reapForeignOrphans: false });
  const handle = new AppHandle({ name: 'fixture', bootstrap: '/tmp/not-executed.mjs' }, 'bootstrap');
  handle.status = 'online';
  const declaration: IProcessEntry = { name: 'workers', module: './not-executed.mjs', instances: 2, ...(scaling ? { scaling } : {}) };
  handle.topologyProcesses = [declaration, { name: 'singleton', module: './not-executed.mjs' }];
  handle.supervisor = { getChildNames: () => [], getChildProcessId: () => null, getRestartCount: () => 0 } as never;
  const pool = { size: 2, getWorkerIds: () => Array.from({ length: pool.size }, (_, n) => `worker-${n}`),
    scale: vi.fn(async (count: number) => { pool.size = count; }) };
  handle.topologyPools.set('workers', pool as never);
  const internals = owner as unknown as { handles: Map<string, AppHandle>; config: unknown };
  internals.handles.set('fixture', handle); internals.config = { ...DEFAULT_ECOSYSTEM, apps: [handle.entry] };
  return { owner, handle, pool, declaration, save };
}

describe('declared process pool resize', () => {
  it('resizes exactly the selected pool and exposes observed vs declared size without a durable override', async () => {
    const { owner, pool, handle, declaration, save } = fixture({ strategy: 'fixed', maxInstances: 4 });
    const entry = structuredClone(handle.entry), metadata = structuredClone(declaration);
    await owner.scaleApp('fixture', 4, 'workers');
    expect(pool.scale).toHaveBeenCalledWith(4);
    expect(owner.getApp('fixture')?.processes?.find(p => p.name === 'workers')).toMatchObject({ instances: 4, declaredInstances: 2 });
    expect(handle.entry).toEqual(entry); expect(declaration).toEqual(metadata); expect(handle.instanceCount).toBe(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]![0].apps[0]).not.toHaveProperty('instances');
    await owner.scaleApp('fixture', 1, 'workers');
    expect(owner.getApp('fixture')?.processes?.find(p => p.name === 'workers')).toMatchObject({ instances: 1, declaredInstances: 2 });
    expect(handle.topologyPools.has('workers')).toBe(true);
  });
  it('keeps no-op honest and still rejects ambiguous targets', async () => {
    const { owner, pool } = fixture();
    await owner.scaleApp('fixture', 2, 'workers'); expect(pool.scale).not.toHaveBeenCalled();
    await expect(owner.scaleApp('fixture', 2)).rejects.toThrow('--process');
    for (const target of ['singleton', 'absent']) await expect(owner.scaleApp('fixture', 2, target)).rejects.toThrow('singleton');
    expect(pool.scale).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses invalid size %s before pool work', async count => {
    const { owner, pool } = fixture();
    await expect(owner.scaleApp('fixture', count, 'workers')).rejects.toThrow('positive safe integer');
    expect(pool.scale).not.toHaveBeenCalled();
  });
  it('enforces fixed default and explicit declared bounds', async () => {
    const fixed = fixture();
    await expect(fixed.owner.scaleApp('fixture', 3, 'workers')).rejects.toThrow('1..2');
    expect(fixed.pool.scale).not.toHaveBeenCalled();
    const explicit = fixture({ strategy: 'fixed', maxInstances: 4 });
    await expect(explicit.owner.scaleApp('fixture', 5, 'workers')).rejects.toThrow('1..4');
  });
  it('retains automatic policy and its declared minimum/default maximum', async () => {
    const { owner, pool, declaration } = fixture({ strategy: 'auto' });
    await expect(owner.scaleApp('fixture', 1, 'workers')).rejects.toThrow('2..8');
    await expect(owner.scaleApp('fixture', 9, 'workers')).rejects.toThrow('2..8');
    await owner.scaleApp('fixture', 3, 'workers');
    expect(pool.size).toBe(3); expect(declaration.scaling).toEqual({ strategy: 'auto' });
  });
  it('never reports partial or mismatched membership as successful', async () => {
    const { owner, pool, save } = fixture({ strategy: 'fixed', maxInstances: 4 });
    pool.scale.mockImplementationOnce(async () => { pool.size = 3; throw new Error('one worker failed'); });
    await expect(owner.scaleApp('fixture', 4, 'workers')).rejects.toThrow('one worker failed');
    expect(owner.getApp('fixture')?.processes?.find(p => p.name === 'workers')?.instances).toBe(3);
    expect(save).not.toHaveBeenCalled();
    pool.scale.mockResolvedValueOnce(undefined);
    await expect(owner.scaleApp('fixture', 4, 'workers')).rejects.toThrow('unconfirmed');
    expect(save).not.toHaveBeenCalled();
  });
  it('refuses stopped applications before changing pool membership', async () => {
    const { owner, handle, pool } = fixture(); handle.status = 'stopped';
    await expect(owner.scaleApp('fixture', 1, 'workers')).rejects.toThrow('online');
    expect(pool.scale).not.toHaveBeenCalled();
  });
});
