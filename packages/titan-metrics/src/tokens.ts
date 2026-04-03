/**
 * Titan Metrics — DI Tokens
 *
 * @module titan-metrics
 */

import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type { IMetricsService, IMetricsModuleOptions, IMetricsStorage } from './types.js';

/** Token for the main MetricsService */
export const METRICS_SERVICE_TOKEN: Token<IMetricsService> = createToken<IMetricsService>('TitanMetricsService');

/** Token for module options passed via forRoot() */
export const METRICS_OPTIONS_TOKEN: Token<IMetricsModuleOptions> = createToken<IMetricsModuleOptions>('TitanMetricsOptions');

/** Token for the storage backend (memory or postgres) */
export const METRICS_STORAGE_TOKEN: Token<IMetricsStorage> = createToken<IMetricsStorage>('TitanMetricsStorage');
