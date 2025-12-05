/**
 * Priceverse 2.0 - Health RPC Service
 * Exposes health check endpoints via Netron RPC
 */

import { Service, Method, Inject } from '@omnitron-dev/titan/decorators';
import type { HealthResponse, HealthCheck } from '../../shared/types.js';
import { HealthService } from './health.service.js';
import { HEALTH_SERVICE_TOKEN } from '../../shared/tokens.js';

@Service({ name: 'HealthService@1.0.0' })
export class HealthRpcService {
  constructor(
    @Inject(HEALTH_SERVICE_TOKEN) private readonly healthService: HealthService,
  ) {}

  /**
   * Comprehensive health check
   */
  @Method({ auth: { allowAnonymous: true } })
  async check(): Promise<HealthResponse> {
    return this.healthService.getHealth();
  }

  /**
   * Liveness probe - checks if service is running
   */
  @Method({ auth: { allowAnonymous: true } })
  async live(): Promise<{ status: 'up' }> {
    return this.healthService.getLiveness();
  }

  /**
   * Readiness probe - checks if service is ready to handle requests
   */
  @Method({ auth: { allowAnonymous: true } })
  async ready(): Promise<HealthCheck> {
    return this.healthService.getReadiness();
  }
}
