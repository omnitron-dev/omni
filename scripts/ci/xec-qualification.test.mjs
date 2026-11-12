import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { githubQualification } from '../../.xec/github-qualification.mjs';
import { qualifyRelease, verifyReleaseQualification } from '../../.xec/qualification.mjs';
import { runtimeArtifactDigest } from '../../apps/omnitron/src/shared/runtime-artifact.ts';
const { assertReproducedFrameworkArchives: inspectArchives } = await tsImport(
  '../../apps/omnitron/src/release/registry-framework.ts', import.meta.url);

const commit = 'a'.repeat(40), previous = 'b'.repeat(40);
const policy = { repository: 'example/platform', branch: 'main', qualification: {
  provider: 'github', workflow: 'ci.yml', nativeWorkflow: 'native.yml',
  nodes: ['22.23.4', '24.10.0'], jobs: ['Build', 'Test'], pollMs: 1, timeoutMs: 1000,
} };
const completed = (extra = {}) => ({ id: 7, head_sha: commit, head_branch: 'main', path: '.github/workflows/ci.yml',
  event: 'push', status: 'completed', conclusion: 'success', run_attempt: 1, html_url: 'https://github.com/example/platform/actions/runs/7', ...extra });

test('CI checks the exact latest push and every required job', async () => {
  let candidate = completed(), jobs = [{ name: 'Build', conclusion: 'success' }, { name: 'Test', conclusion: 'success' }];
  const driver = githubQualification({ root: '/unused', policy, progress() {}, run: async (_root, cmd, args) => {
    assert.equal(cmd, 'gh');
    const route = args[1];
    return JSON.stringify(route.includes('/jobs?') ? { jobs } : route.includes('workflows/')
      ? { workflow_runs: [completed({ id: 6 }), candidate] } : candidate);
  } });
  assert.equal((await driver.ci({ name: 'ci', commit, observeOnly: true })).id, 7);
  candidate = completed({ conclusion: 'failure' });
  await assert.rejects(driver.ci({ name: 'ci', commit }), /failed/);
  candidate = completed();
  jobs[1].conclusion = 'skipped';
  await assert.rejects(driver.ci({ name: 'ci', commit }), /required successful job/);
  candidate = completed({ head_sha: previous });
  await assert.rejects(driver.ci({ name: 'ci', commit }), /identity differs/);
});

test('a lost dispatch response is reconciled without sending another workflow', async () => {
  let saved, record, posts = 0, writes = 0;
  const context = { name: 'native', node: '22.23.4', commit, previous };
  const driver = githubQualification({ root: '/unused', policy, progress() {}, run: async (_root, _cmd, args) => {
    const route = args[1];
    if (route.includes('git/ref')) return JSON.stringify({ object: { sha: commit } });
    if (route.endsWith('/dispatches')) {
      posts++;
      assert.ok(saved?.intent, 'intent must be durable before dispatch');
      record = completed({ path: '.github/workflows/native.yml', event: 'workflow_dispatch',
        display_title: 'Handoff ' + previous + ' → ' + commit + ' · Node 22.23.4 · ' + saved.intent });
      throw Error('response lost');
    }
    if (route.includes('/jobs?')) return JSON.stringify({ jobs: [{ name: 'systemd', conclusion: 'success' }] });
    return JSON.stringify(route.includes('workflows/') ? { workflow_runs: record ? [record] : [] } : record);
  } });
  const save = async value => { writes++; saved = structuredClone(value); };
  await assert.rejects(driver.native(context, undefined, save), /response lost/);
  assert.equal(posts, 1);
  assert.equal((await driver.native(context, saved, save)).id, 7);
  const before = writes;
  await driver.native({ ...context, observeOnly: true }, saved, save);
  assert.equal(writes, before);
  assert.equal(posts, 1);
  await assert.rejects(driver.native({ ...context, node: '24.10.0' }, saved, save), /input identity differs/);
});

test('read-only inspection cannot dispatch a new native job', async () => {
  const driver = githubQualification({ root: '/unused', policy, progress() {}, run() { throw Error('unexpected API'); } });
  await assert.rejects(driver.native({ name: 'native', commit, previous, node: '22.23.4', observeOnly: true },
    undefined, async () => assert.fail('must not persist')), /has not been dispatched/);
});

