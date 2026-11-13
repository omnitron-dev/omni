import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';
const { runRuntimeUpdate, readRuntimeUpdateReceipt } = await tsImport('../../src/daemon/runtime-update.ts', import.meta.url);
const { assertLocalIdle, assertReviewedBoot, assertSameSavedSelection, assertLocalServiceTargets, stackAdmissionProtocol } = await tsImport('../../src/daemon/runtime-update-host.ts', import.meta.url);
import { BACKEND_ACTIVITY_COUNTERS } from '../../src/shared/dto/backend.ts';

test('only boots with the exact native admission and unchanged desired state', () => {
  const reviewed = 'a'.repeat(64);
  const stack = { project: 'example', stack: 'dev', enabled: true, infrastructureMode: 'preserve', infrastructureReview: reviewed };
  assert.doesNotThrow(() => assertReviewedBoot(stack, reviewed));
  for (const change of [{ enabled: false }, { infrastructureMode: 'reconcile' }, { infrastructureReview: null }, { infrastructureReview: 'b'.repeat(64) }]) {
    assert.throws(() => assertReviewedBoot({ ...stack, ...change }, reviewed), /cannot prove/);
  }
});

test('one-shot admission requires both actual runtimes and preserves native service and boot policy scope', () => {
  const supported = { coldStackAdmissionProtocol: 1 };
  const digest = 'a'.repeat(64);
  const stack = { project: 'example', stack: 'dev', enabled: true, infrastructureMode: 'reconcile', infrastructureReview: null };
  for (const [candidate, previous] of [[{}, {}], [supported, {}], [{}, supported], [supported, { coldStackAdmissionProtocol: 2 }]]) {
    assert.throws(() => assertReviewedBoot(stack, digest, stackAdmissionProtocol(candidate, previous)), /cannot prove/);
  }
  const protocol = stackAdmissionProtocol(supported, supported);
  assert.equal(protocol, 1);
  assert.doesNotThrow(() => assertReviewedBoot(stack, digest, protocol));
  for (const change of [{ enabled: false }, { infrastructureMode: 'preserve' }, { infrastructureReview: 'b'.repeat(64) }])
    assert.throws(() => assertReviewedBoot({ ...stack, ...change }, digest, protocol), /cannot prove/);
  const roles = { scope: 'user', owner: { label: 'dev.omnitron.owner' }, backend: { label: 'dev.omnitron.daemon' } };
  assert.doesNotThrow(() => assertLocalServiceTargets(roles));
  for (const changed of [null, { ...roles, scope: 'system' }, { ...roles, owner: { label: 'dev.omnitron.fixture.owner' } },
    { ...roles, backend: { label: 'dev.omnitron.fixture.backend' } }]) assert.throws(() => assertLocalServiceTargets(changed), /standard Omnitron/);
});

test('acceptance checks the same complete saved release even if the effective review still resolves to it', () => {
  const release = { kind: 'release', id: 'first', manifestSha256: 'a'.repeat(64) };
  const unreported = { kind: 'unreported' };
  const pinned = { project: 'example', stack: 'prod', selection: release, savedSelection: release };
  assert.doesNotThrow(() => assertSameSavedSelection(pinned, { selection: { ...release } }));
  for (const changed of [unreported, { kind: 'working-tree' }, { ...release, id: 'second' }, { ...release, manifestSha256: 'b'.repeat(64) }])
    assert.throws(() => assertSameSavedSelection(pinned, { selection: changed }), /Saved launch selection changed/);
  assert.throws(() => assertSameSavedSelection({ ...pinned, savedSelection: undefined }, { selection: release }), /no saved launch selection/);
  const inferred = { ...pinned, savedSelection: unreported };
  assert.doesNotThrow(() => assertSameSavedSelection(inferred, { selection: unreported }));
  assert.throws(() => assertSameSavedSelection(inferred, { selection: release }), /Saved launch selection changed/);
});

const native = ['darwin', 'linux'].includes(process.platform);
const previous = 'a'.repeat(64);
const target = 'b'.repeat(64);
const source = 'c'.repeat(40);

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
  const { digest } = await runRuntimeUpdate({ ...config, operation: 'prepare' });
  assert.match(digest, /^[a-f0-9]{64}$/);
  blockers.backupOperations = 1;
  await assert.rejects(runRuntimeUpdate({ ...config, operation: 'apply', digest: digest }), /backupOperations=1/);
  delete blockers.backupOperations;
  await assert.rejects(runRuntimeUpdate({ ...config, operation: 'apply', digest: digest }), /activity counters/);
  blockers.backupOperations = 0;
  assert.equal((await runRuntimeUpdate({ ...config, operation: 'prepare' })).digest, digest);
});

test('a pending review holds the native instance lock and a concurrent operation exits before preparation', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'fixture-owner' });
  const entered = Promise.withResolvers();
  const paused = Promise.withResolvers();
  const first = runRuntimeUpdate({ directory, operation: 'prepare', actions: { async prepare() {
    entered.resolve();
    await paused.promise;
    return plan;
  } } });
  await Promise.race([entered.promise, first]);
  const other = { directory, actions: { async prepare() { assert.fail('a second review acquired the instance lock'); } } };
  try {
    await assert.rejects(runRuntimeUpdate({ ...other, operation: 'prepare' }), /lock was not acquired/);
  } finally {
    paused.resolve();
    await first;
  }
  assert.ok((await runRuntimeUpdate({ directory, operation: 'prepare', actions: { async prepare() { return plan; } } })).digest);
});

