/**
 * Service Router for Multi-Backend Client
 *
 * Routes service requests to the appropriate backend based on:
 * 1. Explicit service mappings (highest priority)
 * 2. Pattern matching (RegExp or string prefix)
 * 3. Default backend (fallback)
 *
 * @module routing/service-router
 */

import type { RoutingConfig, ParsedServiceName } from '../types/multi-backend.js';

/**
 * Service Router implementation
 *
 * Resolves service names to backend names using configurable routing rules.
 *
 * @example
 * ```typescript
 * const router = new ServiceRouter(
 *   {
 *     services: { 'UserService': 'core' },
 *     patterns: [
 *       { pattern: /^storage\./, backend: 'storage' },
 *       { pattern: 'analytics', backend: 'analytics' },
 *     ],
 *   },
 *   'core' // default backend
 * );
 *
 * router.resolve('UserService');       // 'core' (explicit mapping)
 * router.resolve('storage.files');     // 'storage' (pattern match)
 * router.resolve('analytics.events');  // 'analytics' (prefix match)
 * router.resolve('unknown');           // 'core' (default)
 * ```
 */
export class ServiceRouter {
  private config: RoutingConfig;
  private defaultBackend: string;
  private availableBackends: Set<string>;

  /**
   * Create a new ServiceRouter
   *
   * @param config - Routing configuration with patterns and explicit mappings
   * @param defaultBackend - Default backend for unmatched services
   * @param availableBackends - Set of available backend names for validation
   */
  constructor(config: RoutingConfig, defaultBackend: string, availableBackends?: string[]) {
    this.config = config;
    this.defaultBackend = defaultBackend;
    this.availableBackends = new Set(availableBackends || []);
  }

  /**
   * Resolve a service name to a backend name
   *
   * Resolution order:
   * 1. Qualified name (e.g., 'backend.service') - parse and validate
   * 2. Explicit service mapping (highest priority)
   * 3. Pattern matching (in order, first match wins)
   * 4. Default backend (fallback)
   *
   * @param serviceName - Service name to resolve (can be qualified)
   * @returns Backend name to use
   */
  resolve(serviceName: string): string {
    // 1. Check for qualified name (e.g., 'backend.service')
    const parsed = this.parseServiceName(serviceName);
    if (parsed.backend) {
      // Validate backend exists
      if (this.availableBackends.size > 0 && !this.availableBackends.has(parsed.backend)) {
        console.warn(
          `ServiceRouter: Backend '${parsed.backend}' not found in available backends, ` +
            `using default backend '${this.defaultBackend}'`
        );
        return this.defaultBackend;
      }
      return parsed.backend;
    }

    // Use the actual service name for routing
    const actualServiceName = parsed.service;

    // 2. Check explicit service mappings (highest priority)
    if (this.config.services?.[actualServiceName]) {
      return this.config.services[actualServiceName];
    }

    // 3. Check pattern rules (in order)
    if (this.config.patterns) {
      for (const { pattern, backend } of this.config.patterns) {
        if (this.matchPattern(actualServiceName, pattern)) {
          return backend;
        }
      }
    }

    // 4. Fall back to default
    return this.defaultBackend;
  }

  /**
   * Get the actual service name (without backend prefix)
   *
   * @param serviceName - Service name (may be qualified)
   * @returns Actual service name for invocation
   */
  getServiceName(serviceName: string): string {
    return this.parseServiceName(serviceName).service;
  }

  /**
   * Parse a qualified service name into backend and service parts
   *
   * Supports the 'backend.service' naming convention.
   *
   * @param qualifiedName - Potentially qualified service name
   * @returns Parsed service name with optional backend
   *
   * @example
   * ```typescript
   * parseServiceName('core.users')     // { backend: 'core', service: 'users' }
   * parseServiceName('users')          // { service: 'users' }
   * parseServiceName('core.auth.user') // { backend: 'core', service: 'auth.user' }
   * ```
   */
  parseServiceName(qualifiedName: string): ParsedServiceName {
    const parts = qualifiedName.split('.');

    if (parts.length >= 2) {
      const potentialBackend = parts[0]!;

      // Only treat as qualified name if the first part is a known backend
      // or if routing to that backend would make sense
      if (this.availableBackends.has(potentialBackend) || this.config.services?.[qualifiedName] === undefined) {
        // Check if this looks like a qualified name by seeing if the potential
        // backend is in our available backends list
        if (this.availableBackends.size > 0 && this.availableBackends.has(potentialBackend)) {
          return {
            backend: potentialBackend,
            service: parts.slice(1).join('.'),
          };
        }
      }
    }

    return { service: qualifiedName };
  }

  /**
   * Match a service name against a pattern
   *
   * @param serviceName - Service name to match
   * @param pattern - Pattern (string prefix or RegExp)
   * @returns true if the pattern matches
   */
  private matchPattern(serviceName: string, pattern: string | RegExp): boolean {
    if (pattern instanceof RegExp) {
      return pattern.test(serviceName);
    }

    // String pattern: match as prefix or exact match
    return serviceName === pattern || serviceName.startsWith(`${pattern}.`) || serviceName.startsWith(pattern);
  }

  /**
   * Add an explicit service mapping
   *
   * @param serviceName - Service name
   * @param backend - Backend name
   */
  addServiceMapping(serviceName: string, backend: string): void {
    if (!this.config.services) {
      this.config.services = {};
    }
    this.config.services[serviceName] = backend;
  }

  /**
   * Remove an explicit service mapping
   *
   * @param serviceName - Service name to remove
   * @returns true if mapping was removed
   */
  removeServiceMapping(serviceName: string): boolean {
    const mappedBackend = this.config.services?.[serviceName];
    if (mappedBackend !== undefined) {
      delete this.config.services![serviceName];
      return true;
    }
    return false;
  }

  /**
   * Add a routing pattern
   *
   * @param pattern - Pattern to match
   * @param backend - Backend to route to
   */
  addPattern(pattern: string | RegExp, backend: string): void {
    if (!this.config.patterns) {
      this.config.patterns = [];
    }
    this.config.patterns.push({ pattern, backend });
  }

  /**
   * Get the current routing configuration
   */
  getConfig(): Readonly<RoutingConfig> {
    return this.config;
  }

  /**
   * Get the default backend name
   */
  getDefaultBackend(): string {
    return this.defaultBackend;
  }

  /**
   * Set the default backend
   *
   * @param backend - New default backend name
   */
  setDefaultBackend(backend: string): void {
    this.defaultBackend = backend;
  }

  /**
   * Update available backends (for validation)
   *
   * @param backends - Array of available backend names
   */
  setAvailableBackends(backends: string[]): void {
    this.availableBackends = new Set(backends);
  }

  /**
   * Check if a backend is available
   *
   * @param backend - Backend name to check
   * @returns true if available (or if no validation is configured)
   */
  isBackendAvailable(backend: string): boolean {
    if (this.availableBackends.size === 0) {
      return true; // No validation configured
    }
    return this.availableBackends.has(backend);
  }
}
