import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyFixtureLogs } from './fixture-log-evidence.mjs';

/** This counter fixture owns no containers. Prove that footprint and use the
 * ordinary reviewed stop on every backend version; it does not qualify the
 * separate keepInfrastructure extension or silently fall back from it. */
export async function stopPrivateFixtureStack(project) {
  const scope = { project: 'probe', stack: 'local' };
  const review = await project.reviewStackStop(scope);
  assert.equal(review.project, scope.project); assert.equal(review.stack, scope.stack);
  assert.match(review.digest, /^[a-f0-9]{64}$/);
  assert.equal(review.targets.length, 1);
  const target = review.targets[0];
  assert.equal(target.node, 'local'); assert.equal(target.reason, undefined);
  if (target.runtime) assert.deepEqual(target.runtime, scope);
  assert.deepEqual(target.applications, ['probe/local/counter']);
  assert.deepEqual(target.containers, [], 'Counter fixture must own no infrastructure');
  const stopped = await project.stopStack({ ...scope, review: review.digest });
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stopOperation.phase, 'stopped');
}

/** Keep the read-only CLI admission and mutation on the same backend artifact. */
export async function upgradePrivateFixtureBackend({ cli, runtimeRoot, commit, status }) {
  const before = await status();
  const directory = path.join(runtimeRoot, 'packages/0/dist');
  const checked = await cli('backend', 'upgrade', directory, '--check');
  assert.equal(checked.checked, true);
  assert.equal(checked.build.commit, commit);
  assert.equal((await status()).pid, before.pid, 'Backend check changed the running backend');
  const changed = await cli('backend', 'upgrade', directory);
  assert.equal(changed.build.commit, commit);
  return { before, changed };
}

