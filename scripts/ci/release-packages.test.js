import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { artifactIntegrity, releaseCommand } from '@xec-sh/ops/release';
import { checkPackageArchives } from '../../.xec/release/packages.js';
import { command as packagesCommand } from '../../.xec/commands/check-packages.js';
import { command as buildCommand } from '../../.xec/commands/release-build.js';
import { command as reproduceCommand } from '../../.xec/commands/reproduce.js';

test('release recipe commands use native strict argument schemas and generated help', async () => {
  const { Command } = createRequire(import.meta.resolve('@xec-sh/cli'))('commander');
  for (const [register, name, invalid] of [
    [packagesCommand, 'check-packages', ['--archives', 'batch.json', '--revision', 'a'.repeat(40)]],
    [buildCommand, 'release-build', ['--source', '/unused']],
    [reproduceCommand, 'reproduce', ['--revision']],
  ]) {
    const output = [];
    const program = () => {
      const cli = new Command().exitOverride().configureOutput({ writeOut: text => output.push(text), writeErr() {} });
      register(cli);
      return cli;
    };
    await assert.rejects(program().parseAsync([name, '--help'], { from: 'user' }), error => error.code === 'commander.helpDisplayed');
    assert.match(output.join(''), new RegExp('Usage:.*' + name));
    for (const args of [['--unknown'], invalid])
      await assert.rejects(program().parseAsync([name, ...args], { from: 'user' }), error => error.code?.startsWith('commander.'));
  }
});

async function fixture(t, exported = './index.js') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-archive-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const metadata = { name: '@fixture/archive', version: '1.0.0', type: 'module', main: exported };
  await fs.mkdir(path.join(root, 'packages/example'), { recursive: true });
  await fs.mkdir(path.join(root, 'apps'));
  await fs.mkdir(path.join(root, 'package'));
  for (const target of ['packages/example/package.json', 'package/package.json'])
    await fs.writeFile(path.join(root, target), JSON.stringify(metadata));
  await fs.writeFile(path.join(root, 'package/index.js'), 'export const accepted = true;\n');
  const file = path.join(root, 'example.tgz');
  await releaseCommand(root, 'tar', ['-czf', file, 'package']);
  const bytes = await fs.readFile(file);
  return { root, bytes, artifact: { name: metadata.name, version: metadata.version, file, integrity: artifactIntegrity(bytes) } };
}

test('consumer export inspection reads the supplied real archive and never repacks the workspace', async t => {
  const { root, bytes, artifact } = await fixture(t);
  const commands = [];
  await checkPackageArchives(root, [artifact], { run(cwd, executable, args, options) {
    commands.push([executable, ...args]);
    assert.equal(executable, 'tar', 'export inspection must not build, install or pack');
    return releaseCommand(cwd, executable, args, options);
  } });
  assert.ok(commands.length > 0);
  assert.deepEqual(await fs.readFile(artifact.file), bytes);
});

test('changed bytes, missing exports and different inventories are rejected without substituting a fresh pack', async t => {
  const valid = await fixture(t);
  await fs.appendFile(valid.artifact.file, 'changed');
  await assert.rejects(checkPackageArchives(valid.root, [valid.artifact]), /archive changed/);
  const missing = await fixture(t, './missing.js');
  await assert.rejects(checkPackageArchives(missing.root, [missing.artifact]), /no exported entry/);
  const foreign = await fixture(t);
  await assert.rejects(checkPackageArchives(foreign.root, [{ ...foreign.artifact, version: '2.0.0' }]), /inventory differs/);
  await assert.rejects(checkPackageArchives(foreign.root, [foreign.artifact, foreign.artifact]), /Duplicate archive/);
});
