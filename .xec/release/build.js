import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as releaseOps from '@xec-sh/ops/release';
import { releaseCommand } from '@xec-sh/ops/release';
import { findPackageJSON } from 'node:module';
import { devNull } from 'node:os';
import policy from '../release-policy.mjs';
import { saveEvidence } from '../evidence.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const releaseInstallArgs = ['install', '--frozen-lockfile', '--ignore-scripts', '--prod=false'];
// Xec defers install scripts. Both producers must materialize allowed native
// dependencies before freezing, without restoring another builder's side effects.
export const releaseDependencyBuildArgs = ['--recursive', '--include-workspace-root', 'rebuild', '--pending'];
const recipe = { version: 2, install: releaseInstallArgs, dependencies: releaseDependencyBuildArgs, build: ['run', 'build'],
  turboForce: true, turboCache: 'local:w', remoteCache: false, sideEffectsCache: false };

const inheritedEnvironment = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'COMSPEC',
  'SystemRoot', 'windir', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PNPM_HOME', 'COREPACK_HOME',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'NPM_CONFIG_CACHE', 'npm_config_cache', 'PNPM_CONFIG_STORE_DIR',
  'NPM_CONFIG_USERCONFIG', 'npm_config_userconfig', 'NPM_CONFIG_REGISTRY', 'npm_config_registry',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CI', 'FORCE_COLOR', 'NO_COLOR', 'TERM',
  'NODE_OPTIONS', 'CC', 'CXX', 'CFLAGS', 'CXXFLAGS', 'LDFLAGS', 'SDKROOT', 'MACOSX_DEPLOYMENT_TARGET',
]);

/** Do not inherit daemon authority, arbitrary script variables or ambient Turbo caches. */
export function releaseEnvironment(input = process.env) {
  const selected = Object.fromEntries(Object.entries(input).filter(([name, value]) => value !== undefined &&
    (inheritedEnvironment.has(name) || name.startsWith('VITE_'))).sort(([a], [b]) => a.localeCompare(b, 'en')));
  if (selected.NODE_OPTIONS?.trim() && !selected.NODE_OPTIONS.trim().split(/\s+/).every(option =>
    /^--(?:max-old-space-size|max-semi-space-size|stack-trace-limit)=\d+$/.test(option) ||
    ['--enable-source-maps', '--no-warnings'].includes(option)))
    throw Error('Release NODE_OPTIONS may set resource/diagnostic limits, not external code or loaders');
  return selected;
}

export function assertReleaseProducerApi(ops = releaseOps) {
  if (ops.RELEASE_PRODUCER_PROTOCOL !== 1 || typeof ops.packReleaseArtifacts !== 'function')
    throw Error('Release preparation requires the published @xec-sh/ops 0.13 producer API; update the pinned dependency first');
}

/** The preparation and independent build must use the same uncached producer contract. */
export async function releaseBuildContext(root, revision, run = releaseCommand) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  const packageManager = (await json(path.join(root, 'package.json'))).packageManager;
  assert.equal(packageManager, 'pnpm@' + await run(root, 'pnpm', ['--version']), 'Release package manager differs');
  const epoch = await run(root, 'git', ['show', '-s', '--format=%ct', revision]);
  assert.match(epoch, /^\d+$/);
  const env = { ...releaseEnvironment(), TZ: 'UTC', SOURCE_DATE_EPOCH: epoch,
    GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', NPM_CONFIG_GLOBALCONFIG: devNull,
    PNPM_CONFIG_SIDE_EFFECTS_CACHE: 'false', PNPM_CONFIG_SIDE_EFFECTS_CACHE_READONLY: 'false',
    TURBO_TELEMETRY_DISABLED: '1', TURBO_FORCE: 'true', TURBO_CACHE: recipe.turboCache, TURBO_CONCURRENCY: '3' };
  const configuration = {};
  for (const [name, file] of Object.entries({
    npmrc: env.NPM_CONFIG_USERCONFIG ?? env.npm_config_userconfig ?? (env.HOME && path.join(env.HOME, '.npmrc')),
    certificate: env.NODE_EXTRA_CA_CERTS,
  })) if (file) configuration[name] = await fs.readFile(file).then(hash, error => {
    if (error.code !== 'ENOENT') throw error;
    return hash('absent');
  });
  const identity = { schema: 2, revision, node: process.version, platform: process.platform, arch: process.arch,
    packageManager, epoch, policy, recipe, lockfile: hash(await fs.readFile(path.join(root, 'pnpm-lock.yaml'))),
    environment: hash(JSON.stringify(env)), configuration };
  return { identity, env };
}

