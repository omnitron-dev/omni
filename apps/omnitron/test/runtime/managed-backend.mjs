import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

assert.ok(['darwin', 'linux'].includes(process.platform), 'This fixture requires native service supervision');
const linux = process.platform === 'linux';
if (linux) assert.equal(process.getuid(), 0, 'Linux fixture needs an isolated system service, independent of SSH login');
const dist = path.resolve(process.argv[2]);
assert.ok(dist.includes('omnitron-handoff-'), 'Use a disposable sealed test artifact');
const managementDist = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
if (managementDist) assert.ok(managementDist.includes('omnitron-handoff-'), 'Use a disposable management artifact');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-managed-'));
const instance = path.join(root, 'i'), execution = path.join(root, 'e');
for (const directory of [instance, execution]) await fs.mkdir(directory, { mode: 0o700 });
process.env.OMNITRON_HOME = instance;
const load = file => import(pathToFileURL(path.join(dist, file)).href);
const { RuntimeInstallation } = await load('daemon/runtime-installation.js');
const { renderLaunchdPlist, renderSystemdUnit } = await load('commands/service-units.js');
const { createDaemonClient } = await load('daemon/daemon-client.js');
const { privateControlClient } = await load('daemon/private-control-client.js');
const { PidManager } = await load('daemon/pid-manager.js');
const run = promisify(execFile);
const native = args => run(linux ? 'systemctl' : '/bin/launchctl', args, { timeout: 45_000, maxBuffer: 1024 * 1024 });
const domain = `gui/${process.getuid()}`;
const id = randomUUID();
const installation = await RuntimeInstallation.open(instance);
let artifact;
try {
  artifact = await installation.exclusive(async () => {
    const installed = await installation.install(path.resolve(dist, '../../..'));
    await installation.select(installed.runtimeHash, 0);
    await installation.writeLauncher();
    return installed;
  });
} finally { await installation.close(); }
const reserve = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); });
});
const port = await reserve(), tcpPort = await reserve();
const config = { protocol: 1, instanceHome: instance, directory: execution, scope: linux ? 'system' : 'user', cwd: root,
  environment: { OMNITRON_HOME: instance, OMNITRON_NO_INFRA: '1', OMNITRON_NO_WATCH: '1', PATH: process.env.PATH },
  owner: { label: `dev.omnitron.fixture.${id}.owner`, unit: `omnitron-fixture-${id}-owner.service`, artifact: artifact.runtimeHash },
  backend: { label: `dev.omnitron.fixture.${id}.backend`, unit: `omnitron-fixture-${id}-backend.service`, artifact: artifact.runtimeHash },
};
await fs.writeFile(path.join(instance, 'config.json'), JSON.stringify({ role: 'slave', port: tcpPort, httpPort: port,
  executionHost: { enabled: true, directory: execution } }), { mode: 0o600 });
