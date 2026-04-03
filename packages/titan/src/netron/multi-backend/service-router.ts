/**
 * Service Router
 *
 * Routes service requests to appropriate backends based on configuration,
 * load balancing strategy, and health status.
 *
 * @module @omnitron-dev/titan/netron/multi-backend
 */

import type {
  ServiceRouterConfig,
  ServiceRoute,
  LoadBalancingStrategy,
  BackendSelection,
  BackendStatus,
} from './types.js';

/**
 * Default router configuration
 */
const DEFAULT_ROUTER_CONFIG: Required<
  Pick<ServiceRouterConfig, 'defaultBackends' | 'defaultStrategy' | 'localityAware'>
> = {
  defaultBackends: [],
  defaultStrategy: 'round-robin',
  localityAware: false,
};

/**
 * Service Router
 *
 * Handles routing of service requests to backends based on:
 * - Explicit service routes
 * - Load balancing strategies
 * - Backend health status
 * - Locality awareness
 */
export class ServiceRouter {
  private config: ServiceRouterConfig;
  private routeMap: Map<string, ServiceRoute>;
  private roundRobinCounters: Map<string, number>;
  private connectionCounts: Map<string, number>;

  constructor(config?: ServiceRouterConfig) {
    this.config = {
      ...DEFAULT_ROUTER_CONFIG,
      ...config,
      routes: config?.routes ?? [],
    };
    this.routeMap = new Map();
    this.roundRobinCounters = new Map();
    this.connectionCounts = new Map();

    // Build route map for efficient lookup
    this.buildRouteMap();
  }

  /**
   * Build route map from configuration
   */
  private buildRouteMap(): void {
    this.routeMap.clear();
    for (const route of this.config.routes) {
      this.routeMap.set(route.service, route);
    }
  }

  /**
   * Select a backend for a service request
   */
  selectBackend(
    serviceName: string,
    availableBackends: BackendStatus[],
    context?: { forcedBackendId?: string; clientRegion?: string }
  ): BackendSelection | null {
    // Handle forced backend
    if (context?.forcedBackendId) {
      const backend = availableBackends.find((b) => b.id === context.forcedBackendId && b.health !== 'unhealthy');
      if (backend) {
        return {
          backendId: backend.id,
          reason: 'forced',
          alternatives: this.getAlternatives(serviceName, backend.id, availableBackends),
        };
      }
    }

    // Find matching route
    const route = this.findRoute(serviceName);

    if (route) {
      // Filter backends based on route configuration
      const routeBackends = availableBackends.filter((b) => route.backends.includes(b.id) && b.health !== 'unhealthy');

      if (routeBackends.length > 0) {
        const selected = this.selectByStrategy(
          routeBackends,
          route.strategy || this.config.defaultStrategy || 'round-robin',
          serviceName,
          context?.clientRegion
        );

        if (selected) {
          return {
            backendId: selected.id,
            reason: 'route',
            alternatives: this.getRouteAlternatives(route, selected.id, availableBackends),
          };
        }
      }

      // Try fallback backends
      if (route.fallback && route.fallback.length > 0) {
        const fallbackBackends = availableBackends.filter(
          (b) => route.fallback!.includes(b.id) && b.health !== 'unhealthy'
        );

        if (fallbackBackends.length > 0) {
          const selected = this.selectByStrategy(
            fallbackBackends,
            route.strategy || this.config.defaultStrategy || 'round-robin',
            serviceName,
            context?.clientRegion
          );

          if (selected) {
            return {
              backendId: selected.id,
              reason: 'fallback',
              alternatives: fallbackBackends.filter((b) => b.id !== selected.id).map((b) => b.id),
            };
          }
        }
      }
    }

    // Use default backends
    const defaultBackends = this.config.defaultBackends ?? [];
    const defaultBackendStatuses = availableBackends.filter(
      (b) => (defaultBackends.length === 0 || defaultBackends.includes(b.id)) && b.health !== 'unhealthy'
    );

    if (defaultBackendStatuses.length > 0) {
      const selected = this.selectByStrategy(
        defaultBackendStatuses,
        this.config.defaultStrategy || 'round-robin',
        serviceName,
        context?.clientRegion
      );

      if (selected) {
        return {
          backendId: selected.id,
          reason: 'default',
          alternatives: defaultBackendStatuses.filter((b) => b.id !== selected.id).map((b) => b.id),
        };
      }
    }

    return null;
  }

  /**
   * Find a route for a service name (supports wildcards)
   */
  private findRoute(serviceName: string): ServiceRoute | undefined {
    // Exact match first
    const exactMatch = this.routeMap.get(serviceName);
    if (exactMatch) return exactMatch;

    // Wildcard match
    for (const [pattern, route] of this.routeMap) {
      if (this.matchPattern(pattern, serviceName)) {
        return route;
      }
    }

    return undefined;
  }

  /**
   * Match service name against pattern (supports * wildcards)
   */
  private matchPattern(pattern: string, serviceName: string): boolean {
    if (!pattern.includes('*')) return pattern === serviceName;

    // Convert pattern to regex
    const regexPattern = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');

    return new RegExp(`^${regexPattern}$`).test(serviceName);
  }

