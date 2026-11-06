import { beforeEach, describe, expect, it, vi } from 'vitest';
const inspect = vi.hoisted(() => vi.fn());
const removed = vi.hoisted(() => vi.fn());
const native = vi.hoisted(() => vi.fn());
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<Record<string, unknown>>()), removeContainer: removed, inspectStackContainers: inspect, getContainerState: native,
}));
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import { InfrastructureRpcService } from '../../src/services/infrastructure.rpc-service.js';
const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return this; } };
beforeEach(() => removed.mockReset().mockResolvedValue(undefined));

describe('infrastructure stop acknowledgements', () => {
  it.each([true, false])('drains admitted provisioning and refuses new work once the stop intent commits (scoped=%s)', async scoped => {
    const rpc: any = new InfrastructureRpcService(() => null);
    const scope = { project: 'sample', stack: 'prod' };
    let stopping = false;
    rpc.setStackOperationGate(() => { if (stopping) throw new Error('stop pending'); });
    let finish!: () => void;
    const work = rpc.trackMutation(scoped ? scope : undefined, () => new Promise<void>(resolve => { finish = resolve; }));
    await Promise.resolve();
    stopping = true;
    const unexpected = vi.fn();
    expect(() => rpc.trackMutation(scope, unexpected)).toThrow('stop pending');
    expect(unexpected).not.toHaveBeenCalled();
    let drained = false;
    const drain = rpc.drainStackProvisioning(scope).then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await Promise.all([work, drain]);
    expect(drained).toBe(true);
  });

  it('retires one allocation after active reconciliation finishes and preserves the other stack', async () => {
    const service: any = new InfrastructureService(logger, { services: {} } as any);
    const own = { name: 'own', labels: { 'omnitron.project': 'sample', 'omnitron.stack': 'prod' } };
    const other = { name: 'other', labels: { 'omnitron.project': 'sample', 'omnitron.stack': 'test' } };
    service.desiredContainers = [own, other];
    let finish!: () => void;
    const sweep = new Promise<void>(resolve => { finish = resolve; });
    service.activeSweeps.add(sweep);
    const retired = service.retireStack({ project: 'sample', stack: 'prod' });
    expect(service.retiredStacks.has('sample/prod')).toBe(true);
    expect(service.desiredContainers).toEqual([own, other]);
    const reconcile = vi.spyOn(service, 'reconcileServiceLocked').mockResolvedValue(undefined);
    await service.reconcileService(own);
    expect(reconcile).not.toHaveBeenCalled();
    finish(); await retired;
    expect(service.desiredContainers).toEqual([other]);
    await service.reconcileService(other);
    expect(reconcile).toHaveBeenCalledWith(other);
    expect(removed).not.toHaveBeenCalled();
    service.dispose();
  });

  it('reports each failed container instead of claiming success', async () => {
    const service: any = new InfrastructureService(logger, { services: {} } as any);
    const labels = { 'omnitron.managed': 'true' };
    service.desiredContainers = [{ name: 'one', labels }, { name: 'two', labels }];
    native.mockImplementation(async name => ({ name, labels, containerId: (name === 'one' ? '1' : '2').repeat(64) }));
    service.usingGlobalOmnitronPg = true;
    removed.mockImplementation(async name => { if (name === '1'.repeat(64)) throw new Error('Docker unavailable'); });
    await expect(service.teardown()).rejects.toThrow('one: Error: Docker unavailable');
    expect(removed).toHaveBeenCalledTimes(2);
    expect(service.getState().ready).toBe(false);
  });
  it('retains failed stack ownership and port reservations for retry', async () => {
    const reviewed = [{ name: 'pg', id: 'a'.repeat(64) }];
    inspect.mockResolvedValueOnce(reviewed).mockResolvedValueOnce(reviewed).mockResolvedValueOnce([]);
    removed.mockRejectedValueOnce(new Error('container still alive')).mockResolvedValue(undefined);
    const relinquishMonitoring = vi.fn().mockResolvedValue(['pg']);
    const manager: any = Object.assign(new StackInfrastructureManager(logger), {
      instances: new Map([['project/prod', { relinquishMonitoring }]]), portAllocations: new Map([['project/prod', [5432]]]), logger,
    });
    await expect(manager.teardownStack('project', 'prod', reviewed)).rejects.toThrow('still alive');
    expect(manager.instances.has('project/prod')).toBe(true);
    expect(manager.portAllocations.has('project/prod')).toBe(true);
    await manager.teardownStack('project', 'prod', reviewed);
    expect(manager.instances.size).toBe(0);
    expect(manager.portAllocations.size).toBe(0);
  });
  it('does not forget failed stacks during bulk teardown', async () => {
    const manager: any = Object.assign(new StackInfrastructureManager(logger), {
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
