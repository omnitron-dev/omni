import type { HttpMiddlewareContext } from '@omnitron-dev/titan/netron/transport/http/middleware';
import { expect, it, vi } from 'vitest';
import { createRateLimitMiddleware } from '../src/ratelimit.middleware.js';
import { RateLimitService } from '../src/ratelimit.service.js';
import { MemoryRateLimitStorage } from '../src/ratelimit.storage.js';

function context(address: string) {
  const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
  return { response, metadata: new Map(), request: { headers: {}, socket: { remoteAddress: address } } } as unknown as HttpMiddlewareContext;
}

it('matches IPv4 and IPv6 network prefixes and literal wildcard segments', async () => {
  const check = createRateLimitMiddleware({ globalLimit: 0, whitelist: ['192.0.2.128/25', '2001:db8::/63', 'test.[unit]*.local'] });
  for (const client of ['192.0.2.200', '2001:db8:0:1::2', 'test.[unit]-a.local']) {
    const next = vi.fn();
    await check(context(client), next);
    expect(next).toHaveBeenCalledOnce();
  }
  for (const client of ['192.0.2.42', '2001:db8:0:2::1', 'testau.local']) {
    const ctx = context(client), next = vi.fn();
    await check(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.response.statusCode).toBe(429);
  }
});

it('shares an exact global ceiling through two service instances independently from individual tiers', async () => {
  const storage = new MemoryRateLimitStorage();
  const services = [0, 1].map(() => new RateLimitService(storage, {
    strategy: 'fixed-window', defaultLimit: 10, burstLimit: 5,
  }));
  try {
    for (const [index, address] of ['http-global', 'second', 'third'].entries()) {
      const ctx = context(address);
      const check = createRateLimitMiddleware({ rateLimitService: services[index % 2], globalLimit: 2 });
      await check(ctx, async () => {});
      expect(ctx.response.statusCode).toBe(index === 2 ? 429 : 200);
    }
    expect(await services[0]!.getStatus('http-global')).toMatchObject({ allowed: true, remaining: 14 });
  } finally {
    for (const service of services) await service.onDestroy();
    storage.destroy();
  }
});

it('honors a zero global budget for a token bucket without reporting an infinite retry', async () => {
  const storage = new MemoryRateLimitStorage();
  const service = new RateLimitService(storage, { strategy: 'token-bucket', burstLimit: 2 });
  try {
    const status = await service.check({ scope: 'global', key: 'http-global', limit: 0 });
    expect(status).toMatchObject({ allowed: false, remaining: 0, limit: 0 });
    expect(Number.isFinite(status.resetAt)).toBe(true);
  } finally {
    await service.onDestroy();
    storage.destroy();
  }
});
