import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { githubQualification } from '../../.xec/github-qualification.mjs';
import { qualifyRelease, verifyReleaseQualification } from '../../.xec/qualification.mjs';

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
    assert.equal(executable, process.execPath);
    assert.ok(path.isAbsolute(args[0]));
    assert.deepEqual(args.slice(1, 3), ['run', 'scripts/check-reproducible-backend.mjs']);
    builds++;
    const directory = args.at(-1);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'QUALIFICATION.json'), JSON.stringify({ revision: commit }));
    return '';
  };
  const verifyBuild = async (directory, revision) => {
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'QUALIFICATION.json'))).revision, revision);
    return { revision, independentBuilds: 2 };
  };
  const provider = {
    async ci() { if (!ciPasses) throw Error('CI pending'); return { id: 1 }; },
    async native(ctx, saved, save) {
      if (!saved) { assert.ok(!ctx.observeOnly); await save({ intent: ctx.node, runId: ctx.node }); }
      return { node: ctx.node };
    },
  };
  const options = { policy, run, verifyBuild, provider, progress() {}, previous };
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