test('changing a reviewed owner generation invalidates the review before any process is stopped', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  let observed = { pid: process.pid, generation: 'first-generation' };
  const actions = {
    async prepare() { return planFor(directory, observed); },
    async stop() { assert.fail('a replaced generation cannot be retired with the prior review'); },
  };
  const config = { actions, directory };
  const reviewed = await runRuntimeUpdate({ ...config, operation: 'prepare' });
  observed = { ...observed, generation: 'second-generation' };
  const replacement = await runRuntimeUpdate({ ...config, operation: 'prepare' });
  assert.notEqual(replacement.digest, reviewed.digest);
  await assert.rejects(runRuntimeUpdate({ ...config, operation: 'apply', digest: reviewed.digest }), error => error.message.includes(replacement.digest));
});

test('a shutdown admission refusal preserves the original owner without starting recovery', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const owner = await ownerGeneration(t, directory, previous);
  const plan = planFor(directory, owner.identity);
  const phases = [];
  let refusal;
  const config = {
    directory,
    progress: phase => phases.push(phase),
    actions: {
      async prepare() { return structuredClone(plan); },
      async validateStop(before, reviewed) {
        assert.deepEqual(before, plan.before);
        assert.deepEqual(reviewed, plan);
        throw refusal;
      },
      async stop() { assert.fail('admission refused before shutdown'); },
      async canRestore() { assert.fail('an admission refusal cannot start recovery'); },
    },
  };
  const review = await runRuntimeUpdate({ ...config, operation: 'prepare' });
  for (const reason of ['source changed', 'worker rotation', 'infrastructure changed']) {
    refusal = new Error(reason);
    await assert.rejects(runRuntimeUpdate({ ...config, operation: 'apply', digest: review.digest }), error => error === refusal);
    assert.equal(await readRuntimeUpdateReceipt(directory), null);
    assert.deepEqual(await owner.observe(), owner.identity);
    assert.equal((await runRuntimeUpdate({ ...config, operation: 'prepare' })).digest, review.digest);
  }
  assert.deepEqual(phases, []);
});

test('applying the same review twice verifies a new live process generation and starts it once', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  let owner = await ownerGeneration(t, directory, previous);
  const original = owner.identity;
  const plan = planFor(directory, original);
  const events = [];
  const actions = {
    async prepare() { return structuredClone(plan); },
    async validateStop(before) {
      assert.equal(before.ownerId, owner.identity.generation);
    },
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
  const preview = await runRuntimeUpdate({ ...config, operation: 'prepare' });
  assert.deepEqual(events, []);
  const receipt = await runRuntimeUpdate({ ...config, operation: 'apply', digest: preview.digest });
  const admitted = await owner.observe();
  assert.deepEqual(receipt.acceptance, admitted);
  assert.equal(receipt.phase, 'accepted');
  const firstAcceptance = events.filter(event => event === 'accept').length;
  assert.ok(firstAcceptance > 0);
  assert.deepEqual(await runRuntimeUpdate({ ...config, operation: 'apply', digest: preview.digest }), receipt);
  assert.deepEqual(await owner.observe(), admitted);
  assert.deepEqual(events.filter(event => event !== 'accept'), ['stop', 'start']);
  assert.ok(events.filter(event => event === 'accept').length > firstAcceptance);

  const rollback = await runRuntimeUpdate({ ...config, operation: 'recover', digest: preview.digest });
  assert.equal(rollback.phase, 'rolled-back');
  assert.equal(rollback.acceptance.artifact, original.artifact);
  assert.notEqual(rollback.acceptance.generation, admitted.generation);
  assert.notEqual(rollback.acceptance.pid, admitted.pid);
  assert.deepEqual(await runRuntimeUpdate({ ...config, operation: 'recover', digest: preview.digest }), rollback);
  assert.deepEqual(await readRuntimeUpdateReceipt(directory), rollback);
  assert.deepEqual(events.filter(event => event !== 'accept'), ['stop', 'start', 'stop', 'start']);
});

test('a lost rollback acknowledgement is inspected without a second cold start', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'original' });
  let starts = 0;
  let restored = false;
  let inspectOnly;
  const actions = {
    async prepare() { return plan; },
    async validateStop() {},
    async stop() {},
    async assertStopped() {},
    async canRestore() { return true; },
    async start(destination) {
      starts++;
      if ('artifact' in destination) throw Error('candidate refused');
      restored = true;
      throw Error('restored but acknowledgement was lost');
    },
    async accept(reviewed, direction, inspect) {
      assert.deepEqual(reviewed, plan);
      assert.equal(direction, 'previous');
      assert.equal(restored, true);
      inspectOnly = inspect;
      return { restored: true };
    },
    async captureForRollback() { assert.fail('restoration cannot retire its already restored owner'); },
  };
  const prepared = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: prepared.digest }), /acknowledgement was lost/);
  const interrupted = await readRuntimeUpdateReceipt(directory);
  assert.equal(interrupted.phase, 'recovery-required');
  assert.equal(interrupted.restoreAttempted, true);
  assert.equal(starts, 2);
  const recovered = await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: prepared.digest });
  assert.equal(recovered.phase, 'rolled-back');
  assert.equal(inspectOnly, true);
  assert.equal(starts, 2);
  assert.deepEqual(await readRuntimeUpdateReceipt(directory, prepared.digest), recovered);
});
