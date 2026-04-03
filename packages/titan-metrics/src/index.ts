/**
 * Titan Metrics — Package exports
 *
 * Pure Titan-native metrics module.
 * No prom-client. No external metrics systems.
 *
 * @module titan-metrics
 */

// Types
export type {
  MetricType,
  MetricSample,
  MetricDefinition,
  HistogramState,
  IMetricsCollectionConfig,
  IMetricsStorageConfig,
  IMetricsRetentionConfig,
  IMetricsSyncConfig,
  IMetricsModuleOptions,
  MetricsQueryFilter,
  MetricsTimeSeries,
  MetricsSnapshot,
  IMetricsStorage,
  IMetricsService,
} from './types.js';

// Tokens
export {
  METRICS_SERVICE_TOKEN,
  METRICS_OPTIONS_TOKEN,
  METRICS_STORAGE_TOKEN,
} from './tokens.js';

// Registry
export { MetricsRegistry } from './registry.js';

// Collector
export { MetricsCollector } from './collector.js';

// Storage
export { MemoryMetricsStorage, PostgresMetricsStorage, SQLiteMetricsStorage, parseMaxAge } from './storage.js';

// Service
export { MetricsService } from './metrics.service.js';

// Module
export { TitanMetricsModule } from './metrics.module.js';

// Decorator
export { Metrics, attachMetricsService } from './decorator.js';

// RPC Service
export { MetricsRpcService } from './rpc-service.js';
