import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseCommand } from '@xec-sh/ops/release';
import policy from '../../.xec/release-policy.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const releaseInstallArgs = ['install', '--frozen-lockfile', '--ignore-scripts', '--prod=false'];
// Xec defers install scripts. Both producers must materialize allowed native
// dependencies before freezing, without restoring another builder's side effects.
export const releaseDependencyBuildArgs = ['--recursive', '--include-workspace-root', 'rebuild', '--pending'];
const recipe = { version: 1, install: releaseInstallArgs, dependencies: releaseDependencyBuildArgs, build: ['run', 'build'],
  turboForce: true, turboCache: 'local:w', remoteCache: false, sideEffectsCache: false };

/** The preparation and independent build must use the same uncached producer contract. */
export async function releaseBuildContext(root, revision, run = releaseCommand) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  const packageManager = (await json(path.join(root, 'package.json'))).packageManager;
  assert.equal(packageManager, 'pnpm@' + await run(root, 'pnpm', ['--version']), 'Release package manager differs');
  const epoch = await run(root, 'git', ['show', '-s', '--format=%ct', revision]);
  assert.match(epoch, /^\d+$/);
  const identity = { schema: 1, revision, node: process.version, platform: process.platform, arch: process.arch,
    packageManager, epoch, policy, recipe };
  const env = { ...process.env, TZ: 'UTC', SOURCE_DATE_EPOCH: epoch,
    PNPM_CONFIG_SIDE_EFFECTS_CACHE: 'false', PNPM_CONFIG_SIDE_EFFECTS_CACHE_READONLY: 'false',
    TURBO_TELEMETRY_DISABLED: '1', TURBO_FORCE: 'true', TURBO_CACHE: recipe.turboCache, TURBO_CONCURRENCY: '3' };
  delete env.TURBO_TOKEN;
  delete env.TURBO_TEAM;
  return { identity, env };
}

export function preparationBuildDirectory(root, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  return path.join(root, '.release-artifacts/qualification', revision, 'preparation');
}

