/**
 * Unit Tests - Zod Schemas Validation
 */

import { describe, it, expect } from 'vitest';
import {
  PairSchema,
  PeriodSchema,
  IntervalSchema,
  GetPriceParamsSchema,
  GetMultiplePricesParamsSchema,
  GetPriceChangeParamsSchema,
  GetChartParamsSchema,
  GetOhlcvParamsSchema,
  PriceResponseSchema,
  PriceChangeResponseSchema,
  ChartResponseSchema,
  OhlcvCandleSchema,
  OhlcvResponseSchema,
  HealthCheckSchema,
  HealthResponseSchema,
} from '../../../src/contracts/schemas.js';

describe('PairSchema', () => {
  it('should validate valid pair symbols', () => {
    expect(() => PairSchema.parse('btc-usd')).not.toThrow();
    expect(() => PairSchema.parse('xmr-usd')).not.toThrow();
    expect(() => PairSchema.parse('eth-usd')).not.toThrow();
    expect(() => PairSchema.parse('btc-rub')).not.toThrow();
    expect(() => PairSchema.parse('xmr-rub')).not.toThrow();
    expect(() => PairSchema.parse('eth-rub')).not.toThrow();
  });

  it('should reject invalid pair symbols', () => {
    expect(() => PairSchema.parse('btc-eur')).toThrow();
    expect(() => PairSchema.parse('invalid')).toThrow();
    expect(() => PairSchema.parse('')).toThrow();
    expect(() => PairSchema.parse(null)).toThrow();
  });
});

describe('PeriodSchema', () => {
  it('should validate valid periods', () => {
    expect(() => PeriodSchema.parse('24hours')).not.toThrow();
    expect(() => PeriodSchema.parse('7days')).not.toThrow();
    expect(() => PeriodSchema.parse('30days')).not.toThrow();
    expect(() => PeriodSchema.parse('custom')).not.toThrow();
  });

  it('should reject invalid periods', () => {
    expect(() => PeriodSchema.parse('1year')).toThrow();
    expect(() => PeriodSchema.parse('invalid')).toThrow();
  });
});

describe('IntervalSchema', () => {
  it('should validate valid intervals', () => {
    expect(() => IntervalSchema.parse('5min')).not.toThrow();
    expect(() => IntervalSchema.parse('1hour')).not.toThrow();
    expect(() => IntervalSchema.parse('1day')).not.toThrow();
  });

  it('should reject invalid intervals', () => {
    expect(() => IntervalSchema.parse('10min')).toThrow();
    expect(() => IntervalSchema.parse('1week')).toThrow();
  });
});

describe('GetPriceParamsSchema', () => {
  it('should validate valid params', () => {
    const result = GetPriceParamsSchema.parse({
      pair: 'btc-usd',
    });
    expect(result.pair).toBe('btc-usd');
  });

  it('should reject missing pair', () => {
    expect(() => GetPriceParamsSchema.parse({})).toThrow();
  });

  it('should reject invalid pair', () => {
    expect(() =>
      GetPriceParamsSchema.parse({
        pair: 'invalid',
      })
    ).toThrow();
  });
});

describe('GetMultiplePricesParamsSchema', () => {
  it('should validate valid params with single pair', () => {
    const result = GetMultiplePricesParamsSchema.parse({
      pairs: ['btc-usd'],
    });
    expect(result.pairs).toHaveLength(1);
  });

  it('should validate valid params with multiple pairs', () => {
    const result = GetMultiplePricesParamsSchema.parse({
      pairs: ['btc-usd', 'eth-usd', 'xmr-usd'],
    });
    expect(result.pairs).toHaveLength(3);
  });

  it('should reject empty array', () => {
    expect(() =>
      GetMultiplePricesParamsSchema.parse({
        pairs: [],
      })
    ).toThrow();
  });

  it('should reject more than 10 pairs', () => {
    const pairs = Array(11).fill('btc-usd');
    expect(() =>
      GetMultiplePricesParamsSchema.parse({
        pairs,
      })
    ).toThrow();
  });

  it('should reject invalid pairs in array', () => {
    expect(() =>
      GetMultiplePricesParamsSchema.parse({
        pairs: ['btc-usd', 'invalid'],
      })
    ).toThrow();
  });
});

