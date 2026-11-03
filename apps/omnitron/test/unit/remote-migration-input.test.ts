import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareRemoteMigration } from '../../src/services/migration-process.js';

const cleanup: string[] = [];
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
});

it('executes the real migration entry with credentials only in its environment', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omni-migration-input-')); cleanup.push(cwd);
  const script = join(cwd, 'migrate.mjs');
  await writeFile(script, `import fs from 'node:fs';
    fs.writeFileSync('observed.json',JSON.stringify({argv:process.argv,value:process.env.MAIN__DATABASE__PASSWORD,preload:process.env.NODE_OPTIONS??null}));
    console.log('one migration applied');`);
  const value = "synthetic ' quoted ; $ secret";
  const request = prepareRemoteMigration({ cwd, script, node: process.execPath }, { MAIN__DATABASE__PASSWORD: value });
  expect(request.command).not.toContain(value);
  const output = execFileSync('/bin/sh', ['-c', request.command], {
    input: request.stdin, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--require /nonexistent-private-loader.cjs' },
  });
  expect(output).toBe('one migration applied\n');
  const observed = JSON.parse(await readFile(join(cwd, 'observed.json'), 'utf8'));
  expect(observed).toEqual({ argv: [process.execPath, script], value, preload: null });
  expect(JSON.stringify(observed.argv)).not.toContain(value);
});

it('reports a failed migration without retrying it', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omni-migration-once-')); cleanup.push(cwd);
  const script = join(cwd, 'migrate.mjs');
  await writeFile(script, `import fs from 'node:fs';fs.appendFileSync('attempts','once\\n');process.exitCode=3;`);
  const request = prepareRemoteMigration({ cwd, script, node: process.execPath }, {});
  expect(() => execFileSync('/bin/sh', ['-c', request.command], { input: request.stdin, stdio: 'pipe' })).toThrow();
  expect(await readFile(join(cwd, 'attempts'), 'utf8')).toBe('once\n');
});
