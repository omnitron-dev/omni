import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { releaseCommand } from '@xec-sh/ops/release';
import { releaseBuildContext, releaseEnvironment, releaseProducerInputs, assertReleaseProducerApi, preparationBuildDirectory, verifyPreparationBuild, publishPreparationRuntime, finalizePreparationBuild } from '../../.xec/release/build.js';
import { runtimeArtifactDigest } from '../../apps/omnitron/src/shared/runtime-artifact.ts';

const revision = 'a'.repeat(40);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value));
const readJson = async file => JSON.parse(await fs.readFile(file));
const run = async (_cwd, executable, args) => {
  if (executable === 'pnpm') { assert.deepEqual(args, ['--version']); return '12.16.1'; }
  assert.equal(executable, 'git');
  assert.deepEqual(args, ['show', '-s', '--format=%ct', revision]);
  return '1730000000';
};

test('release producer refuses the published pre-protocol API instead of silently dropping retention', () => {
  assert.throws(() => assertReleaseProducerApi({}), /published @xec-sh\/ops 0.13/);
  assert.throws(() => assertReleaseProducerApi({ RELEASE_PRODUCER_PROTOCOL: 1 }), /producer API/);
  assertReleaseProducerApi({ RELEASE_PRODUCER_PROTOCOL: 1, packReleaseArtifacts() {} });
});

test('release environment selects explicit build inputs without inheriting daemon authority or arbitrary variables', () => {
  assert.deepEqual(releaseEnvironment({ PATH: '/safe/bin', HOME: '/safe/home', VITE_PUBLIC_URL: 'https://example.invalid',
    OMNITRON_HOME: '/live/daemon', TURBO_TOKEN: 'private', ARBITRARY_SECRET: 'private', npm_lifecycle_event: 'test' }),
  { HOME: '/safe/home', PATH: '/safe/bin', VITE_PUBLIC_URL: 'https://example.invalid' });
  assert.equal(releaseEnvironment({ NODE_OPTIONS: '--max-old-space-size=8192 --enable-source-maps' }).NODE_OPTIONS,
    '--max-old-space-size=8192 --enable-source-maps');
  for (const value of ['--require /external/unbound.js', '--import=/external/unbound.js', '--eval=code'])
    assert.throws(() => releaseEnvironment({ NODE_OPTIONS: value }), /not external code/);
});

test('producer identity follows the actual Xec dependency closure without requiring manifest exports', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-driver-inputs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeJson(path.join(root, 'package.json'), { private: true, type: 'module' });
  for (const name of ['cli', 'ops', 'loader']) {
    const directory = path.join(root, 'node_modules/@xec-sh', name);
    await fs.mkdir(path.join(directory, 'dist'), { recursive: true });
    await writeJson(path.join(directory, 'package.json'), { name: '@xec-sh/' + name, version: '0.13.0',
      exports: { '.': { import: './dist/index.js' } },
      ...(name === 'cli' ? { dependencies: { '@xec-sh/loader': '0.13.0' } } : {}) });
    await fs.writeFile(path.join(directory, 'dist/index.js'), `export const name = ${JSON.stringify(name)};\n`);
  }
  const context = { identity: { revision } };
  const before = await releaseProducerInputs(root, context);
  assert.equal(Object.keys(before).length, 4);
  await fs.appendFile(path.join(root, 'node_modules/@xec-sh/loader/dist/index.js'), 'export const changed = true;\n');
  assert.notDeepEqual(await releaseProducerInputs(root, context), before);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-build-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeJson(path.join(root, 'package.json'), { packageManager: 'pnpm@12.16.1' });
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  const context = await releaseBuildContext(root, revision, run);
  const directory = preparationBuildDirectory(root, revision), runtime = path.join(directory, 'runtime');
  await fs.mkdir(path.join(runtime, 'packages/0/dist'), { recursive: true });
  await fs.mkdir(path.join(runtime, 'packages/0/webapp/dist'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'node'), 'synthetic producer bytes');
  await writeJson(path.join(runtime, 'packages/0/dist/BUILD.json'), { commit: revision, dirty: false, timeBasis: 'source' });
  await writeJson(path.join(runtime, 'packages/0/webapp/dist/console-version.json'), { version: 'console-identity' });
  const digest = await runtimeArtifactDigest(runtime);
  await writeJson(path.join(runtime, 'RUNTIME.json'), { protocol: 1, sha256: digest, packages: 1,
    nodeVersion: context.identity.node, platform: process.platform, arch: process.arch });
  const sdk = path.join(directory, 'sdk');
  await fs.mkdir(sdk);
  const bytes = Buffer.from('already inspected synthetic archive bytes');
  await fs.writeFile(path.join(sdk, 'fixture.tgz'), bytes);
  const record = { name: '@omnitron-dev/example', version: '0.4.9', filename: 'fixture.tgz',
    sha256: hash(bytes), integrity: integrity(bytes), sourceRevision: revision, sourceDirty: false };
  const manifest = JSON.stringify([record]), inventory = JSON.stringify([{ ...record, files: {} }]);
  await fs.writeFile(path.join(sdk, 'framework-manifest.json'), manifest);
  await fs.writeFile(path.join(directory, 'sdk-inventory.json'), inventory);
  const proof = { kind: 'clean-package-preparation', identity: structuredClone(context.identity), consumerVerified: true,
    result: { sha256: digest, packages: 1, console: 'console-identity', sdk: { packages: 1, files: 0, manifestSha256: hash(manifest) } },
    inventorySha256: hash(inventory) };
  const { sdk: _sdk, ...runtimeResult } = proof.result;
  await writeJson(path.join(directory, 'BUILD.json'), { identity: context.identity, result: runtimeResult });
  const receipt = path.join(directory, 'PREPARATION.json');
  await writeJson(receipt, proof);
  return { root, directory, runtime, sdk, receipt, proof, context };
}