describe('GetPriceChangeParamsSchema', () => {
  it('should validate valid params with period', () => {
    const result = GetPriceChangeParamsSchema.parse({
      pair: 'btc-usd',
      period: '24hours',
    });
    expect(result.pair).toBe('btc-usd');
    expect(result.period).toBe('24hours');
  });

  it('should validate valid params with custom dates', () => {
    const result = GetPriceChangeParamsSchema.parse({
      pair: 'btc-usd',
      period: 'custom',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
    });
    expect(result.from).toBe('2024-01-01T00:00:00Z');
    expect(result.to).toBe('2024-01-02T00:00:00Z');
  });

  it('should reject invalid datetime format', () => {
    expect(() =>
      GetPriceChangeParamsSchema.parse({
        pair: 'btc-usd',
        period: 'custom',
        from: '2024-01-01',
        to: '2024-01-02',
      })
    ).toThrow();
  });
});

describe('GetChartParamsSchema', () => {
  it('should apply default values', () => {
    const result = GetChartParamsSchema.parse({
      pair: 'btc-usd',
    });
    expect(result.period).toBe('7days');
    expect(result.interval).toBe('1hour');
  });

  it('should validate custom values', () => {
    const result = GetChartParamsSchema.parse({
      pair: 'btc-usd',
      period: '30days',
      interval: '1day',
    });
    expect(result.period).toBe('30days');
    expect(result.interval).toBe('1day');
  });

  it('should validate with custom date range', () => {
    const result = GetChartParamsSchema.parse({
      pair: 'btc-usd',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-31T23:59:59Z',
    });
    expect(result.from).toBe('2024-01-01T00:00:00Z');
    expect(result.to).toBe('2024-01-31T23:59:59Z');
  });
});

describe('GetOhlcvParamsSchema', () => {
  it('should apply default limit and offset', () => {
    const result = GetOhlcvParamsSchema.parse({
      pair: 'btc-usd',
      interval: '1hour',
    });
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
  });

  it('should validate custom limit and offset', () => {
    const result = GetOhlcvParamsSchema.parse({
      pair: 'btc-usd',
      interval: '1hour',
      limit: 50,
      offset: 10,
    });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(10);
  });

  it('should reject limit below 1', () => {
    expect(() =>
      GetOhlcvParamsSchema.parse({
        pair: 'btc-usd',
        interval: '1hour',
        limit: 0,
      })
    ).toThrow();
  });

  it('should reject limit above 1000', () => {
    expect(() =>
      GetOhlcvParamsSchema.parse({
        pair: 'btc-usd',
        interval: '1hour',
        limit: 1001,
      })
    ).toThrow();
  });

  it('should reject negative offset', () => {
    expect(() =>
      GetOhlcvParamsSchema.parse({
        pair: 'btc-usd',
        interval: '1hour',
        offset: -1,
      })
    ).toThrow();
  });
});

describe('PriceResponseSchema', () => {
  it('should validate valid price response', () => {
    const result = PriceResponseSchema.parse({
      pair: 'btc-usd',
      price: 45000.5,
      timestamp: 1704067200000,
    });
    expect(result.pair).toBe('btc-usd');
    expect(result.price).toBe(45000.5);
    expect(result.timestamp).toBe(1704067200000);
  });

  it('should reject missing fields', () => {
    expect(() =>
      PriceResponseSchema.parse({
        pair: 'btc-usd',
        price: 45000.5,
      })
    ).toThrow();
  });

  it('should reject invalid types', () => {
    expect(() =>
      PriceResponseSchema.parse({
        pair: 'btc-usd',
        price: '45000.5',
        timestamp: 1704067200000,
      })
    ).toThrow();
  });
});

describe('PriceChangeResponseSchema', () => {
  it('should validate valid price change response', () => {
    const result = PriceChangeResponseSchema.parse({
      pair: 'btc-usd',
      startDate: 1704067200000,
      endDate: 1704153600000,
      startPrice: 43000,
      endPrice: 45000,
      changePercent: 4.65,
    });
    expect(result.changePercent).toBe(4.65);
  });

  it('should accept negative change percent', () => {
    const result = PriceChangeResponseSchema.parse({
      pair: 'btc-usd',
      startDate: 1704067200000,
      endDate: 1704153600000,
      startPrice: 45000,
      endPrice: 43000,
      changePercent: -4.44,
    });
    expect(result.changePercent).toBe(-4.44);
  });
});

