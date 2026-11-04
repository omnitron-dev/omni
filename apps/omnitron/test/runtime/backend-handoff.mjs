import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reserveDaemonPorts } from './fixture-ports.mjs';
import { cleanupFixture } from './fixture-cleanup.mjs';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Always pass a disposable compiled artifact. This harness writes test build
// stamps into that artifact and never touches installed daemons or HOME.
const dist = path.resolve(process.argv[2]);
const runtimeRoot = path.resolve(dist, '../../..');
assert.ok(dist.includes('omnitron-handoff-'), 'Use the disposable handoff test artifact');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-backend-'));
await fs.chmod(directory, 0o700);
// Spawner socket sweeps must be confined to this fixture, including when it
// starts backend system workers beside a real running installation.
const temporary = path.join(directory, 'tmp');
await fs.mkdir(temporary, {mode: 0o700});
process.env.TMPDIR = temporary;
const master = process.argv.includes('--master');
const lifecycleOnly = process.argv.includes('--lifecycle-only');
const schemaCandidateArg = process.argv.indexOf('--schema-candidate');
const schemaCandidate = schemaCandidateArg === -1 ? null : path.resolve(process.argv[schemaCandidateArg + 1]);
if (schemaCandidate) assert.ok(master && schemaCandidate.includes('omnitron-handoff-'), 'Use an isolated master schema candidate');
let databaseAdmin, databaseName, databaseUrl;
if (master) {
  const testUrl = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:15432/test');
  assert.ok(['127.0.0.1', 'localhost'].includes(testUrl.hostname) && testUrl.username === 'test' && testUrl.pathname === '/test' && testUrl.port !== '5480', 'Use a dedicated loopback PostgreSQL test database and test account');
  const { Pool } = createRequire(import.meta.url)('pg');
  databaseAdmin = new Pool({ connectionString: testUrl.href, connectionTimeoutMillis: 5000 });
  const {rows: [durability]} = await databaseAdmin.query("SELECT current_setting('fsync') AS fsync, current_setting('full_page_writes') AS full_page_writes, current_setting('synchronous_commit') AS synchronous_commit");
  if (Object.values(durability).some(value => value !== 'on')) {
    await databaseAdmin.end();
    throw new Error('Use a durable test PostgreSQL: fsync, full_page_writes and synchronous_commit must all be on');
  }
  databaseName = `handoff_test_${randomUUID().replaceAll('-', '')}`;
  await databaseAdmin.query(`CREATE DATABASE "${databaseName}"`);
  testUrl.pathname = `/${databaseName}`; databaseUrl = testUrl.href;
}
const instance = path.join(directory, 'i');
await fs.mkdir(instance, { mode: 0o700 });
// Imports below cache instance defaults. Keep the coordinator as isolated as
// its child backends even when the invoking user has a managed installation.
process.env.OMNITRON_HOME = instance;
await fs.writeFile(path.join(instance, 'config.json'), JSON.stringify({
  executionHost: { enabled: true, directory: path.join(directory, 'e') },
}), { mode: 0o600 });
const url = relative => pathToFileURL(path.join(dist, relative)).href;
const { createDaemonClient } = await import(url('daemon/daemon-client.js'));
const { replaceBackend, recoverBackend } = await import(url('daemon/backend-upgrade.js'));
const { RuntimeInstallation, selectedBackend } = await import(url('daemon/runtime-installation.js'));
const { PidManager } = await import(url('daemon/pid-manager.js'));
const stamp = JSON.parse(await fs.readFile(path.join(dist, 'BUILD.json'), 'utf8'));
const sourceHash = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'RUNTIME.json'), 'utf8')).sha256;
const { runtimeArtifactDigest } = await import(url('shared/runtime-artifact.js'));
const { httpPort: httpBase, release } = await reserveDaemonPorts();
const boot = path.join(directory, 'boot.mjs');
const script = path.join(directory, 'counter.mjs');
const applicationSdkArg = process.argv.indexOf('--application-sdk');
const applicationPackage = applicationSdkArg === -1 ? path.resolve(dist, '..') : await fs.realpath(process.argv[applicationSdkArg + 1]);
const { resolveInstalledDependency } = await import(url('release/package-resolution.js'));
const applicationTitan = await resolveInstalledDependency(applicationPackage, '@omnitron-dev/titan');
assert.ok(applicationTitan, 'The application SDK must resolve its own Titan installation');
const appModules = path.join(directory, 'node_modules/@omnitron-dev');
await fs.mkdir(appModules, {recursive:true});
await fs.symlink(applicationPackage, path.join(appModules,'omnitron'));
await fs.symlink(applicationTitan,path.join(appModules,'titan'));
const topology = path.join(directory, 'bootstrap.mjs');
for (const name of ['Pool', 'Single']) await fs.writeFile(path.join(directory,`${name}.mjs`), `
import {Module,Service,Public,Inject} from '@omnitron-dev/titan/decorators';
import {Container,createToken} from '@omnitron-dev/titan/nexus';
class Counter {
 constructor(container){this.container=container;}
 count=0;
 async snapshot(){return {pid:process.pid,parent:process.ppid,count:++this.count,deployment:process.env.FIXTURE_TOPOLOGY,
  ${name === 'Single' ? "sibling:await this.container.resolve(createToken('topology:FixturePool')).snapshot()," : ''}
 };}
}
Inject(Container)(Counter,undefined,0);
Public()(Counter.prototype,'snapshot',Object.getOwnPropertyDescriptor(Counter.prototype,'snapshot'));
Service({name:'Fixture${name}'})(Counter);
class FixtureModule {};
Module({name:'Fixture${name}Module',providers:[Counter],exports:[Counter]})(FixtureModule);
export default FixtureModule;
`);
await fs.writeFile(topology, JSON.stringify({name:'topology',processes:[
 {name:'pool',module:'./Pool.mjs',instances:2,scaling:{strategy:'fixed',maxInstances:3},topology:{expose:true}},
 {name:'single',module:'./Single.mjs',topology:{expose:true,access:['FixturePool']}}
]}).replace(/^/,'export default ')+';');

