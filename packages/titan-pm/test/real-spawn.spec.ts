/**
 * A worker that is actually spawned.
 *
 * Every other suite in this package runs against a mock spawner, including the
 * ones whose names say otherwise: `real-transports.spec.ts` is titled "Tests
 * all documented IPC transport types with real process spawning" and calls
 * `ProcessSpawnerFactory.setMockSpawner(AdvancedMockProcessSpawner)` in
 * `beforeAll`, unconditionally. `http-cluster.spec.ts` uses
 * `createTestProcessManager`, which is `{ mock: true }`. No test in titan-pm
 * had ever forked a process, and titan-pm spawns everything omnitron runs — so
 * a worker that fails to boot, or boots and never signals ready, was something
 * no test could catch.
 *
 * These tests use the real ProcessSpawner (`testing.useMockSpawner: false`).
 * They fork `dist/fork-worker.js`, which imports a compiled worker module and
 * serves its `@Public` methods over the configured transport. The worker file
 * is generated here as plain JavaScript importing this package's own compiled
 * decorators, which is exactly the shape production workers have.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProcessManager } from '../src/process-manager.js';
import { LoggerService } from '@omnitron-dev/titan/module/logger';

const PACKAGE_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DECORATORS = join(PACKAGE_DIR, 'dist', 'decorators.js');

// The spawner forks `dist/fork-worker.js`; without a build there is nothing to
// fork, and a test that silently passed in that case would be worthless.
//
// A STALE dist is the sharper hazard: these tests import the compiled
// decorators, so a change to `src/decorators.ts` is invisible here until
// `pnpm build` runs. That is not a quirk of the test — it is how every
// consumer of this package resolves it, which is why the suite is worth
// running against a fresh build rather than against sources.
const distReady = existsSync(join(PACKAGE_DIR, 'dist', 'fork-worker.js')) && existsSync(DIST_DECORATORS);
if (!distReady) {
  console.log('⏭️  Skipping real-spawn.spec.ts — run `pnpm build` in titan-pm first (dist/ is the fork target)');
}
const describeOrSkip = distReady ? describe : describe.skip;

// Inside the package, not the OS temp dir: a worker file elsewhere on disk
// cannot resolve this package's dependencies, and the spawned process needs
// them the same way a production worker does.
const TMP = mkdtempSync(join(PACKAGE_DIR, 'node_modules', '.real-spawn-'));

/**
 * Writes a compiled-shape worker module: a default-exported class carrying the
 * same metadata the TypeScript decorators produce, applied by calling them.
 */
function writeWorker(name: string, body: string): string {
  const file = join(TMP, `${name}.js`);
  writeFileSync(
    file,
    `import 'reflect-metadata';
import { Process, Public, HealthCheck } from ${JSON.stringify(DIST_DECORATORS)};

${body}

for (const method of Worker.__public) {
  Public()(Worker.prototype, method, Object.getOwnPropertyDescriptor(Worker.prototype, method));
}
if (typeof Worker.prototype.myHealth === 'function') {
  HealthCheck()(Worker.prototype, 'myHealth', Object.getOwnPropertyDescriptor(Worker.prototype, 'myHealth'));
}
Process({ name: ${JSON.stringify(name)}, version: '1.0.0' })(Worker);

export default Worker;
`
  );
  return file;
}

