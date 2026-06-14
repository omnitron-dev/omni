import { describe, it, expect } from 'vitest';
import { TitanError, AggregateError, ErrorCode, ensureError, isErrorCode } from '../src/index.js';

describe('TitanError (merged)', () => {
  it('constructs with code → category/httpStatus/message defaults', () => {
    const e = new TitanError({ code: ErrorCode.NOT_FOUND });
    expect(e.code).toBe(404);
    expect(e.httpStatus).toBe(404);
    expect(e.message).toBe('The requested resource was not found');
    expect(e instanceof TitanError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });

  it('XC-3: custom codes 600/601 map httpStatus to 500 (not leaked)', () => {
    expect(new TitanError({ code: ErrorCode.MULTIPLE_ERRORS }).httpStatus).toBe(500);
    expect(new TitanError({ code: ErrorCode.UNKNOWN_ERROR }).httpStatus).toBe(500);
  });

  it('toJSON ⇄ fromJSON round-trips the wire shape', () => {
    const e = new TitanError({ code: ErrorCode.FORBIDDEN, details: { x: 1 }, requestId: 'r1' });
    const json = e.toJSON();
    const back = TitanError.fromJSON(json);
    expect(back.code).toBe(ErrorCode.FORBIDDEN);
    expect(back.details).toEqual({ x: 1 });
    expect(back.requestId).toBe('r1');
  });

  it('tracks statistics (inherited machinery)', () => {
    TitanError.resetStatistics();
    new TitanError({ code: ErrorCode.NOT_FOUND });
    new TitanError({ code: ErrorCode.NOT_FOUND });
    expect(TitanError.getStatistics().totalErrors).toBeGreaterThanOrEqual(2);
  });

  it('AggregateError is a TitanError subclass with correct instanceof', () => {
    const agg = TitanError.aggregate([new TitanError({ code: ErrorCode.BAD_REQUEST })]);
    expect(agg instanceof AggregateError).toBe(true);
    expect(agg instanceof TitanError).toBe(true);
    expect(agg.code).toBe(ErrorCode.MULTIPLE_ERRORS);
  });

  it('ensureError + isErrorCode helpers', () => {
    const e = ensureError(new Error('boom'));
    expect(e instanceof TitanError).toBe(true);
    expect(isErrorCode(e, ErrorCode.INTERNAL_ERROR)).toBe(true);
  });

  it('ensureError passes a TitanError through unchanged + appends a cause stack', () => {
    const original = new TitanError({ code: ErrorCode.NOT_FOUND });
    expect(ensureError(original)).toBe(original);

    const cause = new Error('root');
    const wrapped = new TitanError({ code: ErrorCode.INTERNAL_ERROR, cause });
    expect((wrapped as any).cause).toBe(cause);
    expect(wrapped.stack).toContain('Caused by:');
  });

  it('withContext / withDetails return a new error with merged fields', () => {
    const base = new TitanError({ code: ErrorCode.BAD_REQUEST, context: { a: 1 }, details: { x: 1 } });
    const withCtx = base.withContext({ b: 2 });
    expect(withCtx).not.toBe(base);
    expect(withCtx.context).toEqual({ a: 1, b: 2 });
    const withDet = base.withDetails({ y: 2 });
    expect(withDet.details).toEqual({ x: 1, y: 2 });
  });
});

describe('TitanError retry semantics', () => {
  it('isRetryable reflects the code', () => {
    expect(new TitanError({ code: ErrorCode.SERVICE_UNAVAILABLE }).isRetryable()).toBe(true);
    expect(new TitanError({ code: ErrorCode.BAD_REQUEST }).isRetryable()).toBe(false);
  });

  it('getRetryStrategy: non-retryable → no retry', () => {
    expect(new TitanError({ code: ErrorCode.FORBIDDEN }).getRetryStrategy()).toEqual({
      shouldRetry: false,
      delay: 0,
      maxAttempts: 0,
    });
  });

  it('getRetryStrategy: rate-limit uses retryAfter; others use exponential', () => {
    const rl = new TitanError({ code: ErrorCode.TOO_MANY_REQUESTS, details: { retryAfter: 5 } });
    expect(rl.getRetryStrategy()).toEqual({ shouldRetry: true, delay: 5000, maxAttempts: 3 });

    const other = new TitanError({ code: ErrorCode.INTERNAL_SERVER_ERROR });
    expect(other.getRetryStrategy()).toEqual({ shouldRetry: true, delay: 1000, maxAttempts: 3, backoffFactor: 2 });
  });
});

describe('TitanError statistics + pool + aggregate', () => {
  it('getCached returns a stable instance per code', () => {
    const a = TitanError.getCached(ErrorCode.NOT_FOUND);
    const b = TitanError.getCached(ErrorCode.NOT_FOUND);
    expect(a).toBe(b);
    expect(a.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('getMetrics + resetStatistics', () => {
    TitanError.resetStatistics();
    new TitanError({ code: ErrorCode.NOT_FOUND });
    new TitanError({ code: ErrorCode.NOT_FOUND });
    new TitanError({ code: ErrorCode.FORBIDDEN });
    const m = TitanError.getMetrics({ window: '1m' });
    expect(m.totalErrors).toBeGreaterThanOrEqual(3);
    expect(m.topErrors[0]).toMatchObject({ code: ErrorCode.NOT_FOUND, name: 'NOT_FOUND' });
    TitanError.resetStatistics();
    expect(TitanError.getStatistics().totalErrors).toBe(0);
  });

  it('XC-7: byCode stays bounded when errors carry arbitrary custom codes', () => {
    TitanError.resetStatistics();

    // Known enum codes are tracked precisely...
    new TitanError({ code: ErrorCode.NOT_FOUND });
    new TitanError({ code: ErrorCode.FORBIDDEN });

    // ...but 200 errors with DISTINCT arbitrary numeric codes must NOT mint 200
    // distinct byCode keys — that map is global + static, so per-code keys would
    // grow it without bound (a latent leak in a long-running process).
    for (let i = 0; i < 200; i++) {
      new TitanError({ code: 50_000 + i });
    }

    const { byCode } = TitanError.getStatistics();
    // NOT_FOUND + FORBIDDEN + the single custom bucket (-1) = 3 keys, not 202.
    expect(Object.keys(byCode)).toHaveLength(3);
    expect(byCode[ErrorCode.NOT_FOUND]).toBe(1);
    expect(byCode[ErrorCode.FORBIDDEN]).toBe(1);
    expect(byCode[-1]).toBe(200); // every custom code folded into the bucket
    TitanError.resetStatistics();
  });

  it('ErrorPool reuses error objects (resetting their fields)', () => {
    const pool = TitanError.createPool({ size: 2 });
    expect(pool.size).toBe(2);
    const e1 = pool.acquire(ErrorCode.BAD_REQUEST, 'first');
    expect(e1.code).toBe(ErrorCode.BAD_REQUEST);
    expect(e1.message).toBe('first');
    pool.release(e1);
    const e2 = pool.acquire(ErrorCode.NOT_FOUND);
    expect(e2.code).toBe(ErrorCode.NOT_FOUND);
    expect(e2.httpStatus).toBe(404);
  });

  it('AggregateError deduplicates by code+message when asked', () => {
    const errs = [
      new TitanError({ code: ErrorCode.BAD_REQUEST, message: 'dup' }),
      new TitanError({ code: ErrorCode.BAD_REQUEST, message: 'dup' }),
      new TitanError({ code: ErrorCode.NOT_FOUND, message: 'other' }),
    ];
    const agg = new AggregateError(errs, { deduplicate: true });
    expect(agg.errors).toHaveLength(2);
    expect(agg.summary).toBe('2 errors occurred');
    expect(agg.code).toBe(ErrorCode.MULTIPLE_ERRORS);
  });
});