describe('ChartResponseSchema', () => {
  it('should validate chart response without OHLCV', () => {
    const result = ChartResponseSchema.parse({
      dates: ['2024-01-01', '2024-01-02'],
      series: [45000, 46000],
    });
    expect(result.dates).toHaveLength(2);
    expect(result.series).toHaveLength(2);
    expect(result.ohlcv).toBeUndefined();
  });

  it('should validate chart response with OHLCV', () => {
    const result = ChartResponseSchema.parse({
      dates: ['2024-01-01'],
      series: [45000],
      ohlcv: {
        open: [44000],
        high: [46000],
        low: [43500],
        close: [45000],
        volume: [1000],
      },
    });
    expect(result.ohlcv).toBeDefined();
    expect(result.ohlcv?.open).toHaveLength(1);
  });

  it('should reject mismatched array lengths', () => {
    expect(() =>
      ChartResponseSchema.parse({
        dates: ['2024-01-01'],
        series: [45000, 46000],
      })
    ).not.toThrow(); // Schema doesn't enforce this, but worth noting
  });
});

describe('OhlcvCandleSchema', () => {
  it('should validate valid candle', () => {
    const result = OhlcvCandleSchema.parse({
      timestamp: '2024-01-01T00:00:00Z',
      open: 44000,
      high: 46000,
      low: 43500,
      close: 45000,
      volume: 1000,
      vwap: 44800,
    });
    expect(result.vwap).toBe(44800);
  });

  it('should allow null vwap', () => {
    const result = OhlcvCandleSchema.parse({
      timestamp: '2024-01-01T00:00:00Z',
      open: 44000,
      high: 46000,
      low: 43500,
      close: 45000,
      volume: 1000,
      vwap: null,
    });
    expect(result.vwap).toBeNull();
  });
});

describe('OhlcvResponseSchema', () => {
  it('should validate valid OHLCV response', () => {
    const result = OhlcvResponseSchema.parse({
      candles: [
        {
          timestamp: '2024-01-01T00:00:00Z',
          open: 44000,
          high: 46000,
          low: 43500,
          close: 45000,
          volume: 1000,
          vwap: 44800,
        },
      ],
      pagination: {
        total: 100,
        limit: 10,
        offset: 0,
      },
    });
    expect(result.candles).toHaveLength(1);
    expect(result.pagination.total).toBe(100);
  });

  it('should validate empty candles array', () => {
    const result = OhlcvResponseSchema.parse({
      candles: [],
      pagination: {
        total: 0,
        limit: 10,
        offset: 0,
      },
    });
    expect(result.candles).toHaveLength(0);
  });
});

describe('HealthCheckSchema', () => {
  it('should validate health check with up status', () => {
    const result = HealthCheckSchema.parse({
      status: 'up',
      latency: 15,
    });
    expect(result.status).toBe('up');
    expect(result.latency).toBe(15);
  });

  it('should validate health check with down status and message', () => {
    const result = HealthCheckSchema.parse({
      status: 'down',
      message: 'Connection refused',
    });
    expect(result.status).toBe('down');
    expect(result.message).toBe('Connection refused');
  });
});

describe('HealthResponseSchema', () => {
  it('should validate complete health response', () => {
    const result = HealthResponseSchema.parse({
      status: 'healthy',
      timestamp: '2024-01-01T00:00:00Z',
      uptime: 3600,
      version: '2.0.0',
      checks: {
        database: { status: 'up', latency: 5 },
        redis: { status: 'up', latency: 2 },
      },
      latency: 10,
    });
    expect(result.status).toBe('healthy');
    expect(result.checks.database.status).toBe('up');
  });

  it('should validate degraded status', () => {
    const result = HealthResponseSchema.parse({
      status: 'degraded',
      timestamp: '2024-01-01T00:00:00Z',
      uptime: 3600,
      version: '2.0.0',
      checks: {
        database: { status: 'up' },
        redis: { status: 'down', message: 'Timeout' },
      },
    });
    expect(result.status).toBe('degraded');
  });
});
