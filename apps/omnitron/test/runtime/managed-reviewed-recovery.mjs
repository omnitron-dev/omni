import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const moduleAt = (dist, file) => import(pathToFileURL(path.join(dist, file)).href);
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** These modules run outside the repository ESM boundary, in a private fixture. */
export async function prepareRecoveryTopology(root, ownerDist) {
  const { resolveInstalledDependency } = await moduleAt(ownerDist, 'release/package-resolution.js');
  const titan = await resolveInstalledDependency(path.dirname(ownerDist), '@omnitron-dev/titan');
  assert.ok(titan, 'The native owner fixture needs its actual application SDK');
  const packages = path.join(root, 'node_modules/@omnitron-dev');
  await fs.mkdir(packages, { recursive: true });
  await fs.symlink(titan, path.join(packages, 'titan'));
  await fs.writeFile(path.join(root, 'Pool.mjs'), `
import { Module, Service, Public } from '@omnitron-dev/titan/decorators';
import os from 'node:os';
class Counter { count=0; snapshot(){return {pid:process.pid,parent:process.ppid,count:++this.count,temporary:os.tmpdir()};} }
Public()(Counter.prototype,'snapshot',Object.getOwnPropertyDescriptor(Counter.prototype,'snapshot'));
Service({name:'FixtureRecoveryPool'})(Counter);
class FixtureModule {};
Module({name:'FixtureRecoveryModule',providers:[Counter],exports:[Counter]})(FixtureModule);
export default FixtureModule;
`);
  await fs.writeFile(path.join(root, 'topology.mjs'), `export default {name:'topology',processes:[
{name:'pool',module:'./Pool.mjs',instances:2,scaling:{strategy:'fixed',maxInstances:2},topology:{expose:true}}]};\n`);
}

/** Exercise the real receiving guardian after a controller disappears on its
 * committed grant and ordinary request-count recycling changes pool membership.
 * Fault injection uses the same prepare/retire/commit APIs as the coordinator;
 * it never edits a checkpoint, inventory digest, registry or guardian guard. */
