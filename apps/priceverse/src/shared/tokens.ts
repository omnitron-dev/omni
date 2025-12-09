/**
 * Priceverse - Dependency Injection Tokens
 * All tokens for services, modules, and configuration
 */

import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type { PricesService } from '../modules/prices/services/prices.service.js';
import type { ChartsService } from '../modules/charts/services/charts.service.js';
import type { HealthService } from '../modules/health/health.service.js';
import type { MetricsService } from '../modules/metrics/metrics.service.js';
import type { CbrRateService } from '../modules/collector/services/cbr-rate.service.js';
import type { StreamAggregatorService } from '../modules/aggregator/services/stream-aggregator.service.js';
import type { OhlcvAggregatorService } from '../modules/aggregator/services/ohlcv-aggregator.service.js';
import type { ExchangeManagerService } from '../modules/collector/services/exchange-manager.service.js';
import type { PriceHistoryRepository } from '../database/repositories/price-history.repository.js';
import type { OhlcvRepository } from '../database/repositories/ohlcv.repository.js';

// Service tokens with explicit type annotations for declaration emission
export const PRICES_SERVICE_TOKEN: Token<PricesService> = createToken<PricesService>('PricesService');
export const CHARTS_SERVICE_TOKEN: Token<ChartsService> = createToken<ChartsService>('ChartsService');
export const HEALTH_SERVICE_TOKEN: Token<HealthService> = createToken<HealthService>('HealthService');
export const METRICS_SERVICE_TOKEN: Token<MetricsService> = createToken<MetricsService>('MetricsService');
export const CBR_RATE_SERVICE_TOKEN: Token<CbrRateService> = createToken<CbrRateService>('CbrRateService');
export const STREAM_AGGREGATOR_TOKEN: Token<StreamAggregatorService> = createToken<StreamAggregatorService>('StreamAggregatorService');
export const OHLCV_AGGREGATOR_TOKEN: Token<OhlcvAggregatorService> = createToken<OhlcvAggregatorService>('OhlcvAggregatorService');
export const EXCHANGE_MANAGER_TOKEN: Token<ExchangeManagerService> = createToken<ExchangeManagerService>('ExchangeManagerService');

// Repository tokens
export const PRICE_HISTORY_REPOSITORY: Token<PriceHistoryRepository> = createToken<PriceHistoryRepository>('PriceHistoryRepository');
export const OHLCV_REPOSITORY: Token<OhlcvRepository> = createToken<OhlcvRepository>('OhlcvRepository');
