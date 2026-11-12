import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProcessManager } from '@omnitron-dev/titan-pm';
import { shutdownLadder } from '../../../../packages/titan-pm/src/shutdown-windows.js';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import type { IEcosystemAppEntry, IEcosystemConfig } from '../../src/config/types.js';

// Exercise the real Omnitron launch methods, supervisor, pool and native fork.
// Only the app-specific worker is a fixture; it reports its actual cwd over RPC.
let root: string;
let pm: ProcessManager;
let supervisor: { stop(): Promise<void> } | undefined;
afterEach(async () => {
  try { await supervisor?.stop(); }
  finally {
    await pm?.shutdown({ force: true, timeout: 10000 });
    if (root) rmSync(root, { recursive: true, force: true });
    supervisor = undefined;
  }
});

const config = {
  supervision: { strategy: 'one_for_one', maxRestarts: 0, window: 60000,
    backoff: { type: 'exponential', initial: 300, max: 30000, factor: 2 } },
  monitoring: { healthCheck: { interval: 30000, timeout: 5000 } },
} as IEcosystemConfig;

function setup() {
  const packageRoot = resolve(import.meta.dirname, '../..');
  root = mkdtempSync(join(packageRoot, 'node_modules', '.bootstrap-cwd-'));
  const application = join(root, 'application');
  const owner = join(root, 'sealed-owner');
  mkdirSync(application); mkdirSync(owner);
  const worker = join(root, 'worker.mjs');
  const decorators = pathToFileURL(resolve(packageRoot, '../../packages/titan-pm/dist/decorators.js')).href;
  writeFileSync(worker, `import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { Process, Public } from ${JSON.stringify(decorators)};
class Worker {
  async inspect() { return { cwd: process.cwd(), pid: process.pid, marker: process.env.CWD_MARKER, shutdownWindow: process.env.TITAN_SHUTDOWN_TIMEOUT_MS }; }
  async write() { writeFileSync('application-state.txt', 'owned by the application'); return process.cwd(); }
  async unmarked() { return 'explicit-public'; }
}
for (const name of ['inspect', 'write']) Public()(Worker.prototype, name, Object.getOwnPropertyDescriptor(Worker.prototype, name));
Process({ name: 'cwd-proof', version: '1.0.0' })(Worker);
export default Worker;
`);
  const logger = createNullLogger();
  pm = new ProcessManager(logger, { isolation: 'child', testing: { useMockSpawner: false } });
  const service = new OrchestratorService(logger, pm, {} as never, application) as any;
  service.bootstrapRuntime = async () => worker;
  service.persistState = vi.fn();
  service.startPostOnlineCooldown = vi.fn();
  return { service, application, owner, worker };
}

it.each([
  { instances: 1, explicit: true }, { instances: 2, explicit: true },
  { instances: 1, explicit: false }, { instances: 2, explicit: false },
])('uses the app directory for native topology instances=$instances explicit=$explicit', async ({ instances, explicit }) => {
  const { service, application, owner, worker } = setup();
  if (explicit) service.cwd = owner;
  const entry: IEcosystemAppEntry = { name: 'cwd-proof', bootstrap: worker,
    ...(explicit && { cwd: application }), env: { CWD_MARKER: 'app-environment' } };
  const handle = new AppHandle(entry, 'bootstrap'); handle.markStarting();
  await service.launchTopology(entry, handle, config, worker, [{ name: 'main', module: worker, instances }]);
  supervisor = handle.supervisor!;
  const proxies = instances > 1
    ? handle.topologyPools.get('main')!.getWorkerIds().map(id => pm.getWorkerHandle(id)!.proxy)
    : [handle.supervisor!.getChildProxy('cwd-proof/main')];
  expect(proxies, JSON.stringify(handle.lastExit)).toHaveLength(instances);
  const ids = new Set<number>();
  for (const proxy of proxies) {
    const observed = await proxy.inspect();
    expect(observed.cwd).toBe(application);
    expect(observed.marker).toBe('app-environment');
    expect(observed.pid).not.toBe(process.pid);
    ids.add(observed.pid);
  }
  expect(ids.size).toBe(instances);
  expect(await proxies[0].write()).toBe(application);
  expect(readFileSync(join(application, 'application-state.txt'), 'utf8')).toBe('owned by the application');
  expect(readdirSync(owner)).toEqual([]);
}, 60000);

it('preserves explicit child shutdown and RPC visibility options without granting default access', async () => {
  const { application, worker } = setup();
  const restricted = await pm.spawn(worker, { name: 'restricted', cwd: application }) as any;
  await expect(restricted.unmarked()).rejects.toThrow();
  const beforeSpawn = vi.fn(async () => {});
  const declared = await pm.spawn(worker, { name: 'declared', cwd: application,
    shutdownTimeout: 12000, allMethodsPublic: true, beforeSpawn }) as any;
  expect(beforeSpawn).toHaveBeenCalledOnce();
  expect(await declared.unmarked()).toBe('explicit-public');
  const observation = await declared.inspect();
  expect(observation.cwd).toBe(application);
  expect(Number(observation.shutdownWindow)).toBe(shutdownLadder(12000).childWindowMs);
}, 60000);

it('refuses a separate cwd for threads instead of silently using the parent directory', async () => {
  const { application, worker } = setup();
  const threads = new ProcessManager(createNullLogger(), { isolation: 'worker', testing: { useMockSpawner: false } });
  try {
    await expect(threads.spawn(worker, { cwd: application })).rejects.toThrow('requires child isolation');
  } finally { await threads.shutdown({ force: true, timeout: 10000 }); }
}, 60000);

it('uses the same app directory for a topology child and its pool', async () => {
  const { service, application, owner, worker } = setup(); service.cwd = owner;
  const entry: IEcosystemAppEntry = { name: 'topology-cwd', bootstrap: worker, cwd: application };
  const handle = new AppHandle(entry, 'bootstrap'); handle.markStarting();
  await service.launchTopology(entry, handle, config, worker, [
    { name: 'http', module: worker }, { name: 'workers', module: worker, instances: 2 },
  ]);
  supervisor = handle.supervisor!;
  const single = handle.supervisor!.getChildProxy('topology-cwd/http') as any;
  const pool = handle.topologyPools.get('workers') as any;
  expect((await single.inspect()).cwd).toBe(application);
  expect((await pool.execute('inspect')).cwd).toBe(application);
  expect(await single.write()).toBe(application);
  expect(await pool.execute('write')).toBe(application);
  expect(readdirSync(owner)).toEqual([]);
}, 60000);
