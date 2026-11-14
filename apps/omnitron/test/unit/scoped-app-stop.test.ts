import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { client, progress, warn, error } = vi.hoisted(() => ({
  client: { whyUnreachable: vi.fn(), stopApp: vi.fn(), stopAll: vi.fn(), disconnect: vi.fn() },
  progress: { start: vi.fn(), stop: vi.fn(), clear: vi.fn() },
  error: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => client, LONG_REQUEST_TIMEOUT: 600_000 }));
vi.mock('@xec-sh/kit', () => ({ spinner: () => progress, log: { warn, info: vi.fn(), error } }));

import { stopCommand } from '../../src/commands/stop.js';

describe('application stop', () => {
  const previousExitCode = process.exitCode;
  beforeEach(() => {
    vi.resetAllMocks();
    process.exitCode = 0;
    client.whyUnreachable.mockResolvedValue(null);
  });
  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it.each(['project/test/api', 'all', undefined])('refuses %s when RPC is unavailable, even with force', async name => {
    const signal = vi.spyOn(process, 'kill').mockImplementation(() => true);
    client.whyUnreachable.mockResolvedValue({ kind: 'silent', pid: 123, waitedMs: 5000 });
    await stopCommand(name, { force: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('application stop was not sent'));
    expect(signal).not.toHaveBeenCalled();
    expect(client.stopApp).not.toHaveBeenCalled();
    expect(client.stopAll).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it('stops only the addressed application', async () => {
    client.stopApp.mockResolvedValue({ success: true });
    await stopCommand('project/test/api', { force: true });
    expect(client.stopApp).toHaveBeenCalledExactlyOnceWith({ name: 'project/test/api', force: true });
    expect(client.stopAll).not.toHaveBeenCalled();
    expect(progress.stop).toHaveBeenCalledWith('project/test/api stopped');
    expect(process.exitCode).toBe(0);
  });

  it.each(['all', undefined])('stops all applications via RPC for %s', async name => {
    client.stopAll.mockResolvedValue({ count: 2 });
    await stopCommand(name);
    expect(client.stopAll).toHaveBeenCalledExactlyOnceWith({ force: false });
    expect(client.stopApp).not.toHaveBeenCalled();
    expect(progress.stop).toHaveBeenCalledWith('Stopped 2 apps');
  });

  it.each(['owner is draining', 'peer disconnected'])('reports %s without retrying', async reason => {
    if (reason === 'owner is draining') client.stopApp.mockResolvedValue({ success: false, error: reason });
    else client.stopApp.mockRejectedValue(new Error(reason));
    await stopCommand('project/test/api');
    expect(client.stopApp).toHaveBeenCalledOnce();
    expect(client.stopAll).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(`Stop not confirmed: ${reason}`);
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
});
