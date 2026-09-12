/**
 * `@PreDestroy` only ever ran when the application FAILED to start.
 *
 * `start()` ends with `container.initialize()`, which runs every
 * `@PostConstruct`. `stop()` ran stop hooks, shutdown tasks and the module
 * loop — and nothing that reached the DI instances. The single caller of
 * `container.dispose()` was the failed-start rollback, so the only teardown
 * an instance ever got was the one after the app never came up.
 *
 * Measured on the downstream stand before the fix: `Storage outbox dispatcher
 * ready` (a `@PostConstruct` line) appeared 120 times, `… shutting down` and
 * `… stopped` (its `@PreDestroy` lines) zero times each. Across five backends
 * every `@PreDestroy` log message was at zero, and the two that were not sat
 * directly under `Failed to start http server`.
 *
 * The cost was not only the lost drain. Storage's dispatcher polls every
 * 200 ms; with its timer never cleared it kept firing through the shutdown,
 * so each stop ended in `Failed to process outbox: Database connection with
 * id default not found` at level 50 — 81 in the log, every one of them after
 * `All database connections closed`.
 *
 * ORDER is the point of these tests, not merely arrival: a drain that runs
 * after the pool it drains into has closed is the bug, not the fix.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, type IModule } from '../../src/types.js';
import { Injectable, PostConstruct, PreDestroy } from '../../src/decorators/index.js';
import { createToken } from '../../src/nexus/index.js';

let app: Application | undefined;

afterEach(async () => {
  if (app && app.state === ApplicationState.Started) await app.stop({ force: true });
  app = undefined;
});

/** A module standing in for the one that owns a connection pool. */
class PoolModule implements IModule {
  name = 'pool';
  constructor(private readonly trace: string[]) {}
  async onStart() { this.trace.push('pool:open'); }
  async onStop() { this.trace.push('pool:close'); }
}

const WORKER = createToken<Worker>('TeardownWorker');

@Injectable()
class Worker {
  static trace: string[] = [];
  @PostConstruct() ready() { Worker.trace.push('worker:construct'); }
  @PreDestroy() async drain() {
    // Asynchronous on purpose: the caller must await it, or a drain that
    // yields once is indistinguishable from one that never ran.
    await Promise.resolve();
    Worker.trace.push('worker:drain');
  }
}

async function appWith(trace: string[]): Promise<Application> {
  const a = await Application.create({
    disableGracefulShutdown: true,
    disableCoreModules: true,
    providers: [[WORKER, { useClass: Worker }]],
  });
  a.use(new PoolModule(trace) as any);
  return a;
}

describe('stop() tears down DI instances', () => {
  it('runs @PreDestroy at all, and before the module that owns the resource', async () => {
    Worker.trace = [];
    const trace = Worker.trace;
    app = await appWith(trace);
    // Resolved before start, the way a module's own providers are: that is
    // what puts the instance in front of `container.initialize()`.
    app.resolve(WORKER);
    await app.start();

    expect(trace, '@PostConstruct is the half that already worked').toContain('worker:construct');

    await app.stop();

    expect(trace, '@PreDestroy never ran on a normal stop').toContain('worker:drain');
    expect(
      trace.indexOf('worker:drain'),
      'the drain ran after the pool closed — which is the defect, not the fix',
    ).toBeLessThan(trace.indexOf('pool:close'));
  });

  it('awaits an async @PreDestroy rather than firing and forgetting it', async () => {
    Worker.trace = [];
    let settled = false;

    @Injectable()
    class Slow {
      @PreDestroy() async drain() {
        await new Promise((r) => setTimeout(r, 25));
        settled = true;
      }
    }
    const SLOW = createToken<Slow>('SlowTeardown');

    app = await Application.create({
      disableGracefulShutdown: true,
      disableCoreModules: true,
      providers: [[SLOW, { useClass: Slow }]],
    });
    await app.start();
    app.resolve(SLOW);

    await app.stop();
    expect(settled, 'stop() returned while the drain was still running').toBe(true);
  });

  it('destroys again on a second stop, so restart is a cycle and not a one-shot', async () => {
    Worker.trace = [];
    const trace = Worker.trace;
    app = await appWith(trace);
    app.resolve(WORKER);

    await app.start();
    await app.stop();
    await app.start();
    await app.stop();

    // The disposal marks make teardown idempotent within one stop; left
    // standing they would make the SECOND stop a silent no-op.
    expect(trace.filter((e) => e === 'worker:drain')).toHaveLength(2);
    expect(trace.filter((e) => e === 'worker:construct')).toHaveLength(2);
  });

  it('keeps stopping when a @PreDestroy throws', async () => {
    const trace: string[] = [];

    @Injectable()
    class Angry {
      @PreDestroy() boom(): void { throw new Error('drain exploded'); }
    }
    const ANGRY = createToken<Angry>('AngryTeardown');

    app = await Application.create({
      disableGracefulShutdown: true,
      disableCoreModules: true,
      providers: [[ANGRY, { useClass: Angry }]],
    });
    app.use(new PoolModule(trace) as any);
    await app.start();
    app.resolve(ANGRY);

    await expect(app.stop()).resolves.not.toThrow();
    expect(trace, 'one bad provider aborted the module teardown').toContain('pool:close');
    expect(app.state).toBe(ApplicationState.Stopped);
  });

  it('skips the teardown on a force stop with no timeout, as the module loop does', async () => {
    Worker.trace = [];
    const trace = Worker.trace;
    app = await appWith(trace);
    app.resolve(WORKER);
    await app.start();

    await app.stop({ force: true });

    expect(trace, 'a force stop without a timeout must not wait on a drain').not.toContain('worker:drain');
  });
});
