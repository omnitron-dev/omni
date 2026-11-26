import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuiltInPolicies } from '../../../src/netron/auth/built-in-policies.js';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import { RateLimiter } from '../../../src/netron/auth/rate-limiter.js';
import type { ExecutionContext } from '../../../src/netron/auth/types.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child() { return this; } } as unknown as ILogger;
const context: ExecutionContext = {
  auth: { userId: 'subscriber', roles: [], permissions: [] }, service: { name: 'workspace', version: '1' },
};
afterEach(() => vi.useRealTimers());

describe('queued capacity through the Netron policy engine', () => {
  it('grants one slot per window, prefers the higher waiting tier and bounds the queue', async () => {
    vi.useFakeTimers();
    const engine = new PolicyEngine(logger);
    const policy = BuiltInPolicies.requireRateLimit(logger, {
      window: 100, queue: true, maxQueueSize: 2, queueTimeoutMs: 1000,
      defaultTier: { name: 'free', limit: 1 }, tiers: { member: { name: 'member', limit: 1, priority: 10 } },
      getTier: ctx => ctx.auth?.roles[0],
    });
    engine.registerPolicy(policy);
    try {
      expect((await engine.evaluate(policy.name, context)).allowed).toBe(true);
      const first = engine.evaluate(policy.name, context);
      const priority = engine.evaluate(policy.name, { ...context, auth: { ...context.auth!, roles: ['member'] } });
      expect((await engine.evaluate(policy.name, context)).allowed).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(await priority).toMatchObject({ allowed: true, metadata: { remaining: 0, queued: true } });
      await vi.advanceTimersByTimeAsync(100);
      expect(await first).toMatchObject({ allowed: true, metadata: { remaining: 0, queued: true } });
      expect(engine.getCacheStats().size).toBe(0);
    } finally { engine.destroy(); }
  });

  it('withdraws a queued acquisition when policy evaluation times out', async () => {
    vi.useFakeTimers();
    const engine = new PolicyEngine(logger);
    const policy = BuiltInPolicies.requireRateLimit(logger, { window: 100, queue: true, defaultTier: { name: 'free', limit: 1 } });
    engine.registerPolicy(policy);
    try {
      await engine.evaluate(policy.name, context);
      const timed = engine.evaluate(policy.name, context, { timeout: 10 });
      await vi.advanceTimersByTimeAsync(10);
      expect((await timed).allowed).toBe(false);
      await vi.advanceTimersByTimeAsync(90);
      expect(await engine.evaluate(policy.name, context)).toMatchObject({ allowed: true, metadata: { remaining: 0 } });
    } finally { engine.destroy(); }
  });

  it('returns an observed denial at the queue deadline with its retry time and admission history', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(logger, { window: 1000, queue: true, queueTimeoutMs: 25, defaultTier: { name: 'base', limit: 1 } });
    try {
      await limiter.consume('key');
      const timed = expect(limiter.consume('key')).rejects.toMatchObject({ details: { queued: true, retryAfter: 975 } });
      await vi.advanceTimersByTimeAsync(25);
      await timed;
      expect(limiter.getStats('key')).toMatchObject({ totalChecks: 2, totalAllowed: 1, totalDenied: 1, currentQueueSize: 0 });
    } finally { limiter.destroy(); }
  });
});
