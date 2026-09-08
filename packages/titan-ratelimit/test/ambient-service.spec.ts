/**
 * `@RateLimit` reads `this.__rateLimitService__` off the decorated instance.
 * A class that does not inject that exact field falls into the decorator's
 * graceful degradation — the request is allowed, and a warning is written only
 * if the instance happens to carry a logger.
 *
 * That is not a rare shape. In this repository thirty of the fifty-four
 * classes carrying `@RateLimit` had no such field, so every limit they
 * declared did nothing, while every application configured the module and paid
 * for the Redis round trips of the classes that did inject it. Nothing failed;
 * the limit simply was not there.
 *
 * The service now publishes itself for the decorators when the container
 * builds it, so a declared limit applies without per-class injection, and an
 * injected field still wins.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { RateLimit, getAmbientRateLimitService, setAmbientRateLimitService } from '../src/ratelimit.decorators.js';
import { RateLimitService } from '../src/ratelimit.service.js';
import { MemoryRateLimitStorage } from '../src/ratelimit.storage.js';
import type { IRateLimitService } from '../src/ratelimit.types.js';

function makeService(): RateLimitService {
  return new RateLimitService(new MemoryRateLimitStorage(), {
    enabled: true,
    strategy: 'fixed-window',
    keyPrefix: `test:${Math.random().toString(36).slice(2)}`,
  } as never);
}

describe('ambient rate-limit service', () => {
  afterEach(() => {
    setAmbientRateLimitService(undefined);
  });

  it('a constructed service publishes itself', () => {
    const service = makeService();
    expect(getAmbientRateLimitService(), 'the service did not publish itself').toBe(service);
  });

  it('onDestroy withdraws it', async () => {
    const service = makeService();
    await service.onDestroy();
    expect(getAmbientRateLimitService()).toBeUndefined();
  });

  it('enforces a limit on a class that injected nothing', async () => {
    makeService();

    class NoInjection {
      calls = 0;

      @RateLimit({ limit: 2, windowMs: 60_000 })
      async work(): Promise<string> {
        this.calls++;
        return 'done';
      }
    }

    const target = new NoInjection();
    await target.work();
    await target.work();

    await expect(target.work(), 'the third call was allowed past a limit of two').rejects.toThrow();
    expect(target.calls, 'the method body ran despite the limit').toBe(2);
  });

  it('lets an injected service win over the ambient one', async () => {
    makeService();

    const injected = {
      enforce: vi.fn().mockResolvedValue(undefined),
    } as unknown as IRateLimitService;

    class WithInjection {
      // The name the decorator looks for.
      __rateLimitService__ = injected;

      @RateLimit({ limit: 1, windowMs: 60_000 })
      async work(): Promise<string> {
        return 'done';
      }
    }

    const target = new WithInjection();
    await target.work();
    await target.work();

    // Both calls went to the injected double, which allows everything; the
    // ambient service's limit of one never applied.
    expect(injected.enforce).toHaveBeenCalledTimes(2);
  });
});
