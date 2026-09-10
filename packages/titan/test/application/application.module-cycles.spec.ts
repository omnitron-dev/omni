/**
 * Module cycles.
 *
 * Two modules that need each other can only be written one way in
 * TypeScript: one of them names the other through `forwardRef`, because the
 * class it names does not exist yet when its own decorator runs. Both halves
 * of that were broken.
 *
 * `resolveInput` classifies a plain function by whether it looks like a class.
 * A `forwardRef` thunk does not, so it was treated as a module FACTORY and
 * its result — a module class — was stored as the module instance. The name
 * looked right and the module appeared in `getModules()`, but none of its
 * providers were ever registered; the first resolution of anything it
 * provided failed with "Token is not registered" against a module that
 * appears to be loaded.
 *
 * And once that was fixed, the cycle itself did not terminate: `register()`
 * marked a class as processed only after walking its imports, so re-entering
 * through the cycle found an unprocessed class and recursed until the stack
 * ran out.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState } from '../../src/types.js';
import { Module } from '../../src/decorators/index.js';
import { createToken, Scope, forwardRef, type Container } from '../../src/nexus/index.js';

/**
 * A module cycle is legal. A PROVIDER cycle inside one is not, and the
 * difference matters: modules that import each other are a wiring choice,
 * while two providers that each need the other finished before they can be
 * constructed cannot both be satisfied. The container has to say so instead
 * of waiting on itself.
 */

const EARLY = createToken<{ describe(): string }>('CycleEarly');
const LATE = createToken<{ describe(): string }>('CycleLate');

@Module({
  imports: [forwardRef(() => LateModule)] as never,
  providers: [
    [
      EARLY,
      {
        useFactory: (late: { describe(): string }) => ({ describe: () => `early→${late.describe()}` }),
        inject: [LATE],
        scope: Scope.Transient,
      },
    ],
  ],
  exports: [EARLY],
})
class EarlyModule {}

@Module({
  imports: [EarlyModule],
  providers: [[LATE, { useFactory: () => ({ describe: () => 'late' }), scope: Scope.Transient }]],
  exports: [LATE],
})
class LateModule {}

const RING_A = createToken<{ v(): string }>('CycleRingA');
const RING_B = createToken<{ v(): string }>('CycleRingB');

@Module({
  imports: [forwardRef(() => RingBModule)] as never,
  providers: [[RING_A, { useFactory: (b: { v(): string }) => ({ v: () => `a${b.v()}` }), inject: [RING_B] }]],
  exports: [RING_A],
})
class RingAModule {}

@Module({
  imports: [RingAModule],
  providers: [[RING_B, { useFactory: (a: { v(): string }) => ({ v: () => `b${a.v()}` }), inject: [RING_A] }]],
  exports: [RING_B],
})
class RingBModule {}

describe('Application module cycles', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) await app.stop({ force: true });
  });

  it('registers the providers behind a forwardRef import', async () => {
    app = await Application.create({ imports: [EarlyModule], disableGracefulShutdown: true });

    // Synchronous: `resolveAsync` performs no module-access check, so only
    // this path proves both the registration and the access rule.
    const early = (app.container as Container).resolve(EARLY);

    expect(early.describe()).toBe('early→late');
  });

  it('records the import in both directions', async () => {
    app = await Application.create({ imports: [EarlyModule], disableGracefulShutdown: true });
    const moduleImports = (app.container as unknown as { moduleImports: Map<string, Set<string>> }).moduleImports;

    expect([...moduleImports].map(([name, imports]) => [name, [...imports]]).sort()).toEqual([
      ['EarlyModule', ['LateModule']],
      ['LateModule', ['EarlyModule']],
    ]);
  });

  it('registers each module in the cycle exactly once', async () => {
    app = await Application.create({ imports: [EarlyModule], disableGracefulShutdown: true });

    const names = app.getModules().map((m) => m.name);

    expect(names.filter((n) => n === 'EarlyModule')).toHaveLength(1);
    expect(names.filter((n) => n === 'LateModule')).toHaveLength(1);
  });

  it('refuses a provider cycle inside a module cycle instead of waiting on itself', async () => {
    let message = 'no error — the container resolved a provider that needs itself';
    try {
      const created = await Application.create({ imports: [RingAModule], disableGracefulShutdown: true });
      await created.stop({ force: true });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/[Cc]ircular/);
  }, 20000);
});
