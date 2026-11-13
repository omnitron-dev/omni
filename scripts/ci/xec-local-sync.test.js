import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { runLocalSync } from '../../.xec/local-sync.js';
import { assertLocalIdle, assertReviewedBoot } from '../../.xec/local-sync-host.js';
import { BACKEND_ACTIVITY_COUNTERS } from '../../apps/omnitron/src/shared/dto/backend.ts';

test('only boots with the exact native admission and unchanged desired state', () => {
  const reviewed = 'a'.repeat(64);
  const stack = { project: 'example', stack: 'dev', enabled: true, infrastructureMode: 'preserve', infrastructureReview: reviewed };
  assert.doesNotThrow(() => assertReviewedBoot(stack, reviewed));
  for (const change of [{ enabled: false }, { infrastructureMode: 'reconcile' }, { infrastructureReview: null }, { infrastructureReview: 'b'.repeat(64) }]) {
    assert.throws(() => assertReviewedBoot({ ...stack, ...change }, reviewed), /cannot prove/);
  }
});

const native = ['darwin', 'linux'].includes(process.platform);
const previous = 'a'.repeat(64);
const target = 'b'.repeat(64);
const source = 'c'.repeat(40);
const execute = promisify(execFile);

async function privateInstance(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-local-sync-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function ownerGeneration(t, directory, artifact) {
  const worker = path.join(directory, 'fixture-worker.mjs');
  await fs.writeFile(worker, `import { randomUUID } from 'node:crypto';
const observation = { artifact: process.argv[2], generation: randomUUID(), pid: process.pid };
process.on('message', action => {
  if (action === 'observe') process.send(observation);
  if (action === 'stop') process.disconnect();
});
process.send(observation);`);
  const child = fork(worker, [artifact], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const closed = once(child, 'exit');
  const neverSpoke = closed.then(() => { throw Error('Private fixture exited before reporting its identity'); });
  let stopped = false;
  const stop = async () => {
    if (!stopped) {
      stopped = true;
      if (child.connected) child.send('stop');
      await closed;
    }
  };
  t.after(stop);
  const [identity] = await Promise.race([once(child, 'message'), neverSpoke]);
  async function observe() {
    assert.ok(child.connected, 'acceptance must inspect the current generation');
    const reply = once(child, 'message');
    child.send('observe');
    const [value] = await reply;
    return value;
  }
  return { identity, observe, stop };
}

function planFor(directory, identity) {
  return { protocol: 1, instance: directory,
    target: { artifact: target, commit: source },
    before: { backend: previous, owner: previous, guardian: previous, console: null, scope: 'user',
      ownerPid: identity.pid, backendPid: identity.pid, guardianPid: identity.pid, ownerId: identity.generation,
      ownerLifetime: identity.generation, retiredPids: [], revision: 1 },
    stacks: [], infrastructure: [],
  };
}

test('the Xec update entry reads the private receipt and rejects a combined status and mutation', async t => {
  const directory = await privateInstance(t);
  const update = new URL('../../.xec/update.mjs', import.meta.url).href;
  const invoke = (...args) => execute(process.execPath, ['--input-type=module', '--eval',
    `import {runUpdate} from ${JSON.stringify(update)}; await runUpdate(process.argv.slice(1));`, '--', ...args],
  { cwd: directory, env: { ...process.env, OMNITRON_HOME: directory } });
  const result = await invoke('local-sync', '--status');
  assert.equal(JSON.parse(result.stdout), null);
  await assert.rejects(invoke('local-sync', '--status', '--review', 'd'.repeat(64)),
    error => error.code === 1 && /xec update local-sync/.test(error.stderr));
  await assert.rejects(invoke('local-apply', '--review', 'd'.repeat(64)), error =>
    error.code === 1 && /belong to local-sync/.test(error.stderr));
  assert.deepEqual(await fs.readdir(directory), []);
});

test('an in-flight operation must be clear before a review can stop the private instance', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'fixture-owner' });
  const blockers = { ...Object.fromEntries(BACKEND_ACTIVITY_COUNTERS.map(name => [name, 0])), backupOperations: 0 };
  const status = { execution: { mode: 'resident', phase: 'active', connection: { status: 'connected' },
    supervision: { type: 'independent' }, owner: { id: plan.before.ownerId },
    epoch: 1, recovery: { status: 'ready' }, blockers } };
  const actions = {
    async prepare() {
      assertLocalIdle(status);
      return plan;
    },
    async stop() { assert.fail('a busy instance cannot be stopped'); },
    async start() { assert.fail('a busy instance cannot be started'); },
  };
  const config = { actions, directory, progress() {} };
  const { digest } = await runLocalSync(config);
  assert.match(digest, /^[a-f0-9]{64}$/);
  blockers.backupOperations = 1;
  await assert.rejects(runLocalSync({ ...config, review: digest }), /backupOperations=1/);
  delete blockers.backupOperations;
  await assert.rejects(runLocalSync({ ...config, review: digest }), /activity counters/);
  blockers.backupOperations = 0;
  assert.equal((await runLocalSync(config)).digest, digest);
});