test('qualification uses one Xec pipeline, resumes a completed build and keeps both native receipts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-release-qualification-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let builds = 0, ciPasses = false;
  const run = async (_root, executable, args) => {
    if (executable === 'git') return commit;
    if (executable === 'pnpm') return inventoryRead(root, args);
    assert.equal(executable, process.execPath);
    assert.ok(path.isAbsolute(args[0]));
    assert.deepEqual(args.slice(1, 3), ['run', 'scripts/check-reproducible-backend.mjs']);
    builds++;
    const directory = args.at(-1);
    await buildFixture(directory, process.version);
    await preparedFixture(root, directory);
    return '';
  };
  const provider = {
    async ci() { if (!ciPasses) throw Error('CI pending'); return { id: 1 }; },
    async native(ctx, saved, save) {
      if (!saved) { assert.ok(!ctx.observeOnly); await save({ intent: ctx.node, runId: ctx.node }); }
      return { node: ctx.node };
    },
  };
  const options = { policy, run, inspectArchives, provider, progress() {}, previous };
  await assert.rejects(qualifyRelease(root, '0.3.5', options), /CI pending/);
  await assert.rejects(verifyReleaseQualification(root, '0.3.5', options), /before publication/);
  ciPasses = true;
  const result = await qualifyRelease(root, '0.3.5', options);
  assert.equal(builds, 1);
  const state = JSON.parse(await fs.readFile(result.receipt));
  assert.deepEqual(Object.keys(state.native).sort(), policy.qualification.nodes);
  const before = await fs.readFile(result.receipt, 'utf8');
  await verifyReleaseQualification(root, '0.3.5', options);
  assert.equal(await fs.readFile(result.receipt, 'utf8'), before);
  assert.equal(builds, 1);
  ciPasses = false;
  await assert.rejects(verifyReleaseQualification(root, '0.3.5', options), /CI pending/);
  await assert.rejects(verifyReleaseQualification(root, '0.3.6', options), /before publication/);
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => JSON.stringify(value);
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) => fs.writeFile(file, encoded(value));
const foreignNode = process.version === 'v24.13.0' ? 'v26.1.0' : 'v24.13.0';
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const packFixture = (directory, file) => execFileSync('tar', ['-czf', file, '-C', directory, 'package'],
  { env: { ...process.env, COPYFILE_DISABLE: '1' } });
const inventoryRead = (root, args) => {
  assert.deepEqual(args, ['--config.lockfile=false', '--config.ignore-pnpmfile=true', '--recursive', 'list', '--depth', '-1', '--json']);
  return encoded([{ path: root }]);
};

async function preparedFixture(root, build) {
  const directory = path.join(root, '.release-artifacts/0.3.5', commit);
  await fs.mkdir(directory, { recursive: true });
  await writeJson(path.join(root, 'package.json'), { name: '@fixture/qualified', version: '0.3.5' });
  const bytes = await fs.readFile(path.join(build, 'prepared.tgz'));
  await fs.writeFile(path.join(directory, 'fixture.tgz'), bytes);
  await writeJson(path.join(directory, 'release.json'), { schema: 1, commit, version: '0.3.5',
    artifacts: [{ name: '@fixture/qualified', version: '0.3.5', file: 'fixture.tgz', integrity: integrity(bytes) }] });
}

/** A small sealed filesystem exercises the real runtime digest verifier. It is
 * producer evidence for this test, not a claim to be a runnable Node image. */
async function buildFixture(directory, producerNode) {
  const runtime = path.join(directory, 'runtime'), sdk = path.join(directory, 'sdk');
  const shared = path.join(runtime, 'packages/0/dist/shared');
  await fs.mkdir(shared, { recursive: true });
  await fs.mkdir(sdk, { recursive: true });
  await writeJson(path.join(runtime, 'package.json'), { type: 'module' });
  const verifier = path.join(shared, 'runtime-artifact.js');
  await fs.writeFile(verifier, stripTypeScriptTypes(await fs.readFile(
    new URL('../../apps/omnitron/src/shared/runtime-artifact.ts', import.meta.url), 'utf8')));
  await writeJson(path.join(runtime, 'packages/0/dist/BUILD.json'), { commit, dirty: false });
  await fs.writeFile(path.join(runtime, 'node'), 'fixture producer bytes: ' + producerNode);
  const hash = await runtimeArtifactDigest(runtime);
  await writeJson(path.join(runtime, 'RUNTIME.json'), { protocol: 1, sha256: hash,
    nodeVersion: producerNode, platform: process.platform, arch: process.arch, packages: 1 });
  const pack = path.join(directory, 'pack-source');
  await fs.mkdir(path.join(pack, 'package/dist'), { recursive: true });
  const pkg = { name: '@fixture/qualified', version: '0.3.5', main: 'dist/index.js' };
  await writeJson(path.join(pack, 'package/package.json'), pkg);
  await fs.writeFile(path.join(pack, 'package/dist/index.js'), 'export const value = 1;');
  packFixture(pack, path.join(sdk, 'fixture.tgz'));
  await writeJson(path.join(pack, 'package/package.json'), { ...pkg, gitHead: commit });
  packFixture(pack, path.join(directory, 'prepared.tgz'));
  const inventory = encoded([{ name: pkg.name, version: pkg.version, filename: 'fixture.tgz', sourceRevision: commit,
    sourceDirty: false, integrity: integrity(await fs.readFile(path.join(sdk, 'fixture.tgz'))) }]);
  await fs.writeFile(path.join(sdk, 'framework-manifest.json'), inventory);
  const proof = { revision: commit, node: producerNode, independentBuilds: 2, sha256: hash,
    sdk: { manifestSha256: sha256(inventory) } };
  await writeJson(path.join(directory, 'QUALIFICATION.json'), proof);
  return proof;
}

