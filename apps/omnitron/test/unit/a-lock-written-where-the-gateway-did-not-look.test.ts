/**
 * A lock written where the gateway did not look.
 *
 * The platform's maintenance mode lives in one Redis key, in the gateway's own
 * database, and three sides named that database — each its own way:
 *
 *     the gateway on a node       (redis.db ?? 0) + 1             → 1
 *     main's GATEWAY_REDIS_URL    redisDbOffset + 5               → 5
 *     the gateway on a dev stack  portAllocation.redisDbEnd + 1   → 5
 *
 * Measured on daos/test on 2026-09-29, reading the node: main's three
 * processes carried GATEWAY_REDIS_URL …/5 and the gateway container
 * REDIS_DB=1. An administrator's «maintenance on» went to DB 5 and the gateway
 * asked DB 1, so the mode never engaged. And neither number was free: the
 * apps' own URLs on the same node were storage …/1 and geo …/5.
 *
 * One rule now (`gateway-redis-db.ts`): the database the stack declares for
 * `gateway`, or else 15 — the last of Redis's sixteen, computable by every
 * side without the apps' allocation, which none of them has when the gateway
 * is created. The allocator reserves it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { DEFAULT_GATEWAY_REDIS_DB, gatewayRedisDb } from '../../src/infrastructure/gateway-redis-db.js';
import { resolveStack, resolvedConfigToEnv } from '../../src/project/config-resolver.js';
import type { IAppDefinition, IEcosystemConfig, IStackConfig } from '../../src/config/types.js';

const definition = (name: string): IAppDefinition => ({
  name,
  version: '1.0.0',
  processes: [{ name: 'http', module: `apps/${name}/src/http.ts` }],
  omnitronConfig: { redis: true },
});

function resolve(options: { databases?: Record<string, number>; offset?: number; apps?: string[] } = {}) {
  const apps = options.apps ?? ['main', 'storage'];
  // A stack with a gateway: that is when main is handed GATEWAY_REDIS_URL.
  const config = { project: 'lock', apps: apps.map((name) => ({ name })), gateway: {} } as unknown as IEcosystemConfig;
  const stackConfig: IStackConfig = {
    type: 'local',
    apps: 'all',
    ...(options.offset !== undefined ? { settings: { redisDbOffset: options.offset } } : {}),
    ...(options.databases ? { infrastructure: { redis: { port: 6379, databases: options.databases } } } : {}),
  } as IStackConfig;
  const definitions = new Map(apps.map((name) => [name, definition(name)] as const));
  return resolveStack(config, 'lock', 'dev', stackConfig, definitions);
}

const gatewayDbOfMain = (stack: ReturnType<typeof resolve>) => {
  const env = resolvedConfigToEnv(stack.appConfigs.get('main')!, 'main', 'dev');
  return Number(/\/(\d+)$/.exec(env['GATEWAY_REDIS_URL'] ?? '')?.[1]);
};

describe('one rule for the gateway’s database', () => {
  it('is 15 unless the stack says otherwise', () => {
    expect(DEFAULT_GATEWAY_REDIS_DB).toBe(15);
    expect(gatewayRedisDb(undefined)).toBe(15);
    expect(gatewayRedisDb({ main: 0, storage: 1, geo: 5 })).toBe(15);
  });

  it('is what the stack declares for `gateway`', () => {
    expect(gatewayRedisDb({ main: 0, gateway: 12 })).toBe(12);
  });

  it('ignores a declaration that is not a database index', () => {
    expect(gatewayRedisDb({ gateway: -1 })).toBe(15);
    expect(gatewayRedisDb({ gateway: 1.5 })).toBe(15);
  });
});

describe('main writes where the gateway reads', () => {
  it('hands main the gateway’s database — 15, not offset + 5', () => {
    expect(gatewayDbOfMain(resolve())).toBe(15);
  });

  it('follows a declared gateway database', () => {
    expect(gatewayDbOfMain(resolve({ databases: { main: 0, storage: 1, gateway: 9 } }))).toBe(9);
  });

  it('never gives the gateway’s database to an app, even when the counter reaches it', () => {
    // Offset 14: the counter hands out 14, then would hand out 15.
    const stack = resolve({ offset: 14, apps: ['main', 'storage', 'geo'] });
    const given = [...stack.redisAllocation.values()];
    expect(given).not.toContain(15);
    expect(gatewayDbOfMain(stack)).toBe(15);
  });

  it('nor a declared one', () => {
    const stack = resolve({ databases: { main: 0, gateway: 1 }, apps: ['main', 'storage', 'geo'] });
    expect([...stack.redisAllocation.values()]).not.toContain(1);
  });
});

describe('every side names it by the rule', () => {
  const src = (path: string) =>
    readFileSync(join(__dirname, '../../src', path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it.each([
    ['project/config-resolver.ts', 'redisDbOffset + 5'],
    ['services/infrastructure.rpc-service.ts', '(redisCfg?.db ?? 0) + 1'],
    ['infrastructure/stack-infra-manager.ts', 'redisDbEnd + 1'],
  ])('%s computes it with gateway-redis-db, not `%s`', (file, old) => {
    const code = src(file);
    expect(code).toContain('gateway-redis-db.js');
    expect(code).not.toContain(old);
  });
});
