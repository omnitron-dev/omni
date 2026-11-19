import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { register } from 'tsx/esm/api';
const loader = register({ namespace: 'runtime-update-test' });
const { runRuntimeUpdate, readRuntimeUpdateReceipt, readPreparedRuntimeUpdate } = await loader.import('../../src/daemon/runtime-update.ts', import.meta.url);
const { assertLocalIdle, assertLocalReview, assertReviewedBoot, assertSameSavedSelection, assertLocalServiceTargets, assertRetainedRuntimeInfrastructure, assertRollbackStackScope, withServingRollbackAdmission } = await loader.import('../../src/daemon/runtime-update-host.ts', import.meta.url);
const { assertReviewableBackendActivity, retainReviewedBackups } = await loader.import('../../src/shared/backup-admission.ts', import.meta.url);
const { RuntimeObservationTimeout, RuntimeObservationUnconfirmed } = await loader.import('../../src/daemon/runtime-observation.ts', import.meta.url);
import { BACKEND_ACTIVITY_COUNTERS } from '../../src/shared/dto/backend.ts';

test('local and standalone fleet review distinguish missing, invalid and active operations', () => {
  const portable = runInNewContext('(' + assertReviewableBackendActivity.toString() + ')');
  for (const review of [assertReviewableBackendActivity, portable]) {
    const counters = Object.fromEntries(BACKEND_ACTIVITY_COUNTERS.map(name => [name, 0]));
    assert.throws(() => review(counters, BACKEND_ACTIVITY_COUNTERS), /omitted required activity counters: backupOperations$/);
    assert.throws(() => review({ ...counters, backupOperations: -1 }, BACKEND_ACTIVITY_COUNTERS), /invalid activity counter: backupOperations$/);
    assert.throws(() => review({ ...counters, backupOperations: 1, kernelRollouts: 2 }, BACKEND_ACTIVITY_COUNTERS), /active: kernelRollouts=2$/);
    assert.doesNotThrow(() => review({ ...counters, backupOperations: 1 }, BACKEND_ACTIVITY_COUNTERS));
  }
});

test('only boots with the exact native admission and unchanged desired state', () => {
  const reviewed = 'a'.repeat(64);
  const stack = { project: 'example', stack: 'dev', enabled: true, infrastructureMode: 'preserve', infrastructureReview: reviewed };
  assert.doesNotThrow(() => assertReviewedBoot(stack, reviewed));
  for (const change of [{ enabled: false }, { infrastructureMode: 'reconcile' }, { infrastructureReview: null }, { infrastructureReview: 'b'.repeat(64) }]) {
    assert.throws(() => assertReviewedBoot({ ...stack, ...change }, reviewed), /cannot prove/);
  }
});

test('rollback scope admits partial startup and refuses a new stack, application, binding or changed release', () => {
  const scope = { project: 'library', stack: 'dev' };
  const selection = { kind: 'release', id: 'v1', manifestSha256: 'a'.repeat(64) };
  const app = name => ({ handleKey: 'library/dev/' + name });
  const stack = { ...scope, enabled: true, path: '/fixture/library', runtimeScope: scope, selection,
    apps: [app('one'), app('two')], status: 'running' };
  const plan = { stacks: [{ ...stack, savedSelection: selection }] };
  const partial = { targets: [{ ...stack, apps: [app('one')], status: 'degraded' }], excluded: [] };
  assert.doesNotThrow(() => assertRollbackStackScope(plan, partial));
  assert.doesNotThrow(() => assertRollbackStackScope({ stacks: [] }, { targets: [], excluded: [{ ...scope, reason: 'disabled' }] }));
  assert.throws(() => assertRollbackStackScope({ stacks: [] }, partial), /membership changed/);
  for (const change of [{ path: '/other' }, { runtimeScope: { project: 'other', stack: 'dev' } },
    { apps: [app('new')] }, { selection: { ...selection, id: 'v2' } }])
    assert.throws(() => assertRollbackStackScope(plan, { targets: [{ ...partial.targets[0], ...change }], excluded: [] }));
});

