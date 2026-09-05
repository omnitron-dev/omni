/**
 * Health RPC Service
 *
 * Netron-native RPC service for health checks.
 * Provides standard health endpoints via Netron protocol.
 *
 * @module titan/modules/health
 */

import { Service, Public, Injectable } from '@omnitron-dev/titan/decorators';
import type { HealthService } from './health.service.js';
import type { HealthIndicatorResult, HealthStatus } from './health.types.js';

/**
 * Liveness probe response
 */
export interface LivenessResponse {
  status: 'up' | 'down';
  timestamp: string;
}

/**
 * Readiness probe response
 */
export interface ReadinessResponse {
  status: HealthStatus;
  timestamp: string;
  checks?: Record<
    string,
    {
      status: HealthStatus;
      message?: string;
    }
  >;
}

/**
 * Full health check response
 */
export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version?: string;
  indicators: Record<string, HealthIndicatorResult>;
  totalLatency?: number;
}

/**
 * Single indicator check response
 */
export interface IndicatorResponse {
  name: string;
  result: HealthIndicatorResult;
}

/**
 * Uptime response
 */
export interface UptimeResponse {
  uptime: {
    ms: number;
    formatted: string;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  };
  timestamp: string;
}

/**
 * Health RPC Service
 *
 * Exposes health check functionality via Netron RPC.
 * Compatible with Kubernetes liveness and readiness probes.
 *
 * @example
 * ```typescript
 * // Client-side usage
 * const health = await peer.queryInterface<HealthRpcService>('Health@1.0.0');
 *
 * // Full health check
 * const result = await health.check();
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 *
 * // Kubernetes probes
 * const isLive = await health.live();
 * const isReady = await health.ready();
 * ```
 */
/**
 * ANONYMOUS SURFACE — what this service answers without credentials.
 *
 * Seven methods carry `@Public({ auth: { allowAnonymous: true } })`, and they
 * are not equally obliged to. The distinction is worth having in front of you
 * before changing either half:
 *
 *   Anonymous BY NECESSITY — `live()` and `ready()`. An orchestrator probe
 *   carries no credentials; requiring auth here means the pod is restarted or
 *   pulled from rotation for failing to authenticate, which is an outage
 *   caused by the auth setting rather than by health.
 *
 *   Anonymous BY INHERITANCE — `check()`, `checkIndicator()`,
 *   `listIndicators()`, `uptime()`, `isHealthy()`. These answer questions a
 *   probe does not ask. `check()` returns every indicator's `message` and
 *   `error` — which, for the database indicator, names the query methods a
 *   connection lacks, and for others can carry a driver's own text.
 *   `listIndicators()` enumerates what this process depends on. `ready()`
 *   discloses a subset of the same: names and messages of whatever is not
 *   healthy.
 *
 * Left as it is deliberately. Which of these may be public is a property of
 * the DEPLOYMENT — an internal port scraped by Prometheus and a public edge
 * are different answers — and a package cannot know which it is in. Tightening
 * the second group here would silently break every dashboard that reads it
 * today, and the outage would land on whoever upgraded rather than on whoever
 * chose the exposure.
 *
 * What an operator needs is that the surface be visible: `omnitron doctor`
 * reports it, and this comment is the answer they should find when they come
 * looking for why.
 */
@Service({ name: 'Health@1.0.0' })
@Injectable()
export class HealthRpcService {
  private healthService!: HealthService;
  private version?: string;

  /**
   * Set the health service instance
   * Called by the module during initialization
   */
  setHealthService(healthService: HealthService): void {
    this.healthService = healthService;
  }

  /**
   * Set application version
   */
  setVersion(version: string): void {
    this.version = version;
  }

  /**
   * Full health check
   *
   * Returns comprehensive health information for all registered indicators.
   * Use this for detailed monitoring and debugging.
   */
  @Public({ auth: { allowAnonymous: true } })
  async check(): Promise<HealthResponse> {
    const result = await this.healthService.check();

    return {
      status: result.status,
      timestamp: result.timestamp.toISOString(),
      uptime: result.uptime ?? this.healthService.getUptime(),
      version: this.version,
      indicators: result.indicators,
      totalLatency: result.totalLatency,
    };
  }

  /**
   * Liveness probe
   *
   * Simple check to verify the process is running and responsive.
   * Used by Kubernetes to determine if the container should be restarted.
   *
   * Always returns quickly - doesn't check external dependencies.
   */
  @Public({ auth: { allowAnonymous: true } })
  async live(): Promise<LivenessResponse> {
    const isAlive = await this.healthService.isAlive();

    return {
      status: isAlive ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe
   *
   * Checks if the application is ready to receive traffic.
   * Used by Kubernetes to determine if the pod should receive traffic.
   *
   * Healthy or degraded = ready
   * Unhealthy = not ready
   */
  @Public({ auth: { allowAnonymous: true } })
  async ready(): Promise<ReadinessResponse> {
    const result = await this.healthService.check();
    const checks: Record<string, { status: HealthStatus; message?: string }> = {};

    // Only include non-healthy indicators in summary
    for (const [name, indicator] of Object.entries(result.indicators)) {
      if (indicator.status !== 'healthy') {
        checks[name] = {
          status: indicator.status,
          message: indicator.message,
        };
      }
    }

    return {
      status: result.status,
      timestamp: new Date().toISOString(),
      checks: Object.keys(checks).length > 0 ? checks : undefined,
    };
  }

  /**
   * Check a specific indicator
   *
   * Useful for targeted health monitoring of specific components.
   */
  @Public({ auth: { allowAnonymous: true } })
  async checkIndicator(name: string): Promise<IndicatorResponse> {
    const result = await this.healthService.checkOne(name);

    return {
      name,
      result,
    };
  }

  /**
   * List all registered indicators
   */
  @Public({ auth: { allowAnonymous: true } })
  async listIndicators(): Promise<{ indicators: string[]; count: number }> {
    const indicators = this.healthService.getIndicators();

    return {
      indicators,
      count: indicators.length,
    };
  }

  /**
   * Get uptime information
   */
  @Public({ auth: { allowAnonymous: true } })
  async uptime(): Promise<UptimeResponse> {
    const uptimeMs = this.healthService.getUptime();
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    return {
      uptime: {
        ms: uptimeMs,
        formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`,
        days,
        hours,
        minutes,
        seconds,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check if system is healthy (convenience method)
   */
  @Public({ auth: { allowAnonymous: true } })
  async isHealthy(): Promise<{ healthy: boolean }> {
    const healthy = await this.healthService.isHealthy();
    return { healthy };
  }
}
