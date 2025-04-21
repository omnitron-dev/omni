import { Inject, Injectable } from '@nestjs/common';
import { NotificationManager } from '@devgrid/rotif';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { ROTIF_MANAGER } from '../constants';

/**
 * Service that provides health check functionality for the Rotif notification system.
 * This service implements the NestJS health check pattern and is compatible with
 * @nestjs/terminus. It checks the Redis connection status to determine if the
 * notification system is operational.
 *
 * @example
 * // Using in a health check controller
 * ＠Controller('health')
 * export class HealthController {
 *   constructor(
 *     private health: HealthCheckService,
 *     private rotifHealth: RotifHealthService
 *   ) {}
 *
 *   ＠Get()
 *   ＠HealthCheck()
 *   check() {
 *     return this.health.check([
 *       () => this.rotifHealth.check()
 *     ]);
 *   }
 * }
 */
@Injectable()
export class RotifHealthService {
  constructor(
    @Inject(ROTIF_MANAGER)
    private readonly rotifManager: NotificationManager,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) { }

  /**
   * Performs a health check of the Rotif notification system.
   * This method attempts to ping the Redis server to verify connectivity.
   * The check is considered successful if the ping receives a response,
   * and failed if the ping throws an error.
   *
   * @returns Promise resolving to a HealthIndicatorResult object containing
   *          the health check status. The result will have a status of either
   *          'up' or 'down', and in case of failure, will include an error message.
   * 
   * @example
   * // Health check result when Redis is available
   * {
   *   rotif: {
   *     status: 'up'
   *   }
   * }
   * 
   * // Health check result when Redis is unavailable
   * {
   *   rotif: {
   *     status: 'down',
   *     message: 'Redis connection refused'
   *   }
   * }
   */
  async check(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('rotif');

    try {
      await this.rotifManager.redis.ping();
      return indicator.up();
    } catch (error: any) {
      return indicator.down({ message: error.message });
    }
  }
}
