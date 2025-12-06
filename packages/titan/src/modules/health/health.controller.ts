/**
 * Health Controller
 *
 * Provides HTTP endpoints for health checks.
 * Compatible with Kubernetes liveness and readiness probes.
 *
 * @module titan/modules/health
 */

import { Injectable } from '../../decorators/index.js';
import { HealthService } from './health.service.js';
import type {
  HealthCheckResult,
  HealthHttpResponse,
  HealthIndicatorResult,
  HealthStatus,
} from './health.types.js';

/**
 * HTTP Response structure
 */
interface HttpResponse {
  statusCode: number;
  body: any;
  headers?: Record<string, string>;
}

/**
 * Health Controller
 *
 * Provides HTTP-compatible endpoints for health checks.
 * Can be integrated with various HTTP frameworks (Express, Fastify, Netron, etc.)
 *
 * @example
 * ```typescript
 * // With Express
 * const healthController = container.resolve(HealthController);
 *
 * app.get('/health', async (req, res) => {
 *   const response = await healthController.check();
 *   res.status(response.statusCode).json(response.body);
 * });
 *
 * app.get('/health/live', async (req, res) => {
 *   const response = await healthController.liveness();
 *   res.status(response.statusCode).json(response.body);
 * });
 *
 * app.get('/health/ready', async (req, res) => {
 *   const response = await healthController.readiness();
 *   res.status(response.statusCode).json(response.body);
 * });
 * ```
 */
@Injectable()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Full health check endpoint
   *
   * GET /health
   *
   * Returns detailed health information for all registered indicators.
   */
  async check(): Promise<HttpResponse> {
    const result = await this.healthService.check();
    const httpResponse = this.formatResponse(result);

    return {
      statusCode: this.getStatusCode(result.status),
      body: httpResponse,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    };
  }

  /**
   * Liveness probe endpoint
   *
   * GET /health/live
   *
   * Simple check to verify the process is running and responsive.
   * Used by Kubernetes to determine if the container should be restarted.
   */
  async liveness(): Promise<HttpResponse> {
    const isAlive = await this.healthService.isAlive();

    return {
      statusCode: isAlive ? 200 : 503,
      body: {
        status: isAlive ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
      },
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    };
  }

  /**
   * Readiness probe endpoint
   *
   * GET /health/ready
   *
   * Checks if the application is ready to receive traffic.
   * Used by Kubernetes to determine if the pod should receive traffic.
   */
  async readiness(): Promise<HttpResponse> {
    const isReady = await this.healthService.isReady();
    const result = await this.healthService.check();

    const unhealthyIndicators: Record<string, HealthIndicatorResult> = {};
    const healthyIndicators: Record<string, HealthIndicatorResult> = {};

    for (const [name, indicator] of Object.entries(result.indicators)) {
      if (indicator.status === 'unhealthy') {
        unhealthyIndicators[name] = indicator;
      } else {
        healthyIndicators[name] = indicator;
      }
    }

    return {
      statusCode: isReady ? 200 : 503,
      body: {
        status: result.status,
        timestamp: new Date().toISOString(),
        info: Object.keys(healthyIndicators).length > 0 ? healthyIndicators : undefined,
        error: Object.keys(unhealthyIndicators).length > 0 ? unhealthyIndicators : undefined,
      },
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    };
  }

  /**
   * Check a specific indicator
   *
   * GET /health/:indicator
   */
  async checkIndicator(indicatorName: string): Promise<HttpResponse> {
    try {
      const result = await this.healthService.checkOne(indicatorName);

      return {
        statusCode: this.getStatusCode(result.status),
        body: {
          [indicatorName]: result,
        },
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      };
    } catch (error) {
      return {
        statusCode: 404,
        body: {
          error: 'Indicator not found',
          message: (error as Error).message,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      };
    }
  }

  /**
   * List all registered indicators
   *
   * GET /health/indicators
   */
  listIndicators(): HttpResponse {
    const indicators = this.healthService.getIndicators();

    return {
      statusCode: 200,
      body: {
        indicators,
        count: indicators.length,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }

  /**
   * Get uptime information
   *
   * GET /health/uptime
   */
  getUptime(): HttpResponse {
    const uptimeMs = this.healthService.getUptime();
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    return {
      statusCode: 200,
      body: {
        uptime: {
          ms: uptimeMs,
          formatted: days + 'd ' + hours + 'h ' + minutes + 'm ' + seconds + 's',
          days,
          hours,
          minutes,
          seconds,
        },
        timestamp: new Date().toISOString(),
      },
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }

  /**
   * Format health check result for HTTP response
   */
  private formatResponse(result: HealthCheckResult): HealthHttpResponse {
    const info: Record<string, HealthIndicatorResult> = {};
    const error: Record<string, HealthIndicatorResult> = {};

    for (const [name, indicator] of Object.entries(result.indicators)) {
      if (indicator.status === 'unhealthy') {
        error[name] = indicator;
      } else {
        info[name] = indicator;
      }
    }

    return {
      status: result.status,
      info: Object.keys(info).length > 0 ? info : undefined,
      error: Object.keys(error).length > 0 ? error : undefined,
      details: result.indicators,
    };
  }

  /**
   * Get HTTP status code based on health status
   */
  private getStatusCode(status: HealthStatus): number {
    switch (status) {
      case 'healthy':
        return 200;
      case 'degraded':
        return 200; // Still accepting traffic
      case 'unhealthy':
        return 503;
      default:
        return 500;
    }
  }
}
