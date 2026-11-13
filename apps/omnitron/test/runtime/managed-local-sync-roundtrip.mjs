import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runLocalSync } from '../../../../.xec/local-sync.js';
import { assertReviewedBoot, stackAdmissionProtocol } from '../../../../.xec/local-sync-host.js';

const actions = ['prepare', 'validateStop', 'stop', 'assertStopped', 'start', 'canRestore', 'captureForRollback', 'accept'];
const file = fileURLToPath(import.meta.url);
const lostReply = 73;

// This transient reviewing client stops after the native start has returned and the
// verifying phase has reached disk, before the operator can receive an acknowledgement.
if (process.argv[1] === file && process.argv[2] === '--interrupt-client') {
  const [, , , directory, review] = process.argv;
  const calls = Object.fromEntries(actions.map(name => [name, (...args) => new Promise((resolve, reject) => {
    process.once('message', reply => reply.error ? reject(Error(reply.error)) : resolve(reply.value));
    process.send({ name, args });
  })]));
  await runLocalSync({ actions: calls, directory, review, progress(phase) {
    if (phase === 'verifying') process.exit(lostReply);
  } });
  throw Error('Fixture client unexpectedly received the completed update');
}

async function loseClientAfterBoot(directory, review, driver, timeout) {
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0, 'Use the bounded public lifecycle budget');
  const child = fork(file, ['--interrupt-client', directory, review], { execArgv: ['--import', 'tsx'],
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)), stdio: ['ignore', 'inherit', 'inherit', 'ipc'], timeout });
  const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => {
    if (code === lostReply && !signal) resolve(); else reject(Error('Private reviewing client exited ' + (signal ?? code)));
  }); });
  let active;
  child.on('message', request => {
    active = (async () => {
      try {
        assert.ok(actions.includes(request.name) && Array.isArray(request.args));
        const value = await driver[request.name](...request.args);
        if (child.connected) child.send({ value });
      } catch (err) { if (child.connected) child.send({ error: err.message }); }
    })();
  });
  // A reviewer failure cannot let its outstanding native command outlive fixture cleanup.
  try { await finished; } finally { await active; }
}