async function selectedFixture(t, producerNode = foreignNode) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-selected-qualification-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = { schema: 1, commit, version: '0.3.5', previous, policy, node: producerNode };
  const key = sha256(encoded(identity));
  const directory = path.join(root, '.release-artifacts/qualification', commit, key);
  const build = path.join(directory, 'build');
  await buildFixture(build, identity.node);
  await preparedFixture(root, build);
  const receipt = path.join(directory, 'qualification.json');
  const selection = path.join(directory, '../selected.json');
  await writeJson(receipt, { identity, stages: {}, native: Object.fromEntries(policy.qualification.nodes.map(node => [node, { intent: node, runId: node }])) });
  await writeJson(selection, { identity, key });
  let observations = 0;
  const provider = {
    async ci(ctx) { assert.equal(ctx.observeOnly, true); assert.equal(ctx.commit, commit); observations++; return { id: 1 }; },
    async native(ctx, saved) {
      assert.equal(ctx.observeOnly, true); assert.equal(ctx.previous, previous);
      assert.equal(saved?.intent, ctx.node); observations++; return { node: ctx.node };
    },
  };
  const run = async (_root, executable, args) => {
    if (executable === 'pnpm') return inventoryRead(root, args);
    assert.equal(executable, 'git', 'Read-only verification must never build, download or dispatch');
    assert.deepEqual(args, ['rev-parse', 'HEAD']);
    return commit;
  };
  return { root, identity, directory, build, receipt, selection,
    options: { policy, provider, run, inspectArchives, progress() {} }, observations: () => observations };
}

async function treeSnapshot(root) {
  const entries = (await fs.readdir(root, { recursive: true })).sort();
  return Promise.all(entries.map(async name => {
    const file = path.join(root, name), stat = await fs.lstat(file);
    return { name, mode: stat.mode, mtime: stat.mtimeMs, ...(stat.isFile() && { sha256: sha256(await fs.readFile(file)) }) };
  }));
}

test('read-only verification uses the selected producer Node and never creates another qualification', async t => {
  const f = await selectedFixture(t), before = await treeSnapshot(f.root);
  assert.notEqual(f.identity.node, process.version);
  const proof = await verifyReleaseQualification(f.root, '0.3.5', f.options);
  assert.equal(proof.receipt, f.receipt);
  assert.equal(proof.stages.reproducibility.node, f.identity.node);
  assert.equal(proof.stages.archiveEquivalence.packages, 1);
  assert.equal(f.observations(), policy.qualification.nodes.length + 1);
  assert.deepEqual(await treeSnapshot(f.root), before);
});

test('new qualification still records and verifies the current build Node', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-current-qualification-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let builds = 0;
  const result = await qualifyRelease(root, '0.3.5', { policy, previous, inspectArchives, progress() {},
    run: async (_root, executable, args) => {
      if (executable === 'git') return commit;
      if (executable === 'pnpm') return inventoryRead(root, args);
      assert.equal(executable, process.execPath); builds++;
      await buildFixture(args.at(-1), process.version);
      await preparedFixture(root, args.at(-1));
      return '';
    }, provider: {
      ci: async () => ({ id: 1 }),
      native: async (ctx, _saved, save) => { assert.equal(ctx.observeOnly, false); await save({ intent: ctx.node }); return { node: ctx.node }; },
    },
  });
  const state = await json(result.receipt);
  assert.equal(builds, 1);
  assert.equal(state.identity.node, process.version);
  assert.equal(state.stages.reproducibility.node, process.version);
});

test('read-only inspection rejects changed selection, receipt identity and current policy before provider effects', async t => {
  for (const kind of ['key', 'version', 'commit', 'schema', 'node', 'receipt', 'policy', 'missing']) await t.test(kind, async sub => {
    const f = await selectedFixture(sub);
    const selected = await json(f.selection);
    if (kind === 'key') selected.key = '0'.repeat(64);
    if (['version', 'commit', 'schema', 'node'].includes(kind)) selected.identity[kind] = 'changed';
    if (kind === 'receipt') { const state = await json(f.receipt); state.identity.node = process.version; await writeJson(f.receipt, state); }
    if (kind === 'policy') f.options.policy = { ...policy, branch: 'different' };
    if (kind === 'missing') await fs.unlink(f.receipt);
    await writeJson(f.selection, selected);
    const before = await treeSnapshot(f.root);
    await assert.rejects(verifyReleaseQualification(f.root, '0.3.5', f.options), /before publication|identity.*differs|receipt is missing/);
    assert.equal(f.observations(), 0);
    assert.deepEqual(await treeSnapshot(f.root), before);
  });
});