test('an unaccepted producer cannot finalize preparation without the canonical accepted release record', async t => {
  const f = await fixture(t);
  await fs.unlink(f.receipt);
  const git = args => releaseCommand(f.root, 'git', args);
  await git(['init', '--quiet']);
  await git(['add', 'package.json', 'pnpm-lock.yaml']);
  await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--quiet', '-m', 'Fixture']);
  const commit = await git(['rev-parse', 'HEAD']);
  const directory = path.join(f.root, '.release-artifacts/0.4.11', commit);
  await fs.mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, 'producer.json'), { commit, accepted: false });
  await assert.rejects(finalizePreparationBuild(f.root, '0.4.11', { identity: { ...f.context.identity, revision: commit } }),
    error => error.code === 'ENOENT' && error.path === path.join(directory, 'release.json'));
  await assert.rejects(fs.stat(f.receipt), { code: 'ENOENT' });
  await assert.rejects(fs.stat(preparationBuildDirectory(f.root, commit)), { code: 'ENOENT' });
});

test('retained preparation verifies exact producer, native bytes, Console and SDK without running a build', async t => {
  const f = await fixture(t);
  assert.deepEqual((await verifyPreparationBuild(f.directory, f.context.identity)).result, f.proof.result);
  const before = await fs.readFile(f.receipt);
  await verifyPreparationBuild(f.directory, f.context.identity);
  assert.deepEqual(await fs.readFile(f.receipt), before);
  assert.equal(f.context.env.TURBO_FORCE, 'true');
  assert.equal(f.context.env.TURBO_CACHE, 'local:w');
  assert.equal(f.context.env.PNPM_CONFIG_SIDE_EFFECTS_CACHE, 'false');
  assert.equal(f.context.env.PNPM_CONFIG_SIDE_EFFECTS_CACHE_READONLY, 'false');
  assert.equal(f.context.env.SOURCE_DATE_EPOCH, '1730000000');
  assert.equal(f.context.env.TZ, 'UTC');
  assert.equal(f.context.env.TURBO_TOKEN, undefined);
  assert.equal(f.context.env.TURBO_TEAM, undefined);
});

test('producer and uncached build contract mismatches cannot become the first reproduction', async t => {
  for (const field of ['revision', 'node', 'platform', 'arch', 'packageManager', 'epoch', 'policy', 'recipe', 'lockfile', 'environment', 'configuration'])
    await t.test(field, async sub => {
      const f = await fixture(sub);
      f.proof.identity[field] = field === 'recipe' ? { ...f.proof.identity.recipe, turboForce: false } : 'different';
      await writeJson(f.receipt, f.proof);
      await assert.rejects(verifyPreparationBuild(f.directory, f.context.identity), /source, producer or build policy differs/);
    });
});

test('modified retained output or incomplete consumer acceptance is rejected', async t => {
  for (const field of ['runtime', 'console', 'sdk', 'sdk-inventory', 'manifest', 'consumer', 'missing'])
    await t.test(field, async sub => {
      const f = await fixture(sub);
      if (field === 'runtime') await fs.appendFile(path.join(f.runtime, 'node'), 'changed');
      if (field === 'console') await writeJson(path.join(f.runtime, 'packages/0/webapp/dist/console-version.json'), { version: 'changed' });
      if (field === 'sdk') await fs.appendFile(path.join(f.sdk, 'fixture.tgz'), 'changed');
      if (field === 'sdk-inventory') await fs.appendFile(path.join(f.directory, 'sdk-inventory.json'), ' ');
      if (field === 'manifest') await fs.appendFile(path.join(f.sdk, 'framework-manifest.json'), ' ');
      if (field === 'consumer') { f.proof.consumerVerified = false; await writeJson(f.receipt, f.proof); }
      if (field === 'missing') await fs.unlink(f.receipt);
      await assert.rejects(verifyPreparationBuild(f.directory, f.context.identity));
    });
});

