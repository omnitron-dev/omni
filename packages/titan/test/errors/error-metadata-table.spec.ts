/**
 * ERROR-TABLE: the per-code error metadata (name / message / retryable) used to
 * be triplicated across getErrorName's map, getDefaultMessage's map, and the
 * isRetryableError list. They now derive from one ERROR_METADATA table. These
 * tests lock in that single-source invariant so the three can't drift apart
 * again, and assert the retryable set is exactly the documented codes.
 */

import { describe, it, expect } from 'vitest';
import {
  ERROR_METADATA,
  getErrorName,
  getDefaultMessage,
  isRetryableError,
  ErrorCode,
} from '../../src/errors/codes.js';

describe('ERROR_METADATA single-source table (ERROR-TABLE)', () => {
  it('drives getErrorName / getDefaultMessage / isRetryableError for every entry', () => {
    for (const [codeStr, meta] of Object.entries(ERROR_METADATA)) {
      const code = Number(codeStr);
      if (meta.name !== undefined) {
        expect(getErrorName(code)).toBe(meta.name);
      }
      if (meta.message !== undefined) {
        expect(getDefaultMessage(code)).toBe(meta.message);
      }
      expect(isRetryableError(code)).toBe(meta.retryable === true);
    }
  });

  it('falls back for codes without curated name/message', () => {
    // 511 is retryable but has no curated name/message.
    expect(ERROR_METADATA[511]).toEqual({ retryable: true });
    expect(getErrorName(511)).toBe('ERROR_511');
    expect(getDefaultMessage(511)).toBe('Error 511');
    expect(isRetryableError(511)).toBe(true);

    // Wholly unknown code → both fall back, not retryable.
    expect(getErrorName(987)).toBe('ERROR_987');
    expect(getDefaultMessage(987)).toBe('Error 987');
    expect(isRetryableError(987)).toBe(false);
  });

  it('marks exactly the documented retryable codes', () => {
    const retryable = Object.entries(ERROR_METADATA)
      .filter(([, m]) => m.retryable)
      .map(([c]) => Number(c))
      .sort((a, b) => a - b);
    expect(retryable).toEqual([
      ErrorCode.REQUEST_TIMEOUT, // 408
      ErrorCode.TOO_MANY_REQUESTS, // 429
      ErrorCode.INTERNAL_SERVER_ERROR, // 500
      ErrorCode.BAD_GATEWAY, // 502
      ErrorCode.SERVICE_UNAVAILABLE, // 503
      ErrorCode.GATEWAY_TIMEOUT, // 504
      ErrorCode.INSUFFICIENT_STORAGE, // 507
      ErrorCode.NETWORK_AUTHENTICATION_REQUIRED, // 511
    ]);
  });
});
