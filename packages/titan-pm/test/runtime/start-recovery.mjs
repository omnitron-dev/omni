import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// An explicit staged package: never compile or alter a live application's runtime.
const root = path.resolve(process.argv[2]);
const require = createRequire(path.join(root, 'package.json'));
const { createNullLogger } = await import(require.resolve('@omnitron-dev/titan/module/logger'));
const { ProcessManager, SupervisionStrategy } = await import(pathToFileURL(path.join(root, 'dist/index.js')));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'titan-recovery-'));
await fs.symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
const blocked = path.join(directory, 'dependency-down');
const worker = path.join(directory, 'worker.mjs');
await fs.writeFile(worker, `
import 'reflect-metadata';
import fs from 'node:fs';
import { Process, Public } from ${JSON.stringify(pathToFileURL(path.join(root, 'dist/decorators.js')).href)};
class Worker {
  async init({ blocked }) { if (blocked && fs.existsSync(blocked)) throw new Error('fixture dependency unavailable'); }
  async identity() { return { pid: process.pid, parent: process.ppid }; }
}
Public()(Worker.prototype, 'identity', Object.getOwnPropertyDescriptor(Worker.prototype, 'identity'));
Process({ name: 'fixture-worker', version: '1.0.0' })(Worker);
export default Worker;
`);
const manager = new ProcessManager(createNullLogger(), { isolation: 'child', testing: { useMockSpawner: false } });
const supervisor = manager.createSupervisor({ strategy: SupervisionStrategy.ONE_FOR_ONE, maxRestarts: 5, window: 60_000,
  backoff: { type: 'fixed', initial: 100, max: 100 }, children: [
    { name: 'stable', process: worker, spawnOptions: { logLevel: 'error', startupTimeout: 5000 } },
    { name: 'recovering', process: worker, spawnOptions: { logLevel: 'error', startupTimeout: 5000, dependencies: { blocked } } },
  ] });
const pids = new Set(); let failures = 0, checks = 0, restored = false;
supervisor.on('child:started', name => {
  const info = manager.getProcess(supervisor.getChildProcessId(name));
  if (info?.pid) pids.add(info.pid);
});
supervisor.on('child:start-failed', (name, error) => {
  if (name === 'recovering') {
    assert.match(String(error), /fixture dependency unavailable/);
    failures++;
    if (failures === 2) void fs.unlink(blocked).then(() => { restored = true; });
  }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await supervisor.start();
  const stable = await supervisor.getChildProxy('stable').identity();
  const before = await supervisor.getChildProxy('recovering').identity();
  assert.notEqual(before.pid, process.pid);
  await fs.writeFile(blocked, 'down');
  process.kill(before.pid, 'SIGKILL');
  const deadline = Date.now() + 30_000;
  let after;
  while (Date.now() < deadline) {
    assert.deepEqual(await supervisor.getChildProxy('stable').identity(), stable); checks++;
    if (restored && supervisor.getChildProxy('recovering')) {
      try { after = await supervisor.getChildProxy('recovering').identity(); if (after.pid !== before.pid) break; } catch {}
    }
    await sleep(20);
  }
  assert.ok(after && after.pid !== before.pid, 'Recovery did not produce a new ready worker');
  assert.equal(failures, 2);
  assert.equal(supervisor.getRestartCount('recovering'), 3);
  assert.equal(after.parent, process.pid);
  console.log(JSON.stringify({ ok: true, failures, checks, stable: stable.pid, before: before.pid, recovered: after.pid }));
} finally {
  await supervisor.stop(); await manager.shutdown({ force: true, timeout: 10_000 });
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await fs.rm(directory, { recursive: true, force: true });
}
