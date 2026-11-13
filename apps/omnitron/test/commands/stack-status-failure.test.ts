import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getStack: vi.fn(), disconnect: vi.fn(), warn: vi.fn(), json: vi.fn(), error: vi.fn(), jsonMode: false }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ LONG_REQUEST_TIMEOUT: 600000,
  isRequestTimeout: () => false,
  createDaemonClient: () => ({ service: async () => ({ getStack: mock.getStack }), disconnect: mock.disconnect }) }));
vi.mock('@xec-sh/kit', () => ({ log: { info: vi.fn(), warn: mock.warn }, table: vi.fn(), note: vi.fn(),
  prism: new Proxy({}, { get: () => (text: string) => text }) }));
vi.mock('../../src/commands/output.js', () => ({ emitJson: mock.json, emitError: mock.error, emitStep: vi.fn(),
  emitSuccess: vi.fn(), emitInfo: vi.fn(), isJsonMode: () => mock.jsonMode }));
import { stackStatusCommand } from '../../src/commands/stack.js';

const issues = ['api (errored): module "dependency.js" is unavailable; verify dependency installation and the active runtime compiler',
  'worker (stopped): dependency api did not start'];
beforeEach(() => {
  vi.clearAllMocks(); mock.jsonMode = false;
  mock.getStack.mockResolvedValue({ name: 'dev', type: 'local', status: 'error', uptime: 0, apps: [], nodes: [],
    infrastructure: { ready: true, services: {} }, notUp: issues });
});
describe('stack status launch evidence', () => {
  it('shows every unavailable application and its reason in ordinary output', async () => {
    await stackStatusCommand('sample', 'dev');
    expect(mock.warn.mock.calls).toEqual(issues.map(reason => [`Not up: ${reason}`]));
    expect(mock.disconnect).toHaveBeenCalled();
    expect(mock.error).not.toHaveBeenCalled();
  });
  it('retains the same evidence in the machine-readable response', async () => {
    mock.jsonMode = true;
    await stackStatusCommand('sample', 'dev');
    expect(mock.json).toHaveBeenCalledWith(expect.objectContaining({ notUp: issues }));
    expect(mock.warn).not.toHaveBeenCalled();
    expect(mock.error).not.toHaveBeenCalled();
  });
  it('returns the RPC failure to callers and exits unsuccessfully', async () => {
    mock.jsonMode = true;
    const error = Object.assign(new Error('Stack is unavailable'), { code: 'RPC_UNAVAILABLE' });
    mock.getStack.mockRejectedValueOnce(error);
    const previous = process.exitCode;
    try {
      await stackStatusCommand('sample', 'dev');
      expect(mock.error).toHaveBeenCalledWith(error);
      expect(mock.json).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    } finally { process.exitCode = previous; }
  });
});
