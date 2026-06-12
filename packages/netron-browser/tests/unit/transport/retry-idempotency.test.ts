/**
 * NB-5: RetryManager must not auto-retry NON-idempotent RPCs on AMBIGUOUS
 * failures (the request may already have been processed server-side), or it can
 * silently double-execute a mutation. The default retry condition retries
 * ambiguous failures (connection-reset/timeout, HTTP 5xx/408) only when the call
 * is marked `idempotent`. Failures that prove the request never reached the
 * server (connection-refused/DNS) and an explicit 429 retry regardless. A custom
 * `shouldRetry` bypasses the gate (caller owns the decision).
 */

import { describe, it, expect, vi } from 'vitest';
import { RetryManager } from '../../../src/transport/http/fluent-interface/retry-manager.js';

const err = (props: Record<string, unknown>) => Object.assign(new Error('fail'), props);
const mk = () => new RetryManager();

describe('RetryManager idempotency gate (NB-5)', () => {
  it('does NOT retry an ambiguous 5xx for a non-idempotent call (default)', async () => {
    const fn = vi.fn(async () => {
      throw err({ status: 500 });
    });
    await expect(mk().execute(fn, { attempts: 3, initialDelay: 1, jitter: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1); // no retry — mutation can't double-execute
  });

  it('DOES retry an ambiguous 5xx when the call is marked idempotent', async () => {
    const fn = vi.fn(async () => {
      throw err({ status: 500 });
    });
    await expect(mk().execute(fn, { attempts: 2, initialDelay: 1, jitter: 0, idempotent: true })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does NOT retry an ambiguous timeout (ETIMEDOUT) for a non-idempotent call', async () => {
    const fn = vi.fn(async () => {
      throw err({ code: 'ETIMEDOUT' });
    });
    await expect(mk().execute(fn, { attempts: 3, initialDelay: 1, jitter: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a never-reached failure (ECONNREFUSED) regardless of idempotency', async () => {
    const fn = vi.fn(async () => {
      throw err({ code: 'ECONNREFUSED' });
    });
    await expect(mk().execute(fn, { attempts: 2, initialDelay: 1, jitter: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries an explicit 429 regardless of idempotency', async () => {
    const fn = vi.fn(async () => {
      throw err({ status: 429 });
    });
    await expect(mk().execute(fn, { attempts: 2, initialDelay: 1, jitter: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries a deterministic 4xx (e.g. 400), idempotent or not', async () => {
    const fn = vi.fn(async () => {
      throw err({ status: 400 });
    });
    await expect(mk().execute(fn, { attempts: 3, initialDelay: 1, jitter: 0, idempotent: true })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors a custom shouldRetry, bypassing the idempotency gate', async () => {
    const fn = vi.fn(async () => {
      throw err({ status: 500 });
    });
    await expect(
      mk().execute(fn, { attempts: 1, initialDelay: 1, jitter: 0, shouldRetry: () => true })
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(2); // retried despite non-idempotent default
  });
});
