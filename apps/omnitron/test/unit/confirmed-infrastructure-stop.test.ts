import { beforeEach, describe, expect, it, vi } from 'vitest';
const removed = vi.hoisted(() => vi.fn());
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<Record<string, unknown>>()), removeContainer: removed,
}));
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return this; } };
beforeEach(() => removed.mockReset().mockResolvedValue(undefined));

describe('infrastructure stop acknowledgements', () => {
  it('reports each failed container instead of claiming success', async () => {
    const service: any = new InfrastructureService(logger, { services: {} } as any);
    service.desiredContainers = [{ name: 'one' }, { name: 'two' }];
    service.usingGlobalOmnitronPg = true;
    removed.mockImplementation(async name => { if (name === 'one') throw new Error('Docker unavailable'); });
    await expect(service.teardown()).rejects.toThrow('one: Error: Docker unavailable');
    expect(removed).toHaveBeenCalledTimes(2);
    expect(service.getState().ready).toBe(false);
  });
  it('retains failed stack ownership and port reservations for retry', async () => {
    const teardown = vi.fn().mockRejectedValueOnce(new Error('container still alive')).mockResolvedValue(undefined);
    const manager: any = Object.assign(Object.create(StackInfrastructureManager.prototype), {
      instances: new Map([['project/prod', { teardown }]]), portAllocations: new Map([['project/prod', [5432]]]), logger,
    });
    await expect(manager.teardownStack('project', 'prod')).rejects.toThrow('still alive');
    expect(manager.instances.has('project/prod')).toBe(true);
    expect(manager.portAllocations.has('project/prod')).toBe(true);
    await manager.teardownStack('project', 'prod');
    expect(manager.instances.size).toBe(0);
    expect(manager.portAllocations.size).toBe(0);
  });
  it('does not forget failed stacks during bulk teardown', async () => {
    const manager: any = Object.assign(Object.create(StackInfrastructureManager.prototype), {
      instances: new Map([
        ['project/prod', { teardown: vi.fn().mockRejectedValue(new Error('offline')) }],
        ['project/test', { teardown: vi.fn().mockResolvedValue(undefined) }],
      ]), portAllocations: new Map([['project/prod', []], ['project/test', []]]), logger,
    });
    await expect(manager.teardownAll()).rejects.toThrow('offline');
    expect([...manager.instances.keys()]).toEqual(['project/prod']);
    expect([...manager.portAllocations.keys()]).toEqual(['project/prod']);
  });
});
