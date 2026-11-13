import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareVersionQualification, verifyVersionQualification } from '../../.xec/version-qualification.js';

const CORE = '@omnitron-dev/omnitron';
const beforeVersion = '0.4.0', version = '0.4.6';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
};

async function fixture(t, packageCount = 35) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-version-qualification-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-12T18:00:00Z', GIT_COMMITTER_DATE: '2026-11-12T18:00:00Z' },
  }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Version qualification fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  await write(path.join(root, '.gitignore'), '.release-artifacts/\n');
  await write(path.join(root, 'package.json'), { private: true, type: 'module' });
  await write(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const packages = Array.from({ length: packageCount }, (_, index) => ({
    name: index ? '@omnitron-dev/fixture-' + String(index).padStart(2, '0') : CORE,
    directory: index ? 'packages/fixture-' + String(index).padStart(2, '0') : 'apps/omnitron',
  }));
  for (const item of packages) {
    item.manifest = { name: item.name, version: beforeVersion, type: 'module', main: './dist/index.js',
      ...(item.name === CORE ? { dependencies: { [packages[1].name]: 'workspace:*' }, peerDependencies: { [packages[2].name]: 'workspace:*' } } : {}) };
    await write(path.join(root, item.directory, 'package.json'), item.manifest);
    await write(path.join(root, item.directory, 'src/index.js'), 'export const answer = 42;\n');
  }
  git('add', '.'); git('commit', '--quiet', '-m', 'Qualified runtime source');
  const baseCommit = git('rev-parse', 'HEAD');
  for (const item of packages) await write(path.join(root, item.directory, 'package.json'), { ...item.manifest, version });
  await write(path.join(root, '.xec/version-qualification.js'), '// Reviewed release orchestration only.\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'Version metadata only');
  const commit = git('rev-parse', 'HEAD');
  const storage = path.join(root, '.release-artifacts');
  const runtime = path.join(storage, 'base-runtime');
  await write(path.join(runtime, 'package.json'), { type: 'module' });
  await write(path.join(runtime, 'RUNTIME.json'), { sha256: '1'.repeat(64) });
  // The base-verification callback is the boundary under test. Its tiny runtime
  // loads the REAL bounded archive inspector, rather than a fake tar oracle.
  const tsx = import.meta.resolve('tsx/esm/api');
  for (const [file, exported] of [['release/registry-framework', 'inspectFrameworkArchive'], ['shared/build-stamp', 'parseBuildStamp']]) {
    const source = path.join(repo, 'apps/omnitron/src', file + '.ts');
    await write(path.join(runtime, 'packages/0/dist', file + '.js'),
      'import { tsImport } from ' + JSON.stringify(tsx) + ';\n' +
      'const actual = await tsImport(' + JSON.stringify(source) + ', import.meta.url);\n' +
      'export const ' + exported + ' = actual.' + exported + ';\n');
  }
  const baseReceipt = path.join(storage, 'base-qualification.json');
  await write(baseReceipt, { commit: baseCommit, kind: 'fixture-canonical-base', ci: { id: 10 }, native: { id: 11 } });
  const stamp = revision => ({ commit: revision, dirty: false, builtAt: '2026-11-12T18:00:00.000Z', timeBasis: 'source' });
  const artifacts = { base: [], candidate: [] }, packRoots = new Map();
  async function repack(side, name) {
    const item = artifacts[side].find(a => a.name === name);
    execFileSync('tar', ['-czf', item.file, '-C', packRoots.get(side + name), 'package'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    item.integrity = integrity(await fs.readFile(item.file));
  }
  for (const [side, releaseVersion, revision] of [['base', beforeVersion, baseCommit], ['candidate', version, commit]]) {
    for (const [index, item] of packages.entries()) {
      const pack = path.join(storage, side + '-pack-' + index);
      packRoots.set(side + item.name, pack);
      const manifest = { ...item.manifest, version: releaseVersion, gitHead: revision };
      for (const field of ['dependencies', 'peerDependencies']) if (manifest[field])
        manifest[field] = Object.fromEntries(Object.keys(manifest[field]).map(name => [name, releaseVersion]));
      await write(path.join(pack, 'package/package.json'), manifest);
      await write(path.join(pack, 'package/dist/index.js'), 'export const answer = 42;\n');
      await write(path.join(pack, 'package/dist/index.d.ts'), 'export declare const answer = 42;\n');
      if (item.name === CORE) {
        await write(path.join(pack, 'package/dist/BUILD.json'), stamp(revision));
        await write(path.join(pack, 'package/webapp/dist/BUILD.json'), stamp(revision));
        await write(path.join(pack, 'package/webapp/dist/index.html'), '<h1>Console</h1>\n');
        await write(path.join(pack, 'package/dist/worker.js'), 'self.onmessage = () => {};\n');
        await write(path.join(pack, 'package/fonts/font.bin'), 'fixed font bytes');
      }
      const archive = { name: item.name, version: releaseVersion, file: path.join(storage, side + '-' + index + '.tgz') };
      artifacts[side].push(archive);
      await repack(side, item.name);
    }
  }
  let baseChecks = 0;
  const prepared = { commit, version, artifacts: artifacts.candidate };
  const options = { baseCommit, prepared, verifyBase: async requested => {
    baseChecks++; assert.equal(requested, baseCommit);
    return { commit: baseCommit, version: beforeVersion, runtime, receipt: baseReceipt, artifacts: artifacts.base };
  } };
  return { root, git, packages, prepared, options, runtime, baseReceipt, artifacts, repack,
    pack: name => path.join(packRoots.get('candidate' + name), 'package'), baseChecks: () => baseChecks };
}

test('fresh 35-package archives receive explicit base attribution; verification rechecks real bytes and never writes', async t => {
  const f = await fixture(t);
  const proof = await prepareVersionQualification(f.root, version, f.options);
  assert.equal(proof.kind, 'version-only');
  assert.equal(proof.scenariosAttestedOn, f.options.baseCommit);
  assert.equal(proof.commit, f.prepared.commit);
  assert.equal(proof.archiveEquivalence.length, 35);
  assert.equal(proof.independentBuilds, undefined);
  assert.equal(proof.native, undefined);
  const control = proof.sourceEquivalence.controlFiles.find(item => item.file === '.xec/version-qualification.js');
  assert.equal(control.baseSha256, null);
  assert.match(control.candidateSha256, /^[a-f0-9]{64}$/);
  const receipt = await fs.readFile(proof.receipt);
  await verifyVersionQualification(f.root, version, f.options);
  assert.equal(f.baseChecks(), 2);
  assert.deepEqual(await fs.readFile(proof.receipt), receipt);
  await t.test('canonical base refusal cannot be replaced by the saved green receipt', async () => {
    await assert.rejects(verifyVersionQualification(f.root, version, { ...f.options, verifyBase() { throw Error('CI no longer successful'); } }), /CI no longer successful/);
  });
  await t.test('changed base receipt is not trusted from a copied stage', async () => {
    const original = await fs.readFile(f.baseReceipt);
    await write(f.baseReceipt, { commit: f.options.baseCommit, ci: { id: 20 } });
    await assert.rejects(verifyVersionQualification(f.root, version, f.options), /evidence changed/);
    await fs.writeFile(f.baseReceipt, original);
  });
  await t.test('compressed archive tampering is detected on a later verification', async () => {
    const archive = f.artifacts.candidate[5];
    const original = await fs.readFile(archive.file);
    const changed = Buffer.from(original); changed[9] ^= 1; // Valid gzip header with different compressed integrity.
    await fs.writeFile(archive.file, changed);
    await assert.rejects(verifyVersionQualification(f.root, version, f.options), /SHA-512/);
    await fs.writeFile(archive.file, original);
  });
});

test('the committed public workspace inventory owns version-only qualification as the SDK grows', async t => {
  const f = await fixture(t, 36);
  const proof = await prepareVersionQualification(f.root, version, f.options);
  assert.equal(proof.archiveEquivalence.length, f.packages.length);
  await assert.rejects(prepareVersionQualification(f.root, version, {
    ...f.options, prepared: { ...f.prepared, artifacts: f.artifacts.candidate.slice(0, 35) },
  }), /cover the public SDK/);
});

test('equal inventory cannot hide executable, declaration, asset, peer or build-stamp changes', async t => {
  const f = await fixture(t);
  const pack = f.pack(CORE);
  for (const relative of ['dist/index.js', 'dist/index.d.ts', 'dist/worker.js', 'fonts/font.bin', 'webapp/dist/index.html']) {
    await t.test(relative, async () => {
      const file = path.join(pack, relative), original = await fs.readFile(file);
      await fs.appendFile(file, '\nchanged'); await f.repack('candidate', CORE);
      await assert.rejects(prepareVersionQualification(f.root, version, f.options), /content bytes differ/);
      await fs.writeFile(file, original); await f.repack('candidate', CORE);
    });
  }
  await t.test('executable bit', async () => {
    const file = path.join(pack, 'dist/index.js');
    await fs.chmod(file, 0o755); await f.repack('candidate', CORE);
    await assert.rejects(prepareVersionQualification(f.root, version, f.options), /executable mode differs/);
    await fs.chmod(file, 0o644); await f.repack('candidate', CORE);
  });
  await t.test('internal peer still names old minor version', async () => {
    const file = path.join(pack, 'package.json'), original = await fs.readFile(file), manifest = JSON.parse(original);
    manifest.peerDependencies[f.packages[2].name] = beforeVersion;
    await write(file, manifest); await f.repack('candidate', CORE);
    await assert.rejects(prepareVersionQualification(f.root, version, f.options), /metadata changed/);
    await fs.writeFile(file, original); await f.repack('candidate', CORE);
  });
  for (const relative of ['dist/BUILD.json', 'webapp/dist/BUILD.json']) {
    await t.test(relative + ' timestamp is derived, not ignored', async () => {
      const file = path.join(pack, relative), original = await fs.readFile(file), value = JSON.parse(original);
      value.builtAt = '2020-01-01T00:00:00.000Z';
      await write(file, value); await f.repack('candidate', CORE);
      await assert.rejects(prepareVersionQualification(f.root, version, f.options), /exact source metadata/);
      await fs.writeFile(file, original); await f.repack('candidate', CORE);
    });
  }
  await t.test('missing public package', async () => {
    await assert.rejects(prepareVersionQualification(f.root, version, {
      ...f.options, prepared: { ...f.prepared, artifacts: f.artifacts.candidate.slice(1) },
    }), /cover the public SDK/);
  });
  await prepareVersionQualification(f.root, version, f.options);
});

test('Git delta allows only exact public versions and the named orchestration files', async t => {
  const f = await fixture(t);
  const candidate = f.prepared.commit;
  async function changed(file, content, expected) {
    await write(path.join(f.root, file), content);
    f.git('add', '.'); f.git('commit', '--quiet', '-m', 'Unexpected change');
    const commit = f.git('rev-parse', 'HEAD');
    try {
      await assert.rejects(prepareVersionQualification(f.root, version, {
        ...f.options, prepared: { ...f.prepared, commit },
      }), expected);
    } finally { f.git('reset', '--hard', candidate); }
  }
  await changed('pnpm-lock.yaml', 'lockfileVersion: 10\n', /Non-version source change/);
  await changed('apps/omnitron/src/index.js', 'export const answer = 43;\n', /Non-version source change/);
  await changed('.xec/not-reviewed.js', 'export const bypass = true;\n', /Non-version source change/);
  const source = await json(path.join(f.root, 'apps/omnitron/package.json'));
  await changed('apps/omnitron/package.json', { ...source, engines: { node: '>=26' } }, /Only the public package version/);
  await changed('apps/omnitron/package.json', { ...source, dependencies: { [f.packages[1].name]: '^0.4.0' } }, /Only the public package version/);
  await write(path.join(f.root, 'untracked-source.js'), 'new code');
  await assert.rejects(prepareVersionQualification(f.root, version, f.options), /clean different candidate/);
});
