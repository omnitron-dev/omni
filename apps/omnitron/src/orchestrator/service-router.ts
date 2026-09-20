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

    // The daemon's Netron is the source of truth here, NOT `this.services`.
    //
    // `launchTopology` builds a fresh ServiceRouter on every app launch, so
    // after a restart this map is empty while the daemon still holds the
    // registration from the previous launch — bound to a pool whose workers
    // are gone. The guard used to ask the empty map, find nothing, and call
    // `exposeService`, which threw `Service already exposed`. The caller logs
    // that and carries on, so the daemon kept the DEAD registration and every
    // call through the name failed `Socket closed during RPC` — for the life
    // of the daemon, not just until the next tick.
    //
    // Measured on 2026-09-11: pricing's OHLCV aggregation stopped for forty
    // minutes across three restarts and did not recover; `queryInterface` from
    // a fresh client still returned the full method list, and the first call
    // threw. Only `omnitron down && up` cleared it.
    //
    // A new pool for a name must take over: the old one no longer exists.
    await this.takeOverExisting(qualifiedName, processName);

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
   * Expose a SINGLE process's service on the daemon Netron.
   *
   * `topology.expose` was implemented for pools only, and ignored in silence
   * everywhere else: a process declaring it got no registration, no warning,
   * and every consumer naming it in `topology.access` started without a
   * proxy. Measured on priceverse, whose `collector` process is a single
   * process and holds the only objects that know whether the exchange
   * WebSockets are up — so the server process could not ask, and answered
   * `ready: down — exchanges unavailable` while three of them were connected.
   *
   * The same proxy as a pool's, through the same `callExposedService` hop;
   * what differs is only who is asked — one child rather than a pool that
   * balances between several.
   *
   * `getProxy` is a function rather than the proxy itself because a child
   * is replaced on restart: holding the object would route every later call
   * into a dead process.
   */
  async exposeChildService(
    processName: string,
    serviceName: string,
    serviceVersion: string,
    getProxy: () => { callExposedService?: (...args: unknown[]) => Promise<unknown> } | null,
    methodNames: string[]
  ): Promise<void> {
    const qualifiedName = serviceVersion ? `${serviceName}@${serviceVersion}` : serviceName;
    await this.takeOverExisting(qualifiedName, processName);

    const proxyInstance = this.createChildProxy(getProxy, serviceName, serviceVersion, methodNames);
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
      'Child service exposed on daemon Netron via ServiceRouter'
    );
  }

  /**
   * Drop any registration already standing under `qualifiedName`, on the
   * daemon and in this router, so the caller can register in its place.
   *
   * Silent when there is nothing there — that is the ordinary first launch.
   */
  private async takeOverExisting(qualifiedName: string, processName: string): Promise<void> {
    const known = this.services.has(qualifiedName);
    try {
      await this.netron.peer.unexposeService(qualifiedName);
      this.logger.info(
        { qualifiedName, processName, knownToThisRouter: known },
        'Replaced an existing registration for this service name'
      );
    } catch {
      // Nothing was registered under that name — the normal first-launch path.
    }
    this.services.delete(qualifiedName);
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
   * Release every service this router registered on the daemon's Netron.
   *
   * The router is built fresh per app launch and torn down whole, so this is
   * the teardown — it belongs here rather than being spelled out by each
   * caller. `stopApp` had the loop inline; the stale-duplicate path in
   * `registerApp` had nothing at all, and dropped the handle with its
   * registrations still live on the daemon. A name that the next launch
   * re-exposes is rescued by `takeOverExisting`; one it does not stays
   * advertised, bound to a pool whose workers are gone, for the life of the
   * daemon.
   *
   * Best-effort by design: a name that is already gone is the outcome we
   * wanted, and a failure here must not stop an app from being stopped.
   *
   * This replaces `cleanupProcess(processName)`, which had no caller and no
   * correct one: one child of a pool crashing does not mean the service is
   * gone — the other workers still serve it — so per-process granularity
   * would have deregistered a service that still works.
   */
  async releaseAll(): Promise<void> {
    for (const qualifiedName of [...this.services.keys()]) {
      try {
        await this.unexposeService(qualifiedName);
      } catch (err) {
        this.logger.debug(
          { qualifiedName, error: (err as Error).message },
          'Service was already gone from the daemon Netron',
        );
      }
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
  /**
   * The same shape as `createPoolProxy`, asking one child.
   *
   * Every note on that method applies here — the `callExposedService` hop,
   * the plain-object `methods`/`properties` metadata that `Interface`
   * indexes, the `{ type, arguments }` entries — and is not repeated; what
   * this adds is that the child is looked up per call, because a restart
   * replaces it.
   */
  private createChildProxy(
    getProxy: () => { callExposedService?: (...args: unknown[]) => Promise<unknown> } | null,
    serviceName: string,
    serviceVersion: string,
    methodNames: string[]
  ): any {
    const proto: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

    for (const method of methodNames) {
      proto[method] = async (...args: unknown[]) => {
        const child = getProxy();
        if (!child?.callExposedService) {
          // The process is down or between restarts. Said as an error the
          // caller can read, rather than a `TypeError` naming a property.
          throw new Error(
            `${serviceName}.${method}: the process providing this service is not running`
          );
        }
        return child.callExposedService(serviceName, method, args);
      };
    }

    const DynamicRouterService = { [serviceName]: class {} }[serviceName]!;
    Object.assign(DynamicRouterService.prototype, proto);

    const metadata = {
      name: serviceName,
      version: serviceVersion,
      description: `ServiceRouter proxy for process '${serviceName}'`,
      methods: {} as Record<string, { type: string; arguments: unknown[] }>,
      properties: {} as Record<string, unknown>,
      events: [],
    };
    for (const method of methodNames) {
      metadata.methods[method] = { type: 'Promise', arguments: [] };
    }
    Reflect.defineMetadata(SERVICE_ANNOTATION, metadata, DynamicRouterService);

    return new DynamicRouterService();
  }

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
