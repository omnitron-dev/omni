import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '@xec-sh/kit';
import { stackListCommand } from '../../src/commands/stack.js';
import { finishJsonModeGuard, installJsonModeGuard } from '../../src/commands/output.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const api = vi.hoisted(() => ({
  service: vi.fn(), listProjects: vi.fn(), listStacks: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({ service: api.service, disconnect: api.disconnect }),
}));

let stdout: string, stderr: string;
const originalExitCode = process.exitCode;
beforeEach(() => {
  vi.resetAllMocks();
  process.exitCode = undefined;
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  api.service.mockResolvedValue(api);
  api.listProjects.mockResolvedValue([{ name: 'one', path: '/one' }, { name: 'two', path: '/two' }]);
  api.listStacks.mockResolvedValue([]);
  stdout = ''; stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { stdout += String(chunk); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { stderr += String(chunk); return true; });
  vi.spyOn(log, 'info').mockImplementation(() => {});
  vi.spyOn(log, 'error').mockImplementation(() => {});
});
afterEach(() => {
  finishJsonModeGuard();
  process.exitCode = originalExitCode;
  resetEnvCache();
  vi.restoreAllMocks();
});

async function list(options?: { project?: string }) {
  installJsonModeGuard('stack list');
  try { await stackListCommand(options); }
  finally { finishJsonModeGuard(); }
}

describe('stack list output contract', () => {
  it('returns an empty collection as a successful machine result', async () => {
    api.listProjects.mockResolvedValue([]);
    await list();
    expect(JSON.parse(stdout)).toEqual({ ok: true, data: [] });
    expect(stderr).toBe('');
    expect(process.exitCode).toBeUndefined();
    expect(api.listStacks).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(api.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    { label: 'an empty registry', projects: [] },
    { label: 'a populated registry', projects: [{ name: 'other', path: '/other' }] },
  ])('refuses an unknown explicit project in $label', async ({ projects }) => {
    api.listProjects.mockResolvedValue(projects);
    await list({ project: 'missing' });
    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toEqual({
      ok: false, error: "Project 'missing' not found", code: 'PROJECT_NOT_FOUND', project: 'missing',
    });
    expect(process.exitCode).toBe(1);
    expect(api.listStacks).not.toHaveBeenCalled();
    expect(api.disconnect).toHaveBeenCalledOnce();
  });

  it('reads and emits only the selected project', async () => {
    const stacks = [{ name: 'dev', status: 'running' }];
    api.listStacks.mockResolvedValue(stacks);
    await list({ project: 'two' });
    expect(api.listStacks).toHaveBeenCalledExactlyOnceWith({ project: 'two' });
    expect(JSON.parse(stdout)).toEqual({ ok: true, data: [{ project: 'two', path: '/two', stacks }] });
    expect(stderr).toBe('');
  });

  it.each(['native', 'serialized'])('preserves a %s RPC error without emitting partial success', async kind => {
    const failure = {
      message: 'Execution owner inventory is stale', code: 'OWNER_UNAVAILABLE',
      details: { reason: 'stale-inventory', retryable: false },
      cause: { password: 'private-transport-state' }, stack: 'private stack',
    };
    api.listStacks.mockResolvedValueOnce([]).mockRejectedValueOnce(
      kind === 'native' ? Object.assign(new Error(failure.message), failure) : failure,
    );
    await list();
    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toEqual({
      ok: false, error: failure.message, code: failure.code, details: failure.details,
    });
    expect(process.exitCode).toBe(1);
    expect(api.disconnect).toHaveBeenCalledOnce();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('reports a connection failure once before any project request', async () => {
    api.service.mockRejectedValue(new Error('Daemon endpoint unavailable'));
    await list();
    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toEqual({ ok: false, error: 'Daemon endpoint unavailable' });
    expect(api.listProjects).not.toHaveBeenCalled();
    expect(api.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it('reports the same failure and a failing exit code in human mode', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'human' });
    api.listProjects.mockRejectedValue(new Error('Registry read refused'));
    await list();
    expect(log.error).toHaveBeenCalledExactlyOnceWith('Registry read refused');
    expect(stdout).toBe(''); expect(stderr).toBe('');
    expect(process.exitCode).toBe(1);
    expect(api.disconnect).toHaveBeenCalledOnce();
  });
});
