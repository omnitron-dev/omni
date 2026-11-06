import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

const docker = vi.hoisted(() => ({ inspect: vi.fn(), remove: vi.fn() }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...await original<typeof import('../../src/infrastructure/container-runtime.js')>(),
  inspectStackContainers: docker.inspect, removeContainer: docker.remove,
}));
const before = { id: 'a'.repeat(64), name: 'sample-prod-db' };
const replacement = { ...before, id: 'b'.repeat(64) };
beforeEach(() => vi.resetAllMocks());
function fixture() {
  const owner = { getTeardownNames: () => [before.name], relinquishMonitoring: vi.fn(async () => [before.name]) };
  const manager = Object.assign(new StackInfrastructureManager(createNullLogger()), {
    instances: new Map([['sample/prod', owner]]), portAllocations: new Map(), logger: { error: vi.fn(), debug: vi.fn() },
  }) as StackInfrastructureManager;
  return { manager, owner };
}
describe('local stack container removal', () => {
  it('stops by reviewed Docker ID and releases the owner only after confirmed absence', async () => {
    const { manager, owner } = fixture();
    docker.inspect.mockResolvedValueOnce([before]).mockResolvedValueOnce([before]).mockResolvedValueOnce([]);
    const review = await manager.inspectStopContainers('sample', 'prod');
    await manager.teardownStack('sample', 'prod', review);
    expect(owner.relinquishMonitoring).toHaveBeenCalledOnce();
    expect(docker.remove).toHaveBeenCalledWith(before.id, { graceful: true });
    expect(manager.getInstance('sample', 'prod')).toBeNull();
  });
  it('retains the replacement and the outstanding owner after name reuse', async () => {
    const { manager, owner } = fixture();
    docker.inspect.mockResolvedValueOnce([before]).mockResolvedValueOnce([replacement]);
    const review = await manager.inspectStopContainers('sample', 'prod');
    await expect(manager.teardownStack('sample', 'prod', review)).rejects.toThrow('changed');
    expect(docker.remove).not.toHaveBeenCalled();
    expect(manager.getInstance('sample', 'prod')).toBe(owner);
  });
});
