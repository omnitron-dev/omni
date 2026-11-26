import { afterEach, expect, it, vi } from 'vitest';
import { stackSelectPlacementCommand } from '../../src/commands/stack.js';

const rpc = vi.hoisted(() => ({
  preflightRemotePlacement: vi.fn(), reviewRemotePlacement: vi.fn(), selectRemotePlacement: vi.fn(),
}));
const client = vi.hoisted(() => ({ service: vi.fn(async () => rpc), disconnect: vi.fn() }));
const output = vi.hoisted(() => ({ emitJson: vi.fn(() => true), emitError: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => client, LONG_REQUEST_TIMEOUT: 600000 }));
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
