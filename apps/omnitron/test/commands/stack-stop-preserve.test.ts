import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ reviewStackStop: vi.fn(), stopStack: vi.fn(), disconnect: vi.fn(), error: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ LONG_REQUEST_TIMEOUT: 600000, isRequestTimeout: () => false,
  createDaemonClient: () => ({ service: async () => rpc, disconnect: rpc.disconnect }) }));
vi.mock('@xec-sh/kit', () => ({ log: { info: vi.fn(), warn: vi.fn() }, table: vi.fn(), note: vi.fn(),
  prism: new Proxy({}, { get: () => (text: string) => text }) }));
vi.mock('../../src/commands/output.js', () => ({ emitJson: vi.fn(() => false), emitError: rpc.error,
  emitStep: vi.fn(), emitSuccess: vi.fn(), emitInfo: vi.fn(), isJsonMode: () => false }));
import { stackStopCommand } from '../../src/commands/stack.js';

const digest = 'a'.repeat(64);
const exitCode = process.exitCode;
beforeEach(() => {
  vi.clearAllMocks(); process.exitCode = exitCode;
  rpc.reviewStackStop.mockResolvedValue({ keepInfrastructure: true, digest, targets: [] });
  rpc.stopStack.mockResolvedValue({ status: 'stopped', stopOperation: { phase: 'stopped', keepInfrastructure: true, nodes: [] } });
});
afterEach(() => { process.exitCode = exitCode; });

it('refuses an old controller that silently ignores the infrastructure option', async () => {
  rpc.reviewStackStop.mockResolvedValue({ digest, targets: [] });
  await stackStopCommand('sample', 'dev', { keepInfrastructure: true });
  expect(rpc.stopStack).not.toHaveBeenCalled();
  expect(rpc.error).toHaveBeenCalled();
  expect(rpc.disconnect).toHaveBeenCalled();
});

it('binds the application stop to the current mode and resource review', async () => {
  await stackStopCommand('sample', 'dev', { keepInfrastructure: true });
  expect(rpc.reviewStackStop).toHaveBeenCalledWith({ project: 'sample', stack: 'dev', keepInfrastructure: true });
  expect(rpc.stopStack).toHaveBeenCalledWith({ project: 'sample', stack: 'dev', keepInfrastructure: true, review: digest });
  expect(rpc.error).not.toHaveBeenCalled();
});

it('refuses a supplied review when its resource inventory changed', async () => {
  await stackStopCommand('sample', 'dev', { keepInfrastructure: true, review: 'b'.repeat(64) });
  expect(rpc.stopStack).not.toHaveBeenCalled();
  expect(rpc.error).toHaveBeenCalled();
});

it('does not claim preservation without the durable operation acknowledgement', async () => {
  rpc.stopStack.mockResolvedValue({ status: 'stopped', stopOperation: { phase: 'stopped', nodes: [] } });
  await stackStopCommand('sample', 'dev', { keepInfrastructure: true });
  expect(rpc.stopStack).toHaveBeenCalledOnce();
  expect(rpc.error).toHaveBeenCalled();
});

it('only reviews resources in dry-run mode', async () => {
  await stackStopCommand('sample', 'dev', { keepInfrastructure: true, dryRun: true });
  expect(rpc.reviewStackStop).toHaveBeenCalledOnce();
  expect(rpc.stopStack).not.toHaveBeenCalled();
});
