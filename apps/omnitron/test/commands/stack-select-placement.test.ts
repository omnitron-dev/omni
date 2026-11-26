import { afterEach, expect, it, vi } from 'vitest';
import { stackSelectPlacementCommand, stackStartCommand } from '../../src/commands/stack.js';

const rpc = vi.hoisted(() => ({
  preflightRemotePlacement: vi.fn(), reviewRemotePlacement: vi.fn(), selectRemotePlacement: vi.fn(),
  checkRelease: vi.fn(), startStack: vi.fn(), deployReviewedRelease: vi.fn(), reviewStackStart: vi.fn(),
}));
const client = vi.hoisted(() => ({ service: vi.fn(async () => rpc), disconnect: vi.fn() }));
const output = vi.hoisted(() => ({ emitJson: vi.fn(() => true), emitError: vi.fn(), emitStep: vi.fn(), isJsonMode: () => true }));
vi.mock('../../src/daemon/daemon-client.js', async original => ({
  ...await original<typeof import('../../src/daemon/daemon-client.js')>(), createDaemonClient: () => client,
}));
vi.mock('../../src/commands/output.js', () => output);

const options = { fromNode: 'receiver', release: 'release-2', prepared: 'a'.repeat(64), previousDeclarationCommit: 'b'.repeat(40) };
const request = { project: 'sample', stack: 'prod', fromNodeId: options.fromNode, previousDeclarationCommit: options.previousDeclarationCommit,
  destination: { release: options.release, prepared: options.prepared } };
const exitCode = process.exitCode;
afterEach(() => { vi.clearAllMocks(); process.exitCode = exitCode; });

it('passes preflight evidence through JSON and leaves review and selection untouched', async () => {
  const proof = { fromNodeId: 'receiver', toNodeId: 'receiver', source: { revision: 8 } };
  rpc.preflightRemotePlacement.mockResolvedValueOnce(proof);
  await stackSelectPlacementCommand('sample', 'prod', { ...options, preflight: true });
  expect(rpc.preflightRemotePlacement).toHaveBeenCalledWith(request);
  expect(output.emitJson).toHaveBeenCalledWith(proof);
  expect(rpc.reviewRemotePlacement).not.toHaveBeenCalled();
  expect(rpc.selectRemotePlacement).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalledOnce();
});

it('rejects confirmation mixed with preflight before connecting', async () => {
  await stackSelectPlacementCommand('sample', 'prod', { ...options, preflight: true, review: 'c'.repeat(64) });
  expect(client.service).not.toHaveBeenCalled();
  expect(output.emitError).toHaveBeenCalledWith(expect.stringContaining('either preflight or confirmation'));
  expect(process.exitCode).toBe(1);
});

it('reports an unsupported preflight without invoking a post-stop operation', async () => {
  rpc.preflightRemotePlacement.mockRejectedValueOnce(Error('Unknown method'));
  await stackSelectPlacementCommand('sample', 'prod', { ...options, preflight: true });
  expect(output.emitError).toHaveBeenCalledWith('Unknown method');
  expect(output.emitJson).not.toHaveBeenCalled();
  expect(rpc.reviewRemotePlacement).not.toHaveBeenCalled();
  expect(rpc.selectRemotePlacement).not.toHaveBeenCalled();
});

it('uses one reviewed deployment from the ordinary start command and dry run', async () => {
  const digest = 'e'.repeat(64), input = { project: 'sample', stack: 'prod', release: 'release-2' };
  const admission = { ok: true, deployment: { digest, nodeId: 'receiver', rollback: { release: 'release-1' } } };
  rpc.checkRelease.mockResolvedValue(admission);
  await stackStartCommand(input.project, input.stack, { release: input.release, dryRun: true });
  expect(rpc.checkRelease).toHaveBeenCalledWith(input);
  expect(output.emitJson).toHaveBeenCalledWith(admission);
  expect(rpc.deployReviewedRelease).not.toHaveBeenCalled();
  rpc.deployReviewedRelease.mockResolvedValue({ status: 'running', apps: [{ name: 'main', status: 'online' }] });
  await stackStartCommand(input.project, input.stack, { release: input.release, deploymentReview: digest });
  expect(rpc.deployReviewedRelease).toHaveBeenCalledExactlyOnceWith({ ...input, review: digest });
  expect(rpc.startStack).not.toHaveBeenCalled();
  expect(rpc.reviewStackStart).not.toHaveBeenCalled();
  expect(output.emitError).not.toHaveBeenCalled();
});

it('keeps a refused replacement visible without issuing a preservation or start request', async () => {
  rpc.checkRelease.mockResolvedValue({ ok: false, state: 'replacement-unavailable', because: 'Missing return release' });
  await stackStartCommand('sample', 'prod', { release: 'release-2', dryRun: true });
  expect(process.exitCode).toBe(1);
  await stackStartCommand('sample', 'prod', { release: 'release-2', deploymentReview: 'f'.repeat(64), workingTree: true });
  expect(rpc.reviewStackStart).not.toHaveBeenCalled();
  expect(rpc.startStack).not.toHaveBeenCalled();
  expect(rpc.deployReviewedRelease).not.toHaveBeenCalled();
});
