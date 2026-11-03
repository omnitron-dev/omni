import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { client, daemonStart, progress } = vi.hoisted(() => ({
  client: { whyUnreachable: vi.fn(), startApp: vi.fn(), startAll: vi.fn(), disconnect: vi.fn() },
  progress: { start: vi.fn(), stop: vi.fn() },
  daemonStart: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => client, LONG_REQUEST_TIMEOUT: 600_000 }));
vi.mock('../../src/commands/daemon-cmd.js', () => ({ daemonStart }));
vi.mock('../../src/commands/spinner.js', () => ({ spinner: () => progress }));
vi.mock('@xec-sh/kit', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { startCommand } from '../../src/commands/start.js';

const name = 'project/test/api';
const previousExitCode = process.exitCode;
beforeEach(() => {
  vi.resetAllMocks();
  process.exitCode = 0;
  client.whyUnreachable.mockResolvedValue(null);
  client.startAll.mockResolvedValue([]);
});
afterEach(() => { process.exitCode = previousExitCode; });

it.each(['stopped', 'stale', 'silent', 'unknown'])('keeps a named start scoped on %s', async kind => {
  client.whyUnreachable.mockResolvedValue({ kind, pid: 12, waitedMs: 5000, reason: 'denied' });
  await startCommand(name);
  expect(daemonStart).not.toHaveBeenCalled();
  expect(client.startApp).not.toHaveBeenCalled();
  expect(client.startAll).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(1);
});

it.each(['silent', 'unknown'])('does not launch another daemon on an inconclusive %s fleet probe', async kind => {
  client.whyUnreachable.mockResolvedValue({ kind, pid: 12, waitedMs: 5000, reason: 'denied' });
  await startCommand('all');
  expect(daemonStart).not.toHaveBeenCalled();
  expect(client.startAll).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it.each([['stopped', undefined], ['stale', 'all']] as const)('starts an absent fleet daemon on %s', async (kind, scope) => {
  client.whyUnreachable.mockResolvedValueOnce({ kind, pid: 12 });
  await startCommand(scope);
  expect(daemonStart).toHaveBeenCalledOnce();
  expect(client.startAll).toHaveBeenCalledTimes(scope ? 1 : 0);
  expect(process.exitCode).toBe(0);
});

it('requires a responsive daemon after autostart', async () => {
  client.whyUnreachable.mockResolvedValue({ kind: 'stopped' });
  await startCommand('all');
  expect(daemonStart).toHaveBeenCalledOnce();
  expect(client.startAll).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it('sends only the addressed RPC', async () => {
  client.startApp.mockResolvedValue({ name, status: 'online', pid: 123 });
  await startCommand(name);
  expect(client.startApp).toHaveBeenCalledExactlyOnceWith({ name });
  expect(client.startAll).not.toHaveBeenCalled();
  expect(daemonStart).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(0);
});

it('reports a lost reply without resending', async () => {
  client.startApp.mockRejectedValue(new Error('connection closed'));
  await startCommand(name);
  expect(client.startApp).toHaveBeenCalledOnce();
  expect(progress.stop).toHaveBeenCalledWith('Start not confirmed: connection closed', 1);
  expect(process.exitCode).toBe(1);
});
