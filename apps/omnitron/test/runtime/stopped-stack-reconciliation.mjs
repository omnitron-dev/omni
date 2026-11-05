/** Native owner contract, using real sealed producer imports and the existing SQLite selection. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkStoppedStackReconciliation(f) {
  const { load, directory, config, scope, entries, installed, loaded, store, manifest, built,
    producer, ownerPackage, waitFor, getClient, getOwnerPid, restartOwner, outside } = f;
  const { LocalReleaseSelection } = await load('project/local-release-selection');
  const { DaemonStateStore } = await load('daemon/daemon-state-store.service');
  const { loadRelease } = await load('release/load');
  const { inspectLocalReleaseInstallation: inspect } = await load('release/local-installation');
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const database = path.join(directory, 'controller-selection.db');
  let db = new DaemonStateStore(logger, database);
  const selection = () => new LocalReleaseSelection(db, scope, 'fixture-registration');
  const namespace = entry => ({ ...entry, name: `${scope.project}/${scope.stack}/${entry.name}`,
    env: { NODE_OPTIONS: '', NODE_PATH: '', OMNITRON_STACK: scope.stack,
      ORIGIN_REPORT: path.join(directory, `reconciliation-${entry.name}`) } });
  const proofs = entry => Promise.all(['main', 'collector'].map(async child =>
    JSON.parse(await fs.readFile(entry.env.ORIGIN_REPORT + '.' + child, 'utf8'))));
  const start = async entry => {
    for (const child of ['main', 'collector']) await fs.rm(entry.env.ORIGIN_REPORT + '.' + child, { force: true });
    await getClient().orchestrator.startApp(entry, config);
    const observed = await waitFor(() => proofs(entry), 'both children of ' + entry.name);
    for (const proof of observed) assert.deepEqual(proof.context.producer, producer);
    return observed;
  };
  const stop = async () => {
    const plan = await getClient().orchestrator.inspectStackExecution(scope);
    await getClient().orchestrator.stopStackExecution({ operationId: randomUUID(), plan });
    return getClient().orchestrator.inspectStackExecution(scope);
  };
  try {
    selection().select(0, { id: loaded.id, manifestSha256: loaded.manifestSha256 });
    const mirror = namespace(installed[1]);
    await start(mirror);
    await start(outside);
    await getClient().refresh();
    const outsideBefore = getClient().orchestrator.getApp(outside.name);
    assert.equal(outsideBefore.status, 'online');

    // A new consumer selects a subset. Its producer artifact and complete SDK remain byte-identical.
    const reducedManifest = { ...manifest, id: 'consumer-reduced-fixture', artifacts: [manifest.artifacts[0]] };
    const reducedRoot = path.join(store, reducedManifest.id);
    await fs.mkdir(path.join(reducedRoot, 'artifacts'), { recursive: true });
    await fs.copyFile(built.path, path.join(reducedRoot, 'artifacts', `collector-${built.version}.tar.gz`));
    await fs.writeFile(path.join(reducedRoot, 'manifest.json'), JSON.stringify(reducedManifest));
    const reduced = await loadRelease(reducedManifest.id, store);
    const prepare = async (release, declarations) => inspect(release, scope.stack, declarations,
      { prepare: true, ownerPid: getOwnerPid(), ownerPackage });
    const [target] = (await prepare(reduced, [entries[0]])).map(namespace);
    const plan = await stop();
    selection().select(1, { id: reduced.id, manifestSha256: reduced.manifestSha256 });
    const receipt = await getClient().orchestrator.reconcileStoppedStack({ operationId: randomUUID(), plan, entries: [target] });
    assert.deepEqual(receipt.retired, [mirror.name]);
    assert.equal(getClient().orchestrator.getHandle(mirror.name), undefined);
    assert.equal(await getClient().orchestrator.startKnownApp(mirror.name), undefined);
    await getClient().orchestrator.enableStackExecution(scope);
    const forward = await start(target);
    for (const proof of forward) assert.equal(proof.context.consumer.manifestSha256, reduced.manifestSha256);
    await getClient().refresh();
    assert.equal(getClient().orchestrator.getApp(outside.name).generation, outsideBefore.generation,
      'Graph reconciliation must not restart an application of another stack');
    const ownerBeforeColdStart = getOwnerPid();

    // A deliberate stop survives an actual owner exit and a controller SQLite reopen.
    await stop();
    await db.dispose();
    await restartOwner();
    assert.notEqual(getOwnerPid(), ownerBeforeColdStart);
    db = new DaemonStateStore(logger, database);
    const selected = selection().read();
    assert.deepEqual(selected, { revision: 2, release: { id: reduced.id, manifestSha256: reduced.manifestSha256 } });
    const coldPlan = await getClient().orchestrator.inspectStackExecution(scope);
    assert.equal(coldPlan.phase, 'stopped');
    assert.deepEqual(coldPlan.apps, []);
    await assert.rejects(getClient().orchestrator.enableStackExecution(scope, { automatic: true }), /deliberately stopped/);
    const coldRelease = await loadRelease(selected.release.id, store);
    const coldEntries = (await prepare(coldRelease, [entries[0]])).map(namespace);
    await getClient().orchestrator.reconcileStoppedStack({ operationId: randomUUID(), plan: coldPlan, entries: coldEntries });
    await getClient().orchestrator.enableStackExecution(scope);
    const cold = await start(coldEntries[0]);
    assert.equal(getClient().orchestrator.getApp(mirror.name), null);

    // Explicit rollback recreates the retired alias from the original sealed consumer.
    const rollbackPlan = await stop();
    const rollbackEntries = (await prepare(loaded, entries)).map(namespace);
    selection().select(2, { id: loaded.id, manifestSha256: loaded.manifestSha256 });
    const rollback = await getClient().orchestrator.reconcileStoppedStack({ operationId: randomUUID(), plan: rollbackPlan, entries: rollbackEntries });
    assert.deepEqual(rollback.added, [mirror.name]);
    await getClient().orchestrator.enableStackExecution(scope);
    for (const entry of rollbackEntries) {
      const restored = await start(entry);
      for (const proof of restored) assert.equal(proof.context.consumer.manifestSha256, loaded.manifestSha256);
    }
    await getClient().refresh();
    assert.deepEqual(getClient().orchestrator.list({ prefix: `${scope.project}/${scope.stack}/` }).map(app => app.name).sort(),
      rollbackEntries.map(entry => entry.name).sort());
    assert.equal(selection().read().revision, 3);
    return { forward: receipt, coldStart: { ownerBefore: ownerBeforeColdStart, ownerAfter: getOwnerPid(),
      selection: selected, producerPreserved: true, children: cold.map(proof => proof.pid) },
      rollback, outsideGenerationPreservedDuringReconciliation: outsideBefore.generation,
      producerArtifactAndSdkUnchanged: true, success: true };
  } finally { await db.dispose(); }
}
