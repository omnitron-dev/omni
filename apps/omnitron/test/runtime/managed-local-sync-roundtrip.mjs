import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { upgradePrivateFixtureBackend } from './managed-owner-roundtrip.mjs';
import { authorizeFixtureGuardianReplacement, assertFixtureUnitFilesOwned } from './fixture-unit-files.mjs';
const { runRuntimeUpdate, readRuntimeUpdateReceipt } = await tsImport('../../src/daemon/runtime-update.ts', import.meta.url);
const { assertReviewedBoot, restoreRuntimeRoles } = await tsImport('../../src/daemon/runtime-update-host.ts', import.meta.url);
const { saveRestartConfiguration, readRestartConfiguration, restartLaunchIntent, assertRestartOwnerDefaults } =
  await tsImport('../../src/project/runtime-restart.ts', import.meta.url);

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
  await runRuntimeUpdate({ actions: calls, directory, operation: 'apply', digest: review, progress(phase) {
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

/** The same authenticated next-start review used by runtimeUpdateActions. */
export async function capturePrivateRestartConfiguration({ api, connect, instance, ownerId, scope }) {
  const address = await api(async client => (await client.service('OmnitronBackend')).controlAddress());
  const control = await connect(address.socket, 'OmnitronBackendControl');
  try {
    const status = await control.service.status();
    assert.equal(status.instanceHome, instance, 'Restart review belongs to another private instance');
    assert.equal(status.runtimeRestartProtocol, 1, 'Warm the capable controller before retained review');
    const configuration = await control.service.runtimeRestart({ stacks: [scope] });
    assert.equal(configuration.ownerId, ownerId, 'Restart review belongs to another execution owner');
    return configuration;
  } finally { await control.close(); }
}

export function assertRetainedFixtureLaunches(snapshot, configuration) {
  assert.equal(snapshot.status.phase, 'active');
  assert.equal(snapshot.status.inFlight, 0);
  for (const stack of configuration.stacks) for (const expected of stack.launches) {
    const actual = snapshot.apps.find(app => app.info.name === expected.name)?.entry;
    assert.ok(actual, 'Retained application is absent: ' + expected.name);
    assert.deepEqual(restartLaunchIntent(actual), restartLaunchIntent(expected),
      'Application differs from retained next-start intent: ' + expected.name);
  }
}

export async function managedLocalSyncRoundtrip(context) {
  const { first, previous, candidate, instance, root, projectDirectory, candidateRoot, cli, api, status, ready, certificate,
    worker, history, jobPid, retireNative, launchNative, track, mark, until } = context;
  const req = createRequire(path.join(candidateRoot, 'packages/0/package.json'));
  const { assertCleanManagedShutdown } = await context.load('daemon/owner-reconciliation');
  const { privateControlClient } = await context.load('daemon/private-control-client');
  const { loadRegisteredStartupEcosystem } = await context.load('daemon/startup-config');
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
      scope: supervision.scope, backendCommit: current.build.commit, console: null, consoleCommit: null,
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
  assert.notEqual(previous.owner, candidate.id, 'Use an independent previous execution owner');
  assert.notEqual(previous.guardian, candidate.id, 'Exercise restoration of the previous native guardian');
  await certificate();
  const initialRoles = await nativeRoles(await status());
  const initialApp = await api(client => client.getApp({ name: 'probe/local/counter' }));
  // Production preparation requires the serving controller to capture the old
  // owner's retained intent. The reviewed baseline is this warmed controller,
  // not the earlier backend that will be restored after the cold receipt ends.
  if (previous.backend !== candidate.id) await upgradePrivateFixtureBackend({ cli, runtimeRoot: candidateRoot,
    commit: candidate.build.commit, status });
  await certificate();
  const warmed = await status(), baseline = await nativeRoles(warmed);
  assert.equal(baseline.backend, candidate.id);
  for (const key of ['owner', 'ownerId', 'ownerPid', 'ownerLifetime', 'guardian', 'guardianPid'])
    assert.equal(baseline[key], initialRoles[key], 'Warm preparation changed ' + key);
  assert.equal((await ready(baseline.ownerPid)).pid, worker.pid);
  const warmedApp = await api(client => client.getApp({ name: 'probe/local/counter' }));
  assert.equal(warmedApp.generation, initialApp.generation);
  track(warmed.pid);
  const checks = [];
  for (const id of [candidate.id, previous.backend]) {
    const checked = await cli('backend', 'select', id, '--check');
    assert.equal(checked.candidate, id); assert.equal(checked.checked, true);
    assert.equal(checked.infrastructure.coverage, 'certified-declarations');
    assert.deepEqual(checked.infrastructure.containers, []);
    checks.push(checked);
  }
  assert.equal(checks[0].coldStackAdmissionProtocol, 1);
  assert.equal(checks[0].runtimeRestartProtocol, 1);
  const protocol = 1;
  const configuration = await capturePrivateRestartConfiguration({ api, connect: privateControlClient,
    instance, ownerId: baseline.ownerId, scope });
  assertRestartOwnerDefaults(await loadRegisteredStartupEcosystem(context.config.cwd), configuration.watchConfig);
  assert.equal(configuration.stacks.length, 1);
  const retained = configuration.stacks[0];
  assert.equal(retained.project, scope.project); assert.equal(retained.stack, scope.stack);
  assert.equal(retained.path, projectDirectory); assert.equal(retained.selection, null);
  const review = retained.review;
  assert.equal((await inspectSelection()).digest, review.digest);
  const configurationSha256 = await saveRestartConfiguration(instance, configuration);
  const verifyLaunches = async () => {
    const owner = await privateControlClient(path.join(context.execution, 'owner.sock'), 'OmnitronExecution');
    try { assertRetainedFixtureLaunches(await owner.service.snapshot(), await readRestartConfiguration(instance, configurationSha256)); }
    finally { await owner.close(); }
  };
  await verifyLaunches();
  const plan = { protocol: 1, stackAdmissionProtocol: protocol, instance, target: { artifact: candidate.id, commit: candidate.build.commit },
    configuration: { sha256: configurationSha256, basis: 'retained-next-start' },
    before: { ...baseline, retiredPids: [warmed.pid, baseline.guardianPid, worker.pid] },
    infrastructure: { database: null, containers: [], digest: checks[0].infrastructure.digest,
      schemaScope: checks[0].schemaScope, coldStackAdmissionProtocol: 1, runtimeRestartProtocol: 1 },
    stacks: [{ ...scope, runtimeScope: scope, path: projectDirectory, enabled: true, infrastructureMode: 'reconcile',
      infrastructureReview: null, selection: { kind: 'working-tree' }, savedSelection: { kind: 'unreported' }, startReview: review.digest }],
    excluded: [], watches: [] };
  assertReviewedBoot(plan.stacks[0], review.digest, protocol);
  const migrations = await history();
  assert.equal(claims(), null);
  const rounds = [];
  let stopped, priorWorker = worker, manualStarts = 0;
  let guardianApplyCount = 0, lostGuardianReply = false;
  const restoreCall = async args => {
    const apply = args[0] === 'backend' && args[1] === 'guardian' && args[2] === 'apply' && !args.includes('--check');
    if (apply) {
      const transition = JSON.parse(await fs.readFile(args[3], 'utf8'));
      if (transition.phase === 'prepared')
        await authorizeFixtureGuardianReplacement(context.units, args[3], transition, instance);
    }
    const result = await cli(...args);
    if (apply) {
      guardianApplyCount++;
      await assertFixtureUnitFilesOwned(context.units);
      const current = await status();
      track(current.pid, current.execution.owner.pid, await jobPid('backend'));
      if (!lostGuardianReply) {
        lostGuardianReply = true;
        throw Error('Fixture lost guardian restoration reply');
      }
    }
    return result;
  };
  const completeRestore = async (expected, restoration) => restoreRuntimeRoles(expected,
    () => until(async () => nativeRoles(await status()), 'Restored roles did not become observable'),
    async () => {
      const roles = await nativeRoles(await status());
      assert.equal(roles.owner, baseline.owner); assert.equal(roles.backend, candidate.id); assert.equal(roles.guardian, candidate.id);
      assert.equal(claims()?.previous?.ownerId, roles.ownerId);
      await verifyLaunches();
    }, restoreCall, restoration);
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
    async start(destination, expected, restoration) {
      assert.ok(stopped);
      const forward = !!destination.artifact;
      const target = { owner: forward ? candidate.id : baseline.owner, guardian: candidate.id,
        backend: candidate.id, commit: candidate.build.commit };
      await launchNative(target);
      stopped = undefined;
      const next = await until(async () => {
        const current = await status();
        return current.build.commit === target.commit && current.execution.owner.id !== plan.before.ownerId && current;
      }, 'New native owner and backend did not start', 70_000);
      const value = await ready(next.execution.owner.pid, priorWorker.pid);
      track(next.pid, next.execution.owner.pid, value.pid, await jobPid('backend'));
      priorWorker = value;
      await certificate();
      if (!forward) await completeRestore(expected, restoration);
    },
    completeRestore,
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
      assert.equal(current.build.commit, candidate.build.commit);
      const roles = await nativeRoles(current);
      assert.equal(roles.backend, candidate.id);
      assert.equal(roles.owner, direction === 'target' ? candidate.id : baseline.owner);
      assert.equal(roles.guardian, direction === 'target' ? candidate.id : baseline.guardian);
      await verifyLaunches();
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
  const { digest } = await runRuntimeUpdate({ directory, actions: driver, operation: 'prepare' });
  await loseClientAfterBoot(directory, digest, driver, context.lifecycleBudget);
  const outstanding = await readRuntimeUpdateReceipt(directory);
  assert.equal(outstanding.phase, 'verifying'); assert.equal(outstanding.digest, digest);
  await driver.accept(plan, 'target');
  await assert.rejects(runRuntimeUpdate({ directory, actions: driver, operation: 'apply', digest }), /unfinished/);
  await assert.rejects(project(service => service.startStack({ ...scope, workingTree: true }).then(() => { manualStarts++; })), /held by local update/);
  await assert.rejects(runRuntimeUpdate({ directory, actions: driver, operation: 'recover', digest }), /Fixture lost guardian restoration reply/);
  const interruptedRestore = await readRuntimeUpdateReceipt(directory);
  assert.equal(interruptedRestore.phase, 'recovery-required');
  assert.equal(interruptedRestore.restoreAttempted, true);
  assert.ok(interruptedRestore.restoreGuardian);
  const restoredBeforeRetry = await nativeRoles(await status());
  const restoredApp = await api(client => client.getApp({ name: 'probe/local/counter' }));
  const rollback = await runRuntimeUpdate({ directory, actions: driver, operation: 'recover', digest });
  assert.equal(rollback.phase, 'rolled-back');
  assert.equal(rollback.digest, digest); assert.equal(rounds.length, 2); assert.equal(manualStarts, 0);
  assert.deepEqual(await runRuntimeUpdate({ directory, actions: driver, operation: 'recover', digest }), rollback);
  assert.deepEqual(await readRuntimeUpdateReceipt(directory), rollback);
  assert.deepEqual(rollback.restoreGuardian, interruptedRestore.restoreGuardian);
  assert.deepEqual(await nativeRoles(await status()), restoredBeforeRetry);
  assert.equal((await api(client => client.getApp({ name: 'probe/local/counter' }))).generation, restoredApp.generation);
  assert.equal(guardianApplyCount, 1, 'Lost acknowledgement repeated a committed guardian effect');
  assert.equal(new Set([worker.pid, ...rounds.map(v => v.applicationPid)]).size, 3);
  assert.equal(new Set([first.execution.owner.id, ...rounds.map(v => v.ownerId)]).size, 3);
  assert.notEqual(rounds[0].applicationGeneration, rounds[1].applicationGeneration);
  // The cold receipt restores its actual warmed baseline. Returning to the
  // original backend is a separate public warm transition in the operator plan.
  if (previous.backend !== candidate.id) await upgradePrivateFixtureBackend({ cli,
    runtimeRoot: context.installed(previous.backend), commit: previous.commit, status });
  await certificate();
  const final = await nativeRoles(await status()), finalApp = await api(client => client.getApp({ name: 'probe/local/counter' }));
  assert.equal(final.backend, previous.backend);
  for (const key of ['owner', 'ownerId', 'ownerPid', 'ownerLifetime', 'guardian', 'guardianPid'])
    assert.equal(final[key], restoredBeforeRetry[key], 'Final warm rollback changed ' + key);
  assert.equal(finalApp.pid, restoredApp.pid); assert.equal(finalApp.generation, restoredApp.generation);
  assert.equal((await ready(final.ownerPid)).pid, restoredApp.pid);
  await verifyLaunches();
  assert.deepEqual(await history(), migrations);
  assert.deepEqual(await readRuntimeUpdateReceipt(directory), rollback);
  track(final.backendPid, final.guardianPid);
  const result = { test: 'managed-local-sync-roundtrip', platform: process.platform, root, digest, previous: previous.backend, candidate: candidate.id,
    rounds, protocol, configuration: configurationSha256, reviewedBaseline: baseline,
    verifiedBinaries: checks.map(v => v.candidate), lostAcknowledgement: outstanding.phase,
    restorationReplyLost: true, guardianApplyCount, restoreGuardian: rollback.restoreGuardian,
    finalWarmRollback: { outsideColdReceipt: true, ...final, applicationPid: finalApp.pid, applicationGeneration: finalApp.generation },
    repeatedRollback: 'same receipt and generation', postBootApplicationStarts: manualStarts, success: true };
  await fs.writeFile(path.join(root, 'local-sync-roundtrip.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
