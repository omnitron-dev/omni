/**
 * Priceverse 2.0 - Validation Schemas (Zod)
 */

import { z } from 'zod';

// Pair validation
export const PairSchema = z.enum([
  'btc-usd',
  'xmr-usd',
  'btc-rub',
  'xmr-rub',
  'eth-usd',
  'eth-rub',
]);

// Period validation
export const PeriodSchema = z.enum(['24hours', '7days', '30days', 'custom']);

// Interval validation
export const IntervalSchema = z.enum(['5min', '1hour', '1day']);

// GetPrice params
export const GetPriceParamsSchema = z.object({
  pair: PairSchema,
});

// GetMultiplePrices params
export const GetMultiplePricesParamsSchema = z.object({
  pairs: z.array(PairSchema).min(1).max(10),
});

// GetPriceChange params
export const GetPriceChangeParamsSchema = z.object({
  pair: PairSchema,
  period: PeriodSchema,
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// GetChart params
export const GetChartParamsSchema = z.object({
  pair: PairSchema,
  period: PeriodSchema.optional().default('7days'),
  interval: IntervalSchema.optional().default('1hour'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// GetOHLCV params
export const GetOhlcvParamsSchema = z.object({
  pair: PairSchema,
  interval: IntervalSchema,
  limit: z.number().int().min(1).max(1000).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
});

// Response schemas
export const PriceResponseSchema = z.object({
  pair: z.string(),
  price: z.number(),
  timestamp: z.number(),
});

export const PriceChangeResponseSchema = z.object({
  pair: z.string(),
  startDate: z.number(),
  endDate: z.number(),
  startPrice: z.number(),
  endPrice: z.number(),
  changePercent: z.number(),
});

export const ChartResponseSchema = z.object({
  dates: z.array(z.string()),
  series: z.array(z.number()),
  ohlcv: z
    .object({
      open: z.array(z.number()),
      high: z.array(z.number()),
      low: z.array(z.number()),
      close: z.array(z.number()),
      volume: z.array(z.number()),
    })
    .optional(),
});

export const OhlcvCandleSchema = z.object({
  timestamp: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  vwap: z.number().nullable(),
});

export const OhlcvResponseSchema = z.object({
  candles: z.array(OhlcvCandleSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

export const HealthCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latency: z.number().optional(),
  message: z.string().optional(),
});

export const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  uptime: z.number(),
  version: z.string(),
  checks: z.record(z.string(), HealthCheckSchema),
  latency: z.number().optional(),
});

// Type exports
export type GetPriceParams = z.infer<typeof GetPriceParamsSchema>;
export type GetMultiplePricesParams = z.infer<typeof GetMultiplePricesParamsSchema>;
export type GetPriceChangeParams = z.infer<typeof GetPriceChangeParamsSchema>;
export type GetChartParams = z.infer<typeof GetChartParamsSchema>;
export type GetOhlcvParams = z.infer<typeof GetOhlcvParamsSchema>;
