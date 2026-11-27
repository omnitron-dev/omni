import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { artifactIntegrity, discoverReleasePackages, releaseCommand, releaseTag } from '@xec-sh/ops/release';
import { inspectReleaseSdk, releaseBuildContext } from '../release/build.js';

// Use the pack command and archive format of the application's vendored verifier.
// npm preparation independently stamps its own publication archives with gitHead.
async function buildSdk(source, revision, version, stage, name) {
  const checkout = await fs.mkdtemp(path.join(stage, name + '-source-'));
  const packed = await fs.mkdtemp(path.join(stage, name + '-archives-'));
  const output = path.join(stage, name);
  try {
    const git = (...args) => releaseCommand(checkout, 'git', ['--no-replace-objects', ...args]);
    await git('init', '--quiet');
    await git('fetch', '--quiet', '--depth=1', '--no-tags', '--', source, revision);
    await git('checkout', '--quiet', '--detach', revision);
    assert.equal(await git('rev-parse', 'HEAD'), revision);
    assert.equal(await git('status', '--porcelain'), '');
    const tree = await git('rev-parse', 'HEAD^{tree}');
    const context = await releaseBuildContext(checkout, revision);
    const env = { ...context.env, CI: '1', OMNITRON_HOME: path.join(stage, name + '-home') };
    const run = (cwd, executable, args) => releaseCommand(cwd, executable, args,
      { env, envMode: 'replace', timeoutMs: 30 * 60_000 });
    console.log(name + ' · installing the frozen workspace and building ' + revision);
    await run(checkout, 'pnpm', ['install', '--frozen-lockfile']);
    await run(checkout, 'pnpm', ['run', 'build']);
    const built = file => import(pathToFileURL(path.join(checkout, 'apps/omnitron/dist/release', file)).href);
    const { normalizePackedWorkspace } = await built('portable-archive.js');
    const { inspectFrameworkArchive } = await built('registry-framework.js');
    const packages = await discoverReleasePackages(checkout, run);
    const artifacts = [];
    for (const pkg of packages) {
      assert.equal(pkg.version, version, 'Release package version differs: ' + pkg.name);
      const file = path.join(packed, encodeURIComponent(pkg.name) + '.tgz');
      await run(path.join(checkout, pkg.path), 'pnpm', ['pack', '--out', file]);
      await normalizePackedWorkspace(file);
      artifacts.push({ name: pkg.name, version, file, integrity: artifactIntegrity(await fs.readFile(file)) });
    }
    const { sdk } = await inspectReleaseSdk(artifacts, output, context, inspectFrameworkArchive);
    assert.equal(await git('rev-parse', 'HEAD'), revision);
    assert.equal(await git('status', '--porcelain'), '', 'The build changed its Git source');
    return { version, revision, tree, packageManager: context.identity.packageManager, sdk };
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
    await fs.rm(packed, { recursive: true, force: true });
  }
}

export async function compareVendoredSdk(first, second) {
  const manifest = directory => fs.readFile(path.join(directory, 'framework-manifest.json'));
  const bytes = await manifest(first);
  assert.ok(bytes.equals(await manifest(second)), 'Independent vendored SDK manifests differ');
  const checksums = [];
  for (const entry of JSON.parse(bytes)) {
    assert.equal(path.basename(entry.filename), entry.filename);
    const a = await fs.readFile(path.join(first, entry.filename));
    const b = await fs.readFile(path.join(second, entry.filename));
    assert.ok(a.equals(b), 'Independent pnpm packs differ: ' + entry.name);
    assert.equal(artifactIntegrity(a), entry.integrity, 'Manifest SHA-512 differs: ' + entry.name);
    assert.equal(createHash('sha256').update(a).digest('hex'), entry.sha256);
    checksums.push(Buffer.from(entry.integrity.slice('sha512-'.length), 'base64').toString('hex') + '  ' + entry.filename);
  }
  assert.ok(checksums.length, 'Empty vendored SDK');
  return checksums.join('\n') + '\n';
}

export async function prepareVendoredSdk(source, { revision, out }) {
  assert.match(revision, /^[a-f0-9]{40}$/, 'Expected the full release commit');
  const git = (...args) => releaseCommand(source, 'git', ['--no-replace-objects', ...args]);
  const { version } = JSON.parse(await git('show', revision + ':apps/omnitron/package.json'));
  assert.equal(await git('rev-parse', '--verify', 'refs/tags/' + releaseTag(version) + '^{commit}'), revision,
    'The release tag does not select the requested commit');
  await git('merge-base', '--is-ancestor', revision, 'HEAD');
  const output = path.resolve(out);
  await fs.lstat(output).then(() => { throw Error('Destination already exists: ' + output); },
    error => { if (error.code !== 'ENOENT') throw error; });
  const stage = await fs.mkdtemp(path.join(path.dirname(output), '.vendored-sdk-'));
  try {
    const first = await buildSdk(source, revision, version, stage, 'first');
    const second = await buildSdk(source, revision, version, stage, 'second');
    assert.deepEqual(second, first, 'Independent vendored SDK measurements differ');
    const sdk = path.join(stage, 'second');
    const sums = await compareVendoredSdk(path.join(stage, 'first'), sdk);
    await fs.writeFile(path.join(sdk, 'SHA512SUMS'), sums, { flag: 'wx' });
    const receipt = { ...second, independentBuilds: 2, node: process.version, platform: process.platform, arch: process.arch };
    await fs.mkdir(output, { mode: 0o700 });
    await fs.rename(sdk, path.join(output, 'sdk'));
    await fs.writeFile(path.join(output, 'QUALIFICATION.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(receipt));
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

export function command(program) {
  program.command('vendored-sdk').description('Build a tagged SDK twice and verify every vendored pnpm archive')
    .requiredOption('--revision <sha>', 'Full tagged release commit')
    .requiredOption('--out <directory>', 'New directory for the verified SDK and qualification receipt')
    .allowExcessArguments(false)
    .action(values => prepareVendoredSdk(process.cwd(), values));
}
