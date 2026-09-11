import { describe, it, expect } from 'vitest';
import { Container, createToken } from '../../src/nexus/index.js';

const CONNECTION = createToken<{ real: true }>('CONNECTION');
const SERVICE = createToken<{ db: unknown }>('SERVICE');
const ALIAS = createToken<{ db: unknown }>('ALIAS');

const mod = () => ({
  name: 'AliasModule',
  providers: [
    [CONNECTION, { useFactory: async () => ({ real: true as const }), inject: [] }],
    [SERVICE, { useFactory: (db: unknown) => ({ db }), inject: [CONNECTION] }],
    [ALIAS, { useExisting: SERVICE }],
  ],
  exports: [CONNECTION, SERVICE, ALIAS],
});

describe('an alias to an async provider', () => {
  it('resolves to the real instance through the async path', async () => {
    const c = new Container();
    await c.loadModuleAsync(mod() as never);
    await c.eagerlyInitialize();
    const viaAlias = await c.resolveAsync(ALIAS);
    expect(viaAlias.db).not.toBeInstanceOf(Promise);
    expect(viaAlias.db).toEqual({ real: true });
  });

  it('refuses the sync path instead of handing back a promise', async () => {
    const c = new Container();
    await c.loadModuleAsync(mod() as never);
    let held: unknown = 'not-resolved';
    try {
      held = (c.resolve(ALIAS) as { db: unknown }).db;
    } catch {
      /* refusing is correct */
    }
    expect(held).not.toBeInstanceOf(Promise);
  });

  it('leaves an alias to a synchronous provider synchronous', async () => {
    const VALUE = createToken<number>('VALUE');
    const VALUE_ALIAS = createToken<number>('VALUE_ALIAS');
    const c = new Container();
    await c.loadModuleAsync({
      name: 'SyncAliasModule',
      providers: [
        [VALUE, { useFactory: () => 21, inject: [] }],
        [VALUE_ALIAS, { useExisting: VALUE }],
      ],
      exports: [VALUE, VALUE_ALIAS],
    } as never);
    expect(c.resolve(VALUE_ALIAS)).toBe(21);
  });
});