/** Bind the actual installed release driver closure, not just callback source text. */
export async function releaseProducerInputs(root, context) {
  const inputs = { build: hash(JSON.stringify(context.identity)) }, seen = new Set();
  async function dependency(importer, name) {
    const file = findPackageJSON(name, pathToFileURL(importer));
    assert.ok(file, `Release driver package is unavailable: ${name}`);
    const directory = await fs.realpath(path.dirname(file));
    if (seen.has(directory)) return;
    seen.add(directory);
    const digest = createHash('sha256');
    async function visit(relative) {
      const target = path.join(directory, relative), stat = await fs.lstat(target);
      if (stat.isDirectory()) for (const child of (await fs.readdir(target)).sort()) await visit(path.join(relative, child));
      else {
        assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Release driver input must be a regular file');
        digest.update(relative + '\0').update(await fs.readFile(target)).update('\0');
      }
    }
    await visit('package.json');
    await visit('dist');
    const metadata = await json(file);
    assert.equal(metadata.name, name, 'Resolved release driver package identity differs');
    for (const entry of Object.values(typeof metadata.bin === 'string' ? { bin: metadata.bin } : metadata.bin ?? {})) await visit(entry);
    inputs[name + '@' + metadata.version + ':' + hash(directory).slice(0, 16)] = digest.digest('hex');
    for (const child of Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies }).sort())
      if (child.startsWith('@xec-sh/')) await dependency(file, child);
  }
  for (const name of ['@xec-sh/cli', '@xec-sh/ops']) await dependency(path.join(root, 'package.json'), name);
  return inputs;
}

export function preparationBuildDirectory(root, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  return path.join(root, '.release-artifacts/qualification', revision, 'preparation');
}

/** One owner hook attaches provenance and normalizes bytes before Xec seals them. */
export async function prepareReleaseArchive({ workspace, file }, revision) {
  const { normalizePackedWorkspace } = await import(pathToFileURL(
    path.join(workspace, 'apps/omnitron/dist/release/portable-archive.js')).href);
  await normalizePackedWorkspace(file, revision);
}

