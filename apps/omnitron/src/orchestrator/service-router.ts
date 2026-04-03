/**
 * Service Router — Exposes child process services on the daemon's Netron
 *
 * Native Netron service publication for cross-process topology.
 *
 * For single-instance processes:
 *   Creates a forwarding proxy service that delegates all calls through
 *   the existing NetronClient → child RPC path.
 *
 * For pool processes:
 *   Creates a routing proxy service that delegates calls through
 *   pool.execute() for P2C load-balanced dispatch.
 *
 * Children connect to the daemon's Unix socket Netron and queryInterface()
 * to get transparent proxies to sibling services.
 */

import 'reflect-metadata';
import type { Netron } from '@omnitron-dev/titan/netron';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { ProcessPool } from '@omnitron-dev/titan-pm';
import { SERVICE_ANNOTATION } from '@omnitron-dev/titan/decorators';

interface ServiceRegistration {
  type: 'single' | 'pool';
  processName: string;
  serviceName: string;
  serviceVersion: string;
  instance: unknown;
}

/**
 * ServiceRouter — wires child process services onto the daemon's Netron.
 *
 * Usage:
 *   const router = new ServiceRouter(daemonNetron, logger);
 *   await router.exposePoolService('ohlcv-aggregator', 'OhlcvAggregator', '1.0.0', pool, ['aggregate5Min', 'aggregateDay']);
 *   await router.exposeSingleService('stream-processor', 'StreamProcessor', '1.0.0', netronClient);
 */
export class ServiceRouter {
  private readonly services = new Map<string, ServiceRegistration>();

  constructor(
    private readonly netron: Netron,
    private readonly logger: ILogger
  ) {}

  /**
   * Expose a pool's service on the daemon Netron.
   * The proxy delegates calls through pool.execute() for load balancing.
   *
   * @param processName - Process name from topology (e.g., 'ohlcv-aggregator')
   * @param serviceName - Netron service name (e.g., 'OhlcvAggregator')
   * @param serviceVersion - Service version (e.g., '1.0.0')
   * @param pool - PM ProcessPool with P2C load balancing
   * @param methodNames - Method names to expose on the proxy
   */
  async exposePoolService(
    processName: string,
    serviceName: string,
    serviceVersion: string,
    pool: ProcessPool<unknown>,
    methodNames: string[]
  ): Promise<void> {
    const qualifiedName = serviceVersion ? `${serviceName}@${serviceVersion}` : serviceName;

    if (this.services.has(qualifiedName)) {
      this.logger.warn({ qualifiedName, processName }, 'Service already registered in router');
      return;
    }

    // Create a dynamic proxy class that delegates to pool.execute()
    const proxyInstance = this.createPoolProxy(pool, serviceName, serviceVersion, methodNames);

    // Expose on daemon's Netron
    await this.netron.peer.exposeService(proxyInstance);

    this.services.set(qualifiedName, {
      type: 'pool',
      processName,
      serviceName,
      serviceVersion,
      instance: proxyInstance,
    });

    this.logger.info(
      { processName, qualifiedName, methods: methodNames.length },
      'Pool service exposed on daemon Netron via ServiceRouter'
    );
  }

  /**
   * Remove a service from the daemon Netron when the source process dies.
   */
  async unexposeService(serviceName: string, serviceVersion?: string): Promise<void> {
    const qualifiedName = serviceVersion ? `${serviceName}@${serviceVersion}` : serviceName;
    const reg = this.services.get(qualifiedName);
    if (!reg) return;

    try {
      await this.netron.peer.unexposeService(qualifiedName);
    } catch {
      // Service may already be gone
    }

    this.services.delete(qualifiedName);
    this.logger.info({ qualifiedName }, 'Service unexposed from daemon Netron');
  }

  /**
   * Clean up all services associated with a process name.
   */
  async cleanupProcess(processName: string): Promise<void> {
    const toRemove: string[] = [];

    for (const [qualifiedName, reg] of this.services) {
      if (reg.processName === processName) {
        toRemove.push(qualifiedName);
      }
    }

    for (const qualifiedName of toRemove) {
      await this.unexposeService(qualifiedName);
    }
  }

  /**
   * Get registered service names for diagnostics.
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get service info for a specific service.
   */
  getService(qualifiedName: string): ServiceRegistration | undefined {
    return this.services.get(qualifiedName);
  }

  /**
   * Create a dynamic proxy instance that delegates all method calls
   * to pool.execute() for P2C load-balanced dispatch.
   *
   * The returned object has @Service metadata attached via Reflect,
   * so Netron's exposeService() treats it as a real service.
   */
  private createPoolProxy(
    pool: ProcessPool<unknown>,
    serviceName: string,
    serviceVersion: string,
    methodNames: string[]
  ): any {
    // Create a plain object with methods that delegate to pool.execute()
    const proto: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

    for (const method of methodNames) {
      proto[method] = async (...args: unknown[]) => {
        return pool.execute(method, ...args);
      };
    }

    // Create a named class so stack traces and Netron introspection show the service name
    const DynamicRouterService = { [serviceName]: class {} }[serviceName]!;
    Object.assign(DynamicRouterService.prototype, proto);

    // Attach @Service metadata so Netron treats this as a real service
    const metadata = {
      name: serviceName,
      version: serviceVersion,
      description: `ServiceRouter proxy for pool '${serviceName}'`,
      methods: new Map<string, any>(),
      properties: new Map<string, any>(),
      events: [],
    };

    // Register each method as public
    for (const method of methodNames) {
      metadata.methods.set(method, {
        name: method,
        type: 'method',
        public: true,
      });
    }

    Reflect.defineMetadata(SERVICE_ANNOTATION, metadata, DynamicRouterService);

    const instance = new DynamicRouterService();
    return instance;
  }
}
