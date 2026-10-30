import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';

// An explicit compiled artifact: the test never rebuilds or edits a runtime
// that might be serving real applications. Every file and process is ours.
const dist = path.resolve(process.argv[2] ?? 'dist');
const { ExecutionClient } = await import(pathToFileURL(path.join(dist, 'daemon/execution-client.js')));
const { DEFAULT_ECOSYSTEM, DEFAULT_DAEMON_CONFIG } = await import(pathToFileURL(path.join(dist, 'config/defaults.js')));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-owner-'));
await fs.chmod(directory, 0o700);
const config = { ...DEFAULT_ECOSYSTEM, apps: [] };
const daemonConfig = { ...DEFAULT_DAEMON_CONFIG, logDir: path.join(directory, 'logs') };
const boot = path.join(directory, 'boot.json');
const script = path.join(directory, 'counter.mjs');
await fs.writeFile(boot, JSON.stringify({ directory, cwd: directory, config, daemonConfig }), { mode: 0o600 });
await fs.writeFile(script, `
import http from 'node:http';
import fs from 'node:fs';
let counter = 0;
const started = Date.now();
const timer = setInterval(() => { counter++; }, 5);
const server = http.createServer((_request, response) => response.end(JSON.stringify({ pid: process.pid, parent: process.ppid, started, counter })));
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(${JSON.stringify(path.join(directory, 'address.json'))}, JSON.stringify({ port: server.address().port }));
  process.send?.({ type: 'ready' });
});
process.on('SIGTERM', () => { clearInterval(timer); server.close(() => process.exit(0)); });
`, { mode: 0o600 });
const output = await fs.open(path.join(directory, 'owner.log'), 'a', 0o600);
const owner = fork(path.join(dist, 'daemon/execution-entry.js'), [boot], {
  cwd: directory, execArgv: [], stdio: ['ignore', output.fd, output.fd, 'ipc'], detached: true,
});
await output.close();
const ownerExited = once(owner, 'exit');
const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };
const clients = [];
let failures = 0, samples = 0, sampler;
try {
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Owner boot timed out; inspect ${directory}/owner.log`)), 30_000);
    owner.once('error', reject);
    owner.once('exit', code => { clearTimeout(deadline); reject(new Error(`Owner exited ${code}; inspect ${directory}/owner.log`)); });
    owner.once('message', message => {
      clearTimeout(deadline);
      assert.equal(message.type, 'execution-ready');
      assert.equal(message.owner.pid, owner.pid);
      resolve();
    });
  });
  assert.equal((await fs.stat(path.join(directory, 'owner.sock'))).mode & 0o777, 0o600);
  const first = new ExecutionClient(path.join(directory, 'owner.sock'), logger);
  clients.push(first);
  await first.connect();
  await first.acquire();
  const launched = await first.orchestrator.startApp({ name: 'fixture/local/counter', script, cwd: directory, enabled: true }, config);
  const { port } = JSON.parse(await fs.readFile(path.join(directory, 'address.json'), 'utf8'));
  const probe = async () => {
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const before = await probe();
  assert.equal(before.pid, launched.pid);
  assert.equal(before.parent, owner.pid);
  await first.activateObservations();
  let inProbe = false;
  sampler = setInterval(async () => {
    if (inProbe) return;
    inProbe = true;
    try {
      const sample = await probe();
      assert.equal(sample.pid, before.pid);
      assert.equal(sample.parent, before.parent);
      assert.equal(sample.started, before.started);
      samples++;
    } catch { failures++; }
    finally { inProbe = false; }
  }, 10);
  let current = first;
  // Force genuine transport closure while retaining both facade and grant.
  // Neither a re-created owner nor an application restart may repair this.
  for (let index = 0; index < 3; index++) {
    const prior = current.state();
    await Promise.all([current.connection.disconnect(), current.observations.disconnect()]);
    await current.refresh();
    assert.equal(current.state().connection.status, 'connected');
    assert.equal(current.state().owner.id, prior.owner.id);
    assert.equal(current.state().epoch, prior.epoch);
    assert.equal(current.orchestrator.getApp('fixture/local/counter').pid, before.pid);
    assert.equal(await current.orchestrator.getDependencyGraph('fixture/local/counter'), null);
  }
  for (let index = 0; index < 10; index++) {
    const next = new ExecutionClient(path.join(directory, 'owner.sock'), logger);
    clients.push(next);
    await next.connect();
    const prepared = await current.prepare(next.controllerId);
    assert.equal(prepared.snapshot.apps[0].info.pid, before.pid);
    await next.accept(prepared.ticket, prepared.snapshot.inventoryDigest);
    await assert.rejects(() => current.orchestrator.stopApp('fixture/local/counter'), /no longer owns|CONTROLLER_FENCED/);
    await current.close();
    current = next;
    const seen = current.orchestrator.getApp('fixture/local/counter');
    assert.equal(seen.pid, before.pid);
    assert.equal(seen.restarts, 0);
  }
  const after = await probe();
  assert.equal(after.pid, before.pid);
  assert.equal(after.started, before.started);
  assert.ok(after.counter > before.counter);
  clearInterval(sampler);
  while (inProbe) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(failures, 0);
  assert.ok(samples > 0);
  await current.orchestrator.stopAll(false);
  await current.shutdownOwner();
  const [code] = await ownerExited;
  assert.equal(code, 0);
  console.log(JSON.stringify({ test: 'resident-owner-handoff', transfers: 10, ownerPid: before.parent,
    applicationPid: before.pid, restarts: 0, reconnects: 3, httpSamples: samples, failedSamples: failures,
    counterBefore: before.counter, counterAfter: after.counter, directory }));
} finally {
  if (sampler) clearInterval(sampler);
  await Promise.allSettled(clients.map(client => client.close()));
  // Only the process created above, never a discovered or production pid.
  if (owner.exitCode === null && owner.signalCode === null) {
    owner.kill('SIGTERM');
    await ownerExited;
  }
}