  /**
   * Select backend based on load balancing strategy
   */
  private selectByStrategy(
    backends: BackendStatus[],
    strategy: LoadBalancingStrategy,
    serviceName: string,
    clientRegion?: string
  ): BackendStatus | null {
    if (backends.length === 0) return null;
    if (backends.length === 1) return backends[0] ?? null;

    // Apply locality filtering if enabled
    let candidates = backends;
    if (this.config.localityAware && clientRegion) {
      const localBackends = backends.filter((b) => b.region === clientRegion);
      if (localBackends.length > 0) {
        candidates = localBackends;
      }
    }

    switch (strategy) {
      case 'round-robin':
        return this.selectRoundRobin(candidates, serviceName);
      case 'random':
        return this.selectRandom(candidates);
      case 'least-connections':
        return this.selectLeastConnections(candidates);
      case 'weighted':
        return this.selectWeighted(candidates);
      default:
        return this.selectRoundRobin(candidates, serviceName);
    }
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(backends: BackendStatus[], key: string): BackendStatus | null {
    if (backends.length === 0) return null;
    const counter = this.roundRobinCounters.get(key) ?? 0;
    const selected = backends[counter % backends.length];
    this.roundRobinCounters.set(key, counter + 1);
    return selected ?? null;
  }

  /**
   * Random selection
   */
  private selectRandom(backends: BackendStatus[]): BackendStatus | null {
    if (backends.length === 0) return null;
    return backends[Math.floor(Math.random() * backends.length)] ?? null;
  }

  /**
   * Least connections selection
   */
  private selectLeastConnections(backends: BackendStatus[]): BackendStatus | null {
    if (backends.length === 0) return null;
    const first = backends[0];
    if (!first) return null;
    return backends.reduce((min, current) => {
      const minConnections = this.connectionCounts.get(min.id) ?? min.activeConnections;
      const currentConnections = this.connectionCounts.get(current.id) ?? current.activeConnections;
      return currentConnections < minConnections ? current : min;
    }, first);
  }

  /**
   * Weighted selection
   */
  private selectWeighted(_backends: BackendStatus[]): BackendStatus | null {
    // Note: weights are not in BackendStatus, would need to be passed separately
    // For now, fall back to random selection
    return this.selectRandom(_backends);
  }

  /**
   * Get alternative backends for failover
   */
  private getAlternatives(serviceName: string, excludeId: string, availableBackends: BackendStatus[]): string[] {
    const route = this.findRoute(serviceName);
    if (route) {
      return this.getRouteAlternatives(route, excludeId, availableBackends);
    }

    // Return all healthy backends except the selected one
    return availableBackends.filter((b) => b.id !== excludeId && b.health !== 'unhealthy').map((b) => b.id);
  }

  /**
   * Get alternative backends from route
   */
  private getRouteAlternatives(route: ServiceRoute, excludeId: string, availableBackends: BackendStatus[]): string[] {
    const alternatives: string[] = [];

    // Add other route backends
    for (const backendId of route.backends) {
      if (backendId !== excludeId) {
        const backend = availableBackends.find((b) => b.id === backendId);
        if (backend && backend.health !== 'unhealthy') {
          alternatives.push(backendId);
        }
      }
    }

    // Add fallback backends
    if (route.fallback) {
      for (const backendId of route.fallback) {
        if (backendId !== excludeId && !alternatives.includes(backendId)) {
          const backend = availableBackends.find((b) => b.id === backendId);
          if (backend && backend.health !== 'unhealthy') {
            alternatives.push(backendId);
          }
        }
      }
    }

    return alternatives;
  }

  /**
   * Update connection count for a backend
   */
  updateConnectionCount(backendId: string, count: number): void {
    this.connectionCounts.set(backendId, count);
  }

  /**
   * Increment connection count
   */
  incrementConnections(backendId: string): void {
    const current = this.connectionCounts.get(backendId) ?? 0;
    this.connectionCounts.set(backendId, current + 1);
  }

  /**
   * Decrement connection count
   */
  decrementConnections(backendId: string): void {
    const current = this.connectionCounts.get(backendId) ?? 0;
    this.connectionCounts.set(backendId, Math.max(0, current - 1));
  }

  /**
   * Add a route dynamically
   */
  addRoute(route: ServiceRoute): void {
    this.config.routes.push(route);
    this.routeMap.set(route.service, route);
  }

  /**
   * Remove a route dynamically
   */
  removeRoute(serviceName: string): boolean {
    const index = this.config.routes.findIndex((r) => r.service === serviceName);
    if (index >= 0) {
      this.config.routes.splice(index, 1);
      this.routeMap.delete(serviceName);
      return true;
    }
    return false;
  }

  /**
   * Get all routes
   */
  getRoutes(): ServiceRoute[] {
    return [...this.config.routes];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ServiceRouterConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      routes: config.routes ?? this.config.routes,
    };
    this.buildRouteMap();
  }

  /**
   * Reset round-robin counters
   */
  resetCounters(): void {
    this.roundRobinCounters.clear();
    this.connectionCounts.clear();
  }
}
