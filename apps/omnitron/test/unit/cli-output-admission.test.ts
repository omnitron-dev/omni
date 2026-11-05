import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { OutputCommand, prepareCommandOutput } from '../../src/cli/output-command.js';
import { emitJson, installJsonModeGuard, finishJsonModeGuard } from '../../src/commands/output.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';
let originalEnv: string | undefined;
let exitListeners: Function[];
let stdout: string[], stderr: string[];
beforeEach(() => {
  originalEnv = process.env['OMNITRON_OUTPUT'];
  delete process.env['OMNITRON_OUTPUT'];
  resetEnvCache();
  process.exitCode = undefined;
  exitListeners = process.listeners('exit');
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  for (const listener of process.listeners('exit'))
    if (!exitListeners.includes(listener)) process.removeListener('exit', listener);
  if (originalEnv === undefined) delete process.env['OMNITRON_OUTPUT'];
  else process.env['OMNITRON_OUTPUT'] = originalEnv;
  resetEnvCache();
  process.exitCode = undefined;
  vi.restoreAllMocks();
});
function program() {
  const root = new OutputCommand('omnitron').option('--json');
  root.hook('preAction', (_root, action) => prepareCommandOutput(action));
  return root;
}
describe('machine output admission precedes action execution', () => {
  it.each(['flag', 'environment'])(
    'refuses unknown nested mutation support via %s without invoking its lazy handler',
    async (mode) => {
      const root = program(),
        mutation = vi.fn();
      root.command('system').command('remove').alias('rm').action(mutation);
      if (mode === 'environment') process.env['OMNITRON_OUTPUT'] = 'json';
      await expect(
        root.parseAsync([...(mode === 'flag' ? ['--json'] : []), 'system', 'rm'], { from: 'user' })
      ).rejects.toMatchObject({ code: 'omnitron.jsonUnsupported', exitCode: 2 });
      expect(mutation).not.toHaveBeenCalled();
      expect(stdout).toEqual([]);
      expect(JSON.parse(stderr.join(''))).toMatchObject({
        ok: false,
        code: 'JSON_OUTPUT_UNSUPPORTED',
        command: 'system remove',
        outcome: 'not-started',
      });
      expect(process.exitCode).toBe(2);
    }
  );
  it('allows an explicitly structured action and keeps the shared envelope', async () => {
    const root = program(),
      mutation = vi.fn();
    root
      .command('system')
      .command('change')
      .structuredAction(() => {
        mutation();
        emitJson({ changed: true });
      });
    await root.parseAsync(['system', 'change', '--json'], { from: 'user' });
    expect(mutation).toHaveBeenCalledOnce();
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toEqual({ ok: true, data: { changed: true } });
  });
  it('preserves human actions without machine mode', async () => {
    const root = program(),
      action = vi.fn();
    root.command('change').action(action);
    await root.parseAsync(['change'], { from: 'user' });
    expect(action).toHaveBeenCalledOnce();
    expect(stderr).toEqual([]);
  });
  it('does not inherit machine support from a sibling or parent action', async () => {
    const root = program(),
      mutation = vi.fn();
    const system = root.command('system').structuredAction(() => {
      emitJson({});
    });
    system.command('known').structuredAction(() => {
      emitJson({});
    });
    system.command('new-command').action(mutation);
    await expect(root.parseAsync(['--json', 'system', 'new-command'], { from: 'user' })).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(mutation).not.toHaveBeenCalled();
  });
  it('refuses foreign command handlers that did not declare a protocol', async () => {
    const root = program(),
      mutation = vi.fn();
    root.addCommand(new Command('foreign').action(mutation));
    await expect(root.parseAsync(['--json', 'foreign'], { from: 'user' })).rejects.toMatchObject({ exitCode: 2 });
    expect(mutation).not.toHaveBeenCalled();
  });
  it('validates silent completion before output streams are drained', () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    const before = process.listeners('exit');
    installJsonModeGuard('system change');
    finishJsonModeGuard();
    expect(JSON.parse(stderr.join(''))).toMatchObject({ code: 'JSON_OUTPUT_CONTRACT_VIOLATION', outcome: 'unknown' });
    expect(process.exitCode).toBe(1);
    expect(process.listeners('exit')).toEqual(before);
  });
  it('reports a silent declared action as unknown outcome, never as an unsupported or unstarted operation', () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    const before = process.listeners('exit'),
      remove = installJsonModeGuard('system change');
    const check = process.listeners('exit').find((listener) => !before.includes(listener))!;
    check(0);
    remove();
    expect(JSON.parse(stderr.join(''))).toMatchObject({
      ok: false,
      code: 'JSON_OUTPUT_CONTRACT_VIOLATION',
      outcome: 'unknown',
    });
    expect(stderr.join('')).not.toContain('does not support');
    expect(process.exitCode).toBe(1);
  });
});
