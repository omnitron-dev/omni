import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { linkFixtureDependencies } from '../helpers/installed-dependencies.js';

it('runs compiled and source system workers from an ecosystem without loader dependencies', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-system-worker-'));
  const installation = path.join(root, 'installed');
  const ecosystem = path.join(root, 'ecosystem');
  try {
    await fs.mkdir(installation);
    await fs.mkdir(ecosystem);
    await fs.writeFile(path.join(installation, 'package.json'), '{"type":"module"}');
    await linkFixtureDependencies(installation, ['@omnitron-dev/titan-pm', '@omnitron-dev/titan', 'reflect-metadata', 'tsx']);
    const worker = path.join(installation, 'probe.ts');
    await fs.writeFile(worker, `import 'reflect-metadata';
import { Process } from '@omnitron-dev/titan-pm';
enum State { Ready = 'ready' }
class Probe {
  snapshot() { return { value: State.Ready, pid: process.pid, cwd: process.cwd(), execArgv: process.execArgv }; }
}
Process({ name: 'system-worker-runtime-probe', allMethodsPublic: true })(Probe);
export default Probe;
`);
    await build({ entryPoints: [worker], outfile: path.join(installation, 'probe.js'),
      platform: 'node', format: 'esm', target: 'node24' });
    await build({ entryPoints: [path.resolve(import.meta.dirname, '../../src/workers/system-worker-manager.ts')],
      outfile: path.join(installation, 'manager.js'), bundle: true, packages: 'external',
      platform: 'node', format: 'esm', target: 'node24' });
    const runner = path.join(installation, 'run.js');
    await fs.writeFile(runner, `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ProcessManager } from '@omnitron-dev/titan-pm';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { SystemWorkerManager } from './manager.js';
const ecosystem = ${JSON.stringify(ecosystem)};
process.chdir(ecosystem);
assert.ok(process.execArgv.includes('tsx/esm'), 'Exercise a daemon started with a loader');
assert.throws(() => createRequire(path.join(ecosystem, 'entry.js')).resolve('tsx/esm'), { code: 'MODULE_NOT_FOUND' });
const logger = createNullLogger();
const pm = new ProcessManager(logger, { isolation: 'child', testing: { useMockSpawner: false } });
const manager = new SystemWorkerManager(pm, logger);
const rows = [];
try {
  for (const extension of ['js', 'ts']) {
    const worker = await manager.spawn(extension, path.join(import.meta.dirname, 'probe.' + extension), {}, { startupTimeout: 15000 });
    const observed = await worker.snapshot();
    assert.equal(observed.cwd, ecosystem);
    assert.notEqual(observed.pid, process.pid);
    assert.equal(observed.value, 'ready');
    assert.deepEqual(observed.execArgv, extension === 'js' ? [] : ['--import', import.meta.resolve('tsx/esm')]);
    assert.equal(manager.isAlive(extension), true);
    rows.push({ extension, ...observed });
    await manager.stop(extension);
    assert.equal(manager.isAlive(extension), false);
  }
} finally {
  await manager.stopAll();
  await pm.shutdown({ force: true, timeout: 10000 });
}
console.log('system-worker-proof ' + JSON.stringify(rows));
`);
    const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx/esm', runner], {
      cwd: installation, env, encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024,
    });
    const proof = result.stdout.split('\n').find(line => line.startsWith('system-worker-proof '));
    expect(proof, result.stderr).toBeDefined();
    const rows = JSON.parse(proof!.slice('system-worker-proof '.length));
    expect(rows.map((row: { extension: string }) => row.extension)).toEqual(['js', 'ts']);
    expect(rows[0].pid).not.toBe(rows[1].pid);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 60000);
