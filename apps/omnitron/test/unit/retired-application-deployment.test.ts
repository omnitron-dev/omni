import { describe, expect, it, vi } from 'vitest';
import { DeployService } from '../../src/services/deploy.service.js';
import { createManagementTools } from '../../src/mcp/tool-groups/management.tools.js';

describe('retired application deployment API', () => {
  it.each([0, -1, 501, 1.5, NaN, Infinity])('bounds historical reads before a query for %s', async limit => {
    const selectFrom = vi.fn();
    const service = new DeployService({ selectFrom } as never);
    await expect(service.getHistory(undefined, limit)).rejects.toThrow(/between 1 and 500/);
    expect(selectFrom).not.toHaveBeenCalled();
  });
  it.each(['all-at-once', 'rolling', 'blue-green', 'canary'] as const)('refuses %s before touching data or applications', async strategy => {
    const touched = vi.fn();
    const db = new Proxy({}, { get: (_target, property) => { touched(property); throw new Error('Database access is forbidden'); } });
    const service = new DeployService(db as never);
    await expect(service.deploy({ app: 'sample/prod/api', version: 'v2', strategy })).rejects.toThrow(/no artifact executor/);
    await expect(service.rollback('sample/prod/api')).rejects.toThrow(/no previous artifact/);
    expect(touched).not.toHaveBeenCalled();
    expect(await service.listDeployableApps()).toEqual([]);
  });

  it('keeps historical operation records readable without reinterpreting their labels', async () => {
    const record = { id: 'r1', app: 'sample/prod/api', version: 'requested-v2', strategy: 'canary', status: 'success', startedAt: new Date('2026-01-01'), completedAt: new Date('2026-01-02'), deployedBy: 'operator' };
    const query = { selectAll: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), where: vi.fn(), execute: vi.fn(async () => [record]) };
    for (const name of ['selectAll', 'orderBy', 'limit', 'where'] as const) query[name].mockReturnValue(query);
    const service = new DeployService({ selectFrom: vi.fn(() => query) } as never);
    expect(await service.getHistory('sample/prod/api')).toEqual([{ ...record, previousVersion: null, startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-02T00:00:00.000Z' }]);
    expect(query.where).toHaveBeenCalledWith('app', '=', 'sample/prod/api');
  });

  it('exposes real stack release selection to agents without advertising fake app mutations', async () => {
    const startStack = vi.fn(async () => ({ status: 'running' }));
    const client = { service: vi.fn(async () => ({ startStack })) };
    const tools = createManagementTools(client as never);
    expect(tools.some(tool => tool.name === 'deploy.app' || tool.name === 'deploy.rollback')).toBe(false);
    const start = tools.find(tool => tool.name === 'stack.start')!;
    await start.handler({ project: 'sample', stack: 'prod', release: 'sample-previous' });
    expect(startStack).toHaveBeenCalledWith({ project: 'sample', stack: 'prod', release: 'sample-previous' });
  });
});
