import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fleetRolloutCommand } from '../../src/commands/fleet-rollout.js';

const rpc = vi.hoisted(() => ({
  listNodes: vi.fn(), planKernelRollout: vi.fn(), startKernelRollout: vi.fn(), getKernelRollout: vi.fn(), reconcileKernelRollout: vi.fn(),
}));
const output = vi.hoisted(() => ({ emitJson: vi.fn(() => true), emitInfo: vi.fn(), emitError: vi.fn() }));
vi.mock('../../src/commands/output.js', () => output);
vi.mock('../../src/commands/daemon-required.js', () => ({ requireDaemon: async () => true }));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 60000,
  createDaemonClient: () => ({ service: async () => rpc, disconnect: async () => {} }),
}));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));

const commit = 'a'.repeat(40);
const id = '18ae7c6e-0b69-432a-9674-ff638528dfa5';
const plan = { id, commit, updatedAt: 'now', state: 'planned', targets: [] };
const originalExit = process.exitCode;
beforeEach(() => { vi.resetAllMocks(); output.emitJson.mockReturnValue(true); process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExit; });

it('submits the reviewed plan in the requested node order', async () => {
  rpc.listNodes.mockResolvedValue([{ id: '1', name: 'test' }, { id: '2', name: 'production' }]);
  rpc.planKernelRollout.mockResolvedValue({ ...plan, state: 'planning' });
  rpc.getKernelRollout.mockResolvedValue(plan);
  rpc.startKernelRollout.mockResolvedValue({ ...plan, state: 'running' });
  await fleetRolloutCommand({ kind: 'plan', commit, nodes: ['production', 'test'], apply: true, requestId: id });
  expect(rpc.planKernelRollout).toHaveBeenCalledWith({ requestId: id, commit, nodeIds: ['2', '1'] });
  expect(rpc.startKernelRollout.mock.calls).toEqual([[{ id }]]);
  expect(rpc.getKernelRollout.mock.calls).toEqual([[{ id }]]);
  expect(output.emitJson).toHaveBeenCalledWith({ ...plan, state: 'running' });
});

it('reports blocked batch plans without submitting any server', async () => {
  rpc.planKernelRollout.mockResolvedValue({ ...plan, state: 'blocked' });
  await fleetRolloutCommand({ kind: 'plan', commit, nodes: [], apply: true, requestId: id });
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it('follows the selected operation even when a newer plan becomes the default', async () => {
  rpc.getKernelRollout.mockResolvedValueOnce({ ...plan, state: 'running' })
    .mockResolvedValueOnce({ ...plan, state: 'uncertain' });
  await fleetRolloutCommand({ kind: 'status', id: undefined, wait: true });
  expect(rpc.getKernelRollout.mock.calls).toEqual([[{}], [{ id }]]);
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it('waits for qualification without authorizing the update', async () => {
  rpc.planKernelRollout.mockResolvedValue({ ...plan, state: 'planning' });
  rpc.getKernelRollout.mockResolvedValue(plan);
  await fleetRolloutCommand({ kind: 'plan', commit, requestId: id, nodes: [], apply: false, wait: true });
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
  expect(output.emitJson).toHaveBeenCalledWith(plan);
});

it('finishes one combined submission with the confirmed terminal receipt', async () => {
  rpc.planKernelRollout.mockResolvedValue({ ...plan, state: 'planning' });
  rpc.getKernelRollout.mockResolvedValueOnce(plan).mockResolvedValueOnce({ ...plan, state: 'succeeded' });
  rpc.startKernelRollout.mockResolvedValue({ ...plan, state: 'running' });
  await fleetRolloutCommand({ kind: 'plan', commit, requestId: id, nodes: [], apply: true, wait: true });
  expect(rpc.startKernelRollout.mock.calls).toEqual([[{ id }]]);
  expect(output.emitJson).toHaveBeenCalledWith({ ...plan, state: 'succeeded' });
});

it('reconciles without submitting or replaying a handoff', async () => {
  rpc.reconcileKernelRollout.mockResolvedValue({ ...plan, state: 'failed' });
  await fleetRolloutCommand({ kind: 'reconcile', id });
  expect(rpc.reconcileKernelRollout.mock.calls).toEqual([[{ id }]]);
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it('returns the request ID after a lost plan response and does not apply', async () => {
  rpc.planKernelRollout.mockRejectedValue(Error('connection lost'));
  await fleetRolloutCommand({ kind: 'plan', commit, nodes: [], apply: true });
  const requestId = rpc.planKernelRollout.mock.calls[0]![0].requestId;
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(output.emitError).toHaveBeenCalledWith(expect.stringContaining(requestId), { rolloutId: requestId });
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
});
