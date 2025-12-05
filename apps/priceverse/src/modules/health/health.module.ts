/**
 * Priceverse 2.0 - Health Module
 * Provides health check and monitoring capabilities
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { HealthService } from './health.service.js';
import { HealthRpcService } from './health.rpc-service.js';
import { HEALTH_SERVICE_TOKEN } from '../../shared/tokens.js';

@Module({
  providers: [
    { provide: HEALTH_SERVICE_TOKEN, useClass: HealthService },
    HealthRpcService,
  ],
  exports: [HEALTH_SERVICE_TOKEN],
})
export class HealthModule {}
