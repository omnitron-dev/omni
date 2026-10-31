import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createRequire } from 'node:module';

// An explicit compiled artifact: the test never rebuilds or edits a runtime
// that might be serving real applications. Every file and process is ours.
const dist = path.resolve(process.argv[2] ?? 'dist');
const requireRuntime = createRequire(path.join(dist, 'index.js'));
const { Kysely, SqliteDialect } = await import(pathToFileURL(requireRuntime.resolve('kysely')));
const Database = requireRuntime('better-sqlite3');
const { LogCollectorService } = await import(pathToFileURL(path.join(dist, 'services/log-collector.service.js')));
const { logEntryOf } = await import(pathToFileURL(path.join(dist, 'monitoring/log-entry.js')));
const { withDateBinding } = await import(pathToFileURL(path.join(dist, 'database/sqlite-date-binding.js')));
const { ExecutionClient } = await import(pathToFileURL(path.join(dist, 'daemon/execution-client.js')));
const { DEFAULT_ECOSYSTEM, DEFAULT_DAEMON_CONFIG } = await import(pathToFileURL(path.join(dist, 'config/defaults.js')));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-owner-'));
await fs.chmod(directory, 0o700);
const config = { ...DEFAULT_ECOSYSTEM, apps: [] };
const sqlite = new Database(path.join(directory, 'fixture-logs.sqlite'));
sqlite.pragma('journal_mode=WAL'); sqlite.pragma('synchronous=FULL');
sqlite.exec(`CREATE TABLE logs(id TEXT PRIMARY KEY,timestamp TEXT NOT NULL,nodeId TEXT,app TEXT NOT NULL,level TEXT NOT NULL,message TEXT NOT NULL,labels TEXT,traceId TEXT,spanId TEXT,metadata TEXT);`);
const db = new Kysely({ dialect: new SqliteDialect({ database: withDateBinding(sqlite) }) });
const collector = new LogCollectorService(db);
const largeMessage = 'bootstrap:' + 'x'.repeat(8000);
const daemonConfig = { ...DEFAULT_DAEMON_CONFIG, logDir: path.join(directory, 'logs') };
const boot = path.join(directory, 'boot.json');
const script = path.join(directory, 'counter.mjs');
await fs.writeFile(boot, JSON.stringify({ directory, cwd: directory, config, daemonConfig }), { mode: 0o600 });
await fs.writeFile(script, `
import http from 'node:http';
import fs from 'node:fs';
process.stdout.write(JSON.stringify({level:30,time:'2026-10-31T01:02:03.004567Z',msg:${JSON.stringify(largeMessage)}})+'\\n');
process.stderr.write('Error: fixture boot detail\\n    at fixture\\n');
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
  cwd: directory, env: { ...process.env, OMNITRON_HOME: directory }, execArgv: [], stdio: ['ignore', output.fd, output.fd, 'ipc'], detached: true,
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
  first.setLogCollector(collector);
  await new Promise(resolve => setTimeout(resolve, 200));
  const capture = await first.remote.readLogs();
  assert(capture.some(item => item.value.record.message === largeMessage));
  assert(capture.some(item => item.value.record.message === 'Error: fixture boot detail\n    at fixture'));
  // Commit, then deliberately lose its acknowledgment. The ordinary poll replays it.
  await collector.persistCaptured(capture.map(item => logEntryOf(item.value.app, item.value.record)));
  await first.activateObservations();
  const stored = await db.selectFrom('logs').selectAll().execute();
  assert.equal(stored.filter(row => row.message === largeMessage).length, 1);
  assert.equal(stored.filter(row => row.message === 'Error: fixture boot detail\n    at fixture').length, 1);
  assert.equal((await first.remote.readLogs()).length, 0);
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
    await assert.rejects(() => next.remote.acknowledgeLogs({ grant: current.grant, records: [] }), /retired controller/);
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
    applicationPid: before.pid, durableLogRecords: stored.length, replayWithoutDuplicates: true, retiredLogAcknowledgmentsRefused: 10, restarts: 0, reconnects: 3, httpSamples: samples, failedSamples: failures,
    counterBefore: before.counter, counterAfter: after.counter, directory }));
} finally {
  if (sampler) clearInterval(sampler);
  await Promise.allSettled(clients.map(client => client.close()));
  await collector.dispose();
  await db.destroy();
  // Only the process created above, never a discovered or production pid.
  if (owner.exitCode === null && owner.signalCode === null) {
    owner.kill('SIGTERM');
    await ownerExited;
  }
}
