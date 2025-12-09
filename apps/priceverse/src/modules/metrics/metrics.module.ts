/**
 * Priceverse - Metrics Module
 * Provides application metrics and monitoring
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { MetricsService } from './metrics.service.js';
import { METRICS_SERVICE_TOKEN } from '../../shared/tokens.js';

@Module({
  providers: [
    { provide: METRICS_SERVICE_TOKEN, useClass: MetricsService },
  ],
  exports: [METRICS_SERVICE_TOKEN],
})
export class MetricsModule { }