test('live rollback needs a private hold even with an empty plan and releases its exact attempt if native stop fails', async () => {
  const calls = [];
  const service = {
    runtimeRollbackHold: async input => { calls.push(['hold', input]); },
    runtimeRollbackRelease: async input => { calls.push(['release', input]); },
  };
  const stop = async () => { calls.push(['stop']); throw Error('Native stop failed'); };
  const digest = 'a'.repeat(64);
  await assert.rejects(withServingRollbackAdmission(service, undefined, digest, stop), /cannot hold the reviewed application inventory/);
  assert.deepEqual(calls, []);
  await assert.rejects(withServingRollbackAdmission(service, 1, digest, stop), /Native stop failed/);
  assert.deepEqual(calls.map(([name]) => name), ['hold', 'stop', 'release']);
  assert.equal(calls[0][1].callerPid, process.pid);
  assert.deepEqual(calls[2][1], { digest, attempt: calls[0][1].attempt });
});

test('a stale saved preserve review identifies both digests even with a capable restoring controller', () => {
  const saved = 'a'.repeat(64), current = 'b'.repeat(64);
  const stack = { project: 'example', stack: 'dev', enabled: true, infrastructureMode: 'preserve', infrastructureReview: saved };
  assert.throws(() => assertReviewedBoot(stack, current, 1), (error) => {
    assert.match(error.message, new RegExp('Saved preserve review ' + saved));
    assert.match(error.message, new RegExp('Current retained launch and infrastructure review ' + current));
    assert.match(error.message, /--dry-run --infrastructure preserve/);
    return true;
  });
  assert.doesNotThrow(() => assertReviewedBoot(stack, saved, 1));
});

