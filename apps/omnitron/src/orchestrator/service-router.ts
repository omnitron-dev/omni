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

    // Route through the bootstrap process's `callExposedService` hop rather
    // than calling `pool.execute(method)` directly. The pool's own PM service
    // is `BootstrapApp`, so a direct call asks that class for a method it has
    // never had, and the caller gets "Unknown member" naming a service it did
    // not call.
    for (const method of methodNames) {
      proto[method] = async (...args: unknown[]) =>
        pool.execute('callExposedService', serviceName, method, args);
    }

    // Create a named class so stack traces and Netron introspection show the service name
    const DynamicRouterService = { [serviceName]: class {} }[serviceName]!;
    Object.assign(DynamicRouterService.prototype, proto);

    // Attach @Service metadata so Netron treats this as a real service.
    //
    // `methods` and `properties` are PLAIN OBJECTS keyed by member name,
    // matching what Titan's own @Service decorator builds — `Interface`
    // resolves every call through `$def.meta.methods[prop]`, an object index.
    // These were `Map`s, which index to `undefined` for every name: the
    // service registered, `queryInterface` succeeded, the proxy looked
    // healthy, and the first call answered "Unknown member: 'x' is not
    // defined in the service interface". Every pool service exposed through
    // this router was unreachable that way, and the daemon's own log said it
    // had exposed N methods, because it counted the names it was given rather
    // than the definition it produced.
    //
    // Each entry carries `{ type, arguments }` for the same reason. Parameter
    // types are not recoverable from a discovered method name, so the argument
    // list is empty — Netron does not validate arity on the caller side.
    const metadata = {
      name: serviceName,
      version: serviceVersion,
      description: `ServiceRouter proxy for pool '${serviceName}'`,
      methods: {} as Record<string, { type: string; arguments: unknown[] }>,
      properties: {} as Record<string, unknown>,
      events: [],
    };

    for (const method of methodNames) {
      metadata.methods[method] = { type: 'Promise', arguments: [] };
    }

    Reflect.defineMetadata(SERVICE_ANNOTATION, metadata, DynamicRouterService);

    const instance = new DynamicRouterService();
    return instance;
  }
}
