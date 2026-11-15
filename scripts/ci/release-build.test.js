import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { releaseCommand } from '@xec-sh/ops/release';
import { releaseBuildContext, releaseEnvironment, releaseProducerInputs, assertReleaseProducerApi, preparationBuildDirectory, verifyPreparationBuild, publishPreparationRuntime, finalizePreparationBuild, verifyPublicationPreparation } from '../../.xec/release/build.js';
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

async function publicationFixture(t) {
  const f = await fixture(t), version = '0.4.9';
  const workspace = path.join(f.root, 'packages/example');
  await fs.mkdir(workspace, { recursive: true });
  await writeJson(path.join(workspace, 'package.json'), { name: '@omnitron-dev/example', version });
  const directory = path.join(f.root, '.release-artifacts', version, revision);
  await fs.mkdir(directory, { recursive: true });
  await fs.copyFile(path.join(f.sdk, 'fixture.tgz'), path.join(directory, 'fixture.tgz'));
  const artifacts = [{ name: '@omnitron-dev/example', version, file: 'fixture.tgz',
    integrity: integrity(await fs.readFile(path.join(directory, 'fixture.tgz'))) }];
  const accepted = { schema: 1, commit: revision, version, artifacts };
  // The fixture deliberately records a producer different from the test process.
  // Publication verifies its provenance, rather than claiming another build.
  f.proof.identity.node = process.version === 'v22.18.0' ? 'v24.13.0' : 'v22.18.0';
  const producer = { ...accepted, stage: 'producer', identity: { protocol: 1,
    policy: hash(JSON.stringify(f.proof.identity.policy)), inputs: { build: hash(JSON.stringify(f.proof.identity)) },
    runtime: { platform: f.proof.identity.platform, arch: f.proof.identity.arch,
      versions: { node: f.proof.identity.node.slice(1) } } } };
  await writeJson(path.join(directory, 'producer.json'), producer);
  await writeJson(path.join(directory, 'release.json'), accepted);
  f.proof.acceptedArtifacts = artifacts.map(({ name, version, integrity }) => ({ name, version, integrity }));
  f.proof.publicationReceipts = {
    producer: hash(await fs.readFile(path.join(directory, 'producer.json'))),
    release: hash(await fs.readFile(path.join(directory, 'release.json'))),
  };
  await writeJson(f.receipt, f.proof);
  const observed = [];
  const execute = async (cwd, executable, args) => {
    assert.equal(cwd, f.root);
    observed.push([executable, ...args]);
    if (executable === 'git' && args.join(' ') === 'rev-parse HEAD') return revision;
    if (executable === 'git' && args.join(' ') === `show -s --format=%ct ${revision}`) return f.proof.identity.epoch;
    if (executable === 'pnpm' && args.join(' ') === '--config.lockfile=false --config.ignore-pnpmfile=true --recursive list --depth -1 --json')
      return JSON.stringify([{ path: workspace }]);
    throw Error('Publication must not build, pack, run consumers or dispatch qualification: ' + executable + ' ' + args.join(' '));
  };
  return { ...f, version, archives: directory, execute, observed };
}

test('npm publication verifies exact accepted bytes without runtime qualification or a repeated build', async t => {
  const f = await publicationFixture(t);
  const before = await fs.readFile(f.receipt);
  // These retained outputs belong to runtime reproduction/activation. Npm
  // publication reads only its actual archives and canonical acceptance receipts.
  await fs.rm(f.runtime, { recursive: true });
  await fs.rm(f.sdk, { recursive: true });
  const result = await verifyPublicationPreparation(f.root, f.version, f.execute);
  assert.equal(result.publication.kind, 'accepted-npm-archives');
  assert.equal(result.publication.producerNode, f.proof.identity.node);
  assert.notEqual(result.publication.producerNode, process.version);
  assert.equal(result.prepared.artifacts.length, 1);
  assert.deepEqual(await fs.readFile(f.receipt), before, 'read-only publication cannot create or rewrite acceptance');
  assert.deepEqual(f.observed.map(([executable]) => executable), ['git', 'pnpm', 'git']);
});

test('unaccepted, changed or incomplete release evidence cannot authorize npm publication', async t => {
  for (const change of ['release-missing', 'producer-missing', 'acceptance-missing', 'consumer', 'archives',
    'accepted-inventory', 'producer-receipt', 'release-receipt', 'receipt-binding', 'producer-source',
    'source', 'policy', 'recipe', 'lockfile', 'package-manager']) await t.test(change, async sub => {
    const f = await publicationFixture(sub);
    if (change === 'release-missing') await fs.unlink(path.join(f.archives, 'release.json'));
    else if (change === 'producer-missing') await fs.unlink(path.join(f.archives, 'producer.json'));
    else if (change === 'acceptance-missing') await fs.unlink(f.receipt);
    else if (change === 'archives') await fs.appendFile(path.join(f.archives, 'fixture.tgz'), 'altered');
    else if (change === 'producer-receipt' || change === 'release-receipt')
      await fs.appendFile(path.join(f.archives, change.split('-')[0] + '.json'), '\n');
    else if (change === 'producer-source') {
      const file = path.join(f.archives, 'producer.json'), record = await readJson(file);
      record.commit = 'b'.repeat(40);
      await writeJson(file, record);
      f.proof.publicationReceipts.producer = hash(await fs.readFile(file));
      await writeJson(f.receipt, f.proof);
    } else if (change === 'lockfile') await fs.appendFile(path.join(f.root, 'pnpm-lock.yaml'), '# changed\n');
    else if (change === 'package-manager') await writeJson(path.join(f.root, 'package.json'), { packageManager: 'pnpm@0.0.1' });
    else {
      if (change === 'consumer') f.proof.consumerVerified = false;
      if (change === 'accepted-inventory') f.proof.acceptedArtifacts[0].integrity = integrity(Buffer.from('other bytes'));
      if (change === 'receipt-binding') delete f.proof.publicationReceipts;
      if (change === 'source') f.proof.identity.revision = 'b'.repeat(40);
      if (change === 'policy') f.proof.identity.policy.preparation.consumerTimeoutMs++;
      if (change === 'recipe') f.proof.identity.recipe.turboForce = false;
      await writeJson(f.receipt, f.proof);
    }
    await assert.rejects(verifyPublicationPreparation(f.root, f.version, f.execute));
  });
});

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
