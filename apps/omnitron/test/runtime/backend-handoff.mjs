import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fork } from 'node:child_process';
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
const master = process.argv.includes('--master');
let databaseAdmin, databaseName, databaseUrl;
if (master) {
  const testUrl = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:15432/test');
  assert.ok(['127.0.0.1', 'localhost'].includes(testUrl.hostname) && testUrl.port === '15432', 'Use the dedicated local test PostgreSQL on port 15432');
  const { Pool } = createRequire(import.meta.url)('pg');
  databaseAdmin = new Pool({ connectionString: testUrl.href, connectionTimeoutMillis: 5000 });
  databaseName = `handoff_test_${randomUUID().replaceAll('-', '')}`;
  await databaseAdmin.query(`CREATE DATABASE "${databaseName}"`);
  testUrl.pathname = `/${databaseName}`; databaseUrl = testUrl.href;
}
const instance = path.join(directory, 'i');
await fs.mkdir(instance, { mode: 0o700 });
const url = relative => pathToFileURL(path.join(dist, relative)).href;
const { createDaemonClient } = await import(url('daemon/daemon-client.js'));
const { replaceBackend, recoverBackend } = await import(url('daemon/backend-upgrade.js'));
const { RuntimeInstallation, selectedBackend } = await import(url('daemon/runtime-installation.js'));
const { PidManager } = await import(url('daemon/pid-manager.js'));
const stamp = JSON.parse(await fs.readFile(path.join(dist, 'BUILD.json'), 'utf8'));
const sourceHash = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'RUNTIME.json'), 'utf8')).sha256;
const { runtimeArtifactDigest } = await import(url('shared/runtime-artifact.js')); 
const reserve = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const httpBase = await reserve();
const boot = path.join(directory, 'boot.mjs');
const script = path.join(directory, 'counter.mjs');
const applicationPackage = path.resolve(import.meta.dirname, '../..');
const appModules = path.join(directory, 'node_modules/@omnitron-dev');
await fs.mkdir(appModules, {recursive:true});
await fs.symlink(applicationPackage, path.join(appModules,'omnitron'));
await fs.symlink(await fs.realpath(path.join(applicationPackage,'node_modules/@omnitron-dev/titan')),path.join(appModules,'titan'));
const topology = path.join(directory, 'bootstrap.mjs');
for (const name of ['Pool', 'Single']) await fs.writeFile(path.join(directory,`${name}.mjs`), `
import {Module,Service,Public} from '@omnitron-dev/titan/decorators';
class Counter { count=0; snapshot(){return {pid:process.pid,parent:process.ppid,count:++this.count};} }
Public()(Counter.prototype,'snapshot',Object.getOwnPropertyDescriptor(Counter.prototype,'snapshot'));
Service({name:'Fixture${name}'})(Counter);
class FixtureModule {};
Module({name:'Fixture${name}Module',providers:[Counter],exports:[Counter]})(FixtureModule);
export default FixtureModule;
`);
await fs.writeFile(topology, JSON.stringify({name:'topology',processes:[
 {name:'pool',module:'./Pool.mjs',instances:2,topology:{expose:true}},
 {name:'single',module:'./Single.mjs',topology:{expose:true}}
]}).replace(/^/,'export default ')+';');

await fs.writeFile(script, `import http from 'node:http'; import fs from 'node:fs';
let counter=0; const started=Date.now(); setInterval(()=>counter++,5);
const server=http.createServer((_q,r)=>r.end(JSON.stringify({pid:process.pid,parent:process.ppid,started,counter})));
server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(${JSON.stringify(path.join(directory, 'address.json'))},JSON.stringify({port:server.address().port}));process.send?.({type:'ready'});});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
await fs.writeFile(boot, `
import { OmnitronDaemon } from ${JSON.stringify(url('daemon/daemon.js'))};
import { DEFAULT_ECOSYSTEM, DEFAULT_DAEMON_CONFIG } from ${JSON.stringify(url('config/defaults.js'))};
const daemon=new OmnitronDaemon();
// Console initialization must not mutate the sealed runtime dependency tree.
new (await import(${JSON.stringify(url('webapp/webapp.service.js'))})).WebappService({});
${master ? `await (await import(${JSON.stringify(url('database/migration-runner.js'))})).runOmnitronMigrations();` : ''}
const config={...DEFAULT_ECOSYSTEM,apps:[{name:'counter',script:${JSON.stringify(script)},cwd:${JSON.stringify(directory)},enabled:true},{name:'topology',bootstrap:${JSON.stringify(topology)},cwd:${JSON.stringify(directory)},enabled:true}]};
await daemon.start(config,{noInfra:true,noWatch:true},{...DEFAULT_DAEMON_CONFIG,role:${JSON.stringify(master ? 'master' : 'slave')},port:0,httpPort:${httpBase},executionHost:{enabled:true,directory:${JSON.stringify(path.join(directory, 'e'))}},auth:{jwtSecret:'isolated-test-secret-not-for-production'}});
process.send({type:'ready',execution:daemon.backendRuntimeStatus()}); process.disconnect();
`);
const output = await fs.open(path.join(directory, 'initial.log'), 'a', 0o600);
const initial = fork(boot, [], { cwd: directory, env: { ...process.env, OMNITRON_HOME: instance, ...(databaseUrl ? { OMNITRON_DATABASE_URL: databaseUrl } : {}) },
  execArgv: [], stdio: ['ignore', output.fd, output.fd, 'ipc'] });
await output.close();
const ownedBackends = new Set();
if (initial.pid) ownedBackends.add(initial.pid);
let ownerPid, topologyConnection, sampler, inProbe = false, failures = 0, samples = 0;
const waitDead = async pid => {
  for (let attempt = 0; attempt < 400 && PidManager.isProcessAlive(pid); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
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
  topologyConnection = await privateControlClient(path.join(directory,'e/owner.sock'),'FixturePool');
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
  RuntimeInstallation.prototype.select = async function () { throw new Error('fixture: selector publication failed'); };
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
  const after = await probe();
  assert.ok(after.counter > before.counter);
  clearInterval(sampler);
  while (inProbe) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(failures, 0);
  console.log(JSON.stringify({ test: 'backend-replacement-and-rollback', role:master?'master':'slave', verifiedRoles:[...sessions.keys()], directory, ownerPid,
    applicationPid: before.pid, poolPids:[...poolPids], backendPids: [...ownedBackends], epoch: recovered.execution.epoch,
    samples, failures, selectorReconciliationPreservedPid: true, counterBefore: before.counter, counterAfter: after.counter }));
} finally {
  if (sampler) clearInterval(sampler);
  await topologyConnection?.close();
  // Discoveries here are confined to the private fixture directory and are
  // verified against its marker; no system daemon marker is ever read.
  const marker = new PidManager(path.join(instance, 'daemon.pid'));
  const current = marker.getPid();
  if (current) ownedBackends.add(current);
  if (!ownerPid) ownerPid = new PidManager(path.join(directory, 'e/owner.pid')).getPid();
  for (const pid of ownedBackends) if (PidManager.isProcessAlive(pid)) { process.kill(pid, 'SIGTERM'); await waitDead(pid); }
  if (ownerPid && PidManager.isProcessAlive(ownerPid)) { process.kill(ownerPid, 'SIGTERM'); await waitDead(ownerPid); }
  if (databaseAdmin) {
    try { await databaseAdmin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
    finally { await databaseAdmin.end(); }
  }
}
