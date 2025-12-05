# Priceverse 2.0 - Titan-Based Price Aggregation Platform

## Executive Summary

**Priceverse 2.0** is a next-generation, enterprise-grade cryptocurrency and forex price aggregation platform built entirely on the **Titan framework**. This system demonstrates Titan's full capabilities as an industrial-strength backend platform, utilizing:

- **Netron RPC** with HTTP transport for high-performance JSON-RPC API
- **Titan Process Manager** for horizontal scaling with worker pools and supervision
- **Titan Database Module** with Kysely for type-safe database operations
- **Titan Redis Module** for caching, pub/sub, and real-time streaming
- **Titan Scheduler** for periodic aggregation tasks
- **Titan Events** for event-driven architecture
- **Nexus DI** for complete dependency injection

### Key Improvements Over Original Priceverse

| Aspect | Original (NestJS) | Priceverse 2.0 (Titan) |
|--------|-------------------|------------------------|
| Framework | NestJS + Fastify | Titan (minimal footprint) |
| ORM | Prisma + ZenStack | Kysely (type-safe, lightweight) |
| RPC/API | ts-rest + NestJS controllers | Netron HTTP Transport (JSON-RPC style) |
| DI System | NestJS DI | Nexus DI (advanced, plugin-based) |
| Messaging | Redis Streams (manual) | Rotif + Redis Module (integrated) |
| Scheduling | node-cron | Titan Scheduler (distributed) |
| Health | Custom | Titan Health (built-in) |
| Streaming | Manual | Netron Streaming (native) |
| Scaling | PM2 cluster | Titan PM (Process Pools, Supervisors) |
| Fault Tolerance | Manual restart | Titan Supervisor (Erlang-style) |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [System Components](#2-system-components)
3. [Data Models](#3-data-models)
4. [Service Definitions](#4-service-definitions)
5. [Netron HTTP API](#5-netron-http-api)
6. [Exchange Collectors](#6-exchange-collectors)
7. [Aggregation Engine](#7-aggregation-engine)
8. [Scaling with Process Manager](#8-scaling-with-process-manager)
9. [Caching Strategy](#9-caching-strategy)
10. [Configuration Management](#10-configuration-management)
11. [Health & Monitoring](#11-health--monitoring)
12. [Implementation Plan](#12-implementation-plan)
13. [File Structure](#13-file-structure)
14. [Technical Specifications](#14-technical-specifications)

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRICEVERSE 2.0 PLATFORM                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        TITAN APPLICATION                                │ │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐│ │
│  │  │   ConfigModule   │ │   LoggerModule   │ │     HealthModule         ││ │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────────────┘│ │
│  │                                                                         │ │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐│ │
│  │  │  DatabaseModule  │ │    RedisModule   │ │    SchedulerModule       ││ │
│  │  │  (Kysely/PG)     │ │  (Cache/PubSub)  │ │    (Cron/Interval)       ││ │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────────────┘│ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐│ │
│  │  │                    APPLICATION MODULES                               ││ │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐││ │
│  │  │  │  Collector  │ │ Aggregator  │ │   Prices    │ │    Charts       │││ │
│  │  │  │   Module    │ │   Module    │ │   Module    │ │    Module       │││ │
│  │  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘││ │
│  │  └─────────────────────────────────────────────────────────────────────┘│ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐│ │
│  │  │                    NETRON HTTP TRANSPORT (JSON-RPC)                  ││ │
│  │  │  ┌─────────────────────────────────────────────────────────────────┐││ │
│  │  │  │  POST /netron/invoke     → PricesService.getPrice(...)         │││ │
│  │  │  │  POST /netron/invoke     → ChartsService.getChartData(...)     │││ │
│  │  │  │  POST /netron/batch      → Multiple calls in single request    │││ │
│  │  │  │  GET  /health            → Health check (no auth)              │││ │
│  │  │  └─────────────────────────────────────────────────────────────────┘││ │
│  │  └─────────────────────────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌───────────────────────────────────┐  ┌──────────────────────────────────┐│
│  │         EXCHANGE WORKERS          │  │         DATA STORAGE              ││
│  │  ┌─────────┐ ┌─────────┐          │  │  ┌──────────┐ ┌──────────────────┐││
│  │  │ Binance │ │ Kraken  │ ...      │  │  │PostgreSQL│ │      Redis       │││
│  │  │ Worker  │ │ Worker  │          │  │  │ (Kysely) │ │ (Cache/Streams)  │││
│  │  └─────────┘ └─────────┘          │  │  └──────────┘ └──────────────────┘││
│  └───────────────────────────────────┘  └──────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow Architecture

```
EXCHANGES (WebSocket)              TITAN APPLICATION                    CLIENTS
      │                                   │                                │
      │   ┌───────────────────────────────┴────────────────────────────┐   │
      │   │                                                             │   │
      ▼   │   ┌────────────┐    ┌────────────┐    ┌────────────────┐   │   │
  Binance─┼──▶│            │    │            │    │                │   │   │
  Kraken ─┼──▶│ Collector  │───▶│ Redis      │───▶│   Aggregator   │   │   │
  Coinbase┼──▶│ Workers    │    │ Streams    │    │   Service      │   │   │
  OKX    ─┼──▶│            │    │            │    │                │   │   │
  Bybit  ─┼──▶└────────────┘    └────────────┘    └───────┬────────┘   │   │
      │   │                                               │            │   │
      │   │                                               ▼            │   │
      │   │                          ┌────────────────────────────┐    │   │
      │   │                          │      VWAP Calculation      │    │   │
      │   │                          │   (10s real-time window)   │    │   │
      │   │                          └─────────────┬──────────────┘    │   │
      │   │                                        │                   │   │
      │   │                    ┌───────────────────┼───────────────┐   │   │
      │   │                    ▼                   ▼               │   │   │
      │   │           ┌──────────────┐     ┌─────────────┐         │   │
      │   │           │   Redis      │     │  PostgreSQL │         │   │
      │   │           │   Cache      │     │  (History)  │         │   │
      │   │           │ (Live Price) │     │             │         │   │
      │   │           └──────┬───────┘     └──────┬──────┘         │   │
      │   │                  │                    │                │   │
      │   │                  └────────┬───────────┘                │   │
      │   │                           │                            │   │
      │   │                           ▼                            │   │
      │   │                  ┌────────────────┐                    │   │
      │   │                  │ Prices Service │◀───────────────────┼───┤
      │   │                  │ (Netron RPC)   │                    │   │
      │   │                  └────────────────┘                    │   │
      │   │                           │                            │   │
      │   └───────────────────────────┼────────────────────────────┘   │
      │                               ▼                                │
      │                      ┌────────────────┐                        │
      └──────────────────────│  HTTP API      │◀───────────────────────┘
                             │  (Port 3000)   │
                             └────────────────┘
```

### 1.3 Core Design Principles

1. **Single Application Instance**: Unlike the original 3-bootstrap design, Priceverse 2.0 runs as a single Titan application with modular internal components.

2. **Event-Driven**: Uses Titan Events module for loose coupling between collectors, aggregators, and services.

3. **Type-Safe Throughout**: Kysely for database, Zod for validation, TypeScript strict mode.

4. **Horizontal Scalability**: Designed for Redis-backed distributed execution.

5. **Observable**: Built-in health checks, metrics, and structured logging.

---

## 2. System Components

### 2.1 Module Hierarchy

```typescript
// Main application module
@Module({
  imports: [
    // Titan Core Modules
    ConfigModule.forRoot(configOptions),
    LoggerModule.forRoot(loggerOptions),
    DatabaseModule.forRoot(databaseOptions),
    RedisModule.forRoot(redisOptions),
    SchedulerModule.forRoot(schedulerOptions),
    EventsModule.forRoot(),

    // Application Modules
    CollectorModule,
    AggregatorModule,
    PricesModule,
    ChartsModule,
  ],
  providers: [
    // Global providers
    { provide: APP_CONFIG_TOKEN, useClass: AppConfigService },
  ],
  exports: [],
})
export class AppModule {}
```

### 2.2 Module Descriptions

#### CollectorModule
- **Purpose**: Collect raw trade data from cryptocurrency exchanges
- **Components**:
  - `ExchangeWorkerManager` - Manages WebSocket connections to exchanges
  - `BinanceWorker`, `KrakenWorker`, etc. - Exchange-specific collectors
  - `TradeStreamPublisher` - Publishes trades to Redis Streams
- **Dependencies**: RedisModule, ConfigModule, LoggerModule

#### AggregatorModule
- **Purpose**: Process trade streams and calculate aggregated prices
- **Components**:
  - `StreamAggregator` - Consumes Redis Streams, calculates VWAP
  - `OHLCVAggregator` - Creates 5min/1hour/1day candles
  - `CurrencyConverter` - Converts USD to RUB using CBR rate
- **Dependencies**: RedisModule, DatabaseModule, SchedulerModule

#### PricesModule
- **Purpose**: Expose price data via Netron RPC/HTTP
- **Components**:
  - `PricesService` - Business logic for price queries
  - `PricesRpcService` - Netron-exposed RPC service
- **Dependencies**: RedisModule, DatabaseModule

#### ChartsModule
- **Purpose**: Provide OHLCV chart data
- **Components**:
  - `ChartsService` - Chart data queries and formatting
  - `ChartsRpcService` - Netron-exposed chart endpoints
- **Dependencies**: DatabaseModule

---

## 3. Data Models

### 3.1 Database Schema (Kysely)

```typescript
// src/database/schema.ts

import { Generated, ColumnType } from 'kysely';

// Price history - raw aggregated prices
export interface PriceHistoryTable {
  id: Generated<number>;
  pair: PairSymbol;
  price: ColumnType<string, string, string>; // Decimal as string
  timestamp: ColumnType<Date, Date | string, Date | string>;
  method: AggregationMethod;
  sources: ColumnType<string[], string[], string[]>; // JSON array
  volume: ColumnType<string | null, string | null, string | null>;
  created_at: ColumnType<Date, never, never>;
}

// 5-minute OHLCV candles
export interface PriceHistory5MinTable {
  id: Generated<number>;
  pair: PairSymbol;
  timestamp: ColumnType<Date, Date | string, Date | string>;
  open: ColumnType<string, string, string>;
  high: ColumnType<string, string, string>;
  low: ColumnType<string, string, string>;
  close: ColumnType<string, string, string>;
  volume: ColumnType<string, string, string>;
  vwap: ColumnType<string | null, string | null, string | null>;
  trade_count: number;
  created_at: ColumnType<Date, never, never>;
}

// 1-hour OHLCV candles
export interface PriceHistory1HourTable {
  id: Generated<number>;
  pair: PairSymbol;
  timestamp: ColumnType<Date, Date | string, Date | string>;
  open: ColumnType<string, string, string>;
  high: ColumnType<string, string, string>;
  low: ColumnType<string, string, string>;
  close: ColumnType<string, string, string>;
  volume: ColumnType<string, string, string>;
  vwap: ColumnType<string | null, string | null, string | null>;
  trade_count: number;
  created_at: ColumnType<Date, never, never>;
}

// 1-day OHLCV candles
export interface PriceHistory1DayTable {
  id: Generated<number>;
  pair: PairSymbol;
  timestamp: ColumnType<Date, Date | string, Date | string>;
  open: ColumnType<string, string, string>;
  high: ColumnType<string, string, string>;
  low: ColumnType<string, string, string>;
  close: ColumnType<string, string, string>;
  volume: ColumnType<string, string, string>;
  vwap: ColumnType<string | null, string | null, string | null>;
  trade_count: number;
  created_at: ColumnType<Date, never, never>;
}

// Complete database interface
export interface Database {
  price_history: PriceHistoryTable;
  price_history_5min: PriceHistory5MinTable;
  price_history_1hour: PriceHistory1HourTable;
  price_history_1day: PriceHistory1DayTable;
}

// Enums
export type PairSymbol = 'btc-usd' | 'xmr-usd' | 'btc-rub' | 'xmr-rub' | 'eth-usd' | 'eth-rub';
export type AggregationMethod = 'vwap' | 'median' | 'mean';
export type ChartInterval = '5min' | '1hour' | '1day';
```

### 3.2 Migrations

```typescript
// src/database/migrations/001_initial_schema.ts

import { Kysely, sql } from 'kysely';
import { Migration } from '@omnitron-dev/titan/module/database';

@Migration({
  version: '20241201_001',
  description: 'Create initial price tables',
  transactional: true,
})
export class InitialSchemaMigration {
  async up(db: Kysely<unknown>): Promise<void> {
    // Create pair_symbol enum type
    await sql`
      CREATE TYPE pair_symbol AS ENUM (
        'btc-usd', 'xmr-usd', 'btc-rub', 'xmr-rub', 'eth-usd', 'eth-rub'
      )
    `.execute(db);

    // Create aggregation_method enum type
    await sql`
      CREATE TYPE aggregation_method AS ENUM ('vwap', 'median', 'mean')
    `.execute(db);

    // Create price_history table
    await db.schema
      .createTable('price_history')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('pair', sql`pair_symbol`, (col) => col.notNull())
      .addColumn('price', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
      .addColumn('method', sql`aggregation_method`, (col) => col.notNull())
      .addColumn('sources', 'jsonb', (col) => col.notNull().defaultTo('[]'))
      .addColumn('volume', 'decimal(24, 8)')
      .addColumn('created_at', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`now()`)
      )
      .execute();

    // Create indexes
    await db.schema
      .createIndex('idx_price_history_pair_timestamp')
      .on('price_history')
      .columns(['pair', 'timestamp'])
      .execute();

    // Create 5min candles table
    await db.schema
      .createTable('price_history_5min')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('pair', sql`pair_symbol`, (col) => col.notNull())
      .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
      .addColumn('open', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('high', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('low', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('close', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('volume', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('vwap', 'decimal(24, 8)')
      .addColumn('trade_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('created_at', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`now()`)
      )
      .execute();

    await db.schema
      .createIndex('idx_price_history_5min_pair_timestamp')
      .on('price_history_5min')
      .columns(['pair', 'timestamp'])
      .unique()
      .execute();

    // Create 1hour candles table (similar structure)
    await db.schema
      .createTable('price_history_1hour')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('pair', sql`pair_symbol`, (col) => col.notNull())
      .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
      .addColumn('open', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('high', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('low', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('close', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('volume', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('vwap', 'decimal(24, 8)')
      .addColumn('trade_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('created_at', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`now()`)
      )
      .execute();

    await db.schema
      .createIndex('idx_price_history_1hour_pair_timestamp')
      .on('price_history_1hour')
      .columns(['pair', 'timestamp'])
      .unique()
      .execute();

    // Create 1day candles table
    await db.schema
      .createTable('price_history_1day')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('pair', sql`pair_symbol`, (col) => col.notNull())
      .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
      .addColumn('open', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('high', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('low', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('close', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('volume', 'decimal(24, 8)', (col) => col.notNull())
      .addColumn('vwap', 'decimal(24, 8)')
      .addColumn('trade_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('created_at', 'timestamptz', (col) =>
        col.notNull().defaultTo(sql`now()`)
      )
      .execute();

    await db.schema
      .createIndex('idx_price_history_1day_pair_timestamp')
      .on('price_history_1day')
      .columns(['pair', 'timestamp'])
      .unique()
      .execute();
  }

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('price_history_1day').execute();
    await db.schema.dropTable('price_history_1hour').execute();
    await db.schema.dropTable('price_history_5min').execute();
    await db.schema.dropTable('price_history').execute();
    await sql`DROP TYPE IF EXISTS aggregation_method`.execute(db);
    await sql`DROP TYPE IF EXISTS pair_symbol`.execute(db);
  }
}
```

### 3.3 Redis Data Structures

```typescript
// Redis keys and structures

// Live price cache (String)
// Key: price:{pair}
// Value: JSON { price: string, timestamp: number, sources: string[] }
// TTL: 60 seconds

// Trade streams (Redis Stream)
// Key: stream:trades:{exchange}
// Fields: pair, price, volume, timestamp, trade_id

// Aggregation buffer (Sorted Set)
// Key: buffer:trades:{pair}
// Score: timestamp
// Member: JSON { price, volume, exchange, timestamp }

// USD/RUB rate cache (String)
// Key: rate:usd-rub
// Value: decimal string
// TTL: 3600 seconds

// Consumer group for aggregator
// Stream: stream:trades:*
// Group: aggregator-group
// Consumer: aggregator-{instance-id}
```

---

## 4. Service Definitions

### 4.1 PricesService (Netron RPC)

```typescript
// src/modules/prices/prices.rpc-service.ts

import { Service, Method, Property } from '@omnitron-dev/titan/netron';
import { Injectable, Inject } from '@omnitron-dev/titan/nexus';
import { z } from 'zod';

// Validation schemas
const GetPriceParamsSchema = z.object({
  pair: z.enum(['btc-usd', 'xmr-usd', 'btc-rub', 'xmr-rub', 'eth-usd', 'eth-rub']),
});

const GetMultiplePricesParamsSchema = z.object({
  pairs: z.array(z.enum(['btc-usd', 'xmr-usd', 'btc-rub', 'xmr-rub', 'eth-usd', 'eth-rub'])),
});

const GetPriceChangeParamsSchema = z.object({
  pair: z.enum(['btc-usd', 'xmr-usd', 'btc-rub', 'xmr-rub', 'eth-usd', 'eth-rub']),
  period: z.enum(['24hours', '7days', '30days', 'custom']),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// Response types
interface PriceResponse {
  pair: string;
  price: number;
  timestamp: number;
}

interface PriceChangeResponse {
  pair: string;
  startDate: number;
  endDate: number;
  startPrice: number;
  endPrice: number;
  changePercent: number;
}

@Service({
  name: 'PricesService',
  version: '2.0.0',
  description: 'Real-time cryptocurrency price service',
  transports: ['http'],
})
@Injectable()
export class PricesRpcService {
  @Property({ readonly: true })
  public readonly version = '2.0.0';

  @Property({ readonly: true })
  public readonly supportedPairs = [
    'btc-usd', 'xmr-usd', 'btc-rub', 'xmr-rub', 'eth-usd', 'eth-rub'
  ];

  constructor(
    @Inject(PRICES_SERVICE_TOKEN) private readonly pricesService: PricesService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly logger: ILogger,
  ) {}

  /**
   * Get current price for a single pair
   *
   * Netron RPC Call:
   * POST /netron/invoke
   * { "service": "PricesService@2.0.0", "method": "getPrice", "input": { "pair": "btc-usd" } }
   */
  @Method({
    auth: { allowAnonymous: true },
    cache: { ttl: 5000 }, // 5 second cache
    rateLimit: { requests: 100, window: 60000 },
  })
  async getPrice(params: z.infer<typeof GetPriceParamsSchema>): Promise<PriceResponse> {
    const validated = GetPriceParamsSchema.parse(params);
    return this.pricesService.getPrice(validated.pair);
  }

  /**
   * Get current prices for multiple pairs
   *
   * Netron RPC Call:
   * POST /netron/invoke
   * { "service": "PricesService@2.0.0", "method": "getMultiplePrices", "input": { "pairs": ["btc-usd", "eth-usd"] } }
   */
  @Method({
    auth: { allowAnonymous: true },
    cache: { ttl: 5000 },
    rateLimit: { requests: 50, window: 60000 },
  })
  async getMultiplePrices(
    params: z.infer<typeof GetMultiplePricesParamsSchema>
  ): Promise<PriceResponse[]> {
    const validated = GetMultiplePricesParamsSchema.parse(params);
    return Promise.all(
      validated.pairs.map(pair => this.pricesService.getPrice(pair))
    );
  }

  /**
   * Get price change percentage over a period
   *
   * Netron RPC Call:
   * POST /netron/invoke
   * { "service": "PricesService@2.0.0", "method": "getPriceChange", "input": { "pair": "btc-usd", "period": "7days" } }
   */
  @Method({
    auth: { allowAnonymous: true },
    cache: { ttl: 30000 }, // 30 second cache
    rateLimit: { requests: 30, window: 60000 },
  })
  async getPriceChange(
    params: z.infer<typeof GetPriceChangeParamsSchema>
  ): Promise<PriceChangeResponse> {
    const validated = GetPriceChangeParamsSchema.parse(params);
    return this.pricesService.getPriceChange(
      validated.pair,
      validated.period,
      validated.from,
      validated.to
    );
  }

  /**
   * Stream live price updates (WebSocket transport)
   * Returns AsyncGenerator for real-time streaming
   *
   * Netron WS Call:
   * Connect to ws://host:port, then send:
   * { "service": "PricesService@2.0.0", "method": "streamPrices", "input": { "pairs": ["btc-usd"] } }
   */
  @Method({
    auth: { allowAnonymous: true },
    transports: ['ws'], // WebSocket only for streaming
  })
  async *streamPrices(params: { pairs: string[] }): AsyncGenerator<PriceResponse> {
    const validated = GetMultiplePricesParamsSchema.parse(params);
    yield* this.pricesService.streamPrices(validated.pairs);
  }
}
```

### 4.2 ChartsService (Netron RPC)

```typescript
// src/modules/charts/charts.rpc-service.ts

import { Service, Method } from '@omnitron-dev/titan/netron';
import { Injectable, Inject } from '@omnitron-dev/titan/nexus';
import { z } from 'zod';

const GetChartParamsSchema = z.object({
  pair: z.enum(['btc-usd', 'xmr-usd', 'btc-rub', 'xmr-rub', 'eth-usd', 'eth-rub']),
  period: z.enum(['24hours', '7days', '30days', 'custom']).optional().default('7days'),
  interval: z.enum(['5min', '1hour', '1day']).optional().default('1hour'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

interface ChartResponse {
  dates: string[];
  series: number[];
  ohlcv?: {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
  };
}

@Service({
  name: 'ChartsService',
  version: '2.0.0',
  description: 'OHLCV chart data service',
  transports: ['http'],
})
@Injectable()
export class ChartsRpcService {
  constructor(
    @Inject(CHARTS_SERVICE_TOKEN) private readonly chartsService: ChartsService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly logger: ILogger,
  ) {}

  /**
   * Get chart data for a pair
   *
   * Netron RPC Call:
   * POST /netron/invoke
   * { "service": "ChartsService@2.0.0", "method": "getChartData", "input": { "pair": "btc-usd", "period": "7days", "interval": "1hour" } }
   */
  @Method({
    auth: { allowAnonymous: true },
    cache: { ttl: 60000 }, // 1 minute cache for charts
    rateLimit: { requests: 20, window: 60000 },
  })
  async getChartData(
    params: z.infer<typeof GetChartParamsSchema>
  ): Promise<ChartResponse> {
    const validated = GetChartParamsSchema.parse(params);
    return this.chartsService.getChartData(
      validated.pair,
      validated.period,
      validated.interval,
      validated.from,
      validated.to
    );
  }

  /**
   * Get OHLCV candles with full data
   *
   * Netron RPC Call:
   * POST /netron/invoke
   * { "service": "ChartsService@2.0.0", "method": "getOHLCV", "input": { "pair": "btc-usd", "interval": "1hour", "limit": 100 } }
   */
  @Method({
    auth: { allowAnonymous: true },
    cache: { ttl: 60000 },
    rateLimit: { requests: 20, window: 60000 },
  })
  async getOHLCV(params: {
    pair: string;
    interval: '5min' | '1hour' | '1day';
    limit?: number;
    offset?: number;
  }): Promise<{
    candles: Array<{
      timestamp: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      vwap: number | null;
    }>;
    pagination: {
      total: number;
      limit: number;
      offset: number;
    };
  }> {
    return this.chartsService.getOHLCV(
      params.pair,
      params.interval,
      params.limit ?? 100,
      params.offset ?? 0
    );
  }
}
```

---

## 5. Netron HTTP API

Netron uses a **JSON-RPC style** protocol where all service method invocations are made via `POST /netron/invoke`. This is fundamentally different from REST APIs.

### 5.1 HTTP Endpoints

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| POST | `/netron/invoke` | Invoke a single service method | Depends on method |
| POST | `/netron/batch` | Invoke multiple methods in one request | Depends on methods |
| POST | `/netron/authenticate` | Authenticate and get token | No |
| GET | `/health` | Health check | No |
| GET | `/metrics` | Server metrics | Yes |
| GET | `/openapi.json` | OpenAPI specification | Yes |

### 5.2 Request Format

**Single Invocation (`POST /netron/invoke`):**

```json
{
  "id": "request-uuid-123",
  "version": "2.0",
  "timestamp": 1702000000000,
  "service": "PricesService@2.0.0",
  "method": "getPrice",
  "input": {
    "pair": "btc-usd"
  },
  "context": {
    "traceId": "trace-abc",
    "spanId": "span-123",
    "userId": "anonymous"
  },
  "hints": {
    "cache": { "maxAge": 5000 },
    "timeout": 10000
  }
}
```

**Batch Invocation (`POST /netron/batch`):**

```json
{
  "id": "batch-uuid-456",
  "version": "2.0",
  "timestamp": 1702000000000,
  "requests": [
    {
      "id": "req-1",
      "service": "PricesService@2.0.0",
      "method": "getPrice",
      "input": { "pair": "btc-usd" }
    },
    {
      "id": "req-2",
      "service": "PricesService@2.0.0",
      "method": "getPrice",
      "input": { "pair": "eth-usd" }
    },
    {
      "id": "req-3",
      "service": "ChartsService@2.0.0",
      "method": "getOHLCV",
      "input": { "pair": "btc-usd", "interval": "1hour", "limit": 24 }
    }
  ],
  "options": {
    "parallel": true,
    "stopOnError": false
  }
}
```

### 5.3 Response Format

**Success Response (HTTP 200):**

```json
{
  "id": "request-uuid-123",
  "version": "2.0",
  "timestamp": 1702000000123,
  "success": true,
  "data": {
    "pair": "btc-usd",
    "price": 45678.12345678,
    "timestamp": 1702000000000
  },
  "hints": {
    "metrics": {
      "serverTime": 5
    },
    "cache": {
      "maxAge": 5000
    }
  }
}
```

**Error Response (HTTP 4xx/5xx):**

```json
{
  "id": "request-uuid-123",
  "version": "2.0",
  "timestamp": 1702000000123,
  "success": false,
  "error": {
    "code": "PRICE_1002",
    "message": "Price not available for pair: invalid-pair",
    "details": {
      "pair": "invalid-pair",
      "availablePairs": ["btc-usd", "eth-usd", "xmr-usd"]
    }
  }
}
```

**Batch Response:**

```json
{
  "id": "batch-uuid-456",
  "version": "2.0",
  "timestamp": 1702000000150,
  "responses": [
    {
      "id": "req-1",
      "success": true,
      "data": { "pair": "btc-usd", "price": 45678.12, "timestamp": 1702000000000 }
    },
    {
      "id": "req-2",
      "success": true,
      "data": { "pair": "eth-usd", "price": 2345.67, "timestamp": 1702000000000 }
    },
    {
      "id": "req-3",
      "success": true,
      "data": { "candles": [...], "pagination": { "total": 24, "limit": 24, "offset": 0 } }
    }
  ],
  "hints": {
    "totalTime": 45,
    "successCount": 3,
    "failureCount": 0
  }
}
```

### 5.4 Request Headers

```
Content-Type: application/json
Accept: application/json
X-Netron-Version: 2.0
X-Request-ID: <optional-correlation-id>
X-Trace-ID: <optional-trace-id>
Authorization: Bearer <token>  (if authentication required)
```

### 5.5 Service Methods Reference

| Service | Method | Input | Output |
|---------|--------|-------|--------|
| PricesService@2.0.0 | getPrice | `{ pair: string }` | `PriceResponse` |
| PricesService@2.0.0 | getMultiplePrices | `{ pairs: string[] }` | `PriceResponse[]` |
| PricesService@2.0.0 | getPriceChange | `{ pair, period, from?, to? }` | `PriceChangeResponse` |
| ChartsService@2.0.0 | getChartData | `{ pair, period?, interval?, from?, to? }` | `ChartResponse` |
| ChartsService@2.0.0 | getOHLCV | `{ pair, interval, limit?, offset? }` | `OHLCVResponse` |
| HealthService@1.0.0 | check | `{}` | `HealthResponse` |
| HealthService@1.0.0 | live | `{}` | `{ status: 'ok' }` |
| HealthService@1.0.0 | ready | `{}` | `{ status: 'ok' \| 'not_ready' }` |

### 5.6 Client Examples

**Using fetch (JavaScript):**

```javascript
// Single call
const response = await fetch('http://localhost:3000/netron/invoke', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Netron-Version': '2.0',
  },
  body: JSON.stringify({
    id: crypto.randomUUID(),
    version: '2.0',
    timestamp: Date.now(),
    service: 'PricesService@2.0.0',
    method: 'getPrice',
    input: { pair: 'btc-usd' },
  }),
});

const result = await response.json();
if (result.success) {
  console.log('Price:', result.data.price);
} else {
  console.error('Error:', result.error.message);
}
```

**Using curl:**

```bash
curl -X POST http://localhost:3000/netron/invoke \
  -H "Content-Type: application/json" \
  -H "X-Netron-Version: 2.0" \
  -d '{
    "id": "test-1",
    "version": "2.0",
    "timestamp": 1702000000000,
    "service": "PricesService@2.0.0",
    "method": "getPrice",
    "input": { "pair": "btc-usd" }
  }'
```

**Batch call for dashboard:**

```javascript
// Get all data for dashboard in single request
const dashboardData = await fetch('http://localhost:3000/netron/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'dashboard-refresh',
    version: '2.0',
    timestamp: Date.now(),
    requests: [
      { id: 'btc', service: 'PricesService@2.0.0', method: 'getPrice', input: { pair: 'btc-usd' } },
      { id: 'eth', service: 'PricesService@2.0.0', method: 'getPrice', input: { pair: 'eth-usd' } },
      { id: 'btc-change', service: 'PricesService@2.0.0', method: 'getPriceChange', input: { pair: 'btc-usd', period: '24hours' } },
      { id: 'btc-chart', service: 'ChartsService@2.0.0', method: 'getChartData', input: { pair: 'btc-usd', period: '7days' } },
    ],
    options: { parallel: true },
  }),
});
```

### 5.7 Response Schemas

```typescript
// src/contracts/responses.ts

import { z } from 'zod';

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
  ohlcv: z.object({
    open: z.array(z.number()),
    high: z.array(z.number()),
    low: z.array(z.number()),
    close: z.array(z.number()),
    volume: z.array(z.number()),
  }).optional(),
});

export const OHLCVCandleSchema = z.object({
  timestamp: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  vwap: z.number().nullable(),
});

export const OHLCVResponseSchema = z.object({
  candles: z.array(OHLCVCandleSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  uptime: z.number(),
  version: z.string(),
  checks: z.record(z.object({
    status: z.enum(['up', 'down']),
    latency: z.number().optional(),
    message: z.string().optional(),
  })),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
  timestamp: z.string(),
  requestId: z.string().optional(),
});
```

### 5.3 Error Codes

```typescript
// src/contracts/errors.ts

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

  // Validation errors (4xxx)
  INVALID_PAIR = 'VALIDATION_4001',
  INVALID_PERIOD = 'VALIDATION_4002',
  INVALID_DATE_FORMAT = 'VALIDATION_4003',

  // System errors (5xxx)
  DATABASE_ERROR = 'SYSTEM_5001',
  REDIS_ERROR = 'SYSTEM_5002',
  INTERNAL_ERROR = 'SYSTEM_5003',
}
```

---

## 6. Exchange Collectors

### 6.1 Exchange Worker Architecture

```typescript
// src/modules/collector/workers/base-worker.ts

import { Injectable, PostConstruct, PreDestroy } from '@omnitron-dev/titan/nexus';
import { Inject } from '@omnitron-dev/titan/nexus';
import WebSocket from 'ws';

export interface Trade {
  exchange: string;
  pair: string;
  price: string;
  volume: string;
  timestamp: number;
  tradeId: string;
}

export interface ExchangeWorkerConfig {
  name: string;
  wsUrl: string;
  symbols: Map<string, string>; // internal pair -> exchange symbol
  reconnectDelay: number;
  maxReconnectAttempts: number;
}

@Injectable()
export abstract class BaseExchangeWorker {
  protected ws: WebSocket | null = null;
  protected isConnected = false;
  protected reconnectAttempts = 0;

  constructor(
    @Inject(REDIS_SERVICE_TOKEN) protected readonly redis: RedisService,
    @Inject(LOGGER_SERVICE_TOKEN) protected readonly logger: ILogger,
    @Inject(CONFIG_SERVICE_TOKEN) protected readonly config: ConfigService,
  ) {}

  abstract get exchangeName(): string;
  abstract get wsUrl(): string;
  abstract get symbolMap(): Map<string, string>;

  abstract parseMessage(data: unknown): Trade | null;
  abstract buildSubscribeMessage(symbols: string[]): unknown;

  @PostConstruct()
  async start(): Promise<void> {
    await this.connect();
  }

  @PreDestroy()
  async stop(): Promise<void> {
    this.disconnect();
  }

  protected async connect(): Promise<void> {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.logger.info(`[${this.exchangeName}] Connected`);
        this.subscribe();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.logger.warn(`[${this.exchangeName}] Disconnected`);
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.logger.error(`[${this.exchangeName}] Error:`, error);
      });
    } catch (error) {
      this.logger.error(`[${this.exchangeName}] Connection failed:`, error);
      this.scheduleReconnect();
    }
  }

  protected subscribe(): void {
    if (!this.ws || !this.isConnected) return;

    const symbols = Array.from(this.symbolMap.values());
    const message = this.buildSubscribeMessage(symbols);
    this.ws.send(JSON.stringify(message));
  }

  protected async handleMessage(data: unknown): Promise<void> {
    try {
      const parsed = JSON.parse(data.toString());
      const trade = this.parseMessage(parsed);

      if (trade) {
        await this.publishTrade(trade);
      }
    } catch (error) {
      // Ignore parse errors for non-trade messages
    }
  }

  protected async publishTrade(trade: Trade): Promise<void> {
    const streamKey = `stream:trades:${this.exchangeName}`;

    await this.redis.xadd(streamKey, '*', {
      pair: trade.pair,
      price: trade.price,
      volume: trade.volume,
      timestamp: trade.timestamp.toString(),
      trade_id: trade.tradeId,
    });
  }

  protected disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  protected scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.get('exchange.maxReconnectAttempts', 10)) {
      this.logger.error(`[${this.exchangeName}] Max reconnect attempts reached`);
      return;
    }

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }
}
```

### 6.2 Exchange Implementations

```typescript
// src/modules/collector/workers/binance.worker.ts

import { Injectable } from '@omnitron-dev/titan/nexus';
import { BaseExchangeWorker, Trade } from './base-worker';

@Injectable()
export class BinanceWorker extends BaseExchangeWorker {
  get exchangeName(): string {
    return 'binance';
  }

  get wsUrl(): string {
    const streams = Array.from(this.symbolMap.values())
      .map(s => `${s.toLowerCase()}@trade`)
      .join('/');
    return `wss://stream.binance.com:9443/stream?streams=${streams}`;
  }

  get symbolMap(): Map<string, string> {
    return new Map([
      ['btc-usd', 'BTCUSDT'],
      ['eth-usd', 'ETHUSDT'],
      ['xmr-usd', 'XMRUSDT'],
    ]);
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as { stream?: string; data?: any };
    if (!msg.data || msg.data.e !== 'trade') return null;

    const trade = msg.data;
    const pair = this.reverseLookup(trade.s);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: trade.p,
      volume: trade.q,
      timestamp: trade.T,
      tradeId: trade.t.toString(),
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    // Binance uses URL params, no subscribe message needed
    return null;
  }

  private reverseLookup(symbol: string): string | null {
    for (const [pair, sym] of this.symbolMap.entries()) {
      if (sym === symbol) return pair;
    }
    return null;
  }
}

// src/modules/collector/workers/kraken.worker.ts

@Injectable()
export class KrakenWorker extends BaseExchangeWorker {
  get exchangeName(): string {
    return 'kraken';
  }

  get wsUrl(): string {
    return 'wss://ws.kraken.com';
  }

  get symbolMap(): Map<string, string> {
    return new Map([
      ['btc-usd', 'XBT/USD'],
      ['eth-usd', 'ETH/USD'],
      ['xmr-usd', 'XMR/USD'],
    ]);
  }

  parseMessage(data: unknown): Trade | null {
    if (!Array.isArray(data) || data.length < 4) return null;

    const [channelId, tradeData, channelName, pairName] = data;
    if (typeof channelName !== 'string' || !channelName.startsWith('trade')) {
      return null;
    }

    const pair = this.reverseLookup(pairName as string);
    if (!pair || !Array.isArray(tradeData)) return null;

    // Kraken sends array of trades
    const lastTrade = tradeData[tradeData.length - 1];

    return {
      exchange: this.exchangeName,
      pair,
      price: lastTrade[0],
      volume: lastTrade[1],
      timestamp: Math.floor(parseFloat(lastTrade[2]) * 1000),
      tradeId: `${channelId}-${lastTrade[2]}`,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      event: 'subscribe',
      pair: symbols,
      subscription: { name: 'trade' },
    };
  }

  private reverseLookup(pairName: string): string | null {
    for (const [pair, sym] of this.symbolMap.entries()) {
      if (sym === pairName) return pair;
    }
    return null;
  }
}
```

### 6.3 CBR Rate Fetcher (USD/RUB)

```typescript
// src/modules/collector/services/cbr-rate.service.ts

import { Injectable, Inject } from '@omnitron-dev/titan/nexus';
import { Cron, CronExpression, Schedulable } from '@omnitron-dev/titan/module/scheduler';
import { RedisCache } from '@omnitron-dev/titan/module/redis';
import { parseStringPromise } from 'xml2js';

@Injectable()
@Schedulable()
export class CbrRateService {
  private readonly CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';
  private readonly USD_CHAR_CODE = 'USD';
  private readonly CACHE_KEY = 'rate:usd-rub';
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(
    @Inject(REDIS_SERVICE_TOKEN) private readonly redis: RedisService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly logger: ILogger,
  ) {}

  @PostConstruct()
  async initialize(): Promise<void> {
    await this.fetchRate();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async fetchRate(): Promise<void> {
    try {
      const response = await fetch(this.CBR_URL);
      const xmlText = await response.text();
      const parsed = await parseStringPromise(xmlText);

      const valutes = parsed.ValCurs.Valute;
      const usd = valutes.find((v: any) => v.CharCode[0] === this.USD_CHAR_CODE);

      if (usd) {
        const rate = usd.Value[0].replace(',', '.');
        await this.redis.setex(this.CACHE_KEY, this.CACHE_TTL, rate);
        this.logger.info(`CBR USD/RUB rate updated: ${rate}`);
      }
    } catch (error) {
      this.logger.error('Failed to fetch CBR rate:', error);
    }
  }

  @RedisCache({ key: 'rate:usd-rub', ttl: 3600 })
  async getRate(): Promise<number> {
    const cached = await this.redis.get(this.CACHE_KEY);
    if (cached) {
      return parseFloat(cached);
    }

    await this.fetchRate();
    const rate = await this.redis.get(this.CACHE_KEY);
    return rate ? parseFloat(rate) : 0;
  }
}
```

---

## 7. Aggregation Engine

### 7.1 Real-Time Stream Aggregator

```typescript
// src/modules/aggregator/services/stream-aggregator.service.ts

import { Injectable, Inject, PostConstruct, PreDestroy } from '@omnitron-dev/titan/nexus';
import { Interval, Schedulable } from '@omnitron-dev/titan/module/scheduler';

interface TradeEntry {
  price: number;
  volume: number;
  timestamp: number;
  exchange: string;
}

interface VWAPResult {
  pair: string;
  price: number;
  volume: number;
  sources: string[];
  timestamp: number;
}

@Injectable()
@Schedulable()
export class StreamAggregatorService {
  private readonly AGGREGATION_INTERVAL = 10_000; // 10 seconds
  private readonly WINDOW_SIZE = 30_000; // 30 second window
  private readonly BUFFER_KEY_PREFIX = 'buffer:trades:';
  private readonly EXCHANGES = ['binance', 'kraken', 'coinbase', 'okx', 'bybit', 'kucoin'];

  private isRunning = false;
  private consumerName: string;

  constructor(
    @Inject(REDIS_SERVICE_TOKEN) private readonly redis: RedisService,
    @Inject(DATABASE_SERVICE_TOKEN) private readonly db: DatabaseService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly logger: ILogger,
    @Inject(CBR_RATE_SERVICE_TOKEN) private readonly cbrRate: CbrRateService,
  ) {
    this.consumerName = `aggregator-${process.pid}`;
  }

  @PostConstruct()
  async start(): Promise<void> {
    this.isRunning = true;
    await this.createConsumerGroups();
    this.consumeStreams();
  }

  @PreDestroy()
  async stop(): Promise<void> {
    this.isRunning = false;
  }

  private async createConsumerGroups(): Promise<void> {
    for (const exchange of this.EXCHANGES) {
      const streamKey = `stream:trades:${exchange}`;
      try {
        await this.redis.xgroup('CREATE', streamKey, 'aggregator-group', '0', 'MKSTREAM');
      } catch (error) {
        // Group already exists, ignore
      }
    }
  }

  private async consumeStreams(): Promise<void> {
    while (this.isRunning) {
      try {
        for (const exchange of this.EXCHANGES) {
          const streamKey = `stream:trades:${exchange}`;

          const messages = await this.redis.xreadgroup(
            'GROUP', 'aggregator-group', this.consumerName,
            'COUNT', 100,
            'BLOCK', 1000,
            'STREAMS', streamKey, '>'
          );

          if (messages && messages.length > 0) {
            await this.processBatch(exchange, messages);
          }
        }
      } catch (error) {
        this.logger.error('Stream consumption error:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processBatch(exchange: string, messages: any[]): Promise<void> {
    for (const [streamKey, entries] of messages) {
      for (const [id, fields] of entries) {
        const trade: TradeEntry = {
          price: parseFloat(fields.price),
          volume: parseFloat(fields.volume),
          timestamp: parseInt(fields.timestamp),
          exchange,
        };

        const pair = fields.pair;
        const bufferKey = `${this.BUFFER_KEY_PREFIX}${pair}`;

        // Add to sorted set buffer (score = timestamp)
        await this.redis.zadd(
          bufferKey,
          trade.timestamp,
          JSON.stringify(trade)
        );

        // Acknowledge message
        await this.redis.xack(streamKey, 'aggregator-group', id);
      }
    }
  }

  @Interval(10_000) // Every 10 seconds
  async aggregate(): Promise<void> {
    const pairs = ['btc-usd', 'xmr-usd', 'eth-usd'];

    for (const pair of pairs) {
      try {
        const vwap = await this.calculateVWAP(pair);
        if (vwap) {
          await this.savePrice(vwap);
          await this.convertAndSaveRub(vwap);
          await this.cachePrice(vwap);
        }
      } catch (error) {
        this.logger.error(`Aggregation error for ${pair}:`, error);
      }
    }
  }

  private async calculateVWAP(pair: string): Promise<VWAPResult | null> {
    const bufferKey = `${this.BUFFER_KEY_PREFIX}${pair}`;
    const now = Date.now();
    const windowStart = now - this.WINDOW_SIZE;

    // Get trades within window
    const trades = await this.redis.zrangebyscore(
      bufferKey,
      windowStart,
      now
    );

    if (trades.length === 0) return null;

    // Calculate VWAP
    let totalPriceVolume = 0;
    let totalVolume = 0;
    const sources = new Set<string>();

    for (const tradeStr of trades) {
      const trade: TradeEntry = JSON.parse(tradeStr);
      totalPriceVolume += trade.price * trade.volume;
      totalVolume += trade.volume;
      sources.add(trade.exchange);
    }

    const vwapPrice = totalPriceVolume / totalVolume;

    // Cleanup old trades
    await this.redis.zremrangebyscore(bufferKey, 0, windowStart);

    return {
      pair,
      price: vwapPrice,
      volume: totalVolume,
      sources: Array.from(sources),
      timestamp: now,
    };
  }

  private async savePrice(vwap: VWAPResult): Promise<void> {
    await this.db.executeQuery(async (db) => {
      await db.insertInto('price_history')
        .values({
          pair: vwap.pair as any,
          price: vwap.price.toFixed(8),
          timestamp: new Date(vwap.timestamp),
          method: 'vwap' as any,
          sources: JSON.stringify(vwap.sources),
          volume: vwap.volume.toFixed(8),
        })
        .execute();
    });
  }

  private async convertAndSaveRub(vwap: VWAPResult): Promise<void> {
    const usdRubRate = await this.cbrRate.getRate();
    if (usdRubRate <= 0) return;

    const rubPair = vwap.pair.replace('-usd', '-rub');
    const rubPrice = vwap.price * usdRubRate;

    await this.db.executeQuery(async (db) => {
      await db.insertInto('price_history')
        .values({
          pair: rubPair as any,
          price: rubPrice.toFixed(8),
          timestamp: new Date(vwap.timestamp),
          method: 'vwap' as any,
          sources: JSON.stringify([...vwap.sources, 'cbr']),
          volume: vwap.volume.toFixed(8),
        })
        .execute();
    });

    // Cache RUB price
    await this.cachePrice({
      ...vwap,
      pair: rubPair,
      price: rubPrice,
      sources: [...vwap.sources, 'cbr'],
    });
  }

  private async cachePrice(vwap: VWAPResult): Promise<void> {
    const cacheKey = `price:${vwap.pair}`;
    const cacheValue = JSON.stringify({
      price: vwap.price.toFixed(8),
      timestamp: vwap.timestamp,
      sources: vwap.sources,
    });

    await this.redis.setex(cacheKey, 60, cacheValue);
  }
}
```

### 7.2 OHLCV Aggregator (Cron-Based)

```typescript
// src/modules/aggregator/services/ohlcv-aggregator.service.ts

import { Injectable, Inject } from '@omnitron-dev/titan/nexus';
import { Cron, CronExpression, Schedulable } from '@omnitron-dev/titan/module/scheduler';
import { Transactional } from '@omnitron-dev/titan/module/database';

interface OHLCVCandle {
  pair: string;
  timestamp: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  vwap: string | null;
  tradeCount: number;
}

@Injectable()
@Schedulable()
export class OHLCVAggregatorService {
  constructor(
    @Inject(DATABASE_SERVICE_TOKEN) private readonly db: DatabaseService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly logger: ILogger,
  ) {}

  /**
   * Aggregate 5-minute candles every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  @Transactional()
  async aggregate5Min(): Promise<void> {
    const now = new Date();
    const periodStart = this.floorToInterval(now, 5 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() + 5 * 60 * 1000);

    await this.aggregateCandles('price_history_5min', periodStart, periodEnd);
  }

  /**
   * Aggregate 1-hour candles every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  @Transactional()
  async aggregate1Hour(): Promise<void> {
    const now = new Date();
    const periodStart = this.floorToInterval(now, 60 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() + 60 * 60 * 1000);

    await this.aggregateCandles('price_history_1hour', periodStart, periodEnd);
  }

  /**
   * Aggregate daily candles at midnight UTC
   */
  @Cron('0 0 * * *') // Every day at midnight
  @Transactional()
  async aggregate1Day(): Promise<void> {
    const now = new Date();
    const periodStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 1 // Previous day
    ));
    const periodEnd = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ));

    await this.aggregateCandles('price_history_1day', periodStart, periodEnd);
  }

  private async aggregateCandles(
    tableName: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<void> {
    const pairs = ['btc-usd', 'xmr-usd', 'eth-usd', 'btc-rub', 'xmr-rub', 'eth-rub'];

    for (const pair of pairs) {
      try {
        const candle = await this.calculateOHLCV(pair, periodStart, periodEnd);
        if (candle) {
          await this.saveCandle(tableName, candle);
        }
      } catch (error) {
        this.logger.error(`OHLCV aggregation error for ${pair}:`, error);
      }
    }
  }

  private async calculateOHLCV(
    pair: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<OHLCVCandle | null> {
    return this.db.executeQuery(async (db) => {
      const result = await db
        .selectFrom('price_history')
        .select([
          db.fn.min('price').as('low'),
          db.fn.max('price').as('high'),
          db.fn.count('id').as('trade_count'),
          db.fn.sum(sql`CAST(price AS DECIMAL) * CAST(volume AS DECIMAL)`).as('price_volume_sum'),
          db.fn.sum('volume').as('volume_sum'),
        ])
        .where('pair', '=', pair as any)
        .where('timestamp', '>=', periodStart)
        .where('timestamp', '<', periodEnd)
        .executeTakeFirst();

      if (!result || result.trade_count === 0) return null;

      // Get first and last prices
      const firstPrice = await db
        .selectFrom('price_history')
        .select('price')
        .where('pair', '=', pair as any)
        .where('timestamp', '>=', periodStart)
        .where('timestamp', '<', periodEnd)
        .orderBy('timestamp', 'asc')
        .limit(1)
        .executeTakeFirst();

      const lastPrice = await db
        .selectFrom('price_history')
        .select('price')
        .where('pair', '=', pair as any)
        .where('timestamp', '>=', periodStart)
        .where('timestamp', '<', periodEnd)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .executeTakeFirst();

      const vwap = result.volume_sum > 0
        ? (parseFloat(result.price_volume_sum) / parseFloat(result.volume_sum)).toFixed(8)
        : null;

      return {
        pair,
        timestamp: periodStart,
        open: firstPrice?.price ?? '0',
        high: result.high,
        low: result.low,
        close: lastPrice?.price ?? '0',
        volume: result.volume_sum?.toString() ?? '0',
        vwap,
        tradeCount: Number(result.trade_count),
      };
    });
  }

  private async saveCandle(tableName: string, candle: OHLCVCandle): Promise<void> {
    await this.db.executeQuery(async (db) => {
      await db.insertInto(tableName as any)
        .values({
          pair: candle.pair as any,
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          vwap: candle.vwap,
          trade_count: candle.tradeCount,
        })
        .onConflict((oc) =>
          oc.columns(['pair', 'timestamp']).doUpdateSet({
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            vwap: candle.vwap,
            trade_count: candle.tradeCount,
          })
        )
        .execute();
    });
  }

  private floorToInterval(date: Date, intervalMs: number): Date {
    return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs);
  }
}
```

---

## 8. Scaling with Process Manager

The Titan Process Manager (PM) module provides enterprise-grade horizontal scaling with worker pools, process supervision, and workflow orchestration. This is how Priceverse 2.0 achieves industrial-strength scalability.

### 8.1 Architecture with PM

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PRICEVERSE 2.0 - SCALED ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         MAIN SUPERVISOR                                 │ │
│  │                    (ONE_FOR_ONE strategy)                               │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                    EXCHANGE WORKER POOL                          │   │ │
│  │  │                   (Auto-scale 2-10 workers)                      │   │ │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │   │ │
│  │  │  │Binance  │ │Kraken   │ │Coinbase │ │ OKX     │ │ Bybit   │    │   │ │
│  │  │  │Worker   │ │Worker   │ │Worker   │ │Worker   │ │ Worker  │    │   │ │
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                   AGGREGATOR WORKER POOL                         │   │ │
│  │  │                 (LEAST_LOADED strategy, 4 workers)               │   │ │
│  │  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │   │ │
│  │  │  │ Aggregator-1 │ │ Aggregator-2 │ │ Aggregator-3 │ ...         │   │ │
│  │  │  └──────────────┘ └──────────────┘ └──────────────┘              │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                     API HANDLER POOL                             │   │ │
│  │  │              (Auto-scale, ADAPTIVE strategy)                     │   │ │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐    │   │ │
│  │  │  │ Handler-1  │ │ Handler-2  │ │ Handler-3  │ │ Handler-N  │    │   │ │
│  │  │  │(Netron RPC)│ │(Netron RPC)│ │(Netron RPC)│ │(Netron RPC)│    │   │ │
│  │  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘    │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────┐  ┌────────────────────────────────┐   │
│  │   PostgreSQL                      │  │         Redis Cluster          │   │
│  │   (Shared State)                  │  │    (Streams, Cache, Pub/Sub)   │   │
│  └──────────────────────────────────┘  └────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Main Supervisor Definition

```typescript
// src/scaling/app.supervisor.ts

import { Supervisor, Child, SupervisionStrategy } from '@omnitron-dev/titan/module/pm';

@Supervisor({
  strategy: SupervisionStrategy.ONE_FOR_ONE,
  maxRestarts: 5,
  window: 60000, // 5 restarts per minute max
  backoff: {
    type: 'exponential',
    initial: 1000,
    max: 30000,
    factor: 2,
  },
})
export class AppSupervisor {
  /**
   * Exchange collectors - critical, must always run
   */
  @Child({
    critical: true,
    pool: {
      size: 6, // One per exchange
      strategy: PoolStrategy.ROUND_ROBIN,
    },
  })
  ExchangeWorkers = ExchangeWorkerProcess;

  /**
   * Aggregators - auto-scale based on load
   */
  @Child({
    pool: {
      size: 'auto', // cpus().length
      strategy: PoolStrategy.LEAST_LOADED,
      autoScale: {
        enabled: true,
        min: 2,
        max: 8,
        cpuThreshold: 70,
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.3,
        cooldownPeriod: 60000,
      },
    },
  })
  AggregatorWorkers = AggregatorWorkerProcess;

  /**
   * API handlers - auto-scale with circuit breaker
   */
  @Child({
    pool: {
      size: 4,
      strategy: PoolStrategy.ADAPTIVE,
      autoScale: {
        enabled: true,
        min: 2,
        max: 16,
        targetCPU: 60,
        targetMemory: 70,
      },
      circuitBreaker: {
        enabled: true,
        threshold: 5,
        timeout: 30000,
        halfOpenRequests: 3,
      },
      healthCheck: {
        enabled: true,
        interval: 10000,
        unhealthyThreshold: 3,
      },
    },
  })
  ApiHandlers = ApiHandlerProcess;

  /**
   * Custom restart logic
   */
  onChildCrash(child: ISupervisorChild, error: Error): RestartDecision {
    // Log crash with full context
    console.error(`[Supervisor] Child ${child.name} crashed:`, error);

    // Critical children always restart
    if (child.critical) {
      return RestartDecision.RESTART;
    }

    // Check if error is recoverable
    if (error.message.includes('ECONNREFUSED')) {
      return RestartDecision.RESTART_WITH_BACKOFF;
    }

    return RestartDecision.RESTART;
  }
}
```

### 8.3 Exchange Worker Process

```typescript
// src/scaling/processes/exchange-worker.process.ts

import { Process, Public, HealthCheck, OnShutdown } from '@omnitron-dev/titan/module/pm';

@Process({
  name: 'exchange-worker',
  version: '2.0.0',
  netron: { transport: 'ipc' }, // Fast IPC between processes
  health: { enabled: true, interval: 30000 },
})
export default class ExchangeWorkerProcess {
  private exchange: string;
  private ws: WebSocket | null = null;
  private isRunning = false;

  constructor(
    @Inject(REDIS_SERVICE_TOKEN) private redis: RedisService,
    @Inject(LOGGER_SERVICE_TOKEN) private logger: ILogger,
  ) {}

  /**
   * Initialize worker with specific exchange
   */
  @Public()
  async initialize(exchange: string): Promise<void> {
    this.exchange = exchange;
    this.isRunning = true;
    await this.connect();
  }

  /**
   * Get worker statistics
   */
  @Public()
  async getStats(): Promise<ExchangeWorkerStats> {
    return {
      exchange: this.exchange,
      connected: this.ws?.readyState === WebSocket.OPEN,
      tradesReceived: this.__requestCount,
      errors: this.__errorCount,
      lastLatency: this.__lastLatency,
    };
  }

  @HealthCheck({ interval: 30000 })
  async checkHealth(): Promise<IHealthStatus> {
    const isConnected = this.ws?.readyState === WebSocket.OPEN;

    return {
      status: isConnected ? 'healthy' : 'unhealthy',
      checks: [
        {
          name: 'websocket',
          status: isConnected ? 'pass' : 'fail',
          message: isConnected ? 'Connected' : 'Disconnected',
        },
      ],
      timestamp: Date.now(),
    };
  }

  @OnShutdown()
  async cleanup(): Promise<void> {
    this.isRunning = false;
    if (this.ws) {
      this.ws.close();
    }
  }

  private async connect(): Promise<void> {
    // WebSocket connection logic (same as before)
  }
}
```

### 8.4 API Handler Process with Load Balancing

```typescript
// src/scaling/processes/api-handler.process.ts

import { Process, Public, RateLimit, CircuitBreaker } from '@omnitron-dev/titan/module/pm';

@Process({
  name: 'api-handler',
  version: '2.0.0',
  netron: {
    transport: 'tcp',
    port: 'auto', // Auto-assign port
  },
  observability: {
    metrics: true,
    tracing: true,
  },
})
export default class ApiHandlerProcess {
  constructor(
    @Inject(REDIS_SERVICE_TOKEN) private redis: RedisService,
    @Inject(DATABASE_SERVICE_TOKEN) private db: DatabaseService,
  ) {}

  /**
   * Handle price requests with rate limiting
   */
  @Public()
  @RateLimit({ rps: 100, burst: 200, strategy: 'token-bucket' })
  async getPrice(params: { pair: string }): Promise<PriceResponse> {
    const cached = await this.redis.get(`price:${params.pair}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fallback to database
    return this.fetchFromDatabase(params.pair);
  }

  /**
   * Handle chart requests with circuit breaker for DB protection
   */
  @Public()
  @CircuitBreaker({
    threshold: 5,
    timeout: 30000,
    fallback: 'getChartDataFallback',
  })
  async getChartData(params: GetChartParams): Promise<ChartResponse> {
    return this.db.executeQuery(async (db) => {
      // Complex chart query
    });
  }

  /**
   * Fallback when circuit is open
   */
  async getChartDataFallback(params: GetChartParams): Promise<ChartResponse> {
    // Return cached data or error
    const cached = await this.redis.get(`chart:${params.pair}:${params.interval}`);
    if (cached) {
      return JSON.parse(cached);
    }
    throw new Error('Chart data temporarily unavailable');
  }
}
```

### 8.5 Application Bootstrap with PM

```typescript
// src/main.ts

import { Application } from '@omnitron-dev/titan';
import { ProcessManagerModule } from '@omnitron-dev/titan/module/pm';
import { AppSupervisor } from './scaling/app.supervisor';

async function bootstrap() {
  const app = await Application.create({
    name: 'priceverse',
    version: '2.0.0',
    modules: [
      // Core modules
      ConfigModule.forRoot(configOptions),
      LoggerModule.forRoot(loggerOptions),
      DatabaseModule.forRoot(databaseOptions),
      RedisModule.forRoot(redisOptions),

      // Process Manager with supervisor
      ProcessManagerModule.forRoot({
        isolation: 'worker', // Use worker threads (fast, shared memory)
        transport: 'ipc',    // Fast IPC for local communication
        restartPolicy: {
          enabled: true,
          maxRestarts: 5,
          window: 60000,
        },
        monitoring: {
          healthCheck: { interval: 30000 },
          metrics: true,
        },
      }),

      // Application modules
      AppModule,
    ],
  });

  // Start the supervisor tree
  const pm = app.resolve(PROCESS_MANAGER_TOKEN);
  const supervisor = await pm.supervisor(AppSupervisor);

  // Start Netron HTTP server
  const netron = app.resolve(NETRON_TOKEN);
  await netron.listen({ port: 3000, host: '0.0.0.0' });

  console.log('Priceverse 2.0 started with PM supervision');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await supervisor.shutdown();
    await app.stop();
  });
}

bootstrap();
```

### 8.6 Process Pool Strategies

| Strategy | Use Case | Description |
|----------|----------|-------------|
| `ROUND_ROBIN` | Exchange workers | Sequential distribution |
| `LEAST_LOADED` | Aggregators | Route to worker with lowest CPU |
| `ADAPTIVE` | API handlers | Multi-factor scoring (CPU, memory, latency) |
| `CONSISTENT_HASH` | Cache-heavy ops | Same key → same worker (cache locality) |
| `LATENCY` | Real-time queries | Route to fastest responding worker |

### 8.7 Auto-Scaling Configuration

```typescript
// Recommended auto-scaling settings for Priceverse

// Exchange Workers - stable, no auto-scale
{ size: 6 } // One per exchange

// Aggregators - scale with data volume
{
  size: 'auto',
  autoScale: {
    enabled: true,
    min: 2,
    max: 8,
    cpuThreshold: 70,
    scaleUpThreshold: 0.8,   // Scale up at 80% saturation
    scaleDownThreshold: 0.3, // Scale down at 30% saturation
    cooldownPeriod: 60000,   // Wait 1 min between scaling ops
  },
}

// API Handlers - scale with request volume
{
  size: 4,
  autoScale: {
    enabled: true,
    min: 2,
    max: 16,
    targetCPU: 60,      // Target 60% CPU utilization
    targetMemory: 70,   // Target 70% memory utilization
  },
  circuitBreaker: {
    enabled: true,
    threshold: 5,       // Open after 5 failures
    timeout: 30000,     // Stay open for 30s
    halfOpenRequests: 3, // Test with 3 requests
  },
}
```

### 8.8 Monitoring Pool Metrics

```typescript
// Get real-time pool metrics
const apiPool = pm.getPool('api-handler');

// Pool metrics
console.log({
  activeWorkers: apiPool.metrics.activeWorkers,
  healthyWorkers: apiPool.metrics.healthyWorkers,
  queueSize: apiPool.metrics.queueSize,
  throughput: apiPool.metrics.throughput,      // req/sec
  avgResponseTime: apiPool.metrics.avgResponseTime,
  errorRate: apiPool.metrics.errorRate,
  saturation: apiPool.metrics.saturation,      // 0-1
});

// Listen for scaling events
apiPool.on('pool:scaled', (event) => {
  console.log(`Pool scaled: ${event.previousSize} → ${event.newSize}`);
});

apiPool.on('worker:replaced', (event) => {
  console.log(`Worker ${event.workerId} replaced due to: ${event.reason}`);
});

apiPool.on('circuitbreaker:open', () => {
  console.log('Circuit breaker opened - requests being rejected');
});
```

---

## 9. Caching Strategy

### 9.1 Redis Cache Layer

```typescript
// src/modules/prices/services/prices.service.ts

import { Injectable, Inject } from '@omnitron-dev/titan/nexus';
import { RedisCache, RedisLock } from '@omnitron-dev/titan/module/redis';

@Injectable()
export class PricesService {
  constructor(
    @Inject(REDIS_SERVICE_TOKEN) private readonly redis: RedisService,
    @Inject(DATABASE_SERVICE_TOKEN) private readonly db: DatabaseService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly logger: ILogger,
  ) {}

  /**
   * Get current price with Redis cache
   * Cache TTL: 5 seconds (prices update every 10 seconds)
   */
  @RedisCache({
    key: (pair: string) => `price:${pair}`,
    ttl: 5,
  })
  async getPrice(pair: string): Promise<PriceResponse> {
    // This is called only on cache miss
    const cached = await this.redis.get(`price:${pair}`);

    if (cached) {
      const data = JSON.parse(cached);
      return {
        pair,
        price: parseFloat(data.price),
        timestamp: data.timestamp,
      };
    }

    // Fallback to database if not in cache
    const dbPrice = await this.db.executeQuery(async (db) => {
      return db.selectFrom('price_history')
        .select(['price', 'timestamp'])
        .where('pair', '=', pair as any)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .executeTakeFirst();
    });

    if (!dbPrice) {
      throw new TitanError(
        PriceVerseErrorCode.PRICE_UNAVAILABLE,
        `Price not available for ${pair}`
      );
    }

    return {
      pair,
      price: parseFloat(dbPrice.price),
      timestamp: dbPrice.timestamp.getTime(),
    };
  }

  /**
   * Get price change with longer cache (30 seconds)
   */
  @RedisCache({
    key: (pair, period, from, to) =>
      `change:${pair}:${period}:${from ?? 'null'}:${to ?? 'null'}`,
    ttl: 30,
  })
  async getPriceChange(
    pair: string,
    period: string,
    from?: string,
    to?: string
  ): Promise<PriceChangeResponse> {
    const { startDate, endDate } = this.calculateDateRange(period, from, to);

    const result = await this.db.executeQuery(async (db) => {
      const startPrice = await db.selectFrom('price_history')
        .select(['price', 'timestamp'])
        .where('pair', '=', pair as any)
        .where('timestamp', '>=', startDate)
        .orderBy('timestamp', 'asc')
        .limit(1)
        .executeTakeFirst();

      const endPrice = await db.selectFrom('price_history')
        .select(['price', 'timestamp'])
        .where('pair', '=', pair as any)
        .where('timestamp', '<=', endDate)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .executeTakeFirst();

      return { startPrice, endPrice };
    });

    if (!result.startPrice || !result.endPrice) {
      throw new TitanError(
        PriceVerseErrorCode.CHART_DATA_NOT_FOUND,
        `No price data available for ${pair} in the specified period`
      );
    }

    const start = parseFloat(result.startPrice.price);
    const end = parseFloat(result.endPrice.price);
    const changePercent = ((end - start) / start) * 100;

    return {
      pair,
      startDate: result.startPrice.timestamp.getTime(),
      endDate: result.endPrice.timestamp.getTime(),
      startPrice: start,
      endPrice: end,
      changePercent: Math.round(changePercent * 100) / 100,
    };
  }

  /**
   * Stream live prices using Redis Pub/Sub
   */
  async *streamPrices(pairs: string[]): AsyncGenerator<PriceResponse> {
    const subscriber = this.redis.createSubscriber();
    const channels = pairs.map(p => `price:${p}`);

    await subscriber.subscribe(...channels);

    try {
      for await (const [channel, message] of subscriber) {
        const pair = channel.replace('price:', '');
        const data = JSON.parse(message);

        yield {
          pair,
          price: parseFloat(data.price),
          timestamp: data.timestamp,
        };
      }
    } finally {
      await subscriber.unsubscribe(...channels);
      subscriber.quit();
    }
  }

  private calculateDateRange(
    period: string,
    from?: string,
    to?: string
  ): { startDate: Date; endDate: Date } {
    const endDate = to ? new Date(to) : new Date();
    let startDate: Date;

    switch (period) {
      case '24hours':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7days':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30days':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'custom':
        if (!from) {
          throw new TitanError(
            PriceVerseErrorCode.INVALID_DATE_FORMAT,
            'Custom period requires "from" parameter'
          );
        }
        startDate = new Date(from);
        break;
      default:
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }
}
```

### 8.2 Cache Key Structure

```
Redis Key Structure:
├── price:{pair}              # Current live price (TTL: 60s)
│   └── { price, timestamp, sources }
├── rate:usd-rub              # CBR USD/RUB rate (TTL: 3600s)
├── buffer:trades:{pair}      # Trade buffer (Sorted Set)
├── stream:trades:{exchange}  # Raw trade stream (Redis Stream)
├── change:{pair}:{period}:*  # Price change cache (TTL: 30s)
└── chart:{pair}:{interval}:* # Chart data cache (TTL: 60s)
```

---

## 9. Configuration Management

### 9.1 Configuration Schema

```typescript
// src/config/config.schema.ts

import { z } from 'zod';

export const configSchema = z.object({
  // Application
  app: z.object({
    name: z.string().default('priceverse'),
    version: z.string().default('2.0.0'),
    environment: z.enum(['development', 'staging', 'production']).default('development'),
    port: z.number().default(3000),
    host: z.string().default('0.0.0.0'),
  }),

  // Database
  database: z.object({
    dialect: z.literal('postgres'),
    host: z.string(),
    port: z.number().default(5432),
    database: z.string(),
    user: z.string(),
    password: z.string(),
    pool: z.object({
      min: z.number().default(2),
      max: z.number().default(20),
    }).optional(),
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
    enabled: z.array(z.string()).default([
      'binance', 'kraken', 'coinbase', 'okx', 'bybit', 'kucoin'
    ]),
    maxReconnectAttempts: z.number().default(10),
    reconnectBaseDelay: z.number().default(1000),
  }),

  // Aggregation
  aggregation: z.object({
    interval: z.number().default(10_000), // 10 seconds
    windowSize: z.number().default(30_000), // 30 seconds
    pairs: z.array(z.string()).default([
      'btc-usd', 'xmr-usd', 'eth-usd'
    ]),
  }),

  // Logging
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
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
```

### 9.2 Configuration Module Setup

```typescript
// src/config/config.module.ts

import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { configSchema } from './config.schema';

export const appConfigModule = ConfigModule.forRoot({
  sources: [
    // Default values
    {
      type: 'object',
      data: {
        app: { name: 'priceverse', version: '2.0.0' },
        exchanges: { enabled: ['binance', 'kraken'] },
      },
    },
    // Config file
    {
      type: 'file',
      path: './config/default.json',
      format: 'json',
      optional: true,
    },
    // Environment-specific config
    {
      type: 'file',
      path: `./config/${process.env.NODE_ENV ?? 'development'}.json`,
      format: 'json',
      optional: true,
    },
    // Environment variables (highest priority)
    {
      type: 'env',
      prefix: 'PRICEVERSE_',
      separator: '__',
      transform: 'camelCase',
    },
  ],
  schema: configSchema,
  watchForChanges: process.env.NODE_ENV !== 'production',
});
```

### 9.3 Environment Variables

```bash
# .env.example

# Application
PRICEVERSE_APP__PORT=3000
PRICEVERSE_APP__ENVIRONMENT=production

# Database
PRICEVERSE_DATABASE__HOST=localhost
PRICEVERSE_DATABASE__PORT=5432
PRICEVERSE_DATABASE__DATABASE=priceverse
PRICEVERSE_DATABASE__USER=postgres
PRICEVERSE_DATABASE__PASSWORD=secret

# Redis
PRICEVERSE_REDIS__HOST=localhost
PRICEVERSE_REDIS__PORT=6379
PRICEVERSE_REDIS__PASSWORD=secret

# Logging
PRICEVERSE_LOGGING__LEVEL=info
PRICEVERSE_LOGGING__PRETTY=false
```

---

## 11. Health & Monitoring

### 11.1 Health Module

```typescript
// src/modules/health/health.module.ts

import { Module, Injectable, Inject } from '@omnitron-dev/titan/nexus';
import { Service, Method } from '@omnitron-dev/titan/netron';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_HEALTH_INDICATOR) private readonly dbHealth: DatabaseHealthIndicator,
    @Inject(REDIS_HEALTH_INDICATOR) private readonly redisHealth: RedisHealthIndicator,
    @Inject(CONFIG_SERVICE_TOKEN) private readonly config: ConfigService,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const startTime = Date.now();

    const [dbCheck, redisCheck] = await Promise.allSettled([
      this.dbHealth.isHealthy('database'),
      this.redisHealth.isHealthy('redis'),
    ]);

    const checks: Record<string, HealthCheck> = {
      database: this.extractHealthResult(dbCheck),
      redis: this.extractHealthResult(redisCheck),
    };

    const status = Object.values(checks).every(c => c.status === 'up')
      ? 'healthy'
      : Object.values(checks).some(c => c.status === 'up')
        ? 'degraded'
        : 'unhealthy';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: this.config.get('app.version'),
      checks,
      latency: Date.now() - startTime,
    };
  }

  private extractHealthResult(result: PromiseSettledResult<any>): HealthCheck {
    if (result.status === 'fulfilled') {
      return {
        status: 'up',
        latency: result.value?.latency,
      };
    }
    return {
      status: 'down',
      message: result.reason?.message ?? 'Unknown error',
    };
  }
}

@Service({
  name: 'HealthService',
  version: '1.0.0',
  transports: ['http'],
})
@Injectable()
export class HealthRpcService {
  constructor(
    @Inject(HEALTH_SERVICE_TOKEN) private readonly healthService: HealthService,
  ) {}

  @Method({ auth: { allowAnonymous: true } })
  async check(): Promise<HealthResponse> {
    return this.healthService.getHealth();
  }

  @Method({ auth: { allowAnonymous: true } })
  async live(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  @Method({ auth: { allowAnonymous: true } })
  async ready(): Promise<{ status: 'ok' | 'not_ready' }> {
    const health = await this.healthService.getHealth();
    return {
      status: health.status === 'healthy' ? 'ok' : 'not_ready',
    };
  }
}

@Module({
  providers: [
    { provide: HEALTH_SERVICE_TOKEN, useClass: HealthService },
    HealthRpcService,
  ],
  exports: [HEALTH_SERVICE_TOKEN],
})
export class HealthModule {}
```

### 11.2 Metrics & Observability

```typescript
// src/modules/metrics/metrics.service.ts

import { Injectable, Inject, PostConstruct } from '@omnitron-dev/titan/nexus';
import { Interval, Schedulable } from '@omnitron-dev/titan/module/scheduler';

interface Metrics {
  prices: {
    updatesPerSecond: number;
    lastUpdateTime: number;
    activePairs: number;
  };
  exchanges: {
    connected: number;
    total: number;
    byExchange: Record<string, { connected: boolean; tradesReceived: number }>;
  };
  database: {
    queriesPerSecond: number;
    avgQueryTime: number;
    connectionPoolSize: number;
  };
  redis: {
    opsPerSecond: number;
    cacheHitRate: number;
    streamLag: number;
  };
  system: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
}

@Injectable()
@Schedulable()
export class MetricsService {
  private metrics: Metrics = {
    prices: { updatesPerSecond: 0, lastUpdateTime: 0, activePairs: 0 },
    exchanges: { connected: 0, total: 0, byExchange: {} },
    database: { queriesPerSecond: 0, avgQueryTime: 0, connectionPoolSize: 0 },
    redis: { opsPerSecond: 0, cacheHitRate: 0, streamLag: 0 },
    system: { uptime: 0, memoryUsage: process.memoryUsage(), cpuUsage: process.cpuUsage() },
  };

  private counters = {
    priceUpdates: 0,
    dbQueries: 0,
    dbQueryTime: 0,
    redisOps: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private readonly logger: ILogger,
  ) {}

  @Interval(1000) // Every second
  collectMetrics(): void {
    // Price metrics
    this.metrics.prices.updatesPerSecond = this.counters.priceUpdates;
    this.counters.priceUpdates = 0;

    // Database metrics
    this.metrics.database.queriesPerSecond = this.counters.dbQueries;
    this.metrics.database.avgQueryTime = this.counters.dbQueries > 0
      ? this.counters.dbQueryTime / this.counters.dbQueries
      : 0;
    this.counters.dbQueries = 0;
    this.counters.dbQueryTime = 0;

    // Redis metrics
    this.metrics.redis.opsPerSecond = this.counters.redisOps;
    const totalCacheOps = this.counters.cacheHits + this.counters.cacheMisses;
    this.metrics.redis.cacheHitRate = totalCacheOps > 0
      ? this.counters.cacheHits / totalCacheOps
      : 0;
    this.counters.redisOps = 0;
    this.counters.cacheHits = 0;
    this.counters.cacheMisses = 0;

    // System metrics
    this.metrics.system.uptime = process.uptime();
    this.metrics.system.memoryUsage = process.memoryUsage();
    this.metrics.system.cpuUsage = process.cpuUsage();
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  recordPriceUpdate(): void {
    this.counters.priceUpdates++;
    this.metrics.prices.lastUpdateTime = Date.now();
  }

  recordDbQuery(durationMs: number): void {
    this.counters.dbQueries++;
    this.counters.dbQueryTime += durationMs;
  }

  recordRedisOp(): void {
    this.counters.redisOps++;
  }

  recordCacheHit(): void {
    this.counters.cacheHits++;
  }

  recordCacheMiss(): void {
    this.counters.cacheMisses++;
  }

  setExchangeStatus(exchange: string, connected: boolean): void {
    this.metrics.exchanges.byExchange[exchange] = {
      ...this.metrics.exchanges.byExchange[exchange],
      connected,
    };
    this.metrics.exchanges.connected = Object.values(this.metrics.exchanges.byExchange)
      .filter(e => e.connected).length;
  }
}
```

---

## 12. Implementation Plan

### Phase 1: Foundation (Week 1)

#### 1.1 Project Setup
- [ ] Initialize project with Titan bootstrap
- [ ] Configure TypeScript, ESLint, Prettier
- [ ] Setup package.json with dependencies
- [ ] Configure build system (esbuild/tsx)

#### 1.2 Core Infrastructure
- [ ] Implement configuration schema and module
- [ ] Setup logging with Titan LoggerModule
- [ ] Configure DatabaseModule with Kysely
- [ ] Configure RedisModule

#### 1.3 Database Schema
- [ ] Define Kysely database types
- [ ] Create initial migration
- [ ] Setup migration runner
- [ ] Add database indexes

### Phase 2: Data Collection (Week 2)

#### 2.1 Exchange Workers
- [ ] Implement BaseExchangeWorker abstract class
- [ ] Implement BinanceWorker
- [ ] Implement KrakenWorker
- [ ] Implement CoinbaseWorker
- [ ] Implement OKXWorker
- [ ] Implement BybitWorker
- [ ] Implement KuCoinWorker

#### 2.2 Trade Publishing
- [ ] Setup Redis Streams for trades
- [ ] Implement TradeStreamPublisher
- [ ] Add reconnection logic
- [ ] Implement exchange health monitoring

#### 2.3 CBR Rate Service
- [ ] Implement CBR XML fetcher
- [ ] Add hourly cron job
- [ ] Cache rate in Redis

### Phase 3: Aggregation Engine (Week 3)

#### 3.1 Real-Time Aggregation
- [ ] Implement StreamAggregatorService
- [ ] Setup Redis consumer groups
- [ ] Implement VWAP calculation
- [ ] Add currency conversion (USD → RUB)

#### 3.2 OHLCV Aggregation
- [ ] Implement OHLCVAggregatorService
- [ ] Add 5-minute candle aggregation
- [ ] Add 1-hour candle aggregation
- [ ] Add daily candle aggregation

#### 3.3 Caching Layer
- [ ] Implement price caching
- [ ] Setup cache invalidation
- [ ] Add cache metrics

### Phase 4: API Layer (Week 4)

#### 4.1 Netron Services
- [ ] Implement PricesRpcService
- [ ] Implement ChartsRpcService
- [ ] Implement HealthRpcService
- [ ] Add validation schemas

#### 4.2 HTTP Transport
- [ ] Configure Netron HTTP server
- [ ] Setup CORS middleware
- [ ] Add request logging middleware
- [ ] Implement rate limiting

#### 4.3 Response Handling
- [ ] Implement error handling
- [ ] Add response serialization
- [ ] Setup API documentation

### Phase 5: Testing & Deployment (Week 5)

#### 5.1 Testing
- [ ] Unit tests for services
- [ ] Integration tests for API
- [ ] E2E tests for data flow
- [ ] Load testing

#### 5.2 Deployment
- [ ] Create Dockerfile
- [ ] Setup docker-compose
- [ ] Configure PM2 for production
- [ ] Add Kubernetes manifests (optional)

#### 5.3 Documentation
- [ ] API documentation
- [ ] Deployment guide
- [ ] Operations runbook

---

## 13. File Structure

```
apps/priceverse/
├── docs/
│   └── spec.md                      # This specification
├── src/
│   ├── main.ts                      # Application entry point
│   ├── app.module.ts                # Root module
│   │
│   ├── config/
│   │   ├── config.module.ts         # Config module setup
│   │   ├── config.schema.ts         # Zod configuration schema
│   │   └── index.ts
│   │
│   ├── contracts/
│   │   ├── responses.ts             # Response schemas
│   │   ├── errors.ts                # Error codes
│   │   └── index.ts
│   │
│   ├── database/
│   │   ├── schema.ts                # Kysely database schema
│   │   ├── migrations/
│   │   │   └── 001_initial_schema.ts
│   │   └── index.ts
│   │
│   ├── modules/
│   │   ├── collector/
│   │   │   ├── collector.module.ts
│   │   │   ├── services/
│   │   │   │   ├── cbr-rate.service.ts
│   │   │   │   ├── exchange-manager.service.ts
│   │   │   │   └── trade-publisher.service.ts
│   │   │   ├── workers/
│   │   │   │   ├── base-worker.ts
│   │   │   │   ├── binance.worker.ts
│   │   │   │   ├── kraken.worker.ts
│   │   │   │   ├── coinbase.worker.ts
│   │   │   │   ├── okx.worker.ts
│   │   │   │   ├── bybit.worker.ts
│   │   │   │   └── kucoin.worker.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── aggregator/
│   │   │   ├── aggregator.module.ts
│   │   │   ├── services/
│   │   │   │   ├── stream-aggregator.service.ts
│   │   │   │   └── ohlcv-aggregator.service.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── prices/
│   │   │   ├── prices.module.ts
│   │   │   ├── services/
│   │   │   │   └── prices.service.ts
│   │   │   ├── prices.rpc-service.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── charts/
│   │   │   ├── charts.module.ts
│   │   │   ├── services/
│   │   │   │   └── charts.service.ts
│   │   │   ├── charts.rpc-service.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── health/
│   │   │   ├── health.module.ts
│   │   │   ├── health.service.ts
│   │   │   ├── health.rpc-service.ts
│   │   │   └── index.ts
│   │   │
│   │   └── metrics/
│   │       ├── metrics.module.ts
│   │       ├── metrics.service.ts
│   │       └── index.ts
│   │
│   ├── shared/
│   │   ├── constants.ts             # Injection tokens
│   │   ├── types.ts                 # Shared types
│   │   ├── utils.ts                 # Utility functions
│   │   └── index.ts
│   │
│   └── index.ts                     # Package exports
│
├── config/
│   ├── default.json
│   ├── development.json
│   ├── staging.json
│   └── production.json
│
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .env.example
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 14. Technical Specifications

### 14.1 Runtime Requirements

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | ≥22.0.0 | Primary runtime |
| Bun | ≥1.2.0 | Alternative runtime |
| PostgreSQL | ≥14.0 | Primary database |
| Redis | ≥7.0 | Caching & streams |

### 14.2 Dependencies

```json
{
  "dependencies": {
    "@omnitron-dev/titan": "workspace:*",
    "kysely": "^0.27.0",
    "pg": "^8.11.0",
    "ioredis": "^5.3.0",
    "ws": "^8.16.0",
    "zod": "^3.24.0",
    "xml2js": "^0.6.2"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.9.0",
    "vitest": "^2.0.0"
  }
}
```

### 14.3 Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| API Latency (p50) | <10ms | For cached responses |
| API Latency (p99) | <100ms | Including DB queries |
| Throughput | 10,000 RPS | Per instance |
| Price Update Latency | <500ms | From exchange to cache |
| Memory Usage | <512MB | Per instance |
| CPU Usage | <50% | Under normal load |

### 14.4 Scaling Strategy

Priceverse 2.0 uses Titan PM module for industrial-grade scaling:

1. **Process Pools**: Worker pools with auto-scaling (2-16 workers)
2. **Supervision Trees**: Erlang-style fault tolerance with automatic restarts
3. **Load Balancing**: ADAPTIVE strategy for API handlers, LEAST_LOADED for aggregators
4. **Circuit Breakers**: Protect downstream services from cascading failures
5. **Database**: Read replicas for query distribution
6. **Redis**: Redis Cluster for high availability and pub/sub
7. **Horizontal Scaling**: Multiple app instances with shared Redis for coordination

### 14.5 Security Considerations

1. **No Authentication Required**: Public price data (as in original)
2. **Rate Limiting**: Via Netron middleware (100 req/min default) + PM RateLimit decorator
3. **Input Validation**: Zod schemas on all service methods
4. **SQL Injection**: Prevented by Kysely parameterized queries
5. **DDoS Protection**: Rate limiting + circuit breakers + external WAF recommended
6. **Process Isolation**: Worker threads provide memory isolation

---

## Conclusion

Priceverse 2.0 demonstrates Titan framework's full capabilities as an **industrial-grade backend platform**:

### Core Titan Features Utilized

| Feature | Titan Component | Priceverse Usage |
|---------|-----------------|------------------|
| Dependency Injection | Nexus DI | All services, repositories, workers |
| HTTP API | Netron HTTP Transport | JSON-RPC style POST /netron/invoke |
| Database | Database Module (Kysely) | Type-safe queries, migrations, transactions |
| Caching | Redis Module | Price cache, trade streams, pub/sub |
| Scheduling | Scheduler Module | OHLCV aggregation, CBR rate updates |
| Process Management | PM Module | Worker pools, supervisors, auto-scaling |
| Health Monitoring | Health Module | Liveness, readiness probes |
| Configuration | Config Module | Multi-source config with Zod validation |
| Logging | Logger Module | Structured logging with Pino |

### Key Architectural Achievements

1. **Unified Architecture**: Single Titan application with PM-based process pools vs. 3 separate NestJS bootstraps
2. **JSON-RPC API**: Netron HTTP transport with `POST /netron/invoke` and batch support
3. **Erlang-Style Fault Tolerance**: Supervisor trees with automatic restarts and circuit breakers
4. **Auto-Scaling**: Process pools that scale based on CPU, memory, and saturation metrics
5. **Type Safety**: End-to-end TypeScript with Kysely, Zod, and Netron contracts
6. **Observable**: Built-in health checks, pool metrics, and distributed tracing support
7. **Zero External Frameworks**: Pure Titan stack without NestJS, Express, or Fastify

### Performance Characteristics

- **10,000+ RPS** per instance with adaptive load balancing
- **<10ms p50 latency** for cached responses
- **Automatic recovery** from worker crashes within seconds
- **Horizontal scaling** via PM pools + Redis coordination

This specification provides a complete blueprint for implementing a production-ready cryptocurrency price aggregation platform that showcases Titan's power as an enterprise backend framework.
