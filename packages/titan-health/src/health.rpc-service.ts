/**
 * Health RPC Service
 *
 * Netron-native RPC service for health checks.
 * Provides standard health endpoints via Netron protocol.
 *
 * @module titan/modules/health
 */

import { Service, Public, Injectable, METADATA_KEYS, type MethodOptions } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import type { HealthService } from './health.service.js';
import type { HealthIndicatorResult, HealthModuleOptions, HealthStatus } from './health.types.js';

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
@Service({ name: 'Health@1.0.0' })
@Injectable()
export class HealthRpcService {
  private healthService!: HealthService;
  private version?: string;
  private disabled = false;

  /** Apply this deployment's Netron policy without changing another application's service prototype. */
  static create(health: HealthService, options: HealthModuleOptions): HealthRpcService {
    const roles = options.detailRpcRoles;
    let Rpc = HealthRpcService;
    if (roles !== undefined) {
      if (!Array.isArray(roles) || !roles.length || roles.some(role => typeof role !== 'string' || !role.trim() || role !== role.trim())) {
        throw new TypeError('detailRpcRoles requires at least one nonempty role name');
      }
      class RestrictedHealth extends HealthRpcService {}
      const auth = { roles: [...new Set(roles)] };
      const base = HealthRpcService.prototype;
      const { methods } = Reflect.getMetadata(METADATA_KEYS.SERVICE_ANNOTATION, HealthRpcService);
      for (const method of Object.keys(methods)) {
        if (method === 'live' || method === 'ready') continue;
        const methodOptions = Reflect.getMetadata(METADATA_KEYS.METHOD_OPTIONS, base, method) as MethodOptions;
        Public({ ...methodOptions, auth })(RestrictedHealth.prototype, method, Object.getOwnPropertyDescriptor(base, method));
      }
      Rpc = RestrictedHealth;
    }
    const rpc = new Rpc();
    rpc.setHealthService(health);
    if (options.version) rpc.setVersion(options.version);
    if (options.enableRpcService === false) rpc.disable();
    return rpc;
  }

  /**
   * Answer every call as a missing service would. For a deployment that said
   * `enableRpcService: false` where the module could no longer take the
   * service off the wire (see `TitanHealthModule.forRootAsync`).
   */
  disable(): void {
    this.disabled = true;
  }

  private assertEnabled(): void {
    if (this.disabled) throw Errors.notFound('Service Health@1.0.0');
  }

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
    this.assertEnabled();
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
    this.assertEnabled();
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
    this.assertEnabled();
    const result = await this.healthService.check();
    // Which indicator is not healthy, and why, is `check()`'s to say — to a
    // caller with a role. A probe reads `status`.
    return {
      status: result.status,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check a specific indicator
   *
   * Useful for targeted health monitoring of specific components.
   */
  @Public({ auth: { allowAnonymous: true } })
  async checkIndicator(name: string): Promise<IndicatorResponse> {
    this.assertEnabled();
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
    this.assertEnabled();
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
    this.assertEnabled();
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
    this.assertEnabled();
    const healthy = await this.healthService.isHealthy();
    return { healthy };
  }
}