/** Inspect and retain the exact packed bytes; never call a packer from this verifier. */
export async function inspectReleaseSdk(artifacts, output, context, inspectFrameworkArchive, onInventory = async () => {}) {
  await fs.mkdir(output, { mode: 0o700 });
  const records = [], inventory = [];
  let files = 0;
  for (const artifact of [...artifacts].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const bytes = await fs.readFile(artifact.file), sha256 = hash(bytes);
    const inspected = await inspectFrameworkArchive(artifact, createReadStream(artifact.file), undefined, context.identity.revision);
    files += inspected.files.size;
    assert.ok(files <= 200_000, 'SDK diagnostic inventory exceeds 200000 files');
    const filename = `${artifact.name.slice(1).replace('/', '-')}-${artifact.version}-${sha256.slice(0, 12)}.tgz`;
    await fs.copyFile(artifact.file, path.join(output, filename), fs.constants.COPYFILE_EXCL);
    const metadata = inspected.metadata;
    records.push({ name: artifact.name, version: artifact.version, filename, sha256, integrity: artifact.integrity,
      sourceRevision: context.identity.revision, sourceDirty: false, dependencies: metadata.dependencies ?? {},
      optionalDependencies: metadata.optionalDependencies ?? {}, peerDependencies: metadata.peerDependencies ?? {} });
    inventory.push({ ...records.at(-1), files: Object.fromEntries([...inspected.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) });
    await onInventory(inventory);
  }
  const manifest = JSON.stringify(records, null, 2) + '\n';
  await fs.writeFile(path.join(output, 'framework-manifest.json'), manifest, { flag: 'wx' });
  return { sdk: { packages: records.length, files, manifestSha256: hash(manifest) }, inventory };
}

/** Independent build 2 uses exactly the same Xec producer and owner archive hook. */
export async function packReleaseSdk(cwd, output, context, onInventory) {
  assertReleaseProducerApi();
  const temporary = await fs.mkdtemp(path.join(path.dirname(output), '.sdk-pack-'));
  try {
    const packages = await releaseOps.discoverReleasePackages(cwd);
    const artifacts = await releaseOps.packReleaseArtifacts(cwd, temporary, packages, {
      run: (directory, executable, args, options) => releaseCommand(directory, executable, args, { ...options, envMode: 'replace', env: context.env }),
      prepareArchive: archive => prepareReleaseArchive(archive, context.identity.revision),
    });
    const { inspectFrameworkArchive } = await import(pathToFileURL(path.join(cwd, 'apps/omnitron/dist/release/registry-framework.js')).href);
    return await inspectReleaseSdk(artifacts, output, context, inspectFrameworkArchive, onInventory);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

/** Freeze outputs from a completed clean build, without compiling a second time. */
export async function measureReleaseRuntime(cwd, runtime, context) {
  const revision = context.identity.revision;
  assert.equal(await releaseCommand(cwd, 'git', ['rev-parse', 'HEAD']), revision);
  assert.equal(await releaseCommand(cwd, 'git', ['status', '--porcelain']), '', 'The build changed its source export');
  await releaseCommand(cwd, process.execPath, ['apps/omnitron/scripts/freeze-backend.mjs', 'apps/omnitron', runtime],
    { envMode: 'replace', env: context.env, timeoutMs: 30 * 60_000 });
  const stamp = await json(path.join(runtime, 'packages/0/dist/BUILD.json'));
  assert.equal(stamp.commit, revision);
  assert.equal(stamp.dirty, false, 'The build observed an uncommitted input');
  const manifest = await json(path.join(runtime, 'RUNTIME.json'));
  const ui = await json(path.join(runtime, 'packages/0/webapp/dist/console-version.json'));
  return { sha256: manifest.sha256, packages: manifest.packages, console: ui.version };
}

export async function measureReleaseBuild(cwd, runtime, sdkDirectory, context, onInventory) {
  const result = await measureReleaseRuntime(cwd, runtime, context);
  const { sdk, inventory } = await packReleaseSdk(cwd, sdkDirectory, context, onInventory);
  assert.equal(await releaseCommand(cwd, 'git', ['status', '--porcelain']), '', 'Packing changed its source export');
  return { result: { ...result, sdk }, inventory };
}

/** Verify retained bytes with source-owned code before accepting the first build. */
export async function verifyPreparationBuild(directory, expectedIdentity) {
  const proof = await json(path.join(directory, 'PREPARATION.json'));
  assert.deepEqual(proof.identity, expectedIdentity, 'Preparation source, producer or build policy differs');
  assert.equal(proof.kind, 'clean-package-preparation');
  assert.equal(proof.consumerVerified, true, 'Preparation consumer acceptance is incomplete');
  const { sdk: _sdk, ...runtimeResult } = proof.result;
  assert.deepEqual(await verifyPreparationRuntime(directory, expectedIdentity), runtimeResult, 'Accepted preparation differs from its producer');
  const sdk = path.join(directory, 'sdk');
  const bytes = await fs.readFile(path.join(sdk, 'framework-manifest.json'));
  assert.equal(hash(bytes), proof.result.sdk.manifestSha256, 'Preparation SDK inventory changed');
  const records = JSON.parse(bytes);
  assert.equal(records.length, proof.result.sdk.packages);
  assert.equal(new Set(records.map(record => record.name)).size, records.length);
  for (const entry of records) {
    assert.equal(path.basename(entry.filename), entry.filename, 'Invalid preparation SDK path');
    assert.equal(entry.sourceRevision, expectedIdentity.revision);
    assert.equal(entry.sourceDirty, false);
    const archive = path.join(sdk, entry.filename);
    assert.ok((await fs.lstat(archive)).isFile(), 'Preparation SDK archive must be a regular file');
    const contents = await fs.readFile(archive);
    assert.equal(hash(contents), entry.sha256, 'Preparation SDK archive changed');
    assert.equal('sha512-' + createHash('sha512').update(contents).digest('base64'), entry.integrity);
  }
  const inventoryBytes = await fs.readFile(path.join(directory, 'sdk-inventory.json'));
  assert.equal(hash(inventoryBytes), proof.inventorySha256, 'Preparation SDK file inventory changed');
  return { result: proof.result, inventory: JSON.parse(inventoryBytes) };
}

/** Publish only a verified build producer; this does not claim consumer acceptance. */
export async function publishPreparationRuntime(temporary, directory, identity) {
  const measured = await verifyPreparationRuntime(temporary, identity);
  const existing = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing) assert.deepEqual(await verifyPreparationRuntime(directory, identity), measured, 'Retained producer runtime differs');
  else await fs.rename(temporary, directory);
  return directory;
}

/** Retain only the independent producer runtime. This is not consumer acceptance. */
export async function retainPreparationRuntime(root, workspace, context) {
  assert.notEqual(await fs.realpath(root), await fs.realpath(workspace), 'Preparation requires an independent source export');
  const directory = preparationBuildDirectory(root, context.identity.revision);
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  const temporary = await fs.mkdtemp(path.join(path.dirname(directory), '.preparation-'));
  try {
    const result = await measureReleaseRuntime(workspace, path.join(temporary, 'runtime'), context);
    await fs.writeFile(path.join(temporary, 'BUILD.json'), JSON.stringify({ identity: context.identity, result }) + '\n', { flag: 'wx' });
    await publishPreparationRuntime(temporary, directory, context.identity);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  return directory;
}

export async function verifyPreparationRuntime(directory, identity) {
  const record = await json(path.join(directory, 'BUILD.json'));
  assert.deepEqual(record.identity, identity, 'Preparation source, producer or build policy differs');
  const { verifyRuntimeArtifact } = await import('../../apps/omnitron/src/shared/runtime-artifact.ts');
  const runtime = path.join(directory, 'runtime');
  const manifest = await verifyRuntimeArtifact(runtime, record.result.sha256);
  assert.equal(manifest.nodeVersion, identity.node);
  assert.equal(manifest.platform, identity.platform);
  assert.equal(manifest.arch, identity.arch);
  assert.equal(manifest.packages, record.result.packages);
  const stamp = await json(path.join(runtime, 'packages/0/dist/BUILD.json'));
  assert.equal(stamp.commit, identity.revision);
  assert.equal(stamp.dirty, false);
  assert.equal(stamp.timeBasis, 'source');
  assert.equal((await json(path.join(runtime, 'packages/0/webapp/dist/console-version.json'))).version, record.result.console);
  return record.result;
}

/** Called only after Xec has accepted the exact batch and confirmed all cleanup. */
export async function finalizePreparationBuild(root, version, context) {
  const prepared = await releaseOps.loadPreparedRelease(root, version);
  assert.equal(prepared.commit, context.identity.revision, 'Accepted producer source differs');
  const directory = preparationBuildDirectory(root, context.identity.revision);
  const acceptedArtifacts = prepared.artifacts.map(({ name, version, integrity }) => ({ name, version, integrity }));
  if (await fs.stat(path.join(directory, 'PREPARATION.json')).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) {
    assert.deepEqual((await json(path.join(directory, 'PREPARATION.json'))).acceptedArtifacts, acceptedArtifacts, 'Accepted preparation archive batch differs');
    return verifyPreparationBuild(directory, context.identity);
  }
  const result = await verifyPreparationRuntime(directory, context.identity);
  const temporary = await fs.mkdtemp(path.join(directory, '.acceptance-'));
  let record, inventory;
  try {
    // Verified runtime identity precedes loading its canonical archive inspector.
    const { inspectFrameworkArchive } = await import(pathToFileURL(path.join(directory, 'runtime/packages/0/dist/release/registry-framework.js')).href);
    const measured = await inspectReleaseSdk(prepared.artifacts, path.join(temporary, 'sdk'), context, inspectFrameworkArchive);
    inventory = measured.inventory;
    const inventoryBytes = JSON.stringify(inventory) + '\n';
    await fs.writeFile(path.join(temporary, 'sdk-inventory.json'), inventoryBytes, { flag: 'wx' });
    record = { kind: 'clean-package-preparation', identity: context.identity, consumerVerified: true, acceptedArtifacts,
      result: { ...result, sdk: measured.sdk }, inventorySha256: hash(inventoryBytes) };
    // Retried finalization can discard only these uncommitted, derived copies.
    for (const name of ['sdk', 'sdk-inventory.json']) {
      await fs.rm(path.join(directory, name), { recursive: true, force: true });
      await fs.rename(path.join(temporary, name), path.join(directory, name));
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  await saveEvidence(path.join(directory, 'PREPARATION.json'), record);
  return { result: record.result, inventory };
}