const logPrefix = `handoff-continuity/${randomUUID()}/`;
await fs.writeFile(script, `import http from 'node:http'; import fs from 'node:fs';
let counter=0; const started=Date.now(); setInterval(()=>counter++,5);
let outputSequence=0;
const output=setInterval(()=>{const sequence=++outputSequence;console.log(JSON.stringify({time:new Date().toISOString(),level:30,msg:${JSON.stringify(logPrefix)}+sequence+'\\n    preserved detail '+sequence}));},50);
const server=http.createServer((q,r)=>{if(q.url==='/seal-output')clearInterval(output);r.end(JSON.stringify({pid:process.pid,parent:process.ppid,started,counter,outputSequence}));});
server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(${JSON.stringify(path.join(directory, 'address.json'))},JSON.stringify({port:server.address().port}));process.send?.({type:'ready'});});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
await fs.writeFile(boot, `
import { OmnitronDaemon } from ${JSON.stringify(url('daemon/daemon.js'))};
import { DEFAULT_ECOSYSTEM, DEFAULT_DAEMON_CONFIG } from ${JSON.stringify(url('config/defaults.js'))};
const daemon=new OmnitronDaemon();
// Console initialization must not mutate the sealed runtime dependency tree.
new (await import(${JSON.stringify(url('webapp/webapp.service.js'))})).WebappService({});
${master ? `await (await import(${JSON.stringify(url('database/migration-runner.js'))})).runOmnitronMigrations();` : ''}
const config={...DEFAULT_ECOSYSTEM,apps:[{name:'counter',script:${JSON.stringify(script)},cwd:${JSON.stringify(directory)},enabled:true},
 ...['topology','other-topology'].map(name=>({name,bootstrap:${JSON.stringify(topology)},cwd:${JSON.stringify(directory)},enabled:true,env:{FIXTURE_TOPOLOGY:name}}))]};
await daemon.start(config,{noInfra:true,noWatch:true},{...DEFAULT_DAEMON_CONFIG,role:${JSON.stringify(master ? 'master' : 'slave')},port:0,httpPort:${httpBase},executionHost:{enabled:true,directory:${JSON.stringify(path.join(directory, 'e'))}},auth:{jwtSecret:'isolated-test-secret-not-for-production'}});
process.send({type:'ready',execution:daemon.backendRuntimeStatus()}); process.disconnect();
`);
const output = await fs.open(path.join(directory, 'initial.log'), 'a', 0o600);
await release();
const initial = fork(boot, [], { cwd: directory, env: { ...process.env, OMNITRON_HOME: instance, ...(databaseUrl ? { OMNITRON_DATABASE_URL: databaseUrl } : {}) },
  execArgv: [], stdio: ['ignore', output.fd, output.fd, 'ipc'] });
await output.close();
const ownedBackends = new Set();
if (initial.pid) ownedBackends.add(initial.pid);
let ownerPid, topologyConnection, sampler, primaryFailure, inProbe = false, failures = 0, samples = 0;
const waitDead = async (pid, timeoutMs = 20_000) => {
  for (let attempt = 0; attempt < timeoutMs / 50 && PidManager.isProcessAlive(pid); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(PidManager.isProcessAlive(pid), false, `Own fixture process ${pid} did not exit`);
};
try {
  ownerPid = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Initial backend timed out: ${directory}/initial.log`)), 90_000);
    initial.once('error', error => { clearTimeout(timer); reject(error); });
    initial.once('exit', code => { clearTimeout(timer); reject(new Error(`Initial backend exited ${code}: ${directory}/initial.log`)); });
    initial.once('message', message => { clearTimeout(timer); resolve(message.execution.owner.pid); });
  });
  const socket = path.join(instance, 'daemon.sock');
  let client = createDaemonClient(socket, 30_000);
  await client.startApp({ name: 'counter' });
  await client.startApp({ name: 'topology' });
  await client.startApp({ name: 'other-topology' });
  const sessions = new Map();
  if (master) {
    const accounts = await client.service('OmnitronAccess');
    const auth = await client.service('OmnitronAuth');
    for (const role of ['viewer', 'operator', 'admin']) {
      const username = `fixture-${role}`, password = 'Test-fixture-only-passphrase!';
      await accounts.createUser({ username, password, role });
      sessions.set(role, (await auth.signIn({ username, password })).accessToken);
    }
  }
  const verifyAuthority = async () => {
    for (const [role, token] of sessions) {
      for (const [service, method, input, expected] of [
        ['OmnitronBackend', 'status', [], 200],
        ['OmnitronBackend', 'controlAddress', [], 403],
        ['OmnitronTraces', 'ingestBatch', [{spans:[]}], role === 'viewer' ? 403 : 200],
      ]) {
        const response = await fetch(`http://127.0.0.1:${httpBase + 1}/netron/invoke`, {
          method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
          body:JSON.stringify({id:randomUUID(),service,method,input}), signal:AbortSignal.timeout(5000),
        });
        await response.arrayBuffer(); assert.equal(response.status,expected,`${role} ${service}.${method}`);
      }
    }
  };
  await verifyAuthority();
  const { privateControlClient } = await import(url('daemon/private-control-client.js'));
  // The fixture examines only its own listener directory. No application
  // service may be published on the execution-management socket anymore.
  await assert.rejects(() => privateControlClient(path.join(directory, 'e/owner.sock'), 'FixturePool'));
  const topologySocket = async deployment => {
    const root = path.join(directory, 'e/topology');
    for (const entry of await fs.readdir(root)) {
      const socket = path.join(root, entry, 'rpc.sock');
      const connection = await privateControlClient(socket, 'FixtureSingle');
      try { if ((await connection.service.snapshot()).deployment === deployment) return socket; }
      finally { await connection.close(); }
    }
    throw new Error(`No private topology listener for ${deployment}`);
  };
  // Same private owner and public lifecycle API in both modes. The shorter
  // mode selects these tests only; full handoff qualification also runs them.
  const observeTopology = async (expectedSize = 2, deployment = 'topology') => {
    const socket = await topologySocket(deployment);
    const pool = await privateControlClient(socket, 'FixturePool');
    const single = await privateControlClient(socket, 'FixtureSingle');
    try {
      const poolPids = new Set();
      for (let attempt = 0; attempt < 64; attempt++) {
        const worker = await pool.service.snapshot();
        assert.equal(worker.deployment, deployment);
        assert.equal(worker.parent, ownerPid); poolPids.add(worker.pid);
      }
      assert.equal(poolPids.size, expectedSize, 'Every observed pool instance must answer');
      const worker = await single.service.snapshot();
      assert.equal(worker.deployment, deployment);
      assert.equal(worker.sibling.deployment, deployment, 'topology.access must resolve within its own application');
      assert.ok(poolPids.has(worker.sibling.pid));
      assert.equal(worker.parent, ownerPid); assert.ok(!poolPids.has(worker.pid));
      return { pool: [...poolPids].sort((a, b) => a - b), single: worker.pid };
    } finally { await Promise.all([pool.close(), single.close()]); }
  };
  const counterBeforeLifecycle = (await client.getApp({ name: 'counter' })).pid;
  const beforeLifecycle = await observeTopology();
  const otherBefore = await observeTopology(2, 'other-topology');
  assert.ok(!otherBefore.pool.some(pid => beforeLifecycle.pool.includes(pid)));
  await client.startApp({ name: 'topology' });
  assert.deepEqual(await observeTopology(), beforeLifecycle, 'Repeated start must retain all worker identities');
  for (const request of [
    { name: 'counter', process: 'pool', instances: 2 },
    { name: 'topology', instances: 2 },
    { name: 'topology', process: 'single', instances: 2 },
    { name: 'topology', process: 'missing', instances: 2 },
    ...[0, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, 4].map(instances => ({ name: 'topology', process: 'pool', instances })),
  ]) await assert.rejects(() => client.scale(request));
  assert.deepEqual(await observeTopology(), beforeLifecycle, 'Refused resize must not change workers');
  const scaled = await client.scale({ name: 'topology', process: 'pool', instances: 3 });
  const selected = scaled.processes.find(item => item.name === 'pool');
  assert.equal(selected.instances, 3); assert.equal(selected.declaredInstances, 2);
  assert.equal(scaled.instances, 1, 'The app aggregate is not the selected pool size');
  const grown = await observeTopology(3);
  assert.equal(grown.single, beforeLifecycle.single, 'A pool resize must not replace its singleton sibling');
  await client.scale({ name: 'topology', process: 'pool', instances: 1 });
  const shrunk = await observeTopology(1);
  assert.equal(shrunk.single, beforeLifecycle.single);
  for (const pid of grown.pool.filter(pid => !shrunk.pool.includes(pid))) await waitDead(pid);
  await client.stopApp({ name: 'topology' });
  assert.deepEqual(await observeTopology(2, 'other-topology'), otherBefore);
  for (const pid of [...grown.pool, grown.single]) await waitDead(pid);
  assert.equal((await client.getApp({ name: 'topology' })).status, 'stopped');
  await client.startApp({ name: 'topology' });
  const startedAgain = await observeTopology();
  for (const pid of [...startedAgain.pool, startedAgain.single])
    assert.ok(![...beforeLifecycle.pool, beforeLifecycle.single].includes(pid), 'Restarted workers must be new OS processes');
  await client.restartApp({ name: 'topology' });
  for (const pid of [...startedAgain.pool, startedAgain.single]) await waitDead(pid);
  const restarted = await observeTopology();
  for (const pid of [...restarted.pool, restarted.single])
    assert.ok(![...startedAgain.pool, startedAgain.single].includes(pid));
  assert.equal((await client.getApp({ name: 'counter' })).pid, counterBeforeLifecycle, 'Unrelated application must retain its process');
  assert.ok(PidManager.isProcessAlive(counterBeforeLifecycle));
  assert.deepEqual(await observeTopology(2, 'other-topology'), otherBefore);
  const lifecycleProof = { before: beforeLifecycle, afterStopStart: startedAgain, afterRestart: restarted, grown, shrunk,
    isolatedApplication: otherBefore, sameNameServicesIsolated: true, siblingCallsVerified: true,
    declarationRestoredAfterRestart: true, unrelatedPid: counterBeforeLifecycle };
  if (lifecycleOnly) {
    await client.disconnect();
    console.log(JSON.stringify({ test: 'orchestrator-native-lifecycle', directory, ownerPid, lifecycle: lifecycleProof }));
  } else {
  topologyConnection = await privateControlClient(await topologySocket('topology'),'FixturePool');
  const poolPids = new Set();
  for(let i=0;i<10;i++)poolPids.add((await topologyConnection.service.snapshot()).pid);
  assert.equal(poolPids.size,2,'Both real pool workers must answer');

  await client.disconnect();
  const { port } = JSON.parse(await fs.readFile(path.join(directory, 'address.json'), 'utf8'));
  const probe = async () => (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).json();
  const before = await probe();
  assert.equal(before.parent, ownerPid);
  sampler = setInterval(async () => {
    if (inProbe) return; inProbe = true;
    try {
      const current = await probe();
      assert.equal(current.pid, before.pid); assert.equal(current.started, before.started);
      assert.equal(current.parent, ownerPid);
      const pooled=await topologyConnection.service.snapshot();assert.ok(poolPids.has(pooled.pid));assert.equal(pooled.parent,ownerPid);samples++;
    } catch { failures++; }
    finally { inProbe = false; }
  }, 15);
  const result = await replaceBackend(dist, { socket, progress: message => console.log(message) });
  ownedBackends.add(result.pid);
  assert.notEqual(result.pid, initial.pid); assert.equal(result.ownerPid, ownerPid);
  await verifyAuthority();
  await waitDead(initial.pid);
  // A candidate that passes preflight but crashes before readiness must roll
  // back to the old artifact under a fresh epoch, never re-use an old grant.
  const bad = path.join(directory, 'bad');
  await fs.cp(runtimeRoot, bad, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
  const badDist = path.join(bad, 'packages/0/dist');
  const badStamp = { ...stamp, commit: '1'.repeat(40) };
  await fs.writeFile(path.join(badDist, 'BUILD.json'), JSON.stringify(badStamp));
  await fs.writeFile(path.join(badDist, 'daemon/daemon-entry.js'),
    `if(process.argv[2]==='--check-backend')console.log(${JSON.stringify(JSON.stringify({ protocol: 1, build: badStamp }))});else process.exit(55);`);
  const manifest = JSON.parse(await fs.readFile(path.join(bad, 'RUNTIME.json'), 'utf8'));
  manifest.sha256 = await runtimeArtifactDigest(bad);
  await fs.writeFile(path.join(bad, 'RUNTIME.json'), JSON.stringify(manifest));
  await assert.rejects(() => replaceBackend(badDist, { socket, progress: message => console.log(message) }), /previous backend was restored/);
  client = createDaemonClient(socket, 30_000);
  const recovered = await client.status();
  ownedBackends.add(recovered.pid);
  await client.disconnect();
  assert.equal(recovered.execution.owner.pid, ownerPid);
  assert.ok(recovered.execution.epoch > result.epoch);
  await verifyAuthority();
  // A coordinator/storage failure after public readiness must not launch a
  // second controller. The durable activation journal fences cold starts;
  // explicit recovery proves the live result and completes the selector.
  const originalSelect = RuntimeInstallation.prototype.select;
  RuntimeInstallation.prototype.select = async function failSelectorPublication() { throw new Error('fixture: selector publication failed'); };
  try {
    await assert.rejects(() => replaceBackend(dist, { socket }), /selector publication failed/);
  } finally { RuntimeInstallation.prototype.select = originalSelect; }
  client = createDaemonClient(socket, 30_000);
  const awaitingSelection = await client.status();
  ownedBackends.add(awaitingSelection.pid);
  await client.disconnect();
  assert.notEqual(awaitingSelection.pid, recovered.pid);
  assert.equal(awaitingSelection.execution.owner.pid, ownerPid);
  await assert.rejects(() => selectedBackend(instance), /activation is unfinished/);
  const registry = await RuntimeInstallation.open(instance);
  let reconciled;
  try {
    const pending = registry.activation();
    assert.ok(pending);
    reconciled = await recoverBackend(pending.checkpoint);
    assert.equal(registry.activation(), null);
    assert.equal(registry.selection().current, sourceHash);
    assert.equal((await selectedBackend(instance)).runtimeHash, sourceHash);
  } finally { await registry.close(); }
  assert.equal(reconciled.pid, awaitingSelection.pid);
  assert.equal(reconciled.ownerPid, ownerPid);
  await verifyAuthority();
  client = createDaemonClient(socket, 30_000);
  const backend = await client.service('OmnitronBackend');
  await client.setMetricsEnabled({ name: 'counter', enabled: false });
  assert.equal((await backend.status()).recovery?.status, 'pending');
  let certificate;
  for (let attempt = 0; attempt < 60; attempt++) {
    certificate = (await backend.status()).recovery;
    if (certificate?.status === 'ready') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(certificate?.status, 'ready', JSON.stringify(certificate));
  const runRecovery = () => promisify(execFile)(path.join(runtimeRoot, 'node'), [path.join(dist, 'cli/omnitron.js'), 'backend', 'recover', '--json'], {
    cwd: directory, env: { ...process.env, OMNITRON_HOME: instance, ...(databaseUrl ? { OMNITRON_DATABASE_URL: databaseUrl } : {}) },
    timeout: 150_000, maxBuffer: 1024 * 1024,
  });
  await assert.rejects(runRecovery, /still alive/);
  await client.disconnect();
  assert.ok(ownedBackends.has(reconciled.pid));
  process.kill(reconciled.pid, 'SIGKILL');
  await waitDead(reconciled.pid);
  const recoveredCrash = JSON.parse((await runRecovery()).stdout).data;
  ownedBackends.add(recoveredCrash.pid);
  assert.equal(recoveredCrash.ownerPid, ownerPid);
  assert.ok(recoveredCrash.epoch > reconciled.epoch);
  await verifyAuthority();
  let schemaTransition;
  if (schemaCandidate) {
    // Execute the candidate's management code against the old, real backend.
    // A sealed fixture-only entry fails activation once, then the SAME artifact
    // succeeds, proving the receipt is tied to content, not a mutable release.
    const nextRoot = path.join(directory, 'schema-candidate');
    await fs.cp(path.resolve(schemaCandidate, '../../..'), nextRoot, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
    const nextDist = path.join(nextRoot, 'packages/0/dist');
    const fault = path.join(directory, 'fail-schema-candidate');
    const nextEntry = path.join(nextDist, 'daemon/daemon-entry.js');
    await fs.rename(nextEntry, path.join(nextDist, 'daemon/daemon-entry-original.js'));
    await fs.writeFile(nextEntry, `import fs from 'node:fs'; if(!process.argv.includes('--check-backend') && fs.existsSync(${JSON.stringify(fault)})) process.exit(55); else await import('./daemon-entry-original.js');`);
    const nextManifest = JSON.parse(await fs.readFile(path.join(nextRoot, 'RUNTIME.json'), 'utf8'));
    nextManifest.sha256 = await runtimeArtifactDigest(nextRoot);
    await fs.writeFile(path.join(nextRoot, 'RUNTIME.json'), JSON.stringify(nextManifest));
    const management = await import(pathToFileURL(path.join(nextDist, 'daemon/schema-transition.js')).href);
    const nextUpgrade = (await import(pathToFileURL(path.join(nextDist, 'daemon/backend-upgrade.js')).href)).replaceBackend;
    // The prior recovery is ready publicly before its next certificate is durable.
    const observer = createDaemonClient(socket);
    try {
      for (let i = 0; i < 80; i++) {
        if ((await (await observer.service('OmnitronBackend')).status()).recovery?.status === 'ready') break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } finally { await observer.disconnect(); }
    const plan = await management.prepareSchemaTransition(nextRoot, socket);
    await assert.rejects(nextUpgrade(nextDist, { socket, checkOnly: true }), /changes database migrations/);
    await assert.rejects(nextUpgrade(nextDist, { socket, checkOnly: true, schemaPlan: plan.file }), /applied schema plan/);
    await management.applySchemaTransition(plan.file);
    // Idempotent retry uses the exact history and does not run DDL twice.
    await management.applySchemaTransition(plan.file);
    await fs.writeFile(fault, 'fixture');
    await assert.rejects(nextUpgrade(nextDist, { socket, schemaPlan: plan.file }), /previous backend was restored/);
    const restoredClient = createDaemonClient(socket);
    const restored = await restoredClient.status();
    ownedBackends.add(restored.pid);
    await restoredClient.disconnect();
    assert.equal(restored.execution.owner.pid, ownerPid);
    await fs.unlink(fault);
    // Wait for a new certificate after automatic rollback before preparing another handoff.
    const waitCertificate = async () => {
      const observer = createDaemonClient(socket);
      try {
        for (let i = 0; i < 80; i++) {
          if ((await (await observer.service('OmnitronBackend')).status()).recovery?.status === 'ready') return;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error('Schema runtime certificate did not become ready');
      } finally { await observer.disconnect(); }
    };
    await waitCertificate();
    const upgraded = await nextUpgrade(nextDist, { socket, schemaPlan: plan.file });
    ownedBackends.add(upgraded.pid); assert.equal(upgraded.ownerPid, ownerPid);
    await verifyAuthority();
    await waitCertificate();
    const rolledBack = await nextUpgrade(dist, { socket, schemaPlan: plan.file });
    ownedBackends.add(rolledBack.pid); assert.equal(rolledBack.ownerPid, ownerPid);
    await waitCertificate();
    process.kill(rolledBack.pid, 'SIGKILL'); await waitDead(rolledBack.pid);
    const cold = JSON.parse((await runRecovery()).stdout).data;
    ownedBackends.add(cold.pid); assert.equal(cold.ownerPid, ownerPid);
    await verifyAuthority();
    schemaTransition = { plan: plan.file, failedCandidateRestored: true, upgrade: upgraded.pid, rollback: rolledBack.pid, coldRollback: cold.pid };
  }
  const after = await probe();
  assert.ok(after.counter > before.counter);
  let delivery;
  if (master) {
    const sealed = await (await fetch(`http://127.0.0.1:${port}/seal-output`)).json();
    const {Pool} = createRequire(import.meta.url)('pg');
    const database = new Pool({connectionString:databaseUrl, connectionTimeoutMillis:5000});
    try {
      let rows=[];
      for(let attempt=0;attempt<120;attempt++) {
        rows=(await database.query('SELECT id, message FROM logs WHERE message LIKE $1',[logPrefix+'%'])).rows;
        if(rows.length>=sealed.outputSequence)break;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      assert(sealed.outputSequence>0);
      assert.equal(rows.length,sealed.outputSequence,'Every emitted event must be committed across replacement, rollback and crash recovery');
      assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
      const messages=new Set(rows.map(row=>row.message));
      assert.equal(messages.size,rows.length,'No duplicate source events');
      for(let sequence=1;sequence<=sealed.outputSequence;sequence++)assert(messages.has(logPrefix+sequence+'\n    preserved detail '+sequence),'Missing or truncated event '+sequence);
      delivery={emitted:sealed.outputSequence,committed:rows.length,missing:0,duplicates:0,multilinePreserved:true};
    }finally{await database.end()}
  }
  clearInterval(sampler);
  while (inProbe) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(failures, 0);
  console.log(JSON.stringify({ test: 'backend-replacement-and-rollback', role:master?'master':'slave', verifiedRoles:[...sessions.keys()], directory, ownerPid,
    applicationPid: before.pid, poolPids:[...poolPids], backendPids: [...ownedBackends], epoch: recovered.execution.epoch,
    samples, failures, selectorReconciliationPreservedPid: true, actualBackendCrashRecovered: true, schemaTransition,
    counterBefore: before.counter, counterAfter: after.counter, delivery, lifecycle: lifecycleProof }));
  }
} catch (error) {
  primaryFailure = { error };
  // Keep the first failure visible even if an outer runner later times out
  // while a broken fixture resource is shutting down.
  console.error(new Error(`Runtime fixture failed before cleanup; diagnostics: ${directory}`, { cause: error }));
} finally {
  if (sampler) clearInterval(sampler);
  await cleanupFixture(directory, primaryFailure, async attempt => {
    await attempt('topology connection', () => topologyConnection?.close());
    // Discoveries here are confined to the private fixture directory and are
    // verified against its marker; no system daemon marker is ever read.
    await attempt('backend marker', () => {
      const current = new PidManager(path.join(instance, 'daemon.pid')).getPid();
      if (current) ownedBackends.add(current);
    });
    await attempt('owner marker', () => {
      if (!ownerPid) ownerPid = new PidManager(path.join(directory, 'e/owner.pid')).getPid();
    });
    // Cleanup grants Titan its 30s shutdown budget plus 5s exit safety timer.
    // Functional lifecycle assertions retain their original 20s wait above.
    const terminate = async pid => {
      if (PidManager.isProcessAlive(pid)) { process.kill(pid, 'SIGTERM'); await waitDead(pid, 35_000); }
    };
    for (const pid of ownedBackends) await attempt(`backend ${pid}`, () => terminate(pid));
    if (ownerPid) await attempt(`owner ${ownerPid}`, () => terminate(ownerPid));
    if (databaseAdmin) {
      await attempt('private database', () => databaseAdmin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`));
      await attempt('database pool', () => databaseAdmin.end());
    }
  });
}
// Retain failed fixtures for diagnosis. Successful runs release their private runtime copies.
if (process.env.OMNITRON_KEEP_TEST_ARTIFACTS !== '1') await fs.rm(directory, { recursive: true, force: true });
