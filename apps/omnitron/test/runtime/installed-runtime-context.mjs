/** A real imported bootstrap, its own SDK, and an independently started process owner.
 * node installed-runtime-context.mjs <new-dist> <owner-dist> <dependency-checkout> [--legacy-owner]
 * Historical owners may run the application while honestly reporting no receipt capability.
 */
import assert from 'node:assert/strict';
import { fork, exec as execCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const dist = await fs.realpath(path.resolve(process.argv[2] ?? 'dist'));
const ownerDist = await fs.realpath(path.resolve(process.argv[3] ?? dist));
const dependencyCheckout = await fs.realpath(path.resolve(process.argv[4] ?? path.join(dist, '../../..')));
const legacy = process.argv.includes('--legacy-owner');
const ownerPackage = path.dirname(ownerDist), adapterPackage = path.dirname(dist);
const load = name => import(pathToFileURL(path.join(dist, name + '.js')));
const { ExecutionClient } = await load('daemon/execution-client');
const { DEFAULT_ECOSYSTEM, DEFAULT_DAEMON_CONFIG } = await load('config/defaults');
const { ArtifactBuilder } = await load('project/artifact-builder');
const { inspectLocalReleaseInstallation: inspect } = await load('release/local-installation');
const { targetRuntime } = await load('release/target-runtime');
const { sealReleaseArtifactCommand, installedReleaseCheckCommand } = await load('release/runtime-provenance');
const { loadRelease } = await load('release/load');
const exec = promisify(execCallback);
const hash = value => createHash('sha256').update(value).digest('hex');
const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omni-installed-origin-')));
const config = { ...DEFAULT_ECOSYSTEM, apps: [] };
const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };
const client = new ExecutionClient(path.join(directory, 'owner.sock'), logger);
let owner, ownerExit;
const report = { test: 'installed-runtime-origin', node: process.version, dist, ownerDist, directory, legacy };
const waitFor = async (read, label) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Timed out waiting for ' + label + '; inspect ' + directory + '/owner.log');
};
try {
  const boot = path.join(directory, 'boot.json');
  await fs.writeFile(boot, JSON.stringify({ directory, cwd: directory, config,
    daemonConfig: { ...DEFAULT_DAEMON_CONFIG, logDir: path.join(directory, 'logs') } }), { mode: 0o600 });
  const log = await fs.open(path.join(directory, 'owner.log'), 'a', 0o600);
  owner = fork(path.join(ownerDist, 'daemon/execution-entry.js'), [boot], {
    cwd: directory, execArgv: [], detached: true,
    env: { ...process.env, OMNITRON_HOME: directory, NODE_OPTIONS: '', NODE_PATH: '' },
    stdio: ['ignore', log.fd, log.fd, 'ipc'],
  });
  await log.close(); ownerExit = once(owner, 'exit');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Private owner startup timed out')), 30_000);
    owner.once('error', reject);
    owner.once('exit', code => { clearTimeout(timer); reject(Error('Private owner exited ' + code)); });
    owner.once('message', value => { clearTimeout(timer); assert.equal(value.type, 'execution-ready'); resolve(); });
  });
  const connected = await client.connect(); await client.acquire();
  report.ownerBuild = connected.ownerBuild; report.ownerPid = owner.pid;
  assert.equal(connected.capabilities?.installedStackStart === 1, !legacy,
    'The requested owner contract must be explicit; do not silently weaken this test');

  const application = path.join(directory, 'source');
  await fs.mkdir(path.join(application, 'dist'), { recursive: true });
  const request = createRequire(path.join(dist, 'index.js'));
  const titan = await fs.realpath(path.join(adapterPackage, 'node_modules/@omnitron-dev/titan'));
  for (const [name, target] of [['@omnitron-dev/titan', titan], ['@omnitron-dev/omnitron', adapterPackage]]) {
    const link = path.join(application, 'node_modules', name);
    await fs.mkdir(path.dirname(link), { recursive: true }); await fs.symlink(target, link, 'dir');
  }
  assert(request.resolve('@omnitron-dev/titan').startsWith(titan + path.sep));
  await fs.writeFile(path.join(application, 'package.json'), JSON.stringify({ name: 'runtime-origin-fixture', version: '1.0.0',
    type: 'module', files: ['dist'], dependencies: { '@omnitron-dev/titan': '*', '@omnitron-dev/omnitron': '*' } }));
  await fs.writeFile(path.join(application, 'dist/bootstrap.js'), `
import { defineSystem } from '@omnitron-dev/omnitron/config';
export default defineSystem({name:'original',version:'1.0.0',processes:[{name:'main',module:'./main.js'},{name:'collector',module:'./collector.js'}]});
`);
  for (const child of ['main', 'collector']) await fs.writeFile(path.join(application, 'dist', child + '.js'), `
import fs from 'node:fs';
import { Module } from '@omnitron-dev/titan';
import { createToken } from '@omnitron-dev/titan/nexus';
import { RUNTIME_CONTEXT } from '@omnitron-dev/omnitron/runtime';
const proof = createToken('fixture.runtime-proof');
class RuntimeProbe {}
Module({providers:[[proof,{inject:[RUNTIME_CONTEXT],useFactory:context=>{
  fs.writeFileSync(process.env.ORIGIN_REPORT + '.${child}',JSON.stringify({pid:process.pid,context}));
  return context;
}}]]})(RuntimeProbe);
export default RuntimeProbe;
`);
  const built = await new ArtifactBuilder(directory, path.join(directory, 'archives')).buildApp(
    { name: 'original', cwd: application, bootstrap: 'dist/bootstrap.js' },
    { skipBuild: true, releaseCheckouts: [directory, adapterPackage, dependencyCheckout] });
  const target = await targetRuntime();
  // These identities are fixture declarations, not a qualified public release.
  const producer = { id: 'producer-fixture', project: { repo: 'fixture-project', commit: 'a'.repeat(40) },
    omni: { repo: 'fixture-framework', commit: 'b'.repeat(40) },
    artifacts: [{ app: 'original', version: built.version, sha256: built.tarballSha256, bytes: built.size,
      launch: built.launch, packageSource: { directory: 'apps/original', manifestBlob: 'c'.repeat(40), migrations: {} } }],
    gates: [{ name: 'fixture', status: 'passed' }], builtWith: { omnitron: '0.3.1', packages: [], target },
    builtAt: new Date().toISOString() };
  const manifestJson = JSON.stringify(producer), producerHash = hash(manifestJson);
  const origin = { release: producer.id, manifestSha256: producerHash, app: 'original' };
  const aliases = ['collector', 'mirror'];
  const manifest = { ...producer, id: 'consumer-fixture', omni: { ...producer.omni, commit: 'd'.repeat(40) },
    artifacts: aliases.map(app => ({ ...producer.artifacts[0], app, origin })), imports: [{ sha256: producerHash, manifestJson }] };
  const store = path.join(directory, 'releases'), releaseRoot = path.join(store, manifest.id);
  await fs.mkdir(path.join(releaseRoot, 'artifacts'), { recursive: true });
  for (const app of aliases) await fs.copyFile(built.path, path.join(releaseRoot, 'artifacts', `${app}-${built.version}.tar.gz`));
  await fs.writeFile(path.join(releaseRoot, 'manifest.json'), JSON.stringify(manifest));
  const loaded = await loadRelease(manifest.id, store);
  const entries = aliases.map(name => ({ name, releaseFrom: origin }));
  const preparation = { prepare: true, ownerPid: owner.pid, ownerPackage };
  const [installed, concurrent] = await Promise.all([1, 2].map(() => inspect(loaded, 'local', entries, preparation)));
  assert.equal(installed[0].releaseRoot, concurrent[0].releaseRoot);
  assert.notEqual(installed[0].releaseRoot, installed[1].releaseRoot, 'aliases have distinct immutable receipts');
  const firstRoot = installed[0].releaseRoot;
  const firstReceipt = JSON.parse(await fs.readFile(path.join(firstRoot, '.omnitron-release.json'), 'utf8'));
  assert.equal(firstReceipt.version, 2);
  assert.equal(firstReceipt.origin.manifestSha256, producerHash);
  assert.equal(firstReceipt.origin.runtimeOrigin.consumer.manifestSha256, loaded.manifestSha256);
  const anotherOwner = path.join(directory, 'another-owner'); await fs.mkdir(anotherOwner);
  const [rebound] = await inspect(loaded, 'local', [entries[0]], { ...preparation, ownerPackage: anotherOwner });
  assert.notEqual(firstRoot, rebound.releaseRoot, 'owner binding changes cannot rewrite a live installation');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(firstRoot, '.omnitron-release.json'), 'utf8')), firstReceipt);
  report.concurrentPreparation = true; report.aliasBindings = true; report.ownerBindingPreserved = true;

  const scope = { project: 'consumer', stack: 'local' };
  const runtimeEntry = { ...installed[0], name: 'consumer/local/collector',
    env: { NODE_OPTIONS: '', NODE_PATH: '', OMNITRON_STACK: 'local', ORIGIN_REPORT: path.join(directory, 'app-origin.json') } };
  await client.orchestrator.startApp(runtimeEntry, config);
  const readProofs = () => Promise.all(['main', 'collector'].map(async child => JSON.parse(await fs.readFile(runtimeEntry.env.ORIGIN_REPORT + '.' + child, 'utf8'))));
  const [proof, collectorProof] = await waitFor(readProofs, 'both topology child runtime origins');
  assert.notEqual(proof.pid, collectorProof.pid);
  assert.deepEqual(proof.context.producer, collectorProof.context.producer);
  assert.deepEqual(proof.context.consumer, collectorProof.context.consumer);
  report.collectorPid = collectorProof.pid;
  assert.equal(proof.context.state, 'verified'); assert.equal(proof.context.basis, 'verified-installed-runtime');
  assert.equal(proof.context.ownerAttestation, null);
  assert.equal(proof.context.producer.producerApp, 'original'); assert.equal(proof.context.producer.manifestSha256, producerHash);
  assert.equal(proof.context.producer.frameworkCommit, producer.omni.commit);
  assert.equal(proof.context.consumer.app, 'collector'); assert.equal(proof.context.consumer.manifestSha256, loaded.manifestSha256);
  await client.refresh();
  const observed = client.orchestrator.list().find(app => app.name === runtimeEntry.name);
  assert.equal(observed?.release?.state, legacy ? 'unreported' : 'confirmed');
  if (!legacy) {
    assert.deepEqual(observed.release.consumer, { releaseId: loaded.id, manifestSha256: loaded.manifestSha256, app: 'collector' });
    assert.equal(observed.release.releaseId, producer.id, 'the producer remains distinct from its selected consumer');
  }
  report.applicationPid = proof.pid; report.ownerReceiptState = observed.release.state; report.eagerRuntimeContext = proof.context;
  assert.equal(client.state().owner.pid, owner.pid);
  if (legacy) {
    await assert.rejects(client.orchestrator.inspectInstalledStack(scope), /does not support installed stack start/);
    report.installedStackStart = 'unsupported by historical owner; not claimed';
    await client.orchestrator.stopApp(runtimeEntry.name);
    for (const child of ['main', 'collector']) await fs.unlink(runtimeEntry.env.ORIGIN_REPORT + '.' + child);
    assert(await client.orchestrator.startKnownApp(runtimeEntry.name));
    const [started, collectorStarted] = await waitFor(readProofs, 'ordinary retained application start');
    assert.notEqual(started.pid, proof.pid); assert.notEqual(collectorStarted.pid, collectorProof.pid);
    assert.deepEqual(started.context.producer, proof.context.producer);
    assert.deepEqual(collectorStarted.context.producer, collectorProof.context.producer);
    assert.equal(client.state().owner.pid, owner.pid);
    report.ordinaryRetainedStart = true;
    report.restartedApplicationPid = started.pid;
    report.restartedCollectorPid = collectorStarted.pid;
  } else {
    const stop = { operationId: randomUUID(), plan: await client.orchestrator.inspectStackExecution(scope) };
    await client.orchestrator.stopStackExecution(stop);
    for (const child of ['main', 'collector']) await fs.unlink(runtimeEntry.env.ORIGIN_REPORT + '.' + child);
    const start = { operationId: randomUUID(), plan: await client.orchestrator.inspectInstalledStack(scope) };
    await client.orchestrator.openInstalledStack(start);
    await client.orchestrator.resumeInstalledApp({ ...start, name: runtimeEntry.name });
    const [restarted] = await waitFor(readProofs, 'installed restart');
    assert.notEqual(restarted.pid, proof.pid); assert.deepEqual(restarted.context.producer, proof.context.producer);
    report.installedStackStart = 'confirmed'; report.restartedApplicationPid = restarted.pid;
  }

  // Serialized target-side commands must preserve structured origins on reuse.
  const remote = path.join(directory, 'remote'); await fs.mkdir(remote);
  await fs.writeFile(path.join(remote, 'main.js'), 'export default 1;');
  const remoteOrigin = { ...firstReceipt.origin, app: 'original', runtimeOrigin: {
    ...firstReceipt.origin.runtimeOrigin, consumer: { releaseId: producer.id, manifestSha256: producerHash, app: 'original' },
    entry: { relativeFile: 'main.js', mode: 'script' } } };
  const run = async command => (await exec(command, { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
  await run(sealReleaseArtifactCommand(remote, remoteOrigin, producer.omni.commit, true, true,
    { executable: process.execPath, ownerPackage, nodeOptions: '' }));
  const runtime = { root: ownerPackage, executable: process.execPath, commit: producer.omni.commit };
  assert.equal(await run(installedReleaseCheckCommand(remote, remoteOrigin, runtime, '')), 'verified');
  assert.equal(await run(installedReleaseCheckCommand(remote, { ...remoteOrigin,
    runtimeOrigin: { ...remoteOrigin.runtimeOrigin, producerApp: 'different' } }, runtime, '')), 'stale');
  report.serializedRemoteV2 = true;
  await client.orchestrator.stopAll(false); await client.shutdownOwner();
  assert.equal((await ownerExit)[0], 0); report.success = true;
  console.log(JSON.stringify(report));
} finally {
  await client.close().catch(() => {});
  if (owner && owner.exitCode === null && owner.signalCode === null) { owner.kill('SIGTERM'); await ownerExit; }
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  // Reports and owner diagnostics remain, not the disposable SDK copies.
  for (const name of ['source', 'archives', 'releases', 'another-owner', 'remote'])
    await fs.rm(path.join(directory, name), { recursive: true, force: true });
}
