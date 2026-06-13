import { describe, it, expect } from 'vitest';
import { ErrorCode, ErrorCategory, getErrorCategory, isClientError, isServerError } from '../src/index.js';

describe('error codes', () => {
  it('exposes HTTP-semantic codes', () => {
    expect(ErrorCode.OK).toBe(200);
    expect(ErrorCode.NOT_FOUND).toBe(404);
    expect(ErrorCode.INTERNAL_ERROR ?? ErrorCode.INTERNAL_SERVER_ERROR).toBe(500);
  });

  it('classifies categories by range', () => {
    expect(getErrorCategory(404)).toBe(ErrorCategory.CLIENT);
    expect(getErrorCategory(500)).toBe(ErrorCategory.SERVER);
    expect(getErrorCategory(429)).toBe(ErrorCategory.RATE_LIMIT);
    expect(getErrorCategory(200)).toBe(ErrorCategory.SUCCESS);
  });

  it('isClientError / isServerError split on 4xx vs 5xx', () => {
    expect(isClientError(404)).toBe(true);
    expect(isClientError(500)).toBe(false);
    expect(isServerError(503)).toBe(true);
    expect(isServerError(404)).toBe(false);
  });
});