export async function managedReviewedRecovery(context) {
  const { root, instance, execution, units, first, initialBackend, initialGuardian, managementDist,
    ownerClient, applicationPid, probe, status, until, run, mark, authorizeReplacement } = context;
  const { createDaemonClient } = await moduleAt(initialBackend.directory, 'daemon/daemon-client.js');
  const { privateControlClient } = await moduleAt(initialBackend.directory, 'daemon/private-control-client.js');
  const { PidManager } = await moduleAt(initialBackend.directory, 'daemon/pid-manager.js');
  const { RuntimeInstallation } = await moduleAt(managementDist, 'daemon/runtime-installation.js');
  const { prepareSupervisorTransition, applySupervisorTransition } = await moduleAt(managementDist, 'daemon/supervisor-transition.js');
  const socket = path.join(instance, 'daemon.sock');
  const client = createDaemonClient(socket, 30_000);
  let pool, control, originalFile, originalBytes, accepted;
  try {
    await client.startApp({ name: 'topology' });
    pool = await until(async () => {
      for (const name of await fs.readdir(path.join(execution, 'topology'))) {
        let connection;
        try {
          connection = await privateControlClient(path.join(execution, 'topology', name, 'rpc.sock'), 'FixtureRecoveryPool');
          await connection.service.snapshot(); return connection;
        } catch { await connection?.close(); }
      }
    }, 'The real topology pool did not become available');
    const initialWorkers = new Set();
    for (let i = 0; i < 16; i++) {
      const worker = await pool.service.snapshot();
      assert.equal(worker.temporary, path.join(root, 't'), 'A native pool inherited a shared temporary namespace');
      initialWorkers.add(worker.pid);
    }
    assert.equal(initialWorkers.size, 2);
    await until(async () => (await status()).execution.recovery.status === 'ready', 'No pre-fault recovery certificate');
    const address = await (await client.service('OmnitronBackend')).controlAddress();
    control = await privateControlClient(address.socket, 'OmnitronBackendControl');
    const installation = await RuntimeInstallation.open(instance, { existing: true });
    try {
      await installation.exclusive(async () => {
        const preparation = await control.service.prepare({ candidateId: randomUUID() });
        originalFile = preparation.file;
        originalBytes = await fs.readFile(originalFile);
        const original = JSON.parse(originalBytes);
        assert.equal(original.previousPid, first.pid);
        installation.beginActivation(initialGuardian.runtimeHash, initialBackend.runtimeHash, originalFile);
        await control.service.retire({ ticketId: preparation.ticketId });
        // This one-shot private child simulates the candidate dying immediately
        // after committing its grant, before opening public ingress or replaying logs.
        const fault = path.join(root, 'commit-and-exit.mjs');
        await fs.writeFile(fault, `
import fs from 'node:fs/promises';
import {createNullLogger} from '@omnitron-dev/titan/module/logger';
import {ExecutionClient} from ${JSON.stringify(pathToFileURL(path.join(initialGuardian.directory, 'daemon/execution-client.js')).href)};
const record=JSON.parse(await fs.readFile(${JSON.stringify(originalFile)},'utf8'));
const client=new ExecutionClient(${JSON.stringify(path.join(execution, 'owner.sock'))},createNullLogger(),record.state.ticket.to.controllerId);
try {await client.connect(); await client.accept(record.state.ticket,record.state.executionInventory);}
finally {await client.close();}
process.exit(55);
`);
        await assert.rejects(run(initialGuardian.execPath, [fault], {
          cwd: root, env: process.env, timeout: 30_000, maxBuffer: 1024 * 1024,
        }), error => error.code === 55);
        const committed = await ownerClient.service.snapshot();
        assert.deepEqual(committed.status.controller, original.state.ticket.to);
        assert.deepEqual(committed.status.pending, original.state.ticket);
        assert.equal(committed.status.phase, 'active');
        // Same production recycling exercised by backend-handoff.mjs. No scale,
        // app restart, owner mutation or OS signal is used to change membership.
        const recyclingDeadline = Date.now() + 90_000;
        let requests = 0;
        while (requests < 24_000) {
          assert.ok(Date.now() < recyclingDeadline, 'Request-count recycling deadline');
          const replies = await Promise.all(Array.from({ length: 16 }, () => pool.service.snapshot()));
          for (const reply of replies) assert.equal(reply.parent, first.execution.owner.pid);
          requests += replies.length;
        }
        accepted = await until(async () => {
          const replies = await Promise.all(Array.from({ length: 16 }, () => pool.service.snapshot()));
          if (replies.some(reply => initialWorkers.has(reply.pid)) || [...initialWorkers].some(pid => PidManager.isProcessAlive(pid))) return null;
          const observed = await ownerClient.service.snapshot();
          return observed.inventoryDigest !== original.state.executionInventory ? observed : null;
        }, 'Request-count recycling did not change the real pool membership', Math.max(1, recyclingDeadline - Date.now()));
        assert.deepEqual(accepted.status.controller, original.state.ticket.to);
        assert.deepEqual(accepted.status.pending, original.state.ticket);
        assert.equal((await probe()).pid, applicationPid);
        mark({ stage: 'committed-controller-fault', checkpoint: originalFile, originalCheckpointSha256: sha256(originalBytes),
          beforeInventory: original.state.executionInventory, acceptedInventory: accepted.inventoryDigest, poolRequests: requests });
      });
    } finally { await installation.close(); }
    const supervisor = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor', 300_000);
    try {
      await until(async () => !(await supervisor.service.status()).operationPending, 'Previous guardian did not settle after the fault');
      await assert.rejects(supervisor.service.recover({ checkpoint: originalFile }), /inventory changed|stale project ownership/i);
    } finally { await supervisor.close(); }
    const plan = await prepareSupervisorTransition(path.resolve(managementDist, '../../..'), undefined, { recoveryCheckpoint: originalFile });
    const prepared = JSON.parse(await fs.readFile(plan.file, 'utf8'));
    assert.equal(prepared.recovery.historicalExecutionDelta, 'unknown');
    assert.equal(prepared.recovery.inventoryDigest, accepted.inventoryDigest);
    const beforeCheck = await fs.readFile(plan.file);
    const runner = path.resolve(managementDist, '../../../node');
    const checked = await run(runner, [path.join(managementDist, 'cli/omnitron.js'), 'backend', 'guardian', 'apply', plan.file, '--check', '--json'], {
      cwd: root, env: process.env, timeout: 300_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(JSON.parse(checked.stdout).data.checked, true);
    assert.deepEqual(await fs.readFile(plan.file), beforeCheck);
    await authorizeReplacement(units, plan.file, prepared, instance);
    mark({ stage: 'reviewed-guardian-transition', plan: plan.file });
    if (context.writerExit) {
      // Run the same CLI as the operator. Every command targets this private instance.
      const cli = (...args) => run(runner, [path.join(managementDist, 'cli/omnitron.js'), 'backend', ...args, '--json'],
        { cwd: root, env: process.env, timeout: 360_000, maxBuffer: 1024 * 1024 });
      const rejection = async (args, pattern) => {
        let refusal;
        await assert.rejects(cli(...args), error => {
          const reply = JSON.parse(error.stderr.trim().split('\n').at(-1));
          assert.equal(reply.ok, false); assert.match(reply.error, pattern);
          refusal = reply.error;
          return error.code === 1;
        });
        return refusal;
      };
      const firstRefusal = await rejection(['guardian', 'apply', plan.file], /recovery failed/i);
      const fault = JSON.parse(await fs.readFile(path.join(root, 'writer-exit.json')));
      assert.ok(fault.pid > 0 && !PidManager.isProcessAlive(fault.pid));
      assert.equal(fault.owner.id, first.execution.owner.id);
      assert.equal(fault.owner.pid, first.execution.owner.pid);
      assert.equal(fault.epoch, prepared.recovery.controller.epoch + 1);
      const { BackendRecoveryJournal } = await moduleAt(managementDist, 'daemon/backend-recovery-journal.js');
      const evidence = async () => {
        const view = await ownerClient.service.snapshot();
        const installation = await RuntimeInstallation.openReadOnly(instance);
        const journal = new BackendRecoveryJournal(execution, { readOnly: true });
        try {
          const saved = journal.read();
          const certificate = saved?.status === 'ready' ? saved.record : saved?.previous;
          const activation = installation.activation();
          assert.equal(activation.reviewedRecovery.phase, 'unconfirmed');
          assert.equal(activation.reviewedRecovery.checkpoint, fault.checkpoint);
          assert.equal(activation.reviewedRecovery.planId, prepared.id);
          assert.equal(certificate?.previousPid, fault.pid, 'Missing journal certificate from the exited writer');
          assert.deepEqual(certificate.controller, view.status.controller);
          assert.equal(certificate.registryDigest, prepared.recovery.registryDigest);
          assert.equal(certificate.runtimeHash, initialBackend.runtimeHash);
          const derived = JSON.parse(await fs.readFile(fault.checkpoint));
          assert.equal(derived.reviewedRecovery.originalCheckpointSha256, sha256(originalBytes));
          assert.deepEqual(view.status.pending, derived.state.ticket);
          assert.deepEqual(view.status.controller, derived.state.ticket.to);
          assert.equal(view.status.phase, 'active');
          assert.equal(view.inventoryDigest, accepted.inventoryDigest);
          assert.deepEqual(await fs.readFile(originalFile), originalBytes);
          assert.equal((await probe()).pid, applicationPid);
          return { activation, selection: installation.selection(), grant: view.status.controller,
            owner: view.status.owner, inventory: view.inventoryDigest, journalStatus: saved.status,
            journalReason: saved.status === 'invalid' ? saved.reason : null, certificate: sha256(JSON.stringify(certificate)),
            checkpoint: sha256(await fs.readFile(fault.checkpoint)), plan: sha256(await fs.readFile(plan.file)) };
        } finally { await installation.close(); await journal.close(); }
      };
      const before = await evidence();
      const check = await rejection(['guardian', 'apply', plan.file, '--check'], /already started/i);
      const repeat = await rejection(['guardian', 'apply', plan.file], /earlier attempt|not held by this exact plan/i);
      const ordinary = await rejection(['recover', fault.checkpoint], /held|reviewed recovery/i);
      assert.deepEqual(await evidence(), before, 'A refused command modified ownership or its receipts');
      return { outcome: 'unconfirmed', ownerPid: before.owner.pid, applicationPid, exitedBackendPid: fault.pid,
        epoch: fault.epoch, hold: before.activation.reviewedRecovery.phase, revision: before.selection.revision,
        certificateState: before.journalStatus, certificateReason: before.journalReason,
        originalCheckpointSha256: sha256(originalBytes), derivedCheckpointSha256: before.checkpoint,
        firstRefusal, refusals: { check, repeat, ordinary }, preserved: true };
    }
    const result = await applySupervisorTransition(plan.file);
    assert.equal(result.phase, 'complete');
    const restored = await status();
    assert.equal(restored.build.commit, initialBackend.build.commit);
    assert.notEqual(restored.pid, first.pid);
    assert.equal(restored.execution.owner.pid, first.execution.owner.pid);
    assert.equal(restored.execution.owner.id, first.execution.owner.id);
    assert.equal((await probe()).pid, applicationPid);
    assert.equal((await ownerClient.service.snapshot()).inventoryDigest, accepted.inventoryDigest);
    assert.deepEqual(await fs.readFile(originalFile), originalBytes, 'Recovery changed the original checkpoint');
    const state = await RuntimeInstallation.openReadOnly(instance);
    try {
      assert.equal(state.activation(), null);
      assert.equal(state.selection().current, initialBackend.runtimeHash);
    } finally { await state.close(); }
    assert.equal((await applySupervisorTransition(plan.file)).result.backendPid, restored.pid,
      'Repeating a complete plan started another backend');
    return { ownerPid: first.execution.owner.pid, applicationPid, originalBackendPid: first.pid, restoredBackendPid: restored.pid,
      originalCheckpointSha256: sha256(originalBytes), acceptedInventory: accepted.inventoryDigest,
      historicalExecutionDelta: 'unknown', oldAutomaticRecoveryRefused: true, repeatedApplyPreservedBackend: true };
  } finally { await Promise.all([client.disconnect(), pool?.close(), control?.close()]); }
}
