/**
 * Priceverse 2.0 - Error Codes
 */

export enum PriceVerseErrorCode {
  // Price errors (1xxx)
  PAIR_NOT_FOUND = 'PRICE_1001',
  PRICE_UNAVAILABLE = 'PRICE_1002',
  PRICE_STALE = 'PRICE_1003',

  // Chart errors (2xxx)
  CHART_DATA_NOT_FOUND = 'CHART_2001',
  INVALID_TIME_RANGE = 'CHART_2002',
  INVALID_INTERVAL = 'CHART_2003',

  // Exchange errors (3xxx)
  EXCHANGE_DISCONNECTED = 'EXCHANGE_3001',
  EXCHANGE_RATE_LIMITED = 'EXCHANGE_3002',
  EXCHANGE_NOT_SUPPORTED = 'EXCHANGE_3003',

  // Validation errors (4xxx)
  INVALID_PAIR = 'VALIDATION_4001',
  INVALID_PERIOD = 'VALIDATION_4002',
  INVALID_DATE_FORMAT = 'VALIDATION_4003',
  INVALID_PARAMS = 'VALIDATION_4004',

  // System errors (5xxx)
  DATABASE_ERROR = 'SYSTEM_5001',
  REDIS_ERROR = 'SYSTEM_5002',
  INTERNAL_ERROR = 'SYSTEM_5003',
  SERVICE_UNAVAILABLE = 'SYSTEM_5004',
}

/**
 * Custom error class for Priceverse
 */
export class PriceVerseError extends Error {
  constructor(
    public readonly code: PriceVerseErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PriceVerseError';
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
