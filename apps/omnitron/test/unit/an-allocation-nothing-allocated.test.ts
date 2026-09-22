/**
 * The stack's Redis allocation was a report, not an order.
 *
 *     databases?: Record<string, number>;   // "Named DB allocations: { main: 0, storage: 1 }"
 *
 * An operator writes that block into `omnitron.stacks.json`, and nothing
 * executes it. `allocateRedisDBs` hands out `nextDb++` in list order without
 * opening the file:
 *
 *     for (const appName of apps) {
 *       if (omnitronConfigs.get(appName)?.redis) allocation.set(appName, nextDb++);
 *     }
 *
 * The only readers of the written block are `stack.ts`, which prints
 * `Object.keys(...).length` as "Redis: N DB allocations", and
 * `getConnectionInfo`, whose callers never look at the numbers. The redis
 * preset does not contain the word. And `project.service.ts` GENERATES the
 * same block with the same counter — so the file states what the counter
 * computed, and then the counter computes it again at deploy time.
 *
 * This is the second case of the same shape as
 * `a-computed-value-overwrote-a-stated-one.test.ts`: computed beat stated.
 * Here it is not a password but the database an app reads from.
 *
 * Measured on the dev stand. Allocation and pin agree in the file
 * (priceverse 3, paysys 4, messaging 2), and the URL handed to each process
 * disagreed with both — by exactly the app's POSITION in the list:
 *
 *     main       position 0   allocation 0   URL /0    silent
 *     storage    position 1   allocation 1   URL /1    silent
 *     priceverse position 2   allocation 3   URL /2    192 warnings
 *     paysys     position 3   allocation 4   URL /3    245 warnings
 *     messaging  position 4   allocation 2   URL /4     24 warnings
 *     geo        position 5   allocation 5   URL /5    silent
 *
 * Predicted before grepping: paysys must say "db=3 differs from the pinned
 * db=4". It does, 245 times. The three silent ones are exactly those whose
 * position equals their number.
 *
 * Nothing was lost, because every app pins its own index in code
 * (`DAOS_REDIS_DB`) and the pin wins at runtime — verified by reading all
 * eight databases: db 2 holds only messaging keys, db 3 only priceverse, db 4
 * only paysys. But the pin is a second source of truth, and anything reading
 * `REDIS_URL` without knowing about it — a script, `redis-cli -u $REDIS_URL`,
 * a client written next year — lands in another app's data. That has already
 * cost one outage: paysys read prices from the database priceverse never
 * wrote to, every `price:btc-usd` GET returned null, and every swap quote
 * failed exactly as it would if the feed were down.
 *
 * `allocateRedisDBsLegacy`, still in the same file, honoured an explicit
 * `requires.redis.db`. The new path dropped the ability; this returns it.
 */

import { describe, it, expect } from 'vitest';

import { resolveStack, resolvedConfigToEnv } from '../../src/project/config-resolver.js';
import type { IEcosystemConfig, IStackConfig, IAppDefinition } from '../../src/config/types.js';

const appDefinition = (name: string): IAppDefinition => ({
  name,
  version: '1.0.0',
  processes: [{ name: 'http', module: `apps/${name}/src/http.ts` }],
  omnitronConfig: { redis: true },
});

/** Two apps whose declared databases are deliberately NOT their positions. */
const DECLARED = { alpha: 5, beta: 3 } as const;

function resolve(databases?: Record<string, number>) {
  const config: IEcosystemConfig = {
    project: 'alloc',
    apps: [{ name: 'alpha' }, { name: 'beta' }],
  };
  const stackConfig: IStackConfig = {
    type: 'local',
    apps: 'all',
    ...(databases ? { infrastructure: { redis: { port: 6379, databases } } } : {}),
  };
  const definitions = new Map<string, IAppDefinition>([
    ['alpha', appDefinition('alpha')],
    ['beta', appDefinition('beta')],
  ]);

  return resolveStack(config, 'alloc', 'dev', stackConfig, definitions);
}

/** The db index at the end of a `redis://host:port/N` URL. */
const dbOf = (url: string | undefined) => (url ? Number(new URL(url).pathname.slice(1)) : undefined);

describe('an allocation nothing allocated', () => {
  it('a database stated in the stack config is the database allocated', () => {
    const resolved = resolve({ ...DECLARED });

    expect(
      Object.fromEntries(resolved.redisAllocation),
      'the counter overwrote what the operator wrote',
    ).toMatchObject(DECLARED);
  });

  it('and it is the database the app is handed in REDIS_URL', () => {
    const resolved = resolve({ ...DECLARED });

    for (const [name, declared] of Object.entries(DECLARED)) {
      const env = resolvedConfigToEnv(resolved.appConfigs.get(name)!, name, 'dev');
      expect(dbOf(env['REDIS_URL']), `${name} was sent to another app's database`).toBe(declared);
    }
  });

  it('an app the stack does not mention still gets an index of its own', () => {
    // Control: the auto-allocation is what makes `redis: true` enough for an
    // app that states nothing. Reading the config must not cost that.
    const resolved = resolve({ alpha: 5 });

    expect(resolved.redisAllocation.get('alpha')).toBe(5);
    const beta = resolved.redisAllocation.get('beta');
    expect(beta, 'beta must still be allocated').toBeTypeOf('number');
    expect(beta, 'and not onto a database already spoken for').not.toBe(5);
  });

  it('with no allocation block at all, nothing changes', () => {
    // Control: the old behaviour is the fallback, not a casualty.
    const resolved = resolve();

    expect(Object.fromEntries(resolved.redisAllocation)).toEqual({ alpha: 0, beta: 1 });
  });
});
