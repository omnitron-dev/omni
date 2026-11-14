import { afterEach, expect, it, vi } from 'vitest';

const { client, progress } = vi.hoisted(() => ({
  client: {
    whyUnreachable: vi.fn(async () => null), disconnect: vi.fn(async () => {}),
    restartApp: vi.fn(), restartAll: vi.fn(), reloadApp: vi.fn(),
  },
  progress: { start: vi.fn(), stop: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => client, LONG_REQUEST_TIMEOUT: 600_000 }));
vi.mock('../../src/commands/output.js', () => ({ createProgress: () => progress }));
import { restartCommand } from '../../src/commands/restart.js';
import { reloadCommand } from '../../src/commands/reload.js';

const exitCode = process.exitCode;
afterEach(() => { process.exitCode = exitCode; vi.clearAllMocks(); });

it.each([
  ['restart', restartCommand, client.restartApp],
  ['reload', reloadCommand, client.reloadApp],
] as const)('%s reports an unconfirmed operation with a failing exit status and no retry', async (_name, command, rpc) => {
  process.exitCode = 0;
  rpc.mockRejectedValueOnce(new Error('reply lost'));
  await command('project/dev/api');
  expect(rpc).toHaveBeenCalledExactlyOnceWith({ name: 'project/dev/api' });
  expect(progress.error).toHaveBeenCalledWith('Operation not confirmed: reply lost');
  expect(progress.stop).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(1);
});
