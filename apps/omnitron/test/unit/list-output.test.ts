import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OutputCommand, prepareCommandOutput } from '../../src/cli/output-command.js';
import { finishJsonModeGuard } from '../../src/commands/output.js';
import { resetEnvCache } from '../../src/shared/env-config.js';
import { listCommand } from '../../src/commands/list.js';

const client = vi.hoisted(() => ({ whyUnreachable: vi.fn(), list: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => client }));

let originalOutput: string | undefined;
let originalExitCode: typeof process.exitCode;
let stdout: string[], stderr: string[];

beforeEach(() => {
  originalOutput = process.env['OMNITRON_OUTPUT'];
  originalExitCode = process.exitCode;
  delete process.env['OMNITRON_OUTPUT'];
  resetEnvCache();
  process.exitCode = undefined;
  client.whyUnreachable.mockReset().mockResolvedValue(null);
  client.list.mockReset().mockResolvedValue([]);
  client.disconnect.mockReset().mockResolvedValue(undefined);
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { stdout.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { stderr.push(String(chunk)); return true; });
});

afterEach(() => {
  finishJsonModeGuard();
  if (originalOutput === undefined) delete process.env['OMNITRON_OUTPUT'];
  else process.env['OMNITRON_OUTPUT'] = originalOutput;
  resetEnvCache();
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

async function list() {
  const program = new OutputCommand('omnitron').option('--json');
  program.hook('preAction', (_root, command) => prepareCommandOutput(command));
  program.command('list').structuredAction(listCommand);
  await program.parseAsync(['--json', 'list'], { from: 'user' });
  finishJsonModeGuard();
}

it.each([
  { error: Object.assign(new Error('Owner inventory is unavailable'), { code: 'OWNER_UNAVAILABLE' }),
    expected: { ok: false, error: 'Owner inventory is unavailable', code: 'OWNER_UNAVAILABLE' } },
  { error: { message: 'Request timed out after 60000ms', code: 'REQUEST_TIMEOUT', details: { method: 'list' } },
    expected: { ok: false, error: 'Request timed out after 60000ms', code: 'REQUEST_TIMEOUT', details: { method: 'list' } } },
])('preserves a list RPC failure through the structured command contract: $expected.code', async ({ error, expected }) => {
  client.list.mockRejectedValue(error);
  await list();
  expect(stdout).toEqual([]);
  expect(JSON.parse(stderr.join(''))).toEqual(expected);
  expect(process.exitCode).toBe(1);
  expect(client.disconnect).toHaveBeenCalledOnce();
});

it.each([{ apps: [] }, { apps: [{ name: 'sample/dev/api', status: 'online', pid: 123 }] }])('emits one successful inventory and closes its connection: %j', async ({ apps }) => {
  client.list.mockResolvedValue(apps);
  await list();
  expect(JSON.parse(stdout.join(''))).toEqual({ ok: true, data: { apps } });
  expect(stderr).toEqual([]);
  expect(process.exitCode ?? 0).toBe(0);
  expect(client.disconnect).toHaveBeenCalledOnce();
});

it('reports an unavailable daemon as a failed read without trying to list applications', async () => {
  client.whyUnreachable.mockResolvedValue({ kind: 'stopped' });
  await list();
  expect(stdout).toEqual([]);
  expect(JSON.parse(stderr.join(''))).toEqual({ ok: false, error: 'Daemon is not running' });
  expect(process.exitCode).toBe(1);
  expect(client.list).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalledOnce();
});

it('closes the client when the initial reachability check throws', async () => {
  client.whyUnreachable.mockRejectedValue(new Error('Connection inspection failed'));
  await list();
  expect(stdout).toEqual([]);
  expect(JSON.parse(stderr.join(''))).toEqual({ ok: false, error: 'Connection inspection failed' });
  expect(process.exitCode).toBe(1);
  expect(client.list).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalledOnce();
});
