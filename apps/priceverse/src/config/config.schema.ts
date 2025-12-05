/**
 * Priceverse 2.0 - Configuration Schema
 */

import { z } from 'zod';

export const configSchema = z.object({
  // Application
  app: z.object({
    name: z.string().default('priceverse'),
    version: z.string().default('2.0.0'),
    environment: z
      .enum(['development', 'staging', 'production'])
      .default('development'),
    port: z.number().default(3000),
    host: z.string().default('0.0.0.0'),
  }),

  // Database
  database: z.object({
    dialect: z.literal('postgres').default('postgres'),
    host: z.string().default('localhost'),
    port: z.number().default(5432),
    database: z.string().default('priceverse'),
    user: z.string().default('postgres'),
    password: z.string().default('postgres'),
    pool: z
      .object({
        min: z.number().default(2),
        max: z.number().default(20),
      })
      .optional(),
    ssl: z.boolean().default(false),
  }),

  // Redis
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(6379),
    password: z.string().optional(),
    db: z.number().default(0),
  }),

  // Exchanges
  exchanges: z.object({
    enabled: z
      .array(z.string())
      .default(['binance', 'kraken', 'coinbase', 'okx', 'bybit', 'kucoin']),
    maxReconnectAttempts: z.number().default(10),
    reconnectBaseDelay: z.number().default(1000),
  }),

  // Aggregation
  aggregation: z.object({
    interval: z.number().default(10_000), // 10 seconds
    windowSize: z.number().default(30_000), // 30 seconds
    pairs: z.array(z.string()).default(['btc-usd', 'xmr-usd', 'eth-usd']),
  }),

  // Logging
  logging: z.object({
    level: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
    pretty: z.boolean().default(false),
  }),

  // Health
  health: z.object({
    enabled: z.boolean().default(true),
    path: z.string().default('/health'),
    timeout: z.number().default(5000),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
