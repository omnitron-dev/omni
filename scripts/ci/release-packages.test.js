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

async function fixture(t, exported = './index.js', packedFields = {}, nativeBuild = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-archive-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const metadata = { name: '@fixture/archive', version: '1.0.0', type: 'module', main: exported };
  await fs.mkdir(path.join(root, 'packages/example'), { recursive: true });
  await fs.mkdir(path.join(root, 'apps'));
  await fs.mkdir(path.join(root, 'package'));
  await fs.writeFile(path.join(root, 'packages/example/package.json'), JSON.stringify(metadata));
  await fs.writeFile(path.join(root, 'package/package.json'), JSON.stringify({ ...metadata, ...packedFields }));
  if (nativeBuild) await fs.writeFile(path.join(root, 'package/binding.gyp'), '{"targets":[]}');
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

test('archive acceptance checks for npm install hooks before starting a consumer', async t => {
  for (const [fields, native, reason] of [
    [{ scripts: { postinstall: 'echo fixture' } }, false, 'postinstall'],
    [{ scripts: { prepare: 'echo fixture' } }, false, 'prepare'],
    [{}, true, 'binding.gyp'],
  ]) {
    const { root, artifact } = await fixture(t, './index.js', fields, native);
    await assert.rejects(checkPackageArchives(root, [artifact]), error =>
      error.message.includes('npm installation hook') && error.message.includes(reason));
  }
  const inert = await fixture(t, './index.js', { gypfile: false, scripts: { test: 'echo fixture' } }, true);
  await checkPackageArchives(inert.root, [inert.artifact]);
});

test('pnpm packs only declared Omnitron runtime data, even with local storage and caches beside it', async t => {
  const { root } = await fixture(t);
  const project = path.join(root, 'packages/example');
  const cli = JSON.parse(await fs.readFile(new URL('../../apps/omnitron/package.json', import.meta.url), 'utf8'));
  const metadata = { name: cli.name, version: '1.0.0', files: cli.files, main: './index.js' };
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify(metadata));
  await fs.writeFile(path.join(project, 'index.js'), 'export {};');
  const data = cli.files.filter(file => file.startsWith('data/'));
  assert.ok(data.includes('data/images/minio/Dockerfile'));
  for (const file of [...data, 'data/storage/example.sqlite', 'data/operations/local.env', 'data/operations/__pycache__/worker.pyc']) {
    await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await fs.writeFile(path.join(project, file), 'synthetic fixture\n');
  }
  await releaseCommand(project, 'pnpm', ['pack', '--pack-destination', root]);
  const tarball = (await fs.readdir(root)).find(name => name.endsWith('.tgz') && name !== 'example.tgz');
  assert.ok(tarball);
  const file = path.join(root, tarball);
  const listing = (await releaseCommand(root, 'tar', ['-tzf', file])).split(/\r?\n/);
  assert.deepEqual(listing.filter(name => name.startsWith('package/data/') && !name.endsWith('/')).sort(),
    data.map(name => 'package/' + name).sort());
  await checkPackageArchives(root, [{ name: cli.name, version: metadata.version, file, integrity: artifactIntegrity(await fs.readFile(file)) }]);

  await releaseCommand(root, 'tar', ['-xzf', file, '-C', root]);
  const unwanted = 'package/data/storage/example.sqlite';
  await fs.mkdir(path.dirname(path.join(root, unwanted)), { recursive: true });
  await fs.writeFile(path.join(root, unwanted), 'synthetic');
  await releaseCommand(root, 'tar', ['-czf', file, 'package']);
  await assert.rejects(checkPackageArchives(root, [{ name: cli.name, version: metadata.version, file,
    integrity: artifactIntegrity(await fs.readFile(file)) }]), /individually declared runtime files/);
});
