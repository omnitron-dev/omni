import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyFixtureLogs } from './fixture-log-evidence.mjs';

/** Cold owner qualification shares the managed-backend fixture and its private OS jobs. */
export async function managedOwnerRoundtrip(context) {
  const { root, projectDirectory, instance, execution, config, units, first, artifact, initialBackend, initialGuardian, managementDist, fixtureId,
    applicationSdk, run, native, domain, linux, until, status, assertActive, render, track, mark, authorizeUnitWrite } = context;
  assert.ok(managementDist, 'An independent candidate runtime is required');
  const candidateRoot = path.resolve(managementDist, '../../..');
  const load = name => import(pathToFileURL(path.join(managementDist, name + '.js')).href);
  const { createDaemonClient } = await load('daemon/daemon-client');
  const { ExecutionClient } = await load('daemon/execution-client');
  const { PidManager } = await load('daemon/pid-manager');
  const quiet = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };
  const api = async work => {
    assertActive();
    const client = createDaemonClient(path.join(instance, 'daemon.sock'), 60_000);
    try { return await work(client); } finally { await client.disconnect(); }
  };
  const cli = async (...args) => {
    const result = await run(path.join(candidateRoot, 'node'),
      [path.join(managementDist, 'cli/omnitron.js'), '--json', ...args], {
        cwd: root, env: { ...process.env, OMNITRON_HOME: instance }, timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
      });
    const envelope = JSON.parse(result.stdout);
    assert.notEqual(envelope.success, false, result.stdout);
    assert.ok(envelope.data, result.stdout);
    return envelope.data;
  };
  const candidate = await cli('backend', 'install', candidateRoot);
  assert.equal(candidate.build.dirty, false);
  const previous = { owner: artifact.runtimeHash, guardian: initialGuardian.runtimeHash,
    backend: initialBackend.runtimeHash, commit: first.build.commit };
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
  await api(async client => {
    const project = await client.service('OmnitronProject');
    await project.addProject({ name: 'probe', path: projectDirectory });
    await project.startStack({ project: 'probe', stack: 'local', workingTree: true });
  });
  let worker = await ready(first.execution.owner.pid);
  track(first.execution.owner.pid, worker.pid, first.pid, await jobPid('backend'));
  const originalHistory = await history(), rounds = [];
  let projects;
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
    await api(async client => {
      const project = await client.service('OmnitronProject');
      const review = await project.reviewStackStop({ project: 'probe', stack: 'local', keepInfrastructure: true });
      assert.equal(review.keepInfrastructure, true); assert.ok(review.digest);
      assert.deepEqual(review.targets.flatMap(t => t.applications), ['probe/local/counter']);
      const stopped = await project.stopStack({ project: 'probe', stack: 'local', keepInfrastructure: true, review: review.digest });
      assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stopOperation.phase, 'stopped');
    });
    await until(() => !PidManager.isProcessAlive(priorWorker), 'Reviewed application did not stop');
    await certificate();
    const guardianUnit = units.find(u => u.mode === 'backend');
    await native(linux ? ['stop', guardianUnit.job] : ['bootout', guardianUnit.job]);
    await until(() => !PidManager.isProcessAlive(before.pid) && !PidManager.isProcessAlive(priorGuardian), 'Guardian or backend survived retirement');
    const owner = new ExecutionClient(path.join(execution, 'owner.sock'), quiet);
    try { await owner.connect(); await owner.acquire(); await owner.shutdownOwner(); } finally { await owner.close(); }
    await until(() => !PidManager.isProcessAlive(priorOwner), 'Previous owner did not stop cleanly');
    const receipt = JSON.parse(await fs.readFile(path.join(execution, 'managed-owner.json'), 'utf8'));
    assert.equal(receipt.clean, true); assert.equal(receipt.pid, priorOwner);
    const ownerUnit = units.find(u => u.mode === 'owner');
    await native(linux ? ['stop', ownerUnit.job] : ['bootout', ownerUnit.job]);
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
        nodeArgs: [], restart: unit.mode === 'backend', workdir: path.join(runtime, 'packages/0'), path: process.env.PATH,
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
    if (applicationSdk && target.phase === 'owner-forward') {
      const { prepareManagedProjectRuntime } = await import('./managed-project-runtime.mjs');
      projects = await prepareManagedProjectRuntime({ root, instance, applicationSdk, managementDist,
        candidate, runtime: installed(candidate.id), api, run, until, track, mark });
      await projects.start(after.execution.owner.pid, false);
    } else if (target.phase === 'owner-cold-restart') {
      await projects.start(after.execution.owner.pid, true);
    }
    rounds.push({ ...target, cwd: config.cwd, ownerPid: after.execution.owner.pid, guardianPid: await jobPid('backend'), backendPid: after.pid,
      applicationPid: worker.pid, previousOwnerCleanExit: true, stoppedIntentPreserved: true, preservedMigrationHistoryRows: originalHistory.length });
    mark({ stage: target.phase, ...rounds.at(-1) });
  }
  const applicationRuntime = await projects?.finish();
  const verifiedLogs = await verifyFixtureLogs({ root, instance, runtime: candidateRoot, fixtureId, until });
  const result = { test: 'managed-owner-roundtrip', platform: process.platform, root, previous, candidate: candidate.build,
    rounds, verifiedLogs, ...(applicationRuntime && { applicationRuntime }), liveMutation: false, success: true };
  await fs.writeFile(path.join(root, 'owner-roundtrip.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
