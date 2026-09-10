/**
 * Module encapsulation under `Application`.
 *
 * The container documents three access rules (`checkModuleAccess`):
 *   1. global providers are reachable everywhere;
 *   2. exported providers are reachable from an IMPORTING module and from
 *      the main container;
 *   3. everything else is reachable only inside its own module.
 *
 * Rule 2 reads `container.moduleImports`, an index the container fills in
 * while `loadModule` walks `module.imports`. Applications never take that
 * path: `ModuleRegistry.processDynamic` recurses through `register()` so
 * `forRoot()` results, factory modules and class-level dedup all work, and
 * then hands the container a module with providers and exports but no
 * imports. The index therefore stayed EMPTY for every application ever
 * booted, and both readers of it silently misbehaved:
 *
 *   - `checkModuleAccess` answered `Token not accessible: X` for a token
 *     the resolving module's own import exports;
 *   - re-exports (`exports: [TokenOwnedByAnImportedModule]`) were never
 *     forwarded, so the re-exporting module didn't actually re-export.
 *
 * Neither was visible in ordinary use because eager singleton
 * initialisation resolves most providers through `resolveAsync`, which
 * performs no access check at all, and caches the instance before any
 * synchronous resolution can reach the check. It surfaced only where
 * something forces a fresh SYNCHRONOUS resolution from inside a module
 * scope — in the field, the scheduler resolving a @Cron task, whose sweep
 * then silently never ran.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState } from '../../src/types.js';
import { Module } from '../../src/decorators/index.js';
import { createToken, Scope, type Container } from '../../src/nexus/index.js';

const SHARED = createToken<{ value(): string }>('EncapsulationShared');
const PRIVATE = createToken<{ value(): string }>('EncapsulationPrivate');
const CONSUMER = createToken<{ read(): string }>('EncapsulationConsumer');
const DEEP = createToken<{ read(): string }>('EncapsulationDeep');

/**
 * Everything here is Transient on purpose. A Singleton is created once by
 * eager initialisation — through the async path, which never checks access
 * — and every later resolution returns that cached instance without
 * re-resolving its dependencies. Transient providers are constructed on
 * each `resolve()`, so the access rules are actually exercised.
 */
const transientFactory = (value: string) => ({
  useFactory: () => ({ value: () => value }),
  scope: Scope.Transient,
});

@Module({
  providers: [
    [SHARED, transientFactory('shared')],
    [PRIVATE, transientFactory('private')],
  ],
  exports: [SHARED],
})
class LeafModule {}

@Module({
  imports: [LeafModule],
  providers: [
    [
      CONSUMER,
      {
        useFactory: (shared: { value(): string }) => ({ read: () => shared.value() }),
        inject: [SHARED],
        scope: Scope.Transient,
      },
    ],
  ],
  exports: [CONSUMER, SHARED],
})
class MiddleModule {}

@Module({
  imports: [MiddleModule],
  providers: [
    [
      DEEP,
      {
        useFactory: (shared: { value(): string }) => ({ read: () => shared.value() }),
        inject: [SHARED],
        scope: Scope.Transient,
      },
    ],
  ],
  exports: [DEEP],
})
class OuterModule {}

describe('Application module encapsulation', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) await app.stop({ force: true });
  });

  it('records the import graph the access rules are written against', async () => {
    app = await Application.create({ imports: [OuterModule], disableGracefulShutdown: true });
    const moduleImports = (app.container as unknown as { moduleImports: Map<string, Set<string>> }).moduleImports;

    expect(
      [...moduleImports].map(([name, imports]) => [name, [...imports]]).sort(),
      'the container has no idea which module imports which'
    ).toEqual([
      ['MiddleModule', ['LeafModule']],
      ['OuterModule', ['MiddleModule']],
    ]);
  });

  it('lets an importing module resolve an export of the module it imports', async () => {
    app = await Application.create({ imports: [MiddleModule], disableGracefulShutdown: true });

    // Synchronous resolution: `resolveAsync` skips the access check entirely,
    // so only this path proves the rule.
    const consumer = (app.container as Container).resolve(CONSUMER);

    expect(consumer.read()).toBe('shared');
  });

  it('still refuses a provider the other module does not export', async () => {
    app = await Application.create({ imports: [MiddleModule], disableGracefulShutdown: true });
    const container = app.container as Container;

    expect(() => container.resolve(PRIVATE)).toThrow(/not accessible/);
  });

  it('forwards a re-export so the re-exporting module really re-exports', async () => {
    app = await Application.create({ imports: [OuterModule], disableGracefulShutdown: true });

    // OuterModule imports MiddleModule only. It reaches LeafModule's SHARED
    // token exclusively because MiddleModule lists it in `exports`.
    const deep = (app.container as Container).resolve(DEEP);

    expect(deep.read(), 'a re-exported token did not reach the outer module').toBe('shared');
  });
});
