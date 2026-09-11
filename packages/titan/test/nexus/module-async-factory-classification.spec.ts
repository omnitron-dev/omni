/**
 * A module wrapper must not erase what it wraps.
 *
 * `Container.loadModule` replaces every module provider's `useFactory` with a
 * plain arrow that calls the original inside `runInModuleScope`, so module
 * scope can travel through AsyncLocalStorage. Registration then decides
 * whether a provider is async by asking `useFactory.constructor.name ===
 * 'AsyncFunction'` — of the WRAPPER, which is always a plain `Function`.
 *
 * So every `async useFactory` registered through a module was classified as
 * synchronous, and the guard that exists to stop a synchronous caller from
 * receiving an unsettled Promise never fired. The caller got the Promise and,
 * for a Singleton, kept it.
 *
 * That is not hypothetical. Downstream registers `DATABASE_CONNECTION` as an async
 * factory in a module; a Singleton repository built on the sync path stored
 * the Promise for the life of the process, and every query through it threw
 * `[TransactionAwareRepository] executor has no selectFrom — diagnostic:
 * {"constructorName":"Promise"…}`. On main that was the org audit-log
 * repository: creating a pickup point wrote the row and then answered 500,
 * and redeeming a pickup code marked the parcel delivered and then answered
 * 500, because the audit write after each of them could not run.
 */

import { describe, it, expect } from 'vitest';
import { Container, createToken } from '../../src/nexus/index.js';
import { AsyncResolutionError } from '../../src/nexus/errors.js';

const CONNECTION = createToken<{ real: true }>('CONNECTION');
const REPOSITORY = createToken<{ db: unknown }>('REPOSITORY');

/** Shaped like the real thing: async factory + a sync consumer injecting it. */
const makeModule = () => ({
  name: 'DatabaseishModule',
  providers: [
    [CONNECTION, { useFactory: async () => ({ real: true as const }), inject: [] }],
    [REPOSITORY, { useFactory: (db: unknown) => ({ db }), inject: [CONNECTION] }],
  ],
  exports: [CONNECTION, REPOSITORY],
});

describe('an async factory registered through a module', () => {
  it('is still classified as async after the module-scope wrap', () => {
    const container = new Container();
    container.loadModule(makeModule() as never);

    // The whole defect in one assertion: this used to return the repository
    // holding an unsettled Promise instead of refusing.
    expect(() => container.resolve(REPOSITORY)).toThrow(AsyncResolutionError);
  });

  it('never hands a consumer an unsettled Promise', () => {
    const container = new Container();
    container.loadModule(makeModule() as never);

    let held: unknown = 'not-resolved';
    try {
      held = (container.resolve(REPOSITORY) as { db: unknown }).db;
    } catch {
      /* refusing is the correct outcome — asserted above */
    }
    expect(held).not.toBeInstanceOf(Promise);
  });

  it('the async factory itself is refused on the sync path', () => {
    const container = new Container();
    container.loadModule(makeModule() as never);
    expect(() => container.resolve(CONNECTION)).toThrow(AsyncResolutionError);
  });

  it('resolves to the real value on the async path', async () => {
    const container = new Container();
    container.loadModule(makeModule() as never);

    const repo = await container.resolveAsync(REPOSITORY);
    expect(repo.db).not.toBeInstanceOf(Promise);
    expect(repo.db).toEqual({ real: true });
  });

  it('leaves a purely synchronous module resolving synchronously', () => {
    // The fix must not make every module provider async.
    const VALUE = createToken<number>('VALUE');
    const DOUBLE = createToken<number>('DOUBLE');
    const container = new Container();
    container.loadModule({
      name: 'SyncModule',
      providers: [
        [VALUE, { useFactory: () => 21, inject: [] }],
        [DOUBLE, { useFactory: (v: number) => v * 2, inject: [VALUE] }],
      ],
      exports: [VALUE, DOUBLE],
    } as never);

    expect(container.resolve(DOUBLE)).toBe(42);
  });
});