test('one-shot admission requires a capable restoring controller and preserves native service and boot policy scope', () => {
  const digest = 'a'.repeat(64);
  const stack = { project: 'example', stack: 'dev', enabled: true, infrastructureMode: 'reconcile', infrastructureReview: null };
  for (const protocol of [undefined, 2])
    assert.throws(() => assertReviewedBoot(stack, digest, protocol), /restoring controller/);
  const protocol = 1;
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

test('retained containers are verified against native identity when disabled stacks have no boot declarations', () => {
  const expected = { database: 'control', containers: [{ name: 'retained-postgres', id: 'first' }, { name: 'retained-redis', id: 'second' }] };
  const native = expected.containers.map(({ name, id }) => ({ name, containerId: id }));
  const boot = { ...expected, containers: [] };
  assert.doesNotThrow(() => assertRetainedRuntimeInfrastructure(expected, boot, native));
  assert.doesNotThrow(() => assertRetainedRuntimeInfrastructure(expected, expected, [...native, { name: 'independent', containerId: 'third' }]));
  assert.throws(() => assertRetainedRuntimeInfrastructure(expected, boot, native.slice(1)), /retained-postgres/);
  assert.throws(() => assertRetainedRuntimeInfrastructure(expected, boot, [{ ...native[0], containerId: 'replaced' }, native[1]]), /retained-postgres/);
  assert.throws(() => assertRetainedRuntimeInfrastructure(expected, { ...boot, database: 'replaced' }, native), /database identity/);
  assert.throws(() => assertRetainedRuntimeInfrastructure(expected, { ...boot, containers: [{ name: 'unreviewed', id: 'third' }] }, native), /Unreviewed/);
  assert.throws(() => assertRetainedRuntimeInfrastructure(expected, boot, [...native, native[0]]), /duplicate/);
});

const backup = {
  protocol: 1, id: '01234567-0000-4000-8000-000000000001', kind: 'backup', revision: 2, state: 'running',
  resources: [{ kind: 'database', name: 'fixture', project: 'sample', stack: 'dev' }], inputDigest: 'd'.repeat(64),
  createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:01Z',
  execution: { type: 'docker', operationId: '01234567-0000-4000-8000-000000000001', daemonId: 'fixture-daemon', id: 'owned-container' },
};

test('the reviewed backup may finish before apply without replacing its exact approved identity', async () => {
  const review = [structuredClone(backup)];
  assert.deepEqual(await retainReviewedBackups([backup], review, async () => assert.fail('active identity was already read')), review);
  for (const state of ['succeeded', 'failed', 'cancelled']) {
    const completed = { ...backup, state, revision: 4, updatedAt: '2026-11-15T00:00:02Z' };
    assert.deepEqual(await retainReviewedBackups([], review, async id => {
      assert.equal(id, backup.id);
      return completed;
    }), review, 'the stable review digest retains the original approval, not a substituted receipt');
  }
});

test('new attempts, unknown outcomes, changed intent and a different execution never inherit backup cancellation authority', async () => {
  const review = [backup];
  for (const current of [[{ ...backup, id: '01234567-0000-4000-8000-000000000002' }],
    [{ ...backup, revision: 3 }], [{ ...backup, state: 'unknown' }], [{ ...backup, kind: 'restore' }], [backup, backup]]) {
    await assert.rejects(retainReviewedBackups(current, review, async () => assert.fail('active state must be refused directly')));
  }
  const completed = { ...backup, state: 'succeeded', revision: 4 };
  for (const actual of [null, { ...completed, state: 'unknown' }, { ...completed, revision: 2 },
    { ...completed, inputDigest: 'e'.repeat(64) }, { ...completed, createdAt: '2026-11-15T00:00:02Z' },
    { ...completed, resources: [{ kind: 'database', name: 'another' }] },
    { ...completed, execution: { ...backup.execution, id: 'foreign-container' } }]) {
    await assert.rejects(retainReviewedBackups([], review, async () => actual), /completion is unconfirmed/);
  }
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
    before: { backend: previous, owner: previous, guardian: previous, console: null, consoleCommit: null, scope: 'user',
      ownerPid: identity.pid, backendPid: identity.pid, guardianPid: identity.pid, ownerId: identity.generation,
      ownerLifetime: identity.generation, retiredPids: [], revision: 1 },
    stacks: [], infrastructure: [], backupOperations: [],
  };
}

async function validateFixtureRestore(plan) {
  assert.equal(plan.before.console, null);
  assert.equal(plan.before.consoleCommit, null);
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
  assert.doesNotThrow(() => assertLocalReview(status), 'read-only review is not shutdown admission');
  await assert.rejects(runRuntimeUpdate({ ...config, operation: 'apply', digest }), /backupOperations=1/);
  delete blockers.backupOperations;
  await assert.rejects(runRuntimeUpdate({ ...config, operation: 'apply', digest }), /omitted required activity counters: backupOperations$/);
  blockers.backupOperations = 0;
  assert.equal((await runRuntimeUpdate({ ...config, operation: 'prepare' })).digest, digest);
});

test('recovery checks an older cold controller before any candidate retirement or new start', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'fixture-owner' });
  const actions = { async prepare() { return plan; }, async validateRestore() { throw Error('Legacy controller cannot restore this Console'); },
    async canRestore() { assert.fail('recovery must refuse before inspecting retirement'); },
    async stop() { assert.fail('recovery must preserve the candidate'); }, async start() { assert.fail('cannot start an unqualified controller'); } };
  const prepared = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await fs.writeFile(path.join(directory, 'current.json'), JSON.stringify({ ...prepared, phase: 'failed',
    updatedAt: new Date().toISOString() }), { mode: 0o600 });
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'recover', digest: prepared.digest }), /Legacy controller/);
  const receipt = await readRuntimeUpdateReceipt(directory);
  assert.equal(receipt.phase, 'recovery-required');
  assert.deepEqual(receipt.plan, plan);
  assert.equal(receipt.restoreAttempted, undefined);
});

test('an accepted host stays available for a fresh plan when the rollback footprint changes before shutdown', { skip: !native }, async t => {
  const directory = await privateInstance(t), plan = planFor(directory, { pid: process.pid, generation: 'old' });
  const candidate = { ...plan.before, backend: plan.target.artifact, ownerId: 'candidate' };
  let validates = 0, changed = false;
  const actions = { async prepare() { return plan; }, validateRestore: validateFixtureRestore,
    async canRestore() { return false; }, async captureForRollback() { return candidate; },
    async validateStop(owner, _forward, rollback) {
      assert.deepEqual(rollback, plan); assert.deepEqual(owner, candidate); validates++;
      if (changed) throw Error('A previously excluded stack acquired a generation');
    }, async stop() { assert.fail('must preserve the running owner'); } };
  const preview = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await fs.writeFile(path.join(directory, 'current.json'), JSON.stringify({ ...preview, phase: 'accepted', updatedAt: new Date().toISOString() }), { mode: 0o600 });
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation:'recover', digest:preview.digest,
    progress: phase => { if (phase === 'stopping-candidate') changed = true; } }), /refused before retirement/);
  const receipt = await readRuntimeUpdateReceipt(directory);
  assert.equal(validates, 2); assert.equal(receipt.phase, 'accepted'); assert.equal(receipt.rollbackOwner, undefined);
  assert.equal(receipt.restoreAttempted, undefined); assert.match(receipt.recoveryError, /excluded stack/);
  assert.equal((await runRuntimeUpdate({ actions, directory, operation:'prepare' })).digest, preview.digest);
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

