import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({
  set: vi.fn(),
  disconnect: vi.fn(),
  create: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: rpc.create,
}));
vi.mock('@xec-sh/kit', () => ({
  password: vi.fn(),
  prism: {},
  log: { success: rpc.success, warn: rpc.warn, error: rpc.error },
}));

import { secretSetCommand } from '../../src/commands/secret.js';

const stdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
const previousExitCode = process.exitCode;
function pipe(value: string): void {
  Object.defineProperty(process, 'stdin', { value: Readable.from([value]), configurable: true });
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc.create.mockReturnValue({
    isReachable: async () => true,
    service: async () => ({ set: rpc.set }),
    disconnect: rpc.disconnect,
  });
});
afterEach(() => {
  Object.defineProperty(process, 'stdin', stdin);
  process.exitCode = previousExitCode;
});

describe('secret set without credential arguments', () => {
  it.each([{}, { stdin: true }])('passes piped input only to the vault RPC (%j)', async (options) => {
    const value = 'a private value with spaces';
    pipe(`${value}\r\n`);
    await secretSetCommand('service.api-key', undefined, options);
    expect(rpc.set).toHaveBeenCalledWith({ key: 'service.api-key', value });
    expect(rpc.disconnect).toHaveBeenCalledOnce();
    expect(JSON.stringify([rpc.success.mock.calls, rpc.warn.mock.calls, rpc.error.mock.calls])).not.toContain(value);
  });

  it('rejects conflicting input sources before opening the daemon', async () => {
    await expect(secretSetCommand('key', 'hidden-value', { stdin: true })).rejects.toThrow('not both');
    expect(rpc.create).not.toHaveBeenCalled();
  });

  it.each(['', 'x'.repeat(65537)])('rejects invalid stdin without touching the vault', async (value) => {
    pipe(value);
    await expect(secretSetCommand('key')).rejects.toThrow();
    expect(rpc.create).not.toHaveBeenCalled();
  });

  it('retains positional compatibility while warning without echoing the value', async () => {
    await secretSetCommand('key', 'legacy-secret');
    expect(rpc.set).toHaveBeenCalledWith({ key: 'key', value: 'legacy-secret' });
    expect(rpc.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(rpc.warn.mock.calls)).not.toContain('legacy-secret');
  });

  it('does not write behind the running daemon after a refused stdin mutation', async () => {
    pipe('never-echo-this');
    rpc.set.mockRejectedValue(new Error('Forbidden'));
    await secretSetCommand('key');
    expect(process.exitCode).toBe(1);
    expect(rpc.set).toHaveBeenCalledOnce();
    expect(rpc.disconnect).toHaveBeenCalledOnce();
    expect(JSON.stringify(rpc.error.mock.calls)).toContain('Nothing was written');
    expect(JSON.stringify(rpc.error.mock.calls)).not.toContain('never-echo-this');
  });
});