test('source and producer fields remain checked after an attacker rehashes a modified tree', async t => {
  for (const field of ['stamp', 'node', 'sdk-source']) await t.test(field, async sub => {
    const f = await fixture(sub);
    if (field === 'stamp') {
      await writeJson(path.join(f.runtime, 'packages/0/dist/BUILD.json'), { commit: 'b'.repeat(40), dirty: false, timeBasis: 'source' });
      f.proof.result.sha256 = await runtimeArtifactDigest(f.runtime);
      const manifest = await readJson(path.join(f.runtime, 'RUNTIME.json'));
      await writeJson(path.join(f.runtime, 'RUNTIME.json'), { ...manifest, sha256: f.proof.result.sha256 });
    } else if (field === 'node') {
      const manifest = await readJson(path.join(f.runtime, 'RUNTIME.json'));
      await writeJson(path.join(f.runtime, 'RUNTIME.json'), { ...manifest, nodeVersion: 'v0.0.1' });
    } else {
      const records = await readJson(path.join(f.sdk, 'framework-manifest.json'));
      records[0].sourceRevision = 'b'.repeat(40);
      const manifest = JSON.stringify(records);
      await fs.writeFile(path.join(f.sdk, 'framework-manifest.json'), manifest);
      f.proof.result.sdk.manifestSha256 = hash(manifest);
    }
    await writeJson(f.receipt, f.proof);
    await assert.rejects(verifyPreparationBuild(f.directory, f.context.identity));
  });
});

test('a different package manager is refused before any build', async t => {
  const f = await fixture(t);
  await assert.rejects(releaseBuildContext(f.root, revision, async () => '12.0.0'), /package manager differs/);
});

test('preparation publishes a complete directory atomically and reuses an identical retry', async t => {
  const f = await fixture(t);
  const temporary = path.join(path.dirname(f.directory), '.preparation-test');
  await fs.rename(f.directory, temporary);
  await publishPreparationRuntime(temporary, f.directory, f.context.identity);
  await assert.rejects(fs.stat(temporary), { code: 'ENOENT' });
  await verifyPreparationBuild(f.directory, f.context.identity);
  const before = await fs.stat(path.join(f.directory, 'BUILD.json'));
  await fs.cp(f.directory, temporary, { recursive: true });
  await publishPreparationRuntime(temporary, f.directory, f.context.identity);
  assert.equal((await fs.stat(path.join(f.directory, 'BUILD.json'))).ino, before.ino, 'retry must preserve original evidence');
});

test('preparation retry rejects incomplete evidence and divergent fresh outputs without replacing either', async t => {
  for (const change of ['incomplete', 'producer', 'output']) await t.test(change, async sub => {
    const f = await fixture(sub);
    const temporary = path.join(path.dirname(f.directory), '.preparation-test');
    await fs.cp(f.directory, temporary, { recursive: true });
    if (change === 'incomplete') await fs.unlink(path.join(f.directory, 'BUILD.json'));
    else if (change === 'producer') {
      f.proof.identity.node = 'v0.0.1';
      const record = await readJson(path.join(f.directory, 'BUILD.json'));
      await writeJson(path.join(f.directory, 'BUILD.json'), { ...record, identity: f.proof.identity });
    } else if (change === 'output') {
      const runtime = path.join(temporary, 'runtime');
      await fs.appendFile(path.join(runtime, 'node'), 'new output');
      f.proof.result.sha256 = await runtimeArtifactDigest(runtime);
      const manifest = await readJson(path.join(runtime, 'RUNTIME.json'));
      await writeJson(path.join(runtime, 'RUNTIME.json'), { ...manifest, sha256: f.proof.result.sha256 });
      const record = await readJson(path.join(temporary, 'BUILD.json'));
      await writeJson(path.join(temporary, 'BUILD.json'), { ...record, result: { ...record.result, sha256: f.proof.result.sha256 } });
    }
    const before = await fs.stat(f.directory);
    await assert.rejects(publishPreparationRuntime(temporary, f.directory, f.context.identity));
    assert.equal((await fs.stat(f.directory)).ino, before.ino);
    await fs.access(path.join(temporary, 'PREPARATION.json'));
  });
});
