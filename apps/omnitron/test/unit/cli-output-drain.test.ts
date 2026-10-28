import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entry = new URL('../../src/cli/exit-after-output.ts', import.meta.url).href;
const cwd = fileURLToPath(new URL('../../', import.meta.url));

describe('CLI completion with piped output', () => {
  it.each([0, 7])('preserves complete JSON and diagnostics with exit code %s', (code) => {
    const child = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', `
      import { exitAfterOutput } from ${JSON.stringify(entry)};
      setInterval(() => {}, 60_000);
      console.log(JSON.stringify({ payload: 'x'.repeat(1024 * 1024) }));
      console.error('e'.repeat(1024 * 1024));
      await exitAfterOutput(${code});
    `], { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(code);
    expect(JSON.parse(child.stdout).payload).toHaveLength(1024 * 1024);
    expect(child.stderr).toBe('e'.repeat(1024 * 1024) + '\n');
  });
});
