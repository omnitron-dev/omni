import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const loaded = vi.hoisted(() => vi.fn());
vi.mock('../../src/daemon/startup-config.js', () => ({ loadStartupEcosystem: loaded }));
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import { ensureNamespacedEntry } from '../../src/orchestrator/app-name.js';
import type { IEcosystemConfig, ProcessInfoDto } from '../../src/config/types.js';

beforeEach(() => loaded.mockReset());
function fixture(status: ProcessInfoDto['status'] = 'online') {
  const initial = { ...DEFAULT_ECOSYSTEM, apps: [{ name: 'old', script: '/old.js' }] };
  let observed: Pick<ProcessInfoDto, 'name' | 'status' | 'pid'>[] = [];
  const owner = {
    setConfig: vi.fn().mockResolvedValue(undefined),
    startAll: vi.fn(async (config: IEcosystemConfig) => {
      observed = config.apps.filter(entry => entry.enabled !== false).map(entry => ({
        name: ensureNamespacedEntry(entry).name, status, pid: null,
      }));
    }),
    list: () => observed,
  };
  const daemon = { applyWatchConfig: vi.fn().mockResolvedValue(undefined) };
  return { initial, owner, daemon, service: new DaemonRpcService(owner as never, {} as never, {} as never, initial, daemon as never) };
}
describe('configuration reload uses the registered cold-start source', () => {
  it('updates owner, RPC startup identity and watcher from the same registered config', async () => {
    const f = fixture();
    const next: IEcosystemConfig = { ...DEFAULT_ECOSYSTEM, project: 'sample', stacks: { deployed: { type: 'local' } }, apps: [{ name: 'api', script: '/artifact/api.js' }] };
    loaded.mockResolvedValue(next);
    await expect(f.service.reloadConfig()).resolves.toEqual({ success: true });
    expect(loaded).toHaveBeenCalledWith(process.cwd());
    expect(f.owner.setConfig).toHaveBeenCalledWith(next);
    expect(f.daemon.applyWatchConfig).toHaveBeenCalledWith(next);
    expect(f.owner.list()).toEqual([]);
    await expect(f.service.startAll()).resolves.toEqual([{ name: 'sample/deployed/api', status: 'online', pid: null }]);
    expect(f.owner.startAll.mock.calls[0]![0].apps[0]!.env).toMatchObject({ OMNITRON_PROJECT: 'sample', OMNITRON_STACK: 'deployed' });
  });
  it('retains the prior RPC configuration when owner admission rejects a reload', async () => {
    const f = fixture(); loaded.mockResolvedValue({ apps: [] });
    f.owner.setConfig.mockRejectedValue(new Error('owner unavailable'));
    await expect(f.service.reloadConfig()).rejects.toThrow('owner unavailable');
    expect(f.daemon.applyWatchConfig).not.toHaveBeenCalled();
    await expect(f.service.startAll()).resolves.toEqual([{ name: 'old', status: 'online', pid: null }]);
    expect(f.owner.startAll).toHaveBeenCalledWith(f.initial);
  });
  it.each(['starting', 'errored', 'stopped'] as const)('rejects a %s observation after reloading the registered config', async status => {
    const f = fixture(status);
    loaded.mockResolvedValue({ ...DEFAULT_ECOSYSTEM, project: 'sample', stacks: { deployed: { type: 'local' } },
      apps: [{ name: 'api', script: '/artifact/api.js' }] });
    await f.service.reloadConfig();
    await expect(f.service.startAll()).rejects.toThrow(new RegExp(`sample/deployed/api.*${status}`));
    expect(f.owner.startAll).toHaveBeenCalledOnce();
  });
});