test('an apply mismatch saves the exact fresh review and reports the changed fields without stopping processes', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'first-generation' });
  const actions = { async prepare() { return structuredClone(plan); },
    async admit() { assert.fail('changed plans cannot acquire shutdown authority'); },
    async stop() { assert.fail('changed plans cannot stop processes'); } };
  const reviewed = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  plan.infrastructure = { digest: '9'.repeat(64) };
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: reviewed.digest }), /changed \(infrastructure\).*No processes were stopped/);
  const current = await readPreparedRuntimeUpdate(directory);
  assert.deepEqual(current.plan, plan);
  assert.notEqual(current.digest, reviewed.digest);
  assert.equal(await readRuntimeUpdateReceipt(directory), null);
});

test('health recovery preserves the reviewed acceptance floor without changing shutdown authority', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'original' });
  plan.stacks = [{ project: 'sample', stack: 'dev', apps: [{ handleKey: 'sample/dev/worker', health: 'degraded', generation: 'first' }] }];
  let observed = structuredClone(plan), admitted = 0;
  const actions = {
    async prepare() { return structuredClone(observed); },
    async admit(approved) { admitted++; assert.deepEqual(approved, plan); },
    async validateStop() { throw Error('fixture stops before any process effect'); },
    async releaseAdmission() {},
    async stop() { assert.fail('the fixture does not stop processes'); },
  };
  const { digest } = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  observed.stacks[0].apps[0].health = 'healthy';
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest }), /fixture stops/);
  assert.equal(admitted, 1);
  assert.deepEqual((await readRuntimeUpdateReceipt(directory)).plan, plan);
  assert.equal((await readRuntimeUpdateReceipt(directory)).phase, 'aborted');

  // Better health does not authorize another generation, release or scope.
  observed.stacks[0].apps[0].generation = 'replaced';
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest }), /plan changed \(stacks\)/);
  assert.equal(admitted, 1);
});

test('health regression refuses before admission and cannot replace the reviewed baseline', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'original' });
  plan.stacks = [{ project: 'sample', stack: 'dev', apps: [{ handleKey: 'sample/dev/worker', health: 'healthy' }] }];
  const actions = {
    async prepare() { return structuredClone(plan); },
    async admit() { assert.fail('regressed health cannot acquire shutdown authority'); },
    async stop() { assert.fail('regressed health cannot stop processes'); },
  };
  const reviewed = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  for (const health of ['degraded', 'unhealthy', 'unknown', 'absent', 'invalid']) {
    plan.stacks[0].apps[0].health = health;
    await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: reviewed.digest }),
      /Application health regressed|Invalid application health/);
    assert.deepEqual(await readPreparedRuntimeUpdate(directory), reviewed);
    assert.equal(await readRuntimeUpdateReceipt(directory), null);
  }
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
      async admit() {},
      async releaseAdmission(reviewed) { assert.deepEqual(reviewed, plan); },
      async validateStop(before, reviewed) {
        assert.deepEqual(before, plan.before);
        assert.deepEqual(reviewed, plan);
        throw refusal;
      },
      async stop() { assert.fail('admission refused before shutdown'); },
      validateRestore: validateFixtureRestore,
      async canRestore() { assert.fail('an admission refusal cannot start recovery'); },
    },
  };
  const review = await runRuntimeUpdate({ ...config, operation: 'prepare' });
  for (const reason of ['source changed', 'worker rotation', 'infrastructure changed']) {
    refusal = new Error(reason);
    await assert.rejects(runRuntimeUpdate({ ...config, operation: 'apply', digest: review.digest }), error => error === refusal);
    assert.equal((await readRuntimeUpdateReceipt(directory)).phase, 'aborted');
    assert.deepEqual(await owner.observe(), owner.identity);
    assert.equal((await runRuntimeUpdate({ ...config, operation: 'prepare' })).digest, review.digest);
  }
  assert.deepEqual(phases, ['draining', 'aborted', 'draining', 'aborted', 'draining', 'aborted']);
});