/** The same normalized npm inventory is measured in both independent source exports. */
export async function packReleaseSdk(cwd, output, context, onInventory = async () => {}) {
  const load = file => import(pathToFileURL(path.join(cwd, 'apps/omnitron/dist', file)).href);
  const { normalizePackedWorkspace } = await load('release/portable-archive.js');
  const { inspectFrameworkArchive } = await load('release/registry-framework.js');
  const { readWorkspace, directoryOf } = await load('services/bundle-builder.js');
  const packages = [...readWorkspace(cwd).values()]
    .filter(pkg => !pkg.private && pkg.name.startsWith('@omnitron-dev/'))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  assert.ok(packages.some(pkg => pkg.name === '@omnitron-dev/omnitron'));
  await fs.mkdir(output, { mode: 0o700 });
  const records = [], inventory = [];
  let files = 0;
  for (const pkg of packages) {
    const archive = path.join(output, 'workspace.tgz');
    await releaseCommand(directoryOf(pkg), 'pnpm', ['--config.ignore-scripts=true', 'pack', '--out', archive], { env: context.env });
    await normalizePackedWorkspace(archive);
    const bytes = await fs.readFile(archive);
    const metadata = JSON.parse(await releaseCommand(cwd, 'tar', ['-xOf', archive, 'package/package.json']));
    const sha256 = hash(bytes), integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    const inspected = await inspectFrameworkArchive({ name: pkg.name, version: pkg.version, integrity },
      createReadStream(archive), undefined, context.identity.revision);
    files += inspected.files.size;
    assert.ok(files <= 200_000, 'SDK diagnostic inventory exceeds 200000 files');
    const filename = `${pkg.name.slice(1).replace('/', '-')}-${pkg.version}-${sha256.slice(0, 12)}.tgz`;
    await fs.rename(archive, path.join(output, filename));
    records.push({ name: pkg.name, version: pkg.version, filename, sha256, integrity,
      sourceRevision: context.identity.revision, sourceDirty: false, dependencies: metadata.dependencies ?? {},
      optionalDependencies: metadata.optionalDependencies ?? {}, peerDependencies: metadata.peerDependencies ?? {} });
    inventory.push({ ...records.at(-1), files: Object.fromEntries([...inspected.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) });
    await onInventory(inventory);
  }
  const manifest = JSON.stringify(records, null, 2) + '\n';
  await fs.writeFile(path.join(output, 'framework-manifest.json'), manifest, { flag: 'wx' });
  return { sdk: { packages: records.length, files, manifestSha256: hash(manifest) }, inventory };
}

/** Freeze outputs from a completed clean build, without compiling a second time. */
export async function measureReleaseBuild(cwd, runtime, sdkDirectory, context, onInventory) {
  const revision = context.identity.revision;
  assert.equal(await releaseCommand(cwd, 'git', ['rev-parse', 'HEAD']), revision);
  assert.equal(await releaseCommand(cwd, 'git', ['status', '--porcelain']), '', 'The build changed its source export');
  await releaseCommand(cwd, process.execPath, ['apps/omnitron/scripts/freeze-backend.mjs', 'apps/omnitron', runtime],
    { env: context.env, timeoutMs: 30 * 60_000 });
  const stamp = await json(path.join(runtime, 'packages/0/dist/BUILD.json'));
  assert.equal(stamp.commit, revision);
  assert.equal(stamp.dirty, false, 'The build observed an uncommitted input');
  const manifest = await json(path.join(runtime, 'RUNTIME.json'));
  const ui = await json(path.join(runtime, 'packages/0/webapp/dist/console-version.json'));
  const { sdk, inventory } = await packReleaseSdk(cwd, sdkDirectory, context, onInventory);
  assert.equal(await releaseCommand(cwd, 'git', ['status', '--porcelain']), '', 'Packing changed its source export');
  return { result: { sha256: manifest.sha256, packages: manifest.packages, console: ui.version, sdk }, inventory };
}

/** Verify retained bytes with source-owned code before accepting the first build. */
export async function verifyPreparationBuild(directory, expectedIdentity) {
  const proof = await json(path.join(directory, 'PREPARATION.json'));
  assert.deepEqual(proof.identity, expectedIdentity, 'Preparation source, producer or build policy differs');
  assert.equal(proof.kind, 'clean-package-preparation');
  assert.equal(proof.consumerVerified, true, 'Preparation consumer acceptance is incomplete');
  const runtime = path.join(directory, 'runtime');
  const { verifyRuntimeArtifact } = await import('../../apps/omnitron/src/shared/runtime-artifact.ts');
  const manifest = await verifyRuntimeArtifact(runtime, proof.result.sha256);
  assert.equal(manifest.nodeVersion, expectedIdentity.node, 'Preparation runtime Node differs');
  assert.equal(manifest.platform, expectedIdentity.platform);
  assert.equal(manifest.arch, expectedIdentity.arch);
  assert.equal(manifest.packages, proof.result.packages);
  const stamp = await json(path.join(runtime, 'packages/0/dist/BUILD.json'));
  assert.equal(stamp.commit, expectedIdentity.revision, 'Preparation runtime source differs');
  assert.equal(stamp.dirty, false);
  assert.equal(stamp.timeBasis, 'source');
  const ui = await json(path.join(runtime, 'packages/0/webapp/dist/console-version.json'));
  assert.equal(ui.version, proof.result.console, 'Preparation Console differs');
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

/** The release writer lock excludes other publishers; never replace existing evidence. */
export async function publishPreparationBuild(temporary, directory, identity) {
  const measured = await verifyPreparationBuild(temporary, identity);
  const existing = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing) {
    const retained = await verifyPreparationBuild(directory, identity);
    assert.deepEqual(retained.result, measured.result, 'Retained preparation outputs differ');
    assert.deepEqual(await fs.readFile(path.join(directory, 'sdk-inventory.json')),
      await fs.readFile(path.join(temporary, 'sdk-inventory.json')), 'Retained preparation file inventory differs');
  } else {
    // Publish all outputs and their completion receipt in one filesystem operation.
    await fs.rename(temporary, directory);
  }
  return directory;
}

/** Called only after every package-consumer gate succeeds, before Xec mutates manifests and removes its export. */
export async function retainPreparationBuild(root, workspace, context) {
  assert.notEqual(await fs.realpath(root), await fs.realpath(workspace), 'Preparation requires an independent source export');
  const directory = preparationBuildDirectory(root, context.identity.revision);
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  const temporary = await fs.mkdtemp(path.join(path.dirname(directory), '.preparation-'));
  try {
    const measured = await measureReleaseBuild(workspace, path.join(temporary, 'runtime'), path.join(temporary, 'sdk'), context);
    const inventory = JSON.stringify(measured.inventory) + '\n';
    await fs.writeFile(path.join(temporary, 'sdk-inventory.json'), inventory, { flag: 'wx' });
    await fs.writeFile(path.join(temporary, 'PREPARATION.json'), JSON.stringify({
      kind: 'clean-package-preparation', identity: context.identity, consumerVerified: true,
      result: measured.result, inventorySha256: hash(inventory),
    }, null, 2) + '\n', { flag: 'wx' });
    await publishPreparationBuild(temporary, directory, context.identity);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  return directory;
}
