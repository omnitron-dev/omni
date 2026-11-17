import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputCommand, prepareCommandOutput } from '../../src/cli/output-command.js';
import { finishJsonModeGuard } from '../../src/commands/output.js';
import { resetEnvCache } from '../../src/shared/env-config.js';
import { listCommand } from '../../src/commands/list.js';
import { statusCommand } from '../../src/commands/status.js';

const client = vi.hoisted(() => ({ whyUnreachable: vi.fn(), list: vi.fn(), status: vi.fn(), disconnect: vi.fn() }));
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
  client.status.mockReset().mockResolvedValue({ version: 'fixture', pid: 321, uptime: 10, totalMemory: 0, apps: [] });
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

describe.each([
  { name: 'list', action: listCommand },
  { name: 'status', action: statusCommand },
] as const)('$name inventory output', ({ name, action }) => {
  async function invoke() {
    const program = new OutputCommand('omnitron').option('--json');
    program.hook('preAction', (_root, command) => prepareCommandOutput(command));
    program.command(name).structuredAction(action);
    await program.parseAsync(['--json', name], { from: 'user' });
    finishJsonModeGuard();
  }

  it.each([
    { error: Object.assign(new Error('Owner inventory is unavailable'), { code: 'OWNER_UNAVAILABLE' }),
      expected: { ok: false, error: 'Owner inventory is unavailable', code: 'OWNER_UNAVAILABLE' } },
    { error: { message: 'Request timed out after 60000ms', code: 'REQUEST_TIMEOUT', details: { method: 'list' } },
      expected: { ok: false, error: 'Request timed out after 60000ms', code: 'REQUEST_TIMEOUT', details: { method: 'list' } } },
  ])('preserves an inventory RPC failure through the structured command contract: $expected.code', async ({ error, expected }) => {
    client[name].mockRejectedValue(error);
    await invoke();
    expect(stdout).toEqual([]);
    expect(JSON.parse(stderr.join(''))).toEqual(expected);
    expect(process.exitCode).toBe(1);
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it.each([{ apps: [] }, { apps: [{ name: 'sample/dev/api', status: 'online', pid: 123 }] }])('emits one successful inventory and closes its connection: %j', async ({ apps }) => {
    const status = { version: 'fixture', pid: 321, uptime: 10, totalMemory: 4096, apps };
    client.list.mockResolvedValue(apps);
    client.status.mockResolvedValue(status);
    await invoke();
    expect(JSON.parse(stdout.join(''))).toEqual({ ok: true, data: name === 'list' ? { apps } : {
      version: status.version, pid: status.pid, uptime: status.uptime, memoryBytes: status.totalMemory,
      appsTotal: apps.length, appsOnline: apps.filter(app => app.status === 'online').length, errors: [], apps,
    } });
    expect(stderr).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    { absence: { kind: 'stopped' }, message: 'Daemon is not running' },
    { absence: { kind: 'silent', pid: 321, waitedMs: 3000 }, message: 'Daemon is running (PID 321) but did not answer within 3s' },
  ])('reports the $absence.kind daemon without trying to list applications', async ({ absence, message }) => {
    client.whyUnreachable.mockResolvedValue(absence);
    await invoke();
    expect(stdout).toEqual([]);
    expect(JSON.parse(stderr.join(''))).toEqual({ ok: false, code: 'DAEMON_UNAVAILABLE', error: message, details: { absence } });
    expect(process.exitCode).toBe(1);
    expect(client[name]).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('closes the client when the initial reachability check throws', async () => {
    client.whyUnreachable.mockRejectedValue(new Error('Connection inspection failed'));
    await invoke();
    expect(stdout).toEqual([]);
    expect(JSON.parse(stderr.join(''))).toEqual({ ok: false, error: 'Connection inspection failed' });
    expect(process.exitCode).toBe(1);
    expect(client[name]).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

});