test('a lost drain acknowledgement retains durable admission intent and recovery only releases that intent', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'original' });
  plan.backupOperations = [backup];
  let prepared;
  let releaseConfirmed = false;
  let admitted = 0, released = 0;
  const actions = {
    async prepare(reviewed) {
      if (prepared) assert.deepEqual(reviewed, prepared.plan);
      return plan;
    },
    async admit(reviewed, digest) {
      admitted++;
      const durable = await readRuntimeUpdateReceipt(directory);
      assert.equal(durable.phase, 'draining');
      assert.equal(durable.digest, digest);
      assert.deepEqual(durable.plan, reviewed);
      throw Error('drain reply lost');
    },
    async releaseAdmission(reviewed, digest) {
      released++;
      assert.equal(digest, prepared.digest);
      assert.deepEqual(reviewed, plan);
      if (!releaseConfirmed) throw Error('release reply lost');
    },
    async validateStop() { assert.fail('unknown admission cannot authorize shutdown'); },
    async stop() { assert.fail('recovery of admission cannot stop a process'); },
    validateRestore: validateFixtureRestore,
    async canRestore() { assert.fail('recovery of admission cannot enter owner restoration'); },
  };
  prepared = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: prepared.digest }), /release is unconfirmed/);
  const interrupted = await readRuntimeUpdateReceipt(directory);
  assert.equal(interrupted.phase, 'draining');
  assert.equal(interrupted.error, 'drain reply lost');
  assert.equal(interrupted.recoveryError, 'release reply lost');
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: prepared.digest }), /unfinished/);
  releaseConfirmed = true;
  const recovered = await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: prepared.digest });
  assert.equal(recovered.phase, 'aborted');
  assert.equal(recovered.recoveryError, undefined);
  assert.equal(admitted, 1);
  assert.equal(released, 2);
  assert.deepEqual(await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: prepared.digest }), recovered);
  assert.equal(released, 2, 'a confirmed release is not replayed');
});

test('a refused stop reconciles the unchanged original owner without restarting or restoring it', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const owner = await ownerGeneration(t, directory, previous);
  const plan = planFor(directory, owner.identity);
  let released = 0;
  let confirmed = false;
  const actions = {
    async prepare() { return plan; }, async admit() {}, async validateStop() {},
    async stop() { throw Error('child command refused before its action'); },
    async isPreviousServing(reviewed) {
      assert.deepEqual(reviewed, plan);
      assert.deepEqual(await owner.observe(), owner.identity);
      return confirmed;
    },
    async releaseAdmission() { released++; },
    validateRestore: validateFixtureRestore,
    async canRestore() { return false; },
    async captureForRollback() { throw Error('candidate never served'); },
    async start() { assert.fail('the original owner must never be restarted'); },
  };
  const review = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: review.digest }), /candidate never served/);
  assert.equal((await readRuntimeUpdateReceipt(directory)).phase, 'recovery-required');
  assert.equal(released, 0, 'unknown ownership cannot release admission');
  confirmed = true;
  const result = await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: review.digest });
  assert.equal(result.phase, 'aborted');
  assert.equal(result.error, 'child command refused before its action');
  assert.equal(result.recoveryError, undefined);
  assert.equal(released, 1);
  assert.deepEqual(await owner.observe(), owner.identity);
});

