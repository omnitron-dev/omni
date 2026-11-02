import { describe, expect, it, vi } from 'vitest';
import { shutdownExecutionOwner } from '../../src/daemon/execution-shutdown.js';

function harness() {
  const calls: string[] = [];
  const step = (name: string) => vi.fn(async () => { calls.push(name); });
  const steps = { phase: vi.fn(), stopWatching: vi.fn(), stopApplications: step('applications'),
    stopProcesses: step('processes'), flushState: step('state'), flushLogs: step('logs'),
    stopRpc: step('rpc'), closeStorage: step('storage'), removePid: vi.fn() };
  return { calls, steps };
}
describe('execution owner clean-shutdown evidence', () => {
  it('only completes after all process termination and persistence steps', async () => {
    const { steps, calls } = harness();
    await shutdownExecutionOwner(steps);
    expect(calls).toEqual(['applications', 'processes', 'state', 'logs', 'rpc', 'storage']);
    expect(steps.removePid).toHaveBeenCalledOnce();
    expect(steps.phase).toHaveBeenLastCalledWith('complete');
  });
  it('attempts remaining process termination after an application fails, without certifying clean', async () => {
    const { steps } = harness();
    steps.stopApplications.mockRejectedValue(new Error('supervisor failed'));
    const cleanReceipt = vi.fn();
    await expect(shutdownExecutionOwner(steps).then(cleanReceipt)).rejects.toThrow('termination is unconfirmed');
    expect(steps.stopProcesses).toHaveBeenCalledOnce();
    expect(steps.closeStorage).not.toHaveBeenCalled();
    expect(steps.removePid).not.toHaveBeenCalled(); expect(cleanReceipt).not.toHaveBeenCalled();
  });
  it('retains both application and manager errors', async () => {
    const { steps } = harness();
    steps.stopApplications.mockRejectedValue(new Error('application failure'));
    steps.stopProcesses.mockRejectedValue(new Error('manager failure'));
    const error = await shutdownExecutionOwner(steps).catch(error => error);
    expect(error.errors).toHaveLength(2);
    expect(error.errors.map(String).join(' ')).toContain('application failure');
    expect(error.errors.map(String).join(' ')).toContain('manager failure');
  });
  it('attempts every persistence cleanup but refuses clean on a failed flush', async () => {
    const { steps } = harness();
    steps.flushState.mockRejectedValue(new Error('disk write failed'));
    const cleanReceipt = vi.fn();
    await expect(shutdownExecutionOwner(steps).then(cleanReceipt)).rejects.toThrow('persistence shutdown is incomplete');
    expect(steps.flushLogs).toHaveBeenCalledOnce(); expect(steps.stopRpc).toHaveBeenCalledOnce();
    expect(steps.closeStorage).toHaveBeenCalledOnce(); expect(steps.removePid).not.toHaveBeenCalled();
    expect(cleanReceipt).not.toHaveBeenCalled();
  });
});