test('a pending review holds the native instance lock and a concurrent operation exits before preparation', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'fixture-owner' });
  const entered = Promise.withResolvers();
  const paused = Promise.withResolvers();
  const first = runLocalSync({ directory, actions: { async prepare() {
    entered.resolve();
    await paused.promise;
    return plan;
  } } });
  await Promise.race([entered.promise, first]);
  const other = { directory, actions: { async prepare() { assert.fail('a second review acquired the instance lock'); } } };
  try {
    await assert.rejects(runLocalSync(other), /lock was not acquired/);
  } finally {
    paused.resolve();
    await first;
  }
  assert.ok((await runLocalSync({ directory, actions: { async prepare() { return plan; } } })).digest);
});

test('changing a reviewed owner generation invalidates the review before any process is stopped', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  let observed = { pid: process.pid, generation: 'first-generation' };
  const actions = {
    async prepare() { return planFor(directory, observed); },
    async stop() { assert.fail('a replaced generation cannot be retired with the prior review'); },
  };
  const config = { actions, directory };
  const reviewed = await runLocalSync(config);
  observed = { ...observed, generation: 'second-generation' };
  const replacement = await runLocalSync(config);
  assert.notEqual(replacement.digest, reviewed.digest);
  await assert.rejects(runLocalSync({ ...config, review: reviewed.digest }), error => error.message.includes(replacement.digest));
});

test('applying the same review twice verifies a new live process generation and starts it once', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  let owner = await ownerGeneration(t, directory, previous);
  const original = owner.identity;
  const plan = planFor(directory, original);
  const events = [];
  const actions = {
    async prepare() { return structuredClone(plan); },
    async stop(before) {
      assert.equal(before.ownerId, owner.identity.generation);
      events.push('stop');
      await owner.stop();
    },
    async assertStopped(before) {
      assert.throws(() => process.kill(before.ownerPid, 0), { code: 'ESRCH' });
    },
    async start(selection) {
      events.push('start');
      owner = await ownerGeneration(t, directory, selection.artifact ?? selection.owner);
    },
    async accept(reviewed, which) {
      assert.deepEqual(reviewed, plan);
      const identity = await owner.observe();
      assert.equal(identity.artifact, which === 'target' ? target : previous);
      assert.notEqual(identity.generation, original.generation);
      assert.notEqual(identity.pid, original.pid);
      events.push('accept');
      return identity;
    },
    async canRestore() { return false; },
    async captureForRollback() {
      const identity = await owner.observe();
      assert.equal(identity.artifact, target);
      return planFor(directory, identity).before;
    },
  };
  const config = { actions, directory, progress() {} };
  const preview = await runLocalSync(config);
  assert.deepEqual(events, []);
  const receipt = await runLocalSync({ ...config, review: preview.digest });
  const admitted = await owner.observe();
  assert.deepEqual(receipt.acceptance, admitted);
  assert.equal(receipt.phase, 'accepted');
  const firstAcceptance = events.filter(event => event === 'accept').length;
  assert.ok(firstAcceptance > 0);
  assert.deepEqual(await runLocalSync({ ...config, review: preview.digest }), receipt);
  assert.deepEqual(await owner.observe(), admitted);
  assert.deepEqual(events.filter(event => event !== 'accept'), ['stop', 'start']);
  assert.ok(events.filter(event => event === 'accept').length > firstAcceptance);

  const rollback = await runLocalSync({ ...config, rollback: true, review: preview.digest });
  assert.equal(rollback.phase, 'rolled-back');
  assert.equal(rollback.acceptance.artifact, original.artifact);
  assert.notEqual(rollback.acceptance.generation, admitted.generation);
  assert.notEqual(rollback.acceptance.pid, admitted.pid);
  assert.deepEqual(await runLocalSync({ ...config, rollback: true, review: preview.digest }), rollback);
  assert.deepEqual(await runLocalSync({ ...config, status: true }), rollback);
  assert.deepEqual(events.filter(event => event !== 'accept'), ['stop', 'start', 'stop', 'start']);
});