test('applying the same review twice verifies a new live process generation and starts it once', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  let owner = await ownerGeneration(t, directory, previous);
  const original = owner.identity;
  const plan = planFor(directory, original);
  const events = [];
  const actions = {
    async prepare() { return structuredClone(plan); },
    async admit() {},
    async releaseAdmission() {},
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
    validateRestore: validateFixtureRestore,
    async canRestore() { return false; },
    async captureForRollback() {
      const identity = await owner.observe();
      assert.equal(identity.artifact, target);
      return planFor(directory, identity).before;
    },
    async withRollbackAdmission(_plan, identity, stop) { assert.equal(identity.ownerId, owner.identity.generation); return stop(); },
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

test('native recovery records backend absence before stopping and resumes a lost stop acknowledgement without repeating effects', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'old-owner' });
  const retired = { observation: 'native-empty-owner', backend: target, owner: target, guardian: target,
    backendPid: null, backendCommit: null, ownerCommit: source, ownerPid: 201, guardianPid: 202,
    ownerId: 'candidate-owner', ownerLifetime: 'candidate-life', guardianLifetime: 'guardian-life',
    scope: 'user', revision: 2, retiredPids: [202],
    native: { platform: 'darwin', domain: 'gui/501', bootSession: '01234567-0000-4000-8000-000000000001', processGroups: [201, 202] } };
  let stops = 0, starts = 0, captures = 0, candidateStopped = false;
  const actions = {
    async prepare() { return plan; }, async admit() {}, async releaseAdmission() {},
    async validateStop(identity) { assert.ok(identity.ownerId === plan.before.ownerId || identity.ownerId === retired.ownerId); },
    async stop(identity) {
      stops++;
      if (identity.ownerId === plan.before.ownerId) return;
      const durable = await readRuntimeUpdateReceipt(directory);
      assert.equal(durable.phase, 'stopping-candidate');
      assert.deepEqual(durable.rollbackOwner, retired, 'native owner evidence must reach the journal before any stop effect');
      candidateStopped = true;
      throw Error('stop acknowledgement lost');
    },
    async assertStopped() {},
    async start(destination) {
      starts++;
      if (!destination.artifact) {
        const durable = await readRuntimeUpdateReceipt(directory);
        assert.equal(durable.restoreAttempted, true);
        assert.equal(durable.phase, 'restoring');
        assert.deepEqual(destination, plan.before);
      }
    },
    async accept(_plan, direction) {
      if (direction === 'target') throw new RuntimeObservationUnconfirmed('backend never became ready');
      return { ownerId: 'restored-owner' };
    },
    async isPreviousServing() { return false; },
    validateRestore: validateFixtureRestore,
    async canRestore(identity) { return identity.ownerId === retired.ownerId && candidateStopped; },
    async captureForRollback() { captures++; return retired; },
    async withRollbackAdmission(_plan, identity, stop) { assert.equal(identity.observation, 'native-empty-owner'); return stop(); },
  };
  const review = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: review.digest }), /never became ready/);
  assert.equal((await readRuntimeUpdateReceipt(directory)).phase, 'recovery-required');
  assert.equal(captures, 0, 'an unconfirmed read cannot authorize automatic rollback');
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'recover', digest: review.digest }), /acknowledgement lost/);
  assert.deepEqual((await readRuntimeUpdateReceipt(directory)).rollbackOwner, retired);
  const recovered = await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: review.digest });
  assert.equal(recovered.phase, 'rolled-back');
  assert.equal(captures, 1, 'a clean native shutdown reuses its durable identity');
  assert.equal(stops, 2, 'original and candidate each stopped once');
  assert.equal(starts, 2, 'candidate and restoration each started once');
  assert.deepEqual(await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: review.digest }), recovered);
  assert.equal(starts, 2);
});

test('reconciliation confirms a serving candidate after a lost result without replaying lifecycle actions', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  let owner = await ownerGeneration(t, directory, previous);
  const original = owner.identity;
  const plan = planFor(directory, original);
  let starts = 0, stops = 0, observed = false;
  const actions = {
    async prepare() { return plan; }, async admit() {}, async validateStop() {},
    async stop() { stops++; await owner.stop(); }, async assertStopped() {},
    async start() { starts++; owner = await ownerGeneration(t, directory, target); throw Error('Console reply lost'); },
    validateRestore: validateFixtureRestore,
    async canRestore() { return false; },
    async captureForRollback() { throw Error('owner startup observation pending'); },
    async accept(reviewed, direction, inspectOnly) {
      assert.deepEqual(reviewed, plan);
      assert.equal(direction, 'target');
      assert.equal(inspectOnly, true);
      if (!observed) throw Error('target not fully observed');
      const actual = await owner.observe();
      assert.equal(actual.artifact, target);
      assert.notEqual(actual.generation, original.generation);
      return actual;
    },
  };
  const review = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: review.digest }), /startup observation pending/);
  const pending = await readRuntimeUpdateReceipt(directory);
  assert.equal(pending.phase, 'recovery-required');
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'reconcile', digest: review.digest }), /not fully observed/);
  assert.deepEqual(await readRuntimeUpdateReceipt(directory), pending, 'a refused observation cannot rewrite the receipt');
  observed = true;
  const accepted = await runRuntimeUpdate({ actions, directory, operation: 'reconcile', digest: review.digest });
  assert.equal(accepted.phase, 'accepted');
  assert.equal(accepted.error, 'Console reply lost', 'the original failure remains auditable');
  assert.equal(accepted.recoveryError, undefined, 'confirmed acceptance resolves the failed recovery observation');
  assert.deepEqual(accepted.acceptance, await owner.observe());
  assert.deepEqual(await runRuntimeUpdate({ actions, directory, operation: 'reconcile', digest: review.digest }), accepted);
  assert.equal(starts, 1); assert.equal(stops, 1);
  await fs.writeFile(path.join(directory, 'current.json'), JSON.stringify({ ...pending, restoreAttempted: true }));
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'reconcile', digest: review.digest }), /entered restoration/);
  assert.equal(starts, 1); assert.equal(stops, 1);
});