describeOrSkip('a genuinely spawned worker', () => {
  let pm: ProcessManager;
  const logger = new LoggerService({ level: 'error', pretty: false }).child({ module: 'real-spawn' });

  beforeAll(() => {
    // Fail loudly rather than skip if the build is stale in CI.
    expect(existsSync(DIST_DECORATORS)).toBe(true);
  });

  afterEach(async () => {
    await pm?.shutdown({ force: true, timeout: 10_000 }).catch(() => {});
  });

  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  function manager(): ProcessManager {
    // `isolation` here is the spawn strategy, and the manager config is where
    // it belongs: a per-spawn override exists (`ISpawnOptions.isolation`) but
    // nothing in `IProcessOptions` sets it. The default is 'worker' — worker
    // threads, which share the parent's PID.
    //
    // This comment used to say the strategy was reachable only from here
    // BECAUSE ProcessManager forwarded `security.isolation` into the strategy
    // slot. That was an accurate account of a defect, which is why it read as
    // design for as long as it did.
    pm = new ProcessManager(logger as never, {
      testing: { useMockSpawner: false },
      isolation: 'child',
    } as never);
    return pm;
  }

  it('runs its methods in a different OS process', async () => {
    const file = writeWorker('calculator', `
class Worker {
  static __public = ['add', 'pid'];
  async add(a, b) { return a + b; }
  async pid() { return process.pid; }
}`);

    const proc = await manager().spawn(file, { name: 'calculator' });

    expect(await proc.add(2, 3)).toBe(5);

    // The assertion a mock cannot make: the work happened somewhere else.
    const workerPid = await proc.pid();
    expect(typeof workerPid).toBe('number');
    expect(workerPid).not.toBe(process.pid);
  }, 60_000);

  it('keeps state inside the worker, not the caller', async () => {
    const file = writeWorker('counter', `
class Worker {
  static __public = ['increment', 'value'];
  #n = 0;
  async increment() { return ++this.#n; }
  async value() { return this.#n; }
}`);

    const proc = await manager().spawn(file, { name: 'counter' });

    await proc.increment();
    await proc.increment();

    expect(await proc.value()).toBe(2);
  }, 60_000);

  it('surfaces an error thrown inside the worker', async () => {
    const file = writeWorker('thrower', `
class Worker {
  static __public = ['boom'];
  async boom() { throw new Error('worker exploded'); }
}`);

    const proc = await manager().spawn(file, { name: 'thrower' });

    await expect(proc.boom()).rejects.toThrow(/worker exploded/);
  }, 60_000);

  it('says out loud that vm/container isolation is not implemented', async () => {
    // `security.isolation` accepts 'vm' and 'container', and both spawn a plain
    // child process — same filesystem, same network as the parent. That is not
    // a naming quibble: a caller who sets 'container' expecting confinement
    // gets none, and used to get no indication either. The contract stays;
    // the silence does not.
    const file = writeWorker('confined', `
class Worker {
  static __public = ['pid'];
  async pid() { return process.pid; }
}`);

    // A recording logger rather than a spread of the real one: the spawner and
    // Netron both call `logger.child(...)`, and a spread loses it.
    const warn = vi.fn();
    const recording: Record<string, unknown> = {
      warn,
      info: () => {},
      debug: () => {},
      error: () => {},
      trace: () => {},
      fatal: () => {},
    };
    recording['child'] = () => recording;
    pm = new ProcessManager(recording as never, {
      testing: { useMockSpawner: false },
      isolation: 'child',
    } as never);

    const proc = await pm.spawn(file, { name: 'confined', security: { isolation: 'container' } } as never);
    expect(await proc.pid()).not.toBe(process.pid);

    const messages = warn.mock.calls.map((call) => String(call[1] ?? call[0]));
    expect(messages.some((message) => /container.*not implemented/i.test(message))).toBe(true);
    expect(messages.some((message) => /security boundary/i.test(message))).toBe(true);
  }, 60_000);

  it('does not report a thread-backed worker under the daemon pid', async () => {
    // A worker thread has no pid of its own. `processInfo.pid` used to fall
    // back to `process.pid`, so such a worker was published as running under
    // the daemon's own pid — and every consumer that asked the OS about it got
    // "alive", because the daemon is. A dead worker read as healthy, and `ps`
    // sampling measured the daemon's memory instead of the worker's.
    const file = writeWorker('threaded', `
class Worker {
  static __public = ['ok'];
  async ok() { return true; }
}`);

    // Default isolation is 'worker' — worker threads.
    pm = new ProcessManager(logger as never, { testing: { useMockSpawner: false } } as never);
    const proc = await pm.spawn(file, { name: 'threaded' });
    expect(await proc.ok()).toBe(true);

    const infos = pm.listProcesses().filter((info) => info.name === 'threaded');
    expect(infos).toHaveLength(1);
    expect(infos[0]!.pid).toBeUndefined();
  }, 60_000);

  it('does not let a sandbox setting choose the spawn strategy', async () => {
    // Two vocabularies share the name `isolation`, and one variable in the
    // spawner holds both. `IProcessOptions.security.isolation` is
    // 'none' | 'vm' | 'container' — a sandbox setting. `IProcessManagerConfig.
    // isolation` is 'none' | 'worker' | 'child' — a spawn strategy. The manager
    // forwards the first into the slot the spawner reads as the second
    // (`options.isolation || this.config.isolation || 'worker'`), so ANY
    // per-process security value short-circuits the `||` and the configured
    // strategy is never consulted.
    //
    // 'none' is where the two collide on one string: it means "no sandbox" to
    // the caller and "in-process, for testing" to the spawner — and the
    // spawner's reading also gates the Netron management client
    // (`if (isolation !== 'none')`). So declaring a process unsandboxed, the
    // ordinary production posture, both downgraded it to a child process and
    // took away its service proxy. The failure surfaces later and elsewhere, as
    // 'NetronClient not available for service proxy'.
    const file = writeWorker('unsandboxed', `
class Worker {
  static __public = ['ok'];
  async ok() { return true; }
}`);

    pm = new ProcessManager(logger as never, {
      testing: { useMockSpawner: false },
      isolation: 'worker',
    } as never);

    const proc = await pm.spawn(file, {
      name: 'unsandboxed',
      security: { isolation: 'none' },
    } as never);

    // The proxy must exist: asking for no sandbox says nothing about how the
    // process is reached.
    expect(await proc.ok()).toBe(true);

    // And the configured strategy must survive: a worker thread has no pid of
    // its own, a child process does.
    const infos = pm.listProcesses().filter((info) => info.name === 'unsandboxed');
    expect(infos).toHaveLength(1);
    expect(infos[0]!.pid).toBeUndefined();
  }, 60_000);

  it('calls a @HealthCheck method and reports what it says', async () => {
    // `@HealthCheck` wrote its metadata under the string key 'health-check' on
    // the prototype, while the worker runtime scans each method's entry under
    // PROCESS_METHOD_METADATA_KEY for a `healthCheck` field. The two never met:
    // `healthCheckMethods` was always empty, so `__getProcessHealth` answered
    // `{ status: 'healthy', checks: [] }` for every worker — including one that
    // knew it was degraded, which is the exact inversion a custom health check
    // exists to prevent. The pool's health monitor consumes this answer.
    const file = writeWorker('healthful', `
class Worker {
  static __public = ['ping'];
  async ping() { return 'pong'; }
  async myHealth() { return { status: 'degraded', message: 'deliberately degraded' }; }
}`);

    // The generated worker applies @Public from its __public list; the health
    // method is decorated here so the runtime has something to find.
    const proc = await manager().spawn(file, { name: 'healthful' });

    const health = (await (proc as unknown as {
      __getProcessHealth(): Promise<{ status: string; checks: Array<{ name: string; status: string }> }>;
    }).__getProcessHealth());

    expect(health.checks.map((check) => check.name)).toContain('myHealth');
    expect(health.status).toBe('degraded');
  }, 60_000);

  // Each documented transport, against a process that is actually spawned.
  //
  // `real-transports.spec.ts` is titled "Tests all documented IPC transport
  // types with real process spawning" and installs a mock spawner, so it checks
  // that a transport name is accepted and carried into the spawn context — not
  // that bytes cross a process boundary over it. These do: the assertion is a
  // round trip through a worker running in another process, which fails if the
  // socket is never opened, if the URL is malformed, or if the child cannot
  // dial back.
  // `expectedType` is what the spawner should resolve the option to — note
  // that 'websocket' maps to 'ws'. Asserting it matters: without it all three
  // cases would pass identically if the option stopped reaching the spawner
  // and everything fell back to the default unix socket, which is the failure
  // this file exists to make visible.
  for (const [name, transport, expectedType] of [
    ['unix', 'unix', 'unix'],
    ['tcp', 'tcp', 'tcp'],
    ['websocket', 'websocket', 'ws'],
  ] as const) {
    it(`carries a call over the ${name} transport`, async () => {
      const file = writeWorker(`transport-${name}`, `
class Worker {
  static __public = ['echo'];
  async echo(value) { return { value, pid: process.pid }; }
}`);

      const pm = manager();
      const proc = await pm.spawn(file, {
        name: `transport-${name}`,
        netron: { transport },
      } as never);

      const result = (await (proc as unknown as {
        echo(v: string): Promise<{ value: string; pid: number }>;
      }).echo('over-the-wire'));

      expect(result.value).toBe('over-the-wire');
      // Same proof as elsewhere: the work happened somewhere else.
      expect(result.pid).not.toBe(process.pid);

      // And it went over the transport that was asked for.
      const handle = [...(pm as unknown as { workers: Map<string, { transportConfig?: { type: string } }> }).workers.values()][0];
      expect(handle?.transportConfig?.type).toBe(expectedType);
    }, 60_000);
  }

  it('stops the OS process on shutdown', async () => {
    const file = writeWorker('stoppable', `
class Worker {
  static __public = ['pid'];
  async pid() { return process.pid; }
}`);

    const proc = await manager().spawn(file, { name: 'stoppable' });
    const workerPid = (await proc.pid()) as number;

    // Alive now: signal 0 probes existence without delivering anything.
    expect(() => process.kill(workerPid, 0)).not.toThrow();

    await pm.shutdown({ force: true, timeout: 10_000 });

    const deadline = Date.now() + 10_000;
    let alive = true;
    while (alive && Date.now() < deadline) {
      try {
        process.kill(workerPid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
      }
    }

    expect(alive).toBe(false);
  }, 60_000);
});
