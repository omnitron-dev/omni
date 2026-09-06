/**
 * The queued case must be told apart from a plain denial by a flag, not by
 * wording.
 *
 * `RateLimiter` throws the SAME `RateLimitError` for both — "Request queued due
 * to rate limit" and "Rate limit exceeded" — and `requireRateLimit` classified
 * them with `error.message.includes('queued')`. Producer and consumer coupled
 * by an English sentence: reword the first string and every queued request is
 * reported as a denial, with nothing anywhere failing.
 *
 * Both branches answer `allowed: false`, so the access decision was never at
 * risk. What was at risk is the reason reported and the `queued: true` metadata
 * a caller uses to decide whether to retry rather than give up.
 *
 * Tested as two halves, because the coupling has two ends and mutating one at a
 * time is the only way to learn which end a failure came from.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { BuiltInPolicies } from '../../../src/netron/auth/built-in-policies.js';
import { RateLimiter } from '../../../src/netron/auth/rate-limiter.js';
import { RateLimitError } from '../../../src/errors/index.js';

const logger: any = {
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
};
logger.child = vi.fn(() => logger);

const context: any = { auth: { userId: 'u1' }, environment: { ip: '127.0.0.1' } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rate limiting — the queued signal', () => {
  it('the limiter marks a queued rejection in the error details', async () => {
    // Producer half. Limit of one per window with queueing on, so the second
    // consume takes the queued branch.
    //
    // `enqueue` is stubbed to resolve at once: it otherwise waits for the queue
    // to drain against a hard-coded timeout that no config can shorten, which
    // would make this a thirty-second test of the queue machinery rather than a
    // test of what the throw carries.
    vi.spyOn(RateLimiter.prototype as any, 'enqueue').mockResolvedValue(true);

    const limiter = new RateLimiter(logger, {
      defaultTier: { name: 'test', limit: 1 },
      window: 60_000,
      queue: true,
      maxQueueSize: 10,
    } as any);

    await limiter.consume('u1');

    let thrown: unknown;
    try {
      await limiter.consume('u1');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).details?.queued).toBe(true);
  });

  it('the limiter does NOT mark a plain denial', async () => {
    const limiter = new RateLimiter(logger, {
      defaultTier: { name: 'test', limit: 1 },
      window: 60_000,
      queue: false,
    } as any);

    await limiter.consume('u1');

    let thrown: unknown;
    try {
      await limiter.consume('u1');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).details?.queued).toBeUndefined();
  });

  it('the policy reads the flag, not the message', async () => {
    // Consumer half. Wording deliberately unlike "queued": only the flag says
    // what this is.
    vi.spyOn(RateLimiter.prototype, 'consume').mockRejectedValue(
      new RateLimitError('slow down', { queued: true }, { retryAfter: 100 })
    );

    const policy = BuiltInPolicies.requireRateLimit(logger, { defaultTier: { name: 't', limit: 100 } } as any);
    const result = await policy.evaluate(context, {} as any);

    expect(result.allowed).toBe(false);
    expect(result.metadata?.['queued']).toBe(true);
  });

  it('the policy does not treat a plain denial as queued, whatever it says', async () => {
    // Wording deliberately CONTAINING the old keyword, without the flag.
    vi.spyOn(RateLimiter.prototype, 'consume').mockRejectedValue(
      new RateLimitError('Rate limit exceeded; requests are not queued here', undefined, { retryAfter: 100 })
    );

    const policy = BuiltInPolicies.requireRateLimit(logger, { defaultTier: { name: 't', limit: 100 } } as any);
    const result = await policy.evaluate(context, {} as any);

    expect(result.allowed).toBe(false);
    expect(result.metadata?.['queued']).toBeUndefined();
  });
});
