/**
 * A flag the factory returned.
 *
 * `TitanHealthModule.forRootAsync` registers its providers when the module is
 * built and runs the factory later, when they are resolved. It decided whether
 * to register `HealthRpcService` without looking at `enableRpcService` at all —
 * the only place a caller could put the flag was the factory's result, which
 * arrives after that decision. sample storage and payments return
 * `enableRpcService: false` («We use our own RPC service»), and since omni
 * 0c9eec37 put factory-built services on the wire, both served
 * `Health@1.0.0.check` — heap used, heap limit, the thresholds, uptime — to
 * anonymous callers through the public gateway, with main and messaging
 * (measured on the sample dev stand, 2026-09-25).
 *
 * Held here, through the real exposure path (an Application that starts): the
 * flag read at registration takes the service off the wire; the default keeps
 * it on; a factory's `false` alone leaves it registered and answering nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { readMethodMetadata } from '@omnitron-dev/titan/netron/transport/http/middleware';
import { Application } from '@omnitron-dev/titan';

import { TitanHealthModule } from '../src/health.module.js';
import { HEALTH_RPC_SERVICE_TOKEN } from '../src/health.tokens.js';
import { HealthService } from '../src/health.service.js';
import { HealthRpcService } from '../src/health.rpc-service.js';

let app: Application | undefined;

afterEach(async () => {
  await app?.stop({ force: true }).catch(() => undefined);
  app = undefined;
});

/** The names of the services this application put on the wire. */
function exposedNames(started: Application): string[] {
  const peer = started.netron!.peer as unknown as {
    services?: Map<string, unknown>;
    stubs?: Map<string, { definition?: { meta?: { name?: string } } }>;
  };
  if (peer.stubs) return [...peer.stubs.values()].map((s) => s.definition?.meta?.name ?? '').filter(Boolean);
  return [...(peer.services?.keys() ?? [])];
}

const start = async (health: ReturnType<typeof TitanHealthModule.forRootAsync>) => {
  app = await Application.create({ imports: [health], disableGracefulShutdown: true });
  await app.start();
  return app;
};

const health = (names: string[]) => names.filter((n) => n.startsWith('Health'));

describe('forRootAsync and enableRpcService', () => {
  it('false at registration: Health is not on the wire', async () => {
    const started = await start(
      TitanHealthModule.forRootAsync({
        enableRpcService: false,
        useFactory: () => ({ enableEventLoopIndicator: false }),
      })
    );
    expect(health(exposedNames(started))).toEqual([]);
  });

  it('by default: Health is on the wire (the control)', async () => {
    const started = await start(
      TitanHealthModule.forRootAsync({ useFactory: () => ({ enableEventLoopIndicator: false }) })
    );
    expect(health(exposedNames(started))).not.toEqual([]);
  });

  it('false from the factory alone: registered, and answers every call as a missing service', async () => {
    // Provider lists are fixed before the factory runs, so the service cannot
    // be taken off the wire here — and failing the boot instead would strand
    // every node whose daemon arrives before the application that moves the
    // flag. What it can do is say nothing.
    const started = await start(
      TitanHealthModule.forRootAsync({
        useFactory: () => ({ enableRpcService: false, enableEventLoopIndicator: false }),
      })
    );
    const rpc = await started.resolveAsync(HealthRpcService);
    for (const call of [() => rpc.check(), () => rpc.live(), () => rpc.ready(), () => rpc.listIndicators()]) {
      await expect(call()).rejects.toThrow(/Service Health@1.0.0 not found/);
    }
  });

  it('the same value in both places is not an error', async () => {
    const started = await start(
      TitanHealthModule.forRootAsync({
        enableRpcService: false,
        useFactory: () => ({ enableRpcService: false, enableEventLoopIndicator: false }),
      })
    );
    expect(health(exposedNames(started))).toEqual([]);
  });
});

it('keeps the async deployment policy isolated from the default service and its public probes', async () => {
  const started = await start(TitanHealthModule.forRootAsync({ useFactory: () => ({ detailRpcRoles: ['observer'] }) }));
  const scoped = await started.resolveAsync(HealthRpcService);
  expect(health(exposedNames(started))).toEqual(['Health']);
  expect(await started.resolveAsync(HEALTH_RPC_SERVICE_TOKEN)).toBe(scoped);
  expect(readMethodMetadata(scoped, 'check')?.auth).toEqual({ roles: ['observer'] });
  expect(readMethodMetadata(scoped, 'ready')?.auth).toEqual({ allowAnonymous: true });
  expect(readMethodMetadata(new HealthRpcService(), 'check')?.auth).toEqual({ allowAnonymous: true });
});

it.each([false, true])('exposes Redis readiness and sanitized diagnostics only when enabled (%s)', async enabled => {
  const secret = 'Redis driver reply carrying an internal address';
  const started = await start(TitanHealthModule.forRootAsync({
    useFactory: () => ({
      enableEventLoopIndicator: false,
      enableMemoryIndicator: false,
      enableRedisIndicator: enabled,
      redisClient: { ping: async () => secret },
    }),
  }));
  const service = await started.resolveAsync(HealthRpcService);
  const report = await service.check();
  expect(report.indicators.redis?.status).toBe(enabled ? 'unhealthy' : undefined);
  expect(report.status).toBe(enabled ? 'unhealthy' : 'healthy');
  if (enabled) {
    const single = await service.checkIndicator('redis');
    expect(single.result.message).toBe('Redis PING returned an unexpected reply');
    expect(JSON.stringify(single)).not.toContain(secret);
  }
  expect(JSON.stringify(report)).not.toContain(secret);
  const probe = await service.ready();
  expect(probe.status).toBe(enabled ? 'unhealthy' : 'healthy');
  expect(Object.keys(probe).sort()).toEqual(['status', 'timestamp']);
});

it('refuses to expose an empty detailed role policy', () => {
  expect(() => HealthRpcService.create(new HealthService({}), { detailRpcRoles: [] })).toThrow('detailRpcRoles');
});
