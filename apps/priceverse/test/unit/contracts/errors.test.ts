/**
 * Unit Tests - Error Classes
 */

import { describe, it, expect } from 'vitest';
import { PriceVerseError, PriceVerseErrorCode } from '../../../src/contracts/errors.js';

describe('PriceVerseError', () => {
  it('should create error with code and message', () => {
    const error = new PriceVerseError(
      PriceVerseErrorCode.PAIR_NOT_FOUND,
      'Pair btc-usd not found'
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PriceVerseError);
    expect(error.name).toBe('PriceVerseError');
    expect(error.code).toBe(PriceVerseErrorCode.PAIR_NOT_FOUND);
    expect(error.message).toBe('Pair btc-usd not found');
    expect(error.details).toBeUndefined();
  });

  it('should create error with details', () => {
    const details = { pair: 'btc-usd', timestamp: 1704067200000 };
    const error = new PriceVerseError(
      PriceVerseErrorCode.PRICE_UNAVAILABLE,
      'Price data unavailable',
      details
    );

    expect(error.code).toBe(PriceVerseErrorCode.PRICE_UNAVAILABLE);
    expect(error.details).toEqual(details);
  });

  it('should serialize to JSON correctly', () => {
    const error = new PriceVerseError(
      PriceVerseErrorCode.INVALID_PAIR,
      'Invalid pair format',
      { provided: 'btc-eur', expected: 'btc-usd' }
    );

    const json = error.toJSON();
    expect(json).toEqual({
      code: PriceVerseErrorCode.INVALID_PAIR,
      message: 'Invalid pair format',
      details: { provided: 'btc-eur', expected: 'btc-usd' },
    });
  });

  it('should serialize to JSON without details', () => {
    const error = new PriceVerseError(
      PriceVerseErrorCode.INTERNAL_ERROR,
      'Internal server error'
    );

    const json = error.toJSON();
    expect(json).toEqual({
      code: PriceVerseErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
      details: undefined,
    });
  });

  it('should have correct error codes for price errors', () => {
    expect(PriceVerseErrorCode.PAIR_NOT_FOUND).toBe('PRICE_1001');
    expect(PriceVerseErrorCode.PRICE_UNAVAILABLE).toBe('PRICE_1002');
    expect(PriceVerseErrorCode.PRICE_STALE).toBe('PRICE_1003');
  });

  it('should have correct error codes for chart errors', () => {
    expect(PriceVerseErrorCode.CHART_DATA_NOT_FOUND).toBe('CHART_2001');
    expect(PriceVerseErrorCode.INVALID_TIME_RANGE).toBe('CHART_2002');
    expect(PriceVerseErrorCode.INVALID_INTERVAL).toBe('CHART_2003');
  });

  it('should have correct error codes for exchange errors', () => {
    expect(PriceVerseErrorCode.EXCHANGE_DISCONNECTED).toBe('EXCHANGE_3001');
    expect(PriceVerseErrorCode.EXCHANGE_RATE_LIMITED).toBe('EXCHANGE_3002');
    expect(PriceVerseErrorCode.EXCHANGE_NOT_SUPPORTED).toBe('EXCHANGE_3003');
  });

  it('should have correct error codes for validation errors', () => {
    expect(PriceVerseErrorCode.INVALID_PAIR).toBe('VALIDATION_4001');
    expect(PriceVerseErrorCode.INVALID_PERIOD).toBe('VALIDATION_4002');
    expect(PriceVerseErrorCode.INVALID_DATE_FORMAT).toBe('VALIDATION_4003');
    expect(PriceVerseErrorCode.INVALID_PARAMS).toBe('VALIDATION_4004');
  });

  it('should have correct error codes for system errors', () => {
    expect(PriceVerseErrorCode.DATABASE_ERROR).toBe('SYSTEM_5001');
    expect(PriceVerseErrorCode.REDIS_ERROR).toBe('SYSTEM_5002');
    expect(PriceVerseErrorCode.INTERNAL_ERROR).toBe('SYSTEM_5003');
    expect(PriceVerseErrorCode.SERVICE_UNAVAILABLE).toBe('SYSTEM_5004');
  });

  it('should be catchable as Error', () => {
    try {
      throw new PriceVerseError(
        PriceVerseErrorCode.DATABASE_ERROR,
        'Database connection failed'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof PriceVerseError) {
        expect(error.code).toBe(PriceVerseErrorCode.DATABASE_ERROR);
      }
    }
  });

  it('should preserve stack trace', () => {
    const error = new PriceVerseError(
      PriceVerseErrorCode.INTERNAL_ERROR,
      'Something went wrong'
    );

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('PriceVerseError');
  });
});