/** Cold owner qualification shares the managed-backend fixture and its private OS jobs. */
export async function managedOwnerRoundtrip(context) {
  const { root, projectDirectory, instance, execution, config, units, first, artifact, initialBackend, initialGuardian, managementDist, fixtureId,
    applicationSdk, run, native, domain, linux, until, status, assertActive, render, track, mark, authorizeUnitWrite } = context;
  assert.ok(managementDist, 'An independent candidate runtime is required');
  const candidateRoot = path.resolve(managementDist, '../../..');
  const load = name => import(pathToFileURL(path.join(managementDist, name + '.js')).href);
  const { createDaemonClient, LONG_REQUEST_TIMEOUT } = await load('daemon/daemon-client');
  const { ExecutionClient } = await load('daemon/execution-client');
  const { PidManager } = await load('daemon/pid-manager');
  const quiet = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };
  const api = async work => {
    assertActive();
    // Admission installs and verifies a real application closure. Use the same
    // bounded lifecycle budget as the public CLI, including on external disks.
    const client = createDaemonClient(path.join(instance, 'daemon.sock'), LONG_REQUEST_TIMEOUT);
    try { return await work(client); } finally { await client.disconnect(); }
  };
  const cli = async (...args) => {
    const began = performance.now();
    if (context.localSyncRoundtrip) mark({ stage: 'local-sync-cli-start', command: args.slice(0, 2), at: new Date().toISOString() });
    const result = await run(path.join(candidateRoot, 'node'),
      [path.join(managementDist, 'cli/omnitron.js'), '--json', ...args], {
        cwd: root, env: { ...process.env, OMNITRON_HOME: instance }, timeout: LONG_REQUEST_TIMEOUT, maxBuffer: 2 * 1024 * 1024,
      });
    if (context.localSyncRoundtrip) mark({ stage: 'local-sync-cli-complete', command: args.slice(0, 2), elapsedMs: Math.round(performance.now() - began) });
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true, result.stdout);
    assert.ok(envelope.data, result.stdout);
    return envelope.data;
  };
  const candidate = await cli('backend', 'install', candidateRoot);
  assert.equal(candidate.build.dirty, false);
  assert.equal(first.build.commit, initialBackend.build.commit, 'Initial status does not identify the selected backend');
  const previous = { owner: artifact.runtimeHash, guardian: initialGuardian.runtimeHash,
    backend: initialBackend.runtimeHash, commit: initialBackend.build.commit };
  const installed = hash => path.join(instance, 'runtime/releases', hash);
  const probe = async () => {
    const address = JSON.parse(await fs.readFile(path.join(root, 'address.json'), 'utf8'));
    const response = await fetch(`http://127.0.0.1:${address.port}/health`, { signal: AbortSignal.timeout(1500) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const ready = async (ownerPid, priorPid) => until(async () => {
    const value = await probe();
    assert.equal(value.fixture, fixtureId);
    assert.equal(value.parent, ownerPid);
    if (priorPid) assert.notEqual(value.pid, priorPid);
    return value;
  }, 'The private application did not resume under the expected owner');
  const certificate = () => until(async () => (await status()).execution?.recovery?.status === 'ready', 'Owner recovery certificate');
  const jobPid = async role => {
    const unit = units.find(u => u.mode === role);
    const response = await native(linux ? ['show', unit.job, '--property=MainPID', '--value'] : ['print', unit.job]);
    return Number(linux ? response.stdout.trim() : response.stdout.match(/^\s*pid = (\d+)\s*$/m)?.[1]);
  };
  const history = async () => {
    const { createRequire } = await import('node:module');
    const Database = createRequire(path.join(candidateRoot, 'packages/0/package.json'))('better-sqlite3');
    const db = new Database(path.join(instance, 'data/slave.db'), { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT * FROM migrations ORDER BY name').all(); } finally { db.close(); }
  };
  const retireNative = async (before, priorGuardian) => {
    const priorOwner = before.execution.owner.pid;
    const guardianUnit = units.find(u => u.mode === 'backend');
    await native(linux ? ['stop', guardianUnit.job] : ['bootout', guardianUnit.job]);
    await until(() => !PidManager.isProcessAlive(before.pid) && !PidManager.isProcessAlive(priorGuardian), 'Guardian or backend survived retirement');
    const ownerUnit = units.find(u => u.mode === 'owner');
    if (context.localSyncRoundtrip) {
      // Same native SIGTERM authority as serviceBootout(), restricted to the UUID jobs.
      await native(linux ? ['stop', ownerUnit.job] : ['bootout', ownerUnit.job]);
    } else {
      const owner = new ExecutionClient(path.join(execution, 'owner.sock'), quiet);
      try { await owner.connect(); await owner.acquire(); await owner.shutdownOwner(); } finally { await owner.close(); }
    }
    await until(() => !PidManager.isProcessAlive(priorOwner), 'Previous owner did not stop cleanly');
    const receipt = JSON.parse(await fs.readFile(path.join(execution, 'managed-owner.json'), 'utf8'));
    assert.equal(receipt.clean, true); assert.equal(receipt.pid, priorOwner);
    if (!context.localSyncRoundtrip) await native(linux ? ['stop', ownerUnit.job] : ['bootout', ownerUnit.job]);
  };
  const launchNative = async target => {
    // The public cold-selection command owns compatibility and the installation lease.
    const selected = await cli('backend', 'select', target.backend);
    assert.equal(selected.selection.current, target.backend);
    config.owner.artifact = target.owner;
    config.backend.artifact = target.guardian;
    // Service installation uses the sealed package as its cwd. Qualify that
    // exact boundary: a fork that drops the application's cwd would write into
    // the sealed owner, not merely into another disposable project directory.
    config.cwd = applicationSdk && target.phase !== 'owner-rollback'
      ? path.join(installed(target.owner), 'packages/0') : root;
    await fs.writeFile(path.join(instance, 'runtime/supervision.json'), JSON.stringify(config), { mode: 0o600 });
    for (const unit of units) {
      const runtime = installed(config[unit.mode].artifact);
      const contents = render({ scope: config.scope, execPath: path.join(runtime, 'node'),
        entryPath: path.join(runtime, 'packages/0/dist/daemon/managed-entry.js'), args: [unit.mode], label: config[unit.mode].label,
        nodeArgs: [], restart: unit.mode === 'backend', ...(context.localSyncRoundtrip && unit.mode === 'owner' && { forceKill: false }), workdir: path.join(runtime, 'packages/0'), path: process.env.PATH,
        identity: linux ? { user: 'root', home: process.env.HOME } : undefined,
        environment: { OMNITRON_HOME: instance }, stderrLog: path.join(root, `${unit.mode}.log`) });
      await authorizeUnitWrite(unit, contents);
      await fs.writeFile(unit.file, contents);
      await run(linux ? 'systemd-analyze' : '/usr/bin/plutil', linux ? ['verify', unit.file] : ['-lint', unit.file]);
    }
    if (linux) await native(['daemon-reload']);
    for (const unit of units) {
      await native(linux ? ['start', unit.job] : ['bootstrap', domain, unit.file]);
      track(await until(async () => (await jobPid(unit.mode)) || false, 'New private service PID'));
    }
  };
  const qualifySourceRefresh = async (ownerPid, initialWorker) => {
    const name = 'probe/local/counter', guardianPid = await jobPid('backend');
    const initial = await status();
    assert.equal(initial.execution.ownerCapabilities.sourceRefresh, 1);
    await api(client => client.enableWatch({ apps: [name] }));
    const binding = await until(async () => {
      const watch = await api(client => client.getWatchStatus());
      assert.equal(watch.enabled, true);
      assert.equal(watch.watching, true);
      const source = watch.apps.find(app => app.name === name);
      assert.equal(source?.directory, path.join(projectDirectory, 'source'));
      assert.equal(typeof source.generation, 'string');
      assert.ok(Number.isSafeInteger(source.definitionRevision));
      return source;
    }, 'Dynamically registered classic application has no source binding');
    assert.equal((await api(client => client.getApp({ name }))).pid, initialWorker.pid);
    await fs.writeFile(path.join(projectDirectory, 'sdk-value.json'), '1\n');
    const receipt = await api(client => client.restartAfterChange({ name,
      generation: binding.generation, definitionRevision: binding.definitionRevision }));
    assert.equal(receipt.process.status, 'online');
    assert.equal(receipt.process.name, name);
    assert.notEqual(receipt.process.generation, binding.generation);
    assert.deepEqual(receipt.source, { ...binding, generation: receipt.process.generation });
    let currentWorker = await ready(ownerPid, initialWorker.pid);
    track(currentWorker.pid);
    assert.equal(currentWorker.pid, receipt.process.pid);
    assert.equal(currentWorker.sdkRevision, 1);
    assert.equal(currentWorker.sourceRevision, 0);
    await until(() => !PidManager.isProcessAlive(initialWorker.pid), 'Source refresh retained the previous child');
    const receiptPid = currentWorker.pid, transitions = [];
    for (const target of [
      { phase: 'source-watch-backend-rollback', id: previous.backend, commit: previous.commit },
      { phase: 'source-watch-backend-restore', id: candidate.id, commit: candidate.build.commit },
    ]) {
      await certificate();
      const { before, changed } = await upgradePrivateFixtureBackend({
        cli, runtimeRoot: installed(target.id), commit: target.commit, status,
      });
      const settled = await until(async () => {
        const observed = await status();
        return observed.pid === changed.pid && observed.build.commit === target.commit &&
          observed.execution.recovery.status === 'ready' ? observed : false;
      }, 'Backend did not settle for the source-watch compatibility check');
      track(settled.pid);
      assert.notEqual(settled.pid, before.pid);
      assert.equal(settled.execution.owner.pid, ownerPid, 'Backend replacement changed the source owner');
      assert.equal(await jobPid('backend'), guardianPid, 'Backend replacement changed the guardian');
      assert.equal((await probe()).pid, currentWorker.pid, 'Backend replacement restarted the application');
      if (target.phase === 'source-watch-backend-rollback') {
        const priorPid = currentWorker.pid;
        // A real file event under the previous backend must reach the retained
        // current owner's native watcher. No refresh/restart RPC substitutes.
        await fs.writeFile(path.join(projectDirectory, 'source/value.json'), '2\n');
        currentWorker = await ready(ownerPid, priorPid);
        track(currentWorker.pid);
        assert.equal(currentWorker.sdkRevision, 1);
        assert.equal(currentWorker.sourceRevision, 2);
        await until(() => !PidManager.isProcessAlive(priorPid), 'Native watch retained the previous child');
        await until(async () => {
          const observed = await api(client => client.getApp({ name }));
          assert.equal(observed.pid, currentWorker.pid);
          assert.equal(observed.status, 'online');
          const logs = await api(client => client.getLogs({ name, lines: 100 }));
          assert.ok(logs.some(row => row.message.startsWith(`fixture:${fixtureId}:${currentWorker.pid}:1:2:`)),
            'Previous backend did not expose logs from the source-restarted child');
          return true;
        }, 'Previous backend did not observe the source-restarted process and its logs');
      }
      const observedAfterChange = await status();
      assert.equal(observedAfterChange.pid, settled.pid, 'Source change replaced the backend');
      assert.equal(observedAfterChange.build.commit, target.commit);
      assert.equal(observedAfterChange.execution.owner.pid, ownerPid);
      assert.equal(await jobPid('backend'), guardianPid);
      transitions.push({ ...target, backendPid: settled.pid, ownerPid, guardianPid,
        applicationPid: currentWorker.pid, sdkRevision: currentWorker.sdkRevision,
        sourceRevision: currentWorker.sourceRevision });
      mark({ stage: target.phase, ...transitions.at(-1) });
    }
    return { worker: currentWorker, evidence: { receipt, receiptPid, transitions,
      nativeWatchAfterBackendRollback: true, rpcAndLogsAfterBackendRollback: true } };
  };
  await api(async client => {
    const project = await client.service('OmnitronProject');
    await project.addProject({ name: 'probe', path: projectDirectory });
    await project.startStack({ project: 'probe', stack: 'local', workingTree: true });
  });
  let worker = await ready(first.execution.owner.pid);
  track(first.execution.owner.pid, worker.pid, first.pid, await jobPid('backend'));
  if (context.localSyncRoundtrip) {
    const { managedLocalSyncRoundtrip } = await import('./managed-local-sync-roundtrip.mjs');
    return managedLocalSyncRoundtrip({ ...context, candidate, previous, installed, ready, probe, cli, jobPid, certificate, api,
      retireNative, launchNative, worker, history, load, candidateRoot, lifecycleBudget: LONG_REQUEST_TIMEOUT });
  }
  const originalHistory = await history(), rounds = [];
  let projects, sourceRefresh;
  for (const target of [
    { phase: 'owner-forward', owner: candidate.id, guardian: candidate.id, backend: candidate.id, commit: candidate.build.commit },
    ...(applicationSdk ? [{ phase: 'owner-cold-restart', owner: candidate.id, guardian: candidate.id,
      backend: candidate.id, commit: candidate.build.commit }] : []),
    { phase: 'owner-rollback', ...previous },
  ]) {
    const before = await status(), priorOwner = before.execution.owner.pid, priorGuardian = await jobPid('backend');
    const priorWorker = worker.pid;
    track(priorOwner, priorGuardian, priorWorker, before.pid);
    const checked = await cli('backend', 'select', target.backend, '--check');
    assert.equal(checked.checked, true);
    assert.equal((await status()).execution.owner.pid, priorOwner, 'Read-only compatibility changed ownership');
    await projects?.stop();
    await api(async client => stopPrivateFixtureStack(await client.service('OmnitronProject')));
    await until(() => !PidManager.isProcessAlive(priorWorker), 'Reviewed application did not stop');
    await certificate();
    await retireNative(before, priorGuardian);
    await launchNative(target);
    const after = await until(async () => {
      const value = await status();
      return value.build.commit === target.commit && value.execution.owner.pid !== priorOwner ? value : false;
    }, 'Candidate owner and selected backend did not start');
    track(after.pid, after.execution.owner.pid);
    await certificate();
    assert.deepEqual(await history(), originalHistory, 'Owner replacement rewrote existing migration history');
    const stopped = await api(async client => (await client.service('OmnitronProject')).getStack({ project: 'probe', stack: 'local' }));
    assert.equal(stopped.status, 'stopped');
    assert.ok(!stopped.apps.some(a => a.status === 'online'), 'A stopped stack restarted without explicit intent');
    if (target.phase === 'owner-forward') for (const capability of ['applicationRuntimeResolution', 'executionScopes', 'stoppedStackReconciliation'])
      assert.equal(after.execution.ownerCapabilities[capability], 1);
    await api(async client => (await client.service('OmnitronProject')).startStack({ project: 'probe', stack: 'local', workingTree: true }));
    worker = await ready(after.execution.owner.pid, priorWorker); track(worker.pid);
    if (target.phase === 'owner-forward') {
      const refreshed = await qualifySourceRefresh(after.execution.owner.pid, worker);
      worker = refreshed.worker;
      sourceRefresh = refreshed.evidence;
    }
    if (applicationSdk && target.phase === 'owner-forward') {
      const { prepareManagedProjectRuntime } = await import('./managed-project-runtime.mjs');
      projects = await prepareManagedProjectRuntime({ root, instance, applicationSdk, managementDist,
        candidate, runtime: installed(candidate.id), api, run, until, track, mark });
      await projects.start(after.execution.owner.pid, false);
    } else if (target.phase === 'owner-cold-restart') {
      await projects.start(after.execution.owner.pid, true);
    }
    rounds.push({ ...target, cwd: config.cwd, ownerPid: after.execution.owner.pid, guardianPid: await jobPid('backend'), backendPid: (await status()).pid,
      applicationPid: worker.pid, previousOwnerCleanExit: true, stoppedIntentPreserved: true,
      reviewedInfrastructureEmpty: true, preservedMigrationHistoryRows: originalHistory.length });
    mark({ stage: target.phase, ...rounds.at(-1) });
  }
  const applicationRuntime = await projects?.finish();
  const verifiedLogs = await verifyFixtureLogs({ root, instance, runtime: candidateRoot, fixtureId, until });
  const result = { test: 'managed-owner-roundtrip', platform: process.platform, root, previous, candidate: candidate.build,
    rounds, sourceRefresh, verifiedLogs, ...(applicationRuntime && { applicationRuntime }), liveMutation: false, success: true };
  await fs.writeFile(path.join(root, 'owner-roundtrip.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
