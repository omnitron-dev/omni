/**
 * Priceverse - RPC Service Interfaces
 *
 * Shared interfaces for Netron RPC services.
 * Used by both server (implementation) and client (proxy).
 *
 * These interfaces mirror the @Service-decorated classes in modules/
 * and provide type-safe RPC calls across the network boundary.
 */

import type {
  GetPriceParams,
  GetMultiplePricesParams,
  GetPriceChangeParams,
  GetChartParams,
  GetOhlcvParams,
} from './schemas.js';

import type {
  PriceResponse,
  PriceChangeResponse,
  ChartResponse,
  OhlcvResponse,
  HealthResponse,
  HealthCheck,
} from '../shared/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Service Identifiers
// ═══════════════════════════════════════════════════════════════════════════════

/** Service identifier for PricesService */
export const PRICES_SERVICE_ID = 'PricesService@2.0.0' as const;

/** Service identifier for ChartsService */
export const CHARTS_SERVICE_ID = 'ChartsService@2.0.0' as const;

/** Service identifier for HealthService */
export const HEALTH_SERVICE_ID = 'HealthService@1.0.0' as const;

// ═══════════════════════════════════════════════════════════════════════════════
// PricesService@2.0.0
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PricesService RPC interface
 *
 * Provides real-time and historical cryptocurrency price data.
 *
 * @example
 * ```typescript
 * const service = await connection.queryInterface(PRICES_SERVICE_ID) as IPricesService;
 * const price = await service.getPrice({ pair: 'btc-usd' });
 * ```
 */
export interface IPricesService {
  /**
   * Get current price for a trading pair
   */
  getPrice(params: GetPriceParams): Promise<PriceResponse>;

  /**
   * Get current prices for multiple trading pairs
   */
  getMultiplePrices(params: GetMultiplePricesParams): Promise<PriceResponse[]>;

  /**
   * Calculate price change percentage over a period
   */
  getPriceChange(params: GetPriceChangeParams): Promise<PriceChangeResponse>;

  /**
   * Stream real-time price updates (requires streaming transport)
   */
  streamPrices?(params: GetMultiplePricesParams): AsyncGenerator<PriceResponse>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ChartsService@2.0.0
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ChartsService RPC interface
 *
 * Provides chart data and OHLCV candles for visualization.
 *
 * @example
 * ```typescript
 * const service = await connection.queryInterface(CHARTS_SERVICE_ID) as IChartsService;
 * const ohlcv = await service.getOHLCV({ pair: 'btc-usd', interval: '1hour', limit: 24 });
 * ```
 */
export interface IChartsService {
  /**
   * Get chart data for a trading pair
   */
  getChartData(params: GetChartParams): Promise<ChartResponse>;

  /**
   * Get OHLCV candles with pagination
   */
  getOHLCV(params: GetOhlcvParams): Promise<OhlcvResponse>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HealthService@1.0.0
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * HealthService RPC interface
 *
 * Provides health status, liveness, and readiness probes.
 *
 * @example
 * ```typescript
 * const service = await connection.queryInterface(HEALTH_SERVICE_ID) as IHealthService;
 * const health = await service.check();
 * ```
 */
export interface IHealthService {
  /**
   * Comprehensive health check with all service statuses
   */
  check(): Promise<HealthResponse>;

  /**
   * Liveness probe - checks if service is running
   */
  live(): Promise<{ status: 'up' }>;

  /**
   * Readiness probe - checks if service is ready to handle requests
   */
  ready(): Promise<HealthCheck>;
}
