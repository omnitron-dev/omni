import { describe, expect, it, vi } from 'vitest';
import { ProjectService } from '../../src/services/project.service.js';
import { StackTargets } from '../../src/project/stack-targets.js';
const project = 'sample', stack = 'prod';
function fixture(remote = true) {
  const data = new Map<string, unknown>();
  const nodes = [{ host: 'one.test', port: 9700, role: 'app' }, { host: 'two.test', port: 9700, role: 'app' }];
  const config: any = { apps: [{ name: 'api', script: './api.js' }], stacks: { prod: { type: remote ? 'remote' : 'local', nodes: remote ? nodes : [] } } };
  const calls: string[] = [];
  const invoke = vi.fn(async (host: string, _port: number, _service: string, method: string, args: any[]) => {
    calls.push(`${host}:${method}`);
    if (method === 'prepareNodeStackStop') return { protocol: 1, project, stack, operationId: host };
    return { protocol: 1, project, stack, operationId: args[0].operationId, outcome: 'stopped', observedAt: new Date().toISOString() };
  });
  const service: any = Object.assign(Object.create(ProjectService.prototype), {
    startsInFlight: new Map(), stopsInFlight: new Map(), stackStates: new Map(), ownershipFrozen: false,
    emit: vi.fn(), loadProjectConfig: vi.fn(async () => config), resolveStacks: () => config.stacks,
    resolveStackApps: () => config.apps,
    registry: { setStackEnabled: vi.fn() },
    daemonStateStore: {
      kvUpdateSync: vi.fn((key: string, update: (current: unknown) => unknown) => { const value = update(data.get(key) ?? null); data.set(key, structuredClone(value)); return value; }),
      kvGetSync: (key: string) => data.get(key) ?? null,
    },
    slaveConnector: { invokeOnSlave: invoke, removeSlave: vi.fn() },
    orchestrator: { inspectStackExecution: vi.fn().mockResolvedValue({ project, stack, revision: 0, phase: 'running', apps: [] }), stopStackExecution: vi.fn().mockResolvedValue({}) },
    infraManager: { teardownStack: vi.fn().mockResolvedValue(undefined) },
    toStackInfo: () => ({ name: stack, type: config.stacks.prod.type, status: service.stackStates.get('sample/prod')?.status,
      stopOperation: data.get('stack:sample/prod:last-stop') }),
  });
  return { service, calls, invoke, data };
}
describe('stack stop coordinator', () => {
  it('includes previous deployment targets after a config edit and clears them only after all receipts', async () => {
    const { service, calls } = fixture();
    const targets = new StackTargets(service.daemonStateStore);
    targets.remember({ project, stack }, [{ host: 'previous.test', port: 9700, applications: true }]);
    await service.stopStack(project, stack);
    expect(calls).toContain('previous.test:prepareNodeStackStop');
    expect(calls).toContain('previous.test:executeNodeStackStop');
    expect(targets.inspect({ project, stack }).nodes).toEqual([]);
  });
  it('retains remote obligations even if the current stack declaration becomes local', async () => {
    const { service, calls } = fixture(false);
    new StackTargets(service.daemonStateStore).remember({ project, stack }, [{ host: 'previous.test', port: 9700, applications: true }]);
    await service.stopStack(project, stack);
    expect(service.orchestrator.stopStackExecution).toHaveBeenCalledOnce();
    expect(calls).toEqual(['previous.test:prepareNodeStackStop', 'previous.test:executeNodeStackStop']);
  });
  it('does not forget an unreachable historical target or begin stopping the reachable ones', async () => {
    const { service, invoke } = fixture();
    const targets = new StackTargets(service.daemonStateStore);
    targets.remember({ project, stack }, [{ host: 'previous.test', port: 9700, applications: true }]);
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (...args) => {
      if (args[0] === 'previous.test') throw new Error('unreachable');
      return original(...args);
    });
    await expect(service.stopStack(project, stack)).rejects.toThrow('unreachable');
    expect(invoke.mock.calls.every(call => call[3] === 'prepareNodeStackStop')).toBe(true);
    expect(targets.inspect({ project, stack }).nodes.map(node => node.host)).toEqual(['one.test', 'previous.test', 'two.test']);
  });

  it('prepares every node before effects and retains RPC connections for observation', async () => {
    const { service, calls } = fixture();
    const result = await service.stopStack(project, stack);
    expect(calls).toEqual(['one.test:prepareNodeStackStop', 'two.test:prepareNodeStackStop',
      'one.test:executeNodeStackStop', 'two.test:executeNodeStackStop']);
    expect(service.registry.setStackEnabled).toHaveBeenCalledWith(project, stack, false);
    expect(service.slaveConnector.removeSlave).not.toHaveBeenCalled();
    expect(service.infraManager.teardownStack).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'stopped', stopOperation: { phase: 'stopped', nodes: [
      { node: 'one.test:9700', outcome: 'stopped' }, { node: 'two.test:9700', outcome: 'stopped' },
    ] } });
  });
  it('does not send any stop if a node cannot establish ownership', async () => {
    const { service, invoke, calls } = fixture();
    invoke.mockImplementation(async host => {
      if (host === 'two.test') throw new Error('source-stack binding missing');
      calls.push(host);
      return { protocol: 1, project, stack, operationId: host } as never;
    });
    await expect(service.stopStack(project, stack)).rejects.toThrow('binding missing');
    expect(invoke.mock.calls.every(call => call[3] === 'prepareNodeStackStop')).toBe(true);
    expect(service.registry.setStackEnabled).not.toHaveBeenCalled();
  });
  it('retains per-node uncertainty and never claims stopped after an RPC disconnect', async () => {
    const { service, invoke, data } = fixture();
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (...args) => {
      if (args[0] === 'two.test' && args[3] === 'executeNodeStackStop') throw new Error('RPC disconnected; outcome unknown');
      return original(...args);
    });
    await expect(service.stopStack(project, stack)).rejects.toThrow('unconfirmed');
    expect(data.get('stack:sample/prod:last-stop')).toMatchObject({ phase: 'failed', intentCommitted: true, nodes: [
      { node: 'one.test:9700', outcome: 'stopped' }, { node: 'two.test:9700', outcome: 'unknown', reason: expect.stringContaining('RPC disconnected') },
    ] });
    expect(service.stackStates.get('sample/prod').status).toBe('error');
  });
  it('does not remove local infrastructure while process termination is unconfirmed', async () => {
    const { service } = fixture(false);
    service.orchestrator.stopStackExecution.mockRejectedValue(new Error('process still alive'));
    await expect(service.stopStack(project, stack)).rejects.toThrow('still alive');
    expect(service.infraManager.teardownStack).not.toHaveBeenCalled();
    expect(service.registry.setStackEnabled).toHaveBeenCalledWith(project, stack, false);
  });
  it('refuses effects if the durable resume intent cannot be disabled', async () => {
    const { service } = fixture(false);
    service.registry.setStackEnabled.mockImplementation(() => { throw new Error('disk full'); });
    await expect(service.stopStack(project, stack)).rejects.toThrow('disk full');
    expect(service.orchestrator.stopStackExecution).not.toHaveBeenCalled();
  });
  it('observes even a cached stopped stack and coalesces concurrent stop requests', async () => {
    const { service } = fixture(false);
    service.stackStates.set('sample/prod', { config: { type: 'local' }, status: 'stopped' });
    const [first, second] = await Promise.all([service.stopStack(project, stack), service.stopStack(project, stack)]);
    expect(first).toEqual(second);
    expect(service.orchestrator.inspectStackExecution).toHaveBeenCalledOnce();
    expect(service.orchestrator.stopStackExecution).toHaveBeenCalledOnce();
  });
  it('stops a generated local allocation through the source-bound protocol including infrastructure', async () => {
    const { service } = fixture(false);
    const origin = { project: 'sample', stack: 'upstream' };
    service.stackStates.set('sample/prod', { config: { type: 'local', managedOrigin: origin }, status: 'running' });
    service.nodeStackStop = { prepare: vi.fn(async () => ({ operationId: 'prepared' })), execute: vi.fn(async () => ({})) };
    await service.stopStack(project, stack);
    expect(service.nodeStackStop.prepare).toHaveBeenCalledWith({ ...origin, applications: true });
    expect(service.nodeStackStop.execute).toHaveBeenCalledWith({ ...origin, operationId: 'prepared' });
    expect(service.infraManager.teardownStack).not.toHaveBeenCalled();
    expect(service.orchestrator.stopStackExecution).not.toHaveBeenCalled();
  });
});
