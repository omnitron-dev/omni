import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

assert.equal(process.platform, 'darwin', 'This fixture exercises actual launchd isolation');
const dist = path.resolve(process.argv[2]);
assert.ok(dist.includes('omnitron-handoff-'), 'Use a disposable sealed test artifact');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-managed-'));
const instance = path.join(root, 'i'), execution = path.join(root, 'e');
for (const directory of [instance, execution]) await fs.mkdir(directory, { mode: 0o700 });
process.env.OMNITRON_HOME = instance;
const load = file => import(pathToFileURL(path.join(dist, file)).href);
const { RuntimeInstallation } = await load('daemon/runtime-installation.js');
const { renderLaunchdPlist } = await load('commands/service-units.js');
const { createDaemonClient } = await load('daemon/daemon-client.js');
const { privateControlClient } = await load('daemon/private-control-client.js');
const { PidManager } = await load('daemon/pid-manager.js');
const run = promisify(execFile);
const native = args => run('/bin/launchctl', args, { timeout: 30_000, maxBuffer: 1024 * 1024 });
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
const config = { protocol: 1, instanceHome: instance, directory: execution, scope: 'user', cwd: root,
  environment: { OMNITRON_HOME: instance, OMNITRON_NO_INFRA: '1', OMNITRON_NO_WATCH: '1', PATH: process.env.PATH },
  owner: { label: `dev.omnitron.fixture.${id}.owner`, unit: `omnitron-fixture-${id}-owner.service`, artifact: artifact.runtimeHash },
  backend: { label: `dev.omnitron.fixture.${id}.backend`, unit: `omnitron-fixture-${id}-backend.service`, artifact: artifact.runtimeHash },
};
await fs.writeFile(path.join(instance, 'config.json'), JSON.stringify({ role: 'slave', port: tcpPort, httpPort: port,
  executionHost: { enabled: true, directory: execution } }), { mode: 0o600 });
await fs.writeFile(path.join(instance, 'runtime/supervision.json'), JSON.stringify(config), { mode: 0o600 });
await fs.writeFile(path.join(root, 'counter.mjs'), `import http from 'node:http';import fs from 'node:fs';
 let value=0;setInterval(()=>value++,5);
 const server=http.createServer((q,r)=>r.end(JSON.stringify({pid:process.pid,parent:process.ppid,value})));
 server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(${JSON.stringify(path.join(root, 'address.json'))},JSON.stringify(server.address()));process.send?.({type:'ready'});});
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
await fs.writeFile(path.join(root, 'omnitron.config.mjs'), `export default {apps:[{name:'counter',script:'./counter.mjs',cwd:${JSON.stringify(root)},enabled:true}]};`);
const units = [];
for (const mode of ['owner', 'backend']) {
  const file = path.join(root, `${mode}.plist`);
  await fs.writeFile(file, renderLaunchdPlist({ scope: 'user', execPath: artifact.execPath,
    entryPath: path.join(artifact.directory, 'daemon/managed-entry.js'), args: [mode], label: config[mode].label,
    nodeArgs: [],
    restart: mode === 'backend', workdir: path.dirname(artifact.directory), path: process.env.PATH,
    environment: { OMNITRON_HOME: instance }, stderrLog: path.join(root, `${mode}.log`) }));
  await run('/usr/bin/plutil', ['-lint', file]);
  units.push({ file, job: `${domain}/${config[mode].label}` });
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
let sampler, inFlight = false, samples = 0, failures = 0, ownerPid, applicationPid;
try {
  for (const unit of units) await native(['bootstrap', domain, unit.file]);
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
  sampler = setInterval(async () => {
    if (inFlight) return; inFlight = true;
    try { const now = await probe(); assert.equal(now.pid, applicationPid); assert.equal(now.parent, ownerPid); samples++; }
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
  const after = await probe(); assert.ok(after.value > before.value); assert.equal(failures, 0);
  console.log(JSON.stringify({ test: 'independent-launchd-supervision', root, ownerPid, applicationPid,
    backends: [first.pid, upgraded.pid, recovered.pid, afterGuardian.pid], killedGuardian: guardian.pid, samples, failures }));
} finally {
  if (sampler) clearInterval(sampler);
  while (inFlight) await new Promise(resolve => setTimeout(resolve, 10));
  for (const unit of units.toReversed()) await native(['bootout', unit.job]).catch(() => {});
  if (ownerPid) await until(() => !PidManager.isProcessAlive(ownerPid), 'Fixture owner did not stop', 35_000);
  if (applicationPid) assert.equal(PidManager.isProcessAlive(applicationPid), false, 'Fixture app survived normal owner shutdown');
}
