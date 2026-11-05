import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import { OrchestratorService, ensureNamespacedEntry } from '../../src/orchestrator/orchestrator.service.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';

function fixture(config: IEcosystemConfig, fail?: string) {
  const started: IEcosystemAppEntry[] = [];
  const orchestrator = Object.assign(Object.create(OrchestratorService.prototype), {
    ensureBootReconciled: async () => {}, persistState: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    startApp: async (entry: IEcosystemAppEntry) => {
      if (entry.name === fail) throw new Error('fixture launch rejected');
      started.push(ensureNamespacedEntry(entry));
    },
    list: () => started.map(entry => ({ name: entry.name, status: 'online' })),
  });
  return { started, rpc: new DaemonRpcService(orchestrator, {} as never, {} as never, config, {} as never) };
}

describe('bulk startup preserves project identity', () => {
  const config = (): IEcosystemConfig => ({ ...DEFAULT_ECOSYSTEM, project: 'sample', stacks: { deployed: { type: 'local' } }, apps: [
    { name: 'database', bootstrap: '/artifacts/database/bootstrap.js' },
    { name: 'api', bootstrap: '/artifacts/api/bootstrap.js', dependsOn: ['database'] },
  ] });

  it('returns the canonical stack identities while retaining dependency ordering and source configuration', async () => {
    const source = config(), before = structuredClone(source), f = fixture(source);
    const result = await f.rpc.startAll();
    expect(result.map(app => app.name)).toEqual(['sample/deployed/database', 'sample/deployed/api']);
    expect(source).toEqual(before);
  });
  it('keeps downstream apps blocked when their declared dependency fails', async () => {
    const f = fixture(config(), 'database'); await f.rpc.startAll();
    expect(f.started).toEqual([]);
  });
  it('preserves explicit per-app scope and unscoped daemon entries', async () => {
    const source = config(); source.apps[1]!.env = { OMNITRON_PROJECT: 'other', OMNITRON_STACK: 'prod' };
    const f = fixture(source); await f.rpc.startAll();
    expect(f.started[1]!.name).toBe('other/prod/api');
    const unscoped = fixture({ apps: [{ name: 'worker', script: '/worker.js' }] } as IEcosystemConfig);
    expect((await unscoped.rpc.startAll())[0]!.name).toBe('worker');
  });
});
