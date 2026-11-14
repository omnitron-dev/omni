import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
const cli = fileURLToPath(new URL('../../src/cli/omnitron.ts', import.meta.url));
function run(args: string[], setup?: (root: string) => void, environment = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-machine-admission-'));
  try {
    setup?.(root);
    const env = {
      ...process.env,
      OMNITRON_HOME: path.join(root, 'instance'),
      OMNITRON_OUTPUT: environment ? 'json' : '',
    };
    const result = spawnSync(process.execPath, ['--import', tsx, cli, ...args], {
      cwd: setup ? root : cwd,
      env,
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return { ...result, instanceCreated: fs.existsSync(path.join(root, 'instance')) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
describe('actual CLI machine output boundary', () => {
  it('returns from parser help with a complete response and exit code zero', () => {
    const result = run(['--help']);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: omnitron');
    expect(result.stderr).toBe('');
  });
  it('reports parser errors and exits unsuccessfully without waiting for daemon handles', () => {
    const result = run(['--unknown-cli-option']);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--unknown-cli-option'");
    expect(result.instanceCreated).toBe(false);
  });
  it.each([false, true])(
    'rejects lifecycle mutation before private state is created (environment=%s)',
    (environment) => {
      const result = run([...(environment ? [] : ['--json']), 'up'], undefined, environment);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toMatchObject({
        ok: false,
        code: 'JSON_OUTPUT_UNSUPPORTED',
        command: 'up',
        outcome: 'not-started',
      });
      expect(result.instanceCreated).toBe(false);
    }
  );
  it('returns one structured precondition error for Console start against an isolated stopped daemon', () => {
    const result = run(['--json', 'webapp', 'start']);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, code: 'DAEMON_NOT_RUNNING', outcome: 'not-started' });
    expect(result.stderr).not.toContain('JSON_OUTPUT_CONTRACT_VIOLATION');
  });
  it.each([false, true])(
    'admits backup diagnostics and reports the unavailable daemon as JSON (environment=%s)',
    (environment) => {
      const result = run([...(environment ? [] : ['--json']), 'backup', 'schedules'], undefined, environment);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toEqual({
        ok: false,
        error: 'Backup status unavailable: omnitron daemon is not running (start it with `omnitron up`)',
      });
      expect(result.instanceCreated).toBe(false);
    }
  );
  it.each([
    ['create', 'main'],
    ['full'],
    ['list'],
    ['restore', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'],
    ['schedule', 'all', 'hourly'],
    ['unschedule', 'all'],
  ])('keeps unsupported backup %s output closed before execution', (...args) => {
    for (const environment of [false, true]) {
      const result = run([...(environment ? [] : ['--json']), 'backup', ...args], undefined, environment);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toMatchObject({
        ok: false,
        code: 'JSON_OUTPUT_UNSUPPORTED',
        command: `backup ${args[0]}`,
        outcome: 'not-started',
      });
      expect(result.instanceCreated).toBe(false);
    }
  });
  it('uses the shared envelope for a local --json config flag', () => {
    const result = run(['config', '--json'], (root) =>
      fs.writeFileSync(path.join(root, 'omnitron.config.mjs'), 'export default { apps: [] };\n')
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { apps: [] } });
  });

  it('parses a file revision without invoking the global version action', () => {
    const help = run(['files', 'save', 'probe.txt', '--version', 'new', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: omnitron files save');
    const result = run(['files', 'save', 'probe.txt', '--version', 'new', '--json']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ ok: false });
    expect(result.stdout).toBe('');
  });
});
