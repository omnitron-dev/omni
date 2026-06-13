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
});