export async function managedLocalSyncRoundtrip(context) {
  const { first, previous, candidate, instance, root, projectDirectory, candidateRoot, cli, api, status, ready, certificate,
    worker, history, jobPid, retireNative, launchNative, track, mark, until } = context;
  const req = createRequire(path.join(candidateRoot, 'packages/0/package.json'));
  const { assertCleanManagedShutdown } = await context.load('daemon/owner-reconciliation');
  const { readProcessLifetime } = await import(pathToFileURL(req.resolve('@omnitron-dev/common/process-identity')).href);
  const Database = req('better-sqlite3');
  const directory = path.join(instance, 'runtime/local-updates');
  const scope = { project: 'probe', stack: 'local' };
  const project = work => api(async client => work(await client.service('OmnitronProject')));
  const readStack = () => project(service => service.getStack(scope));
  const birth = pid => {
    const value = readProcessLifetime(pid);
    assert.equal(value.state, 'alive');
    return value.identity;
  };
  const key = 'lifecycle:cold-start:probe/local';
  const claims = () => {
    const db = new Database(path.join(instance, 'data/daemon-state.db'), { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare('SELECT value FROM state_kv WHERE key = ?').get(key);
      return row ? JSON.parse(row.value) : null;
    } finally { db.close(); }
  };
  const nativeRoles = async current => {
    const selected = (await cli('backend', 'installation')).selection;
    const supervision = JSON.parse(await fs.readFile(path.join(instance, 'runtime/supervision.json'), 'utf8'));
    assert.equal(supervision.instanceHome, instance);
    assert.equal(supervision.owner.label, 'dev.omnitron.fixture.' + context.fixtureId + '.owner');
    assert.equal(supervision.backend.label, 'dev.omnitron.fixture.' + context.fixtureId + '.backend');
    return { backend: selected.current, owner: supervision.owner.artifact, guardian: supervision.backend.artifact,
      revision: selected.revision, ownerPid: current.execution.owner.pid, ownerLifetime: birth(current.execution.owner.pid),
      ownerId: current.execution.owner.id, backendPid: current.pid, guardianPid: await jobPid('backend') };
  };
  const inspectSelection = async () => {
    const initial = await readStack();
    const review = await project(service => service.reviewStackStart({ ...scope, infrastructure: 'preserve' }));
    assert.match(review.digest, /^[a-f0-9]{64}$/, JSON.stringify(review.targets));
    assert.deepEqual(review.selection, { workingTree: true });
    assert.equal(initial.infrastructureMode, 'reconcile');
    assert.equal(initial.selectedRelease, undefined);
    assert.equal(initial.infrastructureReview ?? null, null);
    return review;
  };
  assert.notEqual(previous.backend, candidate.id, 'Use two independently sealed runtimes');
  await certificate();
  const checks = [];
  for (const id of [candidate.id, previous.backend]) {
    const checked = await cli('backend', 'select', id, '--check');
    assert.equal(checked.candidate, id); assert.equal(checked.checked, true);
    assert.equal(checked.infrastructure.coverage, 'certified-declarations');
    assert.deepEqual(checked.infrastructure.containers, []);
    checks.push(checked);
  }
  const protocol = stackAdmissionProtocol(...checks);
  assert.equal(protocol, 1);
  const review = await inspectSelection();
  const plan = { protocol: 1, stackAdmissionProtocol: protocol, instance, target: { artifact: candidate.id, commit: candidate.build.commit },
    before: await nativeRoles(first), infrastructure: { database: null, containers: [], digest: checks[0].infrastructure.digest },
    stacks: [{ ...scope, runtimeScope: scope, path: projectDirectory, enabled: true, infrastructureMode: 'reconcile',
      infrastructureReview: null, selection: { kind: 'working-tree' }, savedSelection: { kind: 'unreported' }, startReview: review.digest }],
    excluded: [], watches: [] };
  assertReviewedBoot(plan.stacks[0], review.digest, protocol);
  const migrations = await history();
  assert.equal(claims(), null);
  const rounds = [];
  let stopped, priorWorker = worker, manualStarts = 0;
  const driver = {
    async prepare() { return plan; },
    async validateStop(expected) {
      const prior = await status();
      assert.equal(prior.execution.owner.id, expected.ownerId);
      assert.equal(await jobPid('backend'), expected.guardianPid);
    },
    async stop(expected) {
      const prior = await status(), guardianPid = await jobPid('backend');
      assert.equal(prior.execution.owner.id, expected.ownerId); assert.equal(guardianPid, expected.guardianPid);
      track(prior.pid, prior.execution.owner.pid, guardianPid, priorWorker.pid);
      await retireNative(prior, guardianPid);
      await until(() => [prior.pid, prior.execution.owner.pid, guardianPid, priorWorker.pid].every(pid => readProcessLifetime(pid).state === 'dead'),
        'Clean stop did not retire all four private processes', 25_000);
      await assertCleanManagedShutdown(context.config, { pid: prior.execution.owner.pid, lifetime: expected.ownerLifetime },
        [prior.pid, guardianPid, priorWorker.pid]);
      stopped = expected.ownerId;
    },
    async assertStopped(expected) { assert.equal(stopped, expected.ownerId); },
    async canRestore(expected) { return Boolean(stopped && stopped === expected.ownerId); },
    async captureForRollback() {
      const value = await nativeRoles(await status());
      assert.equal(value.backend, candidate.id); assert.notEqual(value.ownerId, plan.before.ownerId);
      return value;
    },
    async start(destination) {
      assert.ok(stopped);
      const forward = !!destination.artifact;
      const target = forward ? { owner: candidate.id, guardian: candidate.id, backend: candidate.id, commit: candidate.build.commit } : previous;
      await launchNative(target);
      stopped = undefined;
      const next = await until(async () => {
        const current = await status();
        return current.build.commit === target.commit && current.execution.owner.id !== plan.before.ownerId && current;
      }, 'New native owner and backend did not start', 70_000);
      const value = await ready(next.execution.owner.pid, priorWorker.pid);
      track(next.pid, next.execution.owner.pid, value.pid, await jobPid('backend'));
      priorWorker = value;
    },
    async accept(_plan, direction) {
      const current = await status(), value = await ready(current.execution.owner.pid);
      const observed = await inspectSelection(), claim = claims();
      const app = await api(client => client.getApp({ name: 'probe/local/counter' }));
      assert.equal(app.status, 'online'); assert.equal(app.pid, value.pid);
      assert.equal(typeof app.generation, 'string'); assert.ok(app.generation);
      assert.equal(observed.digest, review.digest);
      assert.equal(claim.digest, digest);
      assert.equal(claim[direction].ownerId, current.execution.owner.id);
      assert.equal(claim[direction].ownerPid, current.execution.owner.pid);
      assert.equal(claim[direction].ownerLifetime, birth(current.execution.owner.pid));
      if (direction === 'target') assert.equal(claim.previous, undefined);
      else assert.deepEqual(claim.target, rounds[0].claim.target);
      assert.equal(current.build.commit, direction === 'target' ? candidate.build.commit : previous.commit);
      assert.deepEqual(await history(), migrations);
      const result = { direction, ownerId: current.execution.owner.id, ownerPid: current.execution.owner.pid,
        guardianPid: await jobPid('backend'), backendPid: current.pid, applicationPid: value.pid, applicationGeneration: app.generation, claim,
        commit: current.build.commit, verifiedStart: observed.digest, bootPolicy: 'reconcile', migrationRows: migrations.length };
      const previousEvidence = rounds.find(entry => entry.direction === direction);
      if (previousEvidence) assert.deepEqual(result, previousEvidence);
      else { rounds.push(result); mark({ stage: 'local-sync-' + direction, ...result }); }
      return result;
    },
  };
  const { digest } = await runLocalSync({ directory, actions: driver });
  await loseClientAfterBoot(directory, digest, driver, context.lifecycleBudget);
  const outstanding = await runLocalSync({ directory, status: true });
  assert.equal(outstanding.phase, 'verifying'); assert.equal(outstanding.digest, digest);
  await driver.accept(plan, 'target');
  await assert.rejects(runLocalSync({ directory, actions: driver, review: digest }), /unfinished/);
  await assert.rejects(project(service => service.startStack({ ...scope, workingTree: true }).then(() => { manualStarts++; })), /held by local update/);
  const rollback = await runLocalSync({ directory, actions: driver, rollback: true, review: digest });
  assert.equal(rollback.phase, 'rolled-back');
  assert.equal(rollback.digest, digest); assert.equal(rounds.length, 2); assert.equal(manualStarts, 0);
  assert.deepEqual(await runLocalSync({ directory, actions: driver, rollback: true, review: digest }), rollback);
  assert.deepEqual(await runLocalSync({ directory, status: true }), rollback);
  assert.equal(new Set([worker.pid, ...rounds.map(v => v.applicationPid)]).size, 3);
  assert.equal(new Set([first.execution.owner.id, ...rounds.map(v => v.ownerId)]).size, 3);
  assert.notEqual(rounds[0].applicationGeneration, rounds[1].applicationGeneration);
  const result = { test: 'managed-local-sync-roundtrip', platform: process.platform, root, digest, previous: previous.backend, candidate: candidate.id,
    rounds, protocol, verifiedBinaries: checks.map(v => v.candidate), lostAcknowledgement: outstanding.phase,
    repeatedRollback: 'same receipt and generation', postBootApplicationStarts: manualStarts, success: true };
  await fs.writeFile(path.join(root, 'local-sync-roundtrip.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