test('producer metadata and content hashes remain authoritative across publisher Node versions', async t => {
  for (const kind of ['proof-node', 'manifest-node', 'proof-commit', 'missing-clean-stamp', 'runtime-digest', 'runtime-bytes', 'sdk-inventory', 'sdk-archive']) await t.test(kind, async sub => {
    const f = await selectedFixture(sub), proofFile = path.join(f.build, 'QUALIFICATION.json');
    const proof = await json(proofFile), manifestFile = path.join(f.build, 'runtime/RUNTIME.json'), manifest = await json(manifestFile);
    if (kind === 'proof-node') proof.node = process.version;
    if (kind === 'proof-commit') proof.revision = previous;
    if (kind === 'manifest-node') manifest.nodeVersion = process.version;
    if (kind === 'missing-clean-stamp') await writeJson(path.join(f.build, 'runtime/packages/0/dist/BUILD.json'), { commit });
    if (kind === 'runtime-digest') manifest.sha256 = '0'.repeat(64);
    if (kind === 'runtime-bytes') await fs.appendFile(path.join(f.build, 'runtime/node'), 'changed');
    if (kind === 'sdk-inventory') await fs.appendFile(path.join(f.build, 'sdk/framework-manifest.json'), ' ');
    if (kind === 'sdk-archive') await fs.appendFile(path.join(f.build, 'sdk/fixture.tgz'), 'changed');
    await writeJson(proofFile, proof); await writeJson(manifestFile, manifest);
    const before = await treeSnapshot(f.root);
    await assert.rejects(verifyReleaseQualification(f.root, '0.3.5', f.options), /build evidence differs|Runtime differs|runtime source differs|changed after sealing|SDK inventory changed|SDK archive changed/);
    assert.deepEqual(await treeSnapshot(f.root), before);
  });
});

test('observe-only refuses missing build proof and a provider persistence callback without writing', async t => {
  for (const kind of ['missing-build', 'persist']) await t.test(kind, async sub => {
    const f = await selectedFixture(sub);
    if (kind === 'missing-build') await fs.unlink(path.join(f.build, 'QUALIFICATION.json'));
    else f.options.provider.native = async (_ctx, _saved, save) => { await save({ intent: 'must-not-write' }); };
    const before = await treeSnapshot(f.root);
    await assert.rejects(verifyReleaseQualification(f.root, '0.3.5', f.options), /builds have not completed|cannot persist evidence/);
    assert.deepEqual(await treeSnapshot(f.root), before);
  });
});

test('tampered runtime verifier is rejected before any of its code can execute', async t => {
  const f = await selectedFixture(t, process.version);
  const marker = path.join(f.root, 'untrusted-verifier-executed');
  // Do not import this payload in the fixture: a cached earlier module would
  // mask the import-before-verification defect this test must detect.
  await fs.writeFile(path.join(f.build, 'runtime/packages/0/dist/shared/runtime-artifact.js'),
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed'); export async function verifyRuntimeArtifact() {}`);
  const before = await treeSnapshot(f.root);
  await assert.rejects(verifyReleaseQualification(f.root, '0.3.5', f.options), /changed after sealing/);
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  assert.deepEqual(await treeSnapshot(f.root), before);
});

test('native artifact packaging also rejects a tampered runtime verifier before executing payload code', async t => {
  const f = await selectedFixture(t, process.version);
  const marker = path.join(f.root, 'native-verifier-executed');
  await fs.writeFile(path.join(f.build, 'runtime/packages/0/dist/shared/runtime-artifact.js'),
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed'); export async function verifyRuntimeArtifact() {}`);
  const destination = path.join(f.root, 'native-output'), before = await treeSnapshot(f.root);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../.xec/native-artifact.mjs', import.meta.url)),
    path.join(f.build, 'runtime'), destination], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /changed after sealing/);
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  await assert.rejects(fs.access(destination), { code: 'ENOENT' });
  assert.deepEqual(await treeSnapshot(f.root), before);
});

test('a newly rehashed prepared archive with different code cannot pass reproduced SDK comparison', async t => {
  const f = await selectedFixture(t);
  const pack = path.join(f.build, 'pack-source');
  await fs.writeFile(path.join(pack, 'package/dist/index.js'), 'export const value = 2;');
  packFixture(pack, path.join(f.build, 'prepared.tgz'));
  await preparedFixture(f.root, f.build);
  const before = await treeSnapshot(f.root);
  await assert.rejects(verifyReleaseQualification(f.root, '0.3.5', f.options), /differs|differ/);
  assert.deepEqual(await treeSnapshot(f.root), before);
});
