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
  it('uses the shared envelope for a local --json config flag', () => {
    const result = run(['config', '--json'], (root) =>
      fs.writeFileSync(path.join(root, 'omnitron.config.mjs'), 'export default { apps: [] };\n')
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { apps: [] } });
  });
});