await fs.writeFile(path.join(instance, 'runtime/supervision.json'), JSON.stringify(config), { mode: 0o600 });
await fs.writeFile(path.join(root, 'counter.mjs'), `import http from 'node:http';import fs from 'node:fs';
 let value=0,sequence=0,paused=false;setInterval(()=>value++,5);
 setInterval(()=>{if(paused)return;const record={level:30,time:new Date().toISOString(),msg:'fixture:${id}:'+sequence+++'\\n  first continuation\\n  second continuation'};
 fs.appendFileSync(${JSON.stringify(path.join(root, 'expected.jsonl'))},JSON.stringify(record)+'\\n');process.stdout.write(JSON.stringify(record)+'\\n');},50);
 const server=http.createServer((q,r)=>{if(q.url==='/pause')paused=true;r.end(JSON.stringify({pid:process.pid,parent:process.ppid,value}));});
 server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(${JSON.stringify(path.join(root, 'address.json'))},JSON.stringify(server.address()));process.send?.({type:'ready'});});
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
await fs.writeFile(path.join(root, 'omnitron.config.mjs'), `export default {apps:[{name:'counter',script:'./counter.mjs',cwd:${JSON.stringify(root)},enabled:true}]};`);
const units = [];
for (const mode of ['owner', 'backend']) {
  const systemUnitDir = managementDist ? '/etc/systemd/system' : '/run/systemd/system';
  const file = linux ? path.join(systemUnitDir, config[mode].unit) : path.join(root, `${mode}.plist`);
  const render = linux ? renderSystemdUnit : renderLaunchdPlist;
  await fs.writeFile(file, render({ scope: config.scope, execPath: artifact.execPath,
    entryPath: path.join(artifact.directory, 'daemon/managed-entry.js'), args: [mode], label: config[mode].label,
    nodeArgs: [],
    restart: mode === 'backend', workdir: path.dirname(artifact.directory), path: process.env.PATH,
    identity: linux ? { user: 'root', home: os.homedir() } : undefined,
    environment: { OMNITRON_HOME: instance }, stderrLog: path.join(root, `${mode}.log`) }));
  await run(linux ? 'systemd-analyze' : '/usr/bin/plutil', linux ? ['verify', file] : ['-lint', file]);
  units.push({ file, job: linux ? config[mode].unit : `${domain}/${config[mode].label}` });
}
const socket = path.join(instance, 'daemon.sock');
const status = async () => {
  await fs.access(socket);
  const client = createDaemonClient(socket, 3000);
  try { return await client.status(); } finally { await client.disconnect(); }
};
const until = async (work, message, ms = 150_000) => {
  const deadline = Date.now() + ms; let cause;
  while (Date.now() < deadline) {
    try { const value = await work(); if (value) return value; } catch (error) { cause = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${message}; inspect ${root}; ${cause?.message ?? ''}`);
};
const waitCertificate = () => until(async () => (await status()).execution?.recovery?.status === 'ready', 'No recovery certificate');
let sampler, inFlight = false, samples = 0, failures = 0, ownerPid, applicationPid, ownerClient;
try {
  if (linux) await native(['daemon-reload']);
  for (const unit of units) await native(linux ? ['start', unit.job] : ['bootstrap', domain, unit.file]);
  let first = await until(status, 'Initial managed backend did not start');
  console.log(JSON.stringify({ stage: 'cold-start', root, backend: first.pid, owner: first.execution.owner.pid }));
  ownerPid = first.execution.owner.pid;
  const client = createDaemonClient(socket, 30_000);
  try { await client.startApp({ name: 'counter' }); } finally { await client.disconnect(); }
  const address = await until(async () => JSON.parse(await fs.readFile(path.join(root, 'address.json'), 'utf8')), 'Counter did not start');
  const probe = async () => (await fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(1000) })).json();
  const before = await probe(); applicationPid = before.pid;
  console.log(JSON.stringify({ stage: 'application-ready', applicationPid }));
  assert.equal(before.parent, ownerPid);
  ownerClient = await privateControlClient(path.join(execution, 'owner.sock'), 'OmnitronExecution', 3000);
  sampler = setInterval(async () => {
    if (inFlight) return; inFlight = true;
    try {
      const [now, snapshot] = await Promise.all([probe(), ownerClient.service.snapshot()]);
      assert.equal(now.pid, applicationPid); assert.equal(now.parent, ownerPid);
      assert.equal(snapshot.status.owner.pid, ownerPid); samples++;
    }
    catch { failures++; } finally { inFlight = false; }
  }, 20);
  const cli = (...args) => run(artifact.execPath, [path.join(artifact.directory, 'cli/omnitron.js'), ...args, '--json'], {
    env: { ...process.env, OMNITRON_HOME: instance }, cwd: root, timeout: 600_000, maxBuffer: 1024 * 1024,
  });
  // A regular CLI must delegate, so a replacement remains a child of the OS job.
  const upgraded = JSON.parse((await cli('backend', 'upgrade', dist)).stdout).data;
  console.log(JSON.stringify({ stage: 'upgraded', pid: upgraded.pid }));
  assert.notEqual(upgraded.pid, first.pid); assert.equal(upgraded.ownerPid, ownerPid);
  await waitCertificate();
  process.kill(upgraded.pid, 'SIGKILL');
  const recovered = await until(async () => { const value = await status(); return value.pid !== upgraded.pid ? value : null; }, 'Killed backend was not recovered');
  assert.equal(recovered.execution.owner.pid, ownerPid);
  console.log(JSON.stringify({ stage: 'backend-crash-recovered', pid: recovered.pid }));
  await waitCertificate();
  const supervisor = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
  const guardian = await until(async () => {
    const value = await supervisor.service.status();
    return value.state === 'ready' && value.backendPid === recovered.pid ? value : null;
  }, 'Supervisor did not commit the recovered backend');
  await supervisor.close();
  process.kill(guardian.pid, 'SIGKILL');
  const afterGuardian = await until(async () => { const value = await status(); return value.pid !== recovered.pid ? value : null; }, 'OS did not recover the killed guardian');
  assert.equal(afterGuardian.execution.owner.pid, ownerPid);
  await waitCertificate();
  const committedGuardian = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
  try {
    await until(async () => {
      const value = await committedGuardian.service.status();
      return value.state === 'ready' && value.backendPid === afterGuardian.pid;
    }, 'Guardian has not committed its recovered backend selection');
  } finally { await committedGuardian.close(); }
  if (managementDist) {
    const settledGuardian = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
    try {
      await until(async () => {
        const state = await settledGuardian.service.status();
        return state.state === 'ready' && state.backendPid === afterGuardian.pid;
      }, 'Guardian has not finished publishing the recovered selection');
    } finally { await settledGuardian.close(); }
    const { prepareSupervisorTransition, applySupervisorTransition } = await import(pathToFileURL(path.join(managementDist, 'daemon/supervisor-transition.js')).href);
    const plan = await prepareSupervisorTransition(path.resolve(managementDist, '../../..'), socket);
    assert.equal((await status()).pid, afterGuardian.pid, 'Preparation changed the backend');
    const prepared = JSON.parse(await fs.readFile(plan.file, 'utf8'));
    // Refuse edited native units BEFORE draining a backend.
    await fs.appendFile(prepared.unit.file, '\n<!-- changed after preparation -->\n');
    await assert.rejects(applySupervisorTransition(plan.file), /unit changed since preparation|changed system guardian unit/);
    assert.equal((await status()).pid, afterGuardian.pid);
    await fs.writeFile(prepared.unit.file, prepared.unit.before);
    if (linux) await native(['daemon-reload']);
    const transitioned = await applySupervisorTransition(plan.file);
    assert.equal(transitioned.phase, 'complete');
    assert.equal(transitioned.result.ownerPid, ownerPid);
    assert.notEqual(transitioned.result.backendPid, afterGuardian.pid);
    assert.notEqual(transitioned.result.guardianPid, prepared.guardianPid);
    assert.equal((await applySupervisorTransition(plan.file)).result.backendPid, transitioned.result.backendPid, 'A repeated apply started another backend');
    console.log(JSON.stringify({ stage: 'guardian-transition-complete', result: transitioned.result }));
    await waitCertificate();
    const rollback = await prepareSupervisorTransition(path.resolve(dist, '../../..'), socket);
    const runner = path.resolve(managementDist, '../../../node');
    const script = `import { applySupervisorTransition } from ${JSON.stringify(pathToFileURL(path.join(managementDist, 'daemon/supervisor-transition.js')).href)};await applySupervisorTransition(${JSON.stringify(rollback.file)});`;
    let completed = false;
    const coordinator = execFile(runner, ['--input-type=module', '--eval', script], {
      env: { ...process.env, OMNITRON_HOME: instance }, cwd: root, timeout: 180_000, maxBuffer: 1024 * 1024,
    }, () => { completed = true; });
    try {
      const interrupted = await until(async () => {
        const saved = JSON.parse(await fs.readFile(rollback.file, 'utf8'));
        if (['retired', 'stopped', 'configured', 'started'].includes(saved.phase)) return saved;
        if (completed || saved.phase === 'complete') throw new Error('Coordinator finished before interruption');
        return null;
      }, 'Coordinator never reached a recoverable transition phase', 60_000);
      coordinator.kill('SIGKILL');
      await until(() => completed, 'Fixture coordinator did not exit', 5000);
      console.log(JSON.stringify({ stage: 'guardian-coordinator-killed', phase: interrupted.phase }));
      const resumed = await applySupervisorTransition(rollback.file);
      assert.equal(resumed.phase, 'complete'); assert.equal(resumed.result.ownerPid, ownerPid);
      console.log(JSON.stringify({ stage: 'guardian-transition-resumed', result: resumed.result }));
    } finally { if (!completed) coordinator.kill('SIGKILL'); }
  }
  const after = await probe(); assert.ok(after.value > before.value); assert.equal(failures, 0);
  if (linux && process.env.OMNITRON_RUNTIME_PROBE) {
    const { runtimeProbeCommand } = await import(pathToFileURL(process.env.OMNITRON_RUNTIME_PROBE).href);
    const bundle = { root: path.dirname(dist), version: first.version, commit: first.build.commit };
    const options = { env: { ...process.env, OMNITRON_HOME: instance }, timeout: 60_000, maxBuffer: 1024 * 1024 };
    const detected = JSON.parse((await run('/bin/sh', ['-c', runtimeProbeCommand(bundle, (await status()).pid)], options)).stdout);
    assert.equal(detected.kind, 'managed'); assert.equal(detected.ownerPid, ownerPid);
    await assert.rejects(run('/bin/sh', ['-c', runtimeProbeCommand(bundle, applicationPid)], options), /no recognized entry/);
    console.log(JSON.stringify({ stage: 'remote-inspection-verified', ownerPid, backendPid: afterGuardian.pid }));
  }
  await fetch(`http://127.0.0.1:${address.port}/pause`);
  const expected = (await fs.readFile(path.join(root, 'expected.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const require = createRequire(path.join(artifact.directory, '../package.json'));
  const Database = require('better-sqlite3');
  await until(async () => {
    const db = new Database(path.join(instance, 'data/slave.db'), { readonly: true, fileMustExist: true });
    try {
      const records = db.prepare("SELECT payload FROM sync_buffer WHERE category='logs'").all()
        .map(row => JSON.parse(row.payload)).filter(row => row.message?.startsWith(`fixture:${id}:`));
      if (records.length < expected.length) return false;
      assert.equal(records.length, expected.length, 'Duplicate fixture log deliveries');
      const actual = records.map(row => ({ time: new Date(row.timestamp).toISOString(), msg: row.message }))
        .sort((a, b) => a.msg.localeCompare(b.msg));
      assert.deepEqual(actual, expected.map(({ time, msg }) => ({ time, msg })).sort((a, b) => a.msg.localeCompare(b.msg)));
      return true;
    } finally { db.close(); }
  }, 'Exact multiline logs did not reach the durable outbox');
  console.log(JSON.stringify({ test: linux ? 'independent-systemd-supervision' : 'independent-launchd-supervision', root, ownerPid, applicationPid,
    backends: [first.pid, upgraded.pid, recovered.pid, afterGuardian.pid], killedGuardian: guardian.pid, samples, failures, verifiedLogs: expected.length }));
} finally {
  if (sampler) clearInterval(sampler);
  while (inFlight) await new Promise(resolve => setTimeout(resolve, 10));
  await ownerClient?.close();
  for (const unit of units.toReversed()) await native(linux ? ['stop', unit.job] : ['bootout', unit.job]).catch(() => {});
  if (ownerPid) await until(() => !PidManager.isProcessAlive(ownerPid), 'Fixture owner did not stop', 35_000);
  if (applicationPid) assert.equal(PidManager.isProcessAlive(applicationPid), false, 'Fixture app survived normal owner shutdown');
  if (linux) {
    for (const unit of units) await fs.unlink(unit.file);
    await native(['daemon-reload']);
    await native(['reset-failed', ...units.map(unit => unit.job)]).catch(() => {});
  }
}
// Retain failed fixtures for diagnosis. Successful runs release their private runtime copies.
if (process.env.OMNITRON_KEEP_TEST_ARTIFACTS !== '1') await fs.rm(root, { recursive: true, force: true });
