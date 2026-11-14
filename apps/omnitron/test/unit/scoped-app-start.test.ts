import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { client, daemonStart, progress, error } = vi.hoisted(() => ({
  client: { whyUnreachable: vi.fn(), startApp: vi.fn(), startAll: vi.fn(), disconnect: vi.fn() },
  progress: { start: vi.fn(), stop: vi.fn(), clear: vi.fn() },
  error: vi.fn(),
  daemonStart: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => client, LONG_REQUEST_TIMEOUT: 600_000 }));
vi.mock('../../src/commands/daemon-cmd.js', () => ({ daemonStart }));
vi.mock('@xec-sh/kit', () => ({ spinner: () => progress, log: { warn: vi.fn(), info: vi.fn(), error, success: vi.fn() } }));

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
  expect(client.startAll).toHaveBeenCalledOnce();
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
  expect(error).toHaveBeenCalledWith('Start not confirmed: connection closed');
  expect(process.exitCode).toBe(1);
});

it.each(['starting', 'errored', 'crashed', 'stopped'])('rejects a returned %s application without a success message', async status => {
  client.startApp.mockResolvedValue({ name, status, pid: null });
  await startCommand(name);
  expect(progress.stop).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(`Start not confirmed: ${name} is ${status}`);
  expect(client.startApp).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(1);
});

it('reports a partial fleet start as unconfirmed', async () => {
  client.startAll.mockResolvedValue([{ name: 'healthy', status: 'online' }, { name, status: 'errored' }]);
  await startCommand('all');
  expect(progress.stop).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(`Start not confirmed: ${name} is errored`);
  expect(process.exitCode).toBe(1);
});

it('reports a failed probe before the progress indicator starts', async () => {
  client.whyUnreachable.mockRejectedValueOnce(new Error('connection refused'));
  await startCommand(name);
  expect(progress.start).not.toHaveBeenCalled();
  expect(client.startApp).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith('Start not confirmed: connection refused');
  expect(process.exitCode).toBe(1);
  expect(client.disconnect).toHaveBeenCalledOnce();
});
