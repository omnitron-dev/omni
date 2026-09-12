/**
 * Redis connections were opened and never closed. Ever.
 *
 * `RedisManager` carries `onModuleDestroy()` — a NestJS name. Titan reaches
 * `@PreDestroy`, `onDestroy()` and `dispose()`, and the manager has none of
 * the three, so `closeAllClients()` had no caller at all. Measured across the
 * six downstream backends: 4,000+ `Redis client "…" connected successfully` lines
 * and zero `Redis client "…" closed`.
 *
 * The hook belongs on the MODULE rather than the manager, and the difference
 * is ordering: provider teardown runs before the module loop, so a manager
 * that closed itself there would pull the connections out from under a module
 * still deregistering its node. Modules stop in reverse topological order,
 * which is exactly when it is safe.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '@omnitron-dev/titan';
import { RedisModule } from '../src/index.js';
import { REDIS_MANAGER } from '../src/redis.constants.js';
import type { RedisManager } from '../src/redis.manager.js';

const HOST = process.env['REDIS_HOST'] || 'localhost';
const PORT = Number(process.env['REDIS_PORT'] || 6379);

let app: Application | undefined;
afterEach(async () => {
  try { await app?.stop({ force: true }); } catch { /* already down */ }
  app = undefined;
});

describe('TitanRedisModule closes its clients on stop', () => {
  it('leaves no live client behind after app.stop()', async () => {
    app = await Application.create({
      disableGracefulShutdown: true,
      disableCoreModules: false,
      imports: [RedisModule.forRoot({ host: HOST, port: PORT })],
    } as any);
    await app.start();

    const manager = app.container.resolve(REDIS_MANAGER) as RedisManager;
    const client = manager.getClient();
    await client.ping();
    expect(client.status, 'the fixture never connected — nothing is being tested').toBe('ready');

    await app.stop();

    // `quit()` resolves 'OK' before ioredis flips `status`, so reading the
    // status straight after the call is a race that reports 'ready' on a
    // client that is on its way out. The command is the honest observable:
    // a closed connection refuses one.
    await expect(client.ping()).rejects.toThrow(/closed/i);
    expect(manager.clients.size, 'the manager still holds clients it no longer owns').toBe(0);
  });

  it('closes clients wired through forRootAsync too, which is the path downstream takes', async () => {
    app = await Application.create({
      disableGracefulShutdown: true,
      disableCoreModules: false,
      imports: [
        RedisModule.forRootAsync({
          useFactory: () => ({ host: HOST, port: PORT }),
        }),
      ],
    } as any);
    await app.start();

    const manager = app.container.resolve(REDIS_MANAGER) as RedisManager;
    const client = manager.getClient();
    await client.ping();

    await app.stop();

    await expect(client.ping()).rejects.toThrow(/closed/i);
  });

  it('carries the hook on the module, not on the manager', async () => {
    // The placement is the fix. `RedisManager` keeps `onModuleDestroy` for
    // callers that drive it themselves, but Titan never calls that name, and
    // moving teardown onto the manager would put it in the provider pass —
    // before the module loop, i.e. before the modules that still use Redis
    // have stopped.
    const { RedisManager: Manager } = await import('../src/redis.manager.js');
    expect(typeof (RedisModule as any).prototype.onStop).toBe('function');
    for (const name of ['onDestroy', 'dispose']) {
      expect(
        typeof (Manager.prototype as any)[name],
        `RedisManager.${name} would be called during provider teardown, too early`,
      ).toBe('undefined');
    }
  });
});