for (const error of [new RuntimeObservationTimeout('acceptance pending'), new RuntimeObservationUnconfirmed('RPC result lost')])
test(`${error.code} retains the serving candidate without starting an automatic rollback`, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'original' });
  let stops = 0, starts = 0, ready = false;
  const actions = {
    async prepare() { return plan; }, async admit() {}, async validateStop() {},
    async stop() { stops++; }, async assertStopped() {}, async start() { starts++; },
    validateRestore: validateFixtureRestore,
    async canRestore() { assert.fail('expiry is not evidence for rollback'); },
    async captureForRollback() { assert.fail('expiry cannot retire a serving candidate'); },
    async accept() {
      if (!ready) throw error;
      return { ownerId: 'replacement' };
    },
  };
  const review = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await assert.rejects(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: review.digest }), cause => cause === error);
  assert.equal((await readRuntimeUpdateReceipt(directory)).phase, 'recovery-required');
  assert.equal(stops, 1); assert.equal(starts, 1);
  ready = true;
  assert.equal((await runRuntimeUpdate({ actions, directory, operation: 'reconcile', digest: review.digest })).phase, 'accepted');
  assert.equal(stops, 1); assert.equal(starts, 1);
});

test('a lost rollback acknowledgement is inspected without a second cold start', { skip: !native }, async t => {
  const directory = await privateInstance(t);
  const plan = planFor(directory, { pid: process.pid, generation: 'original' });
  plan.configuration = { sha256: 'f'.repeat(64), basis: 'retained-next-start' };
  const guardian = { file: path.join(directory, 'runtime/supervisor-transition-01234567-0000-0000-0000-000000000001.json'), intentSha256: 'e'.repeat(64) };
  let starts = 0;
  let restored = false;
  let completed = false;
  let inspectOnly;
  const actions = {
    async prepare() { return plan; },
    async admit() {},
    async releaseAdmission() {},
    async validateStop() {},
    async stop() {},
    async assertStopped() {},
    validateRestore: validateFixtureRestore,
    async canRestore() { return true; },
    async start(destination, _plan, restoration) {
      starts++;
      if ('artifact' in destination) throw Error('candidate refused');
      restored = true;
      await restoration.recordGuardian(guardian);
      assert.deepEqual((await readRuntimeUpdateReceipt(directory)).restoreGuardian, guardian, 'the reference is durable before guardian effects');
      throw Error('restored but acknowledgement was lost');
    },
    async completeRestore(reviewed, restoration) {
      assert.deepEqual(reviewed, plan);
      assert.equal(restored, true);
      assert.equal(starts, 2);
      assert.deepEqual(restoration.guardian(), guardian);
      await assert.rejects(restoration.recordGuardian({ ...guardian, intentSha256: 'd'.repeat(64) }), /another guardian plan/);
      await assert.rejects(restoration.recordGuardian({ ...guardian, file: '/different/instance/plan.json' }), /Invalid runtime restoration/);
      completed = true;
    },
    async accept(reviewed, direction, inspect) {
      assert.deepEqual(reviewed, plan);
      assert.equal(direction, 'previous');
      assert.equal(restored, true);
      assert.equal(completed, true);
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
  assert.deepEqual(interrupted.restoreGuardian, guardian);
  assert.equal(starts, 2);
  assert.equal(completed, false);
  const recovered = await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: prepared.digest });
  assert.equal(recovered.phase, 'rolled-back');
  assert.equal(inspectOnly, true);
  assert.equal(completed, true);
  assert.equal(starts, 2);
  assert.deepEqual(await readRuntimeUpdateReceipt(directory, prepared.digest), recovered);
});
