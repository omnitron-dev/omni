import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { closureLibraryDirectories } from '../../src/release/closure-library-path.js';
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

it.each(['declared', 'inherited'])('refuses %s loader overrides before the verified remote migration starts', async mode => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'omni-migration-loader-'))); cleanup.push(cwd);
  const script = join(cwd, 'migrate.mjs');
  await writeFile(script, `import fs from 'node:fs';fs.writeFileSync('effects','unexpected');`);
  const request = prepareRemoteMigration({ cwd, script, node: process.execPath, verifiedRoot: cwd },
    mode === 'declared' ? { LD_LIBRARY_PATH: '/unverified/libraries' } : {});
  const result = spawnSync('/bin/sh', ['-c', request.command], { input: request.stdin, encoding: 'utf8',
    env: { ...process.env, ...(mode === 'inherited' ? { LD_LIBRARY_PATH: '/unverified/libraries' } : {}) } });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Verified release execution refuses external loader environment: LD_LIBRARY_PATH');
  await expect(readFile(join(cwd, 'effects'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('serializes closureLibraryDirectories without bundler or Vitest module-import captures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-migration-closure-')); cleanup.push(root);
  const libDir = join(root, 'node_modules/.omnitron/0/lib');
  await mkdir(libDir, { recursive: true });
  await writeFile(join(root, '.omnitron-closure.json'), '{"version":1}');
  await writeFile(join(libDir, 'libvips-cpp.so.42'), 'elf');
  const stdout = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `const fn = ${closureLibraryDirectories.toString()}; console.log(JSON.stringify(fn([${JSON.stringify(join(root, 'dist/migrate.mjs'))}])));`],
    { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
  );
  expect(JSON.parse(stdout)).toEqual([await realpath(libDir)]);
  const verified = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `const fn = ${closureLibraryDirectories.toString()}; console.log(JSON.stringify(fn({verifiedRoot:${JSON.stringify(await realpath(root))}})));`],
    { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
  );
  expect(JSON.parse(verified)).toEqual([await realpath(libDir)]);
});
