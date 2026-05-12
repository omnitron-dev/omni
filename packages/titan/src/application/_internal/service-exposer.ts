/**
 * Internal collaborator — auto-expose @Service-decorated classes to Netron.
 *
 * After all modules are started, scan every container registration for
 * the `netron:service` metadata stamp left by the `@Service` decorator
 * and call `netron.peer.exposeService` on each instance.
 *
 * Why a dedicated collaborator? The legacy `exposeServicesToNetron`
 * was a 140-line method full of provider-shape probing and noisy
 * defensive logging. Folding it here lets the implementation stay
 * verbose (the probing IS the value — it accommodates `useValue`,
 * `useClass`, and bare-class registrations) without bloating the
 * orchestrator.
 *
 * Single responsibility: discover services + expose them. Returns the
 * count of exposed services. Doesn't know about lifecycle or shutdown.
 *
 * @internal
 */

import 'reflect-metadata';
import {
  type Constructor,
  type Container,
} from '../../nexus/index.js';
import type { Netron } from '../../netron/index.js';
import type { ILogger } from '../../modules/logger/index.js';

interface ServiceMetadata {
  name: string;
  version?: string;
}

interface ServiceInfo {
  serviceClass: Constructor<unknown>;
  serviceMetadata: ServiceMetadata;
}

export class ServiceExposer {
  constructor(
    private readonly container: Container,
    private readonly getLogger: () => ILogger | undefined,
  ) {}

  /**
   * Two-pass exposure:
   *   1. Iterate container registrations and collect classes with the
   *      `netron:service` metadata stamp into a working list. We DON'T
   *      resolve and expose inline because resolution can depend on
   *      services later in the registration order — collecting first
   *      lets the second pass resolve in any order.
   *   2. Resolve each collected service and call `exposeService` on it,
   *      counting successes. Already-exposed services are detected by
   *      the "already exposed" substring in the error message — same
   *      hack the legacy implementation used because the Netron API
   *      doesn't surface a typed conflict error here.
   */
  async expose(netron: Netron): Promise<number> {
    const logger = this.getLogger();
    logger?.debug('Auto-exposing services decorated with @Service to Netron');

    const services: ServiceInfo[] = [];
    for (const [, reg] of this.container.iterateRegistrationsFlat()) {
      try {
        const serviceClass = extractServiceClass(reg.provider);
        if (!serviceClass) continue;

        const metadata = Reflect.getMetadata('netron:service', serviceClass) as ServiceMetadata | undefined;
        if (!metadata) {
          // Diagnostic: a class named *RpcService without the decorator
          // is almost certainly a missed annotation. Surface it loudly.
          if (serviceClass.name && serviceClass.name.includes('RpcService')) {
            logger?.info(
              { className: serviceClass.name, hasMetadata: false },
              'RPC Service class found without @Service metadata',
            );
          }
          continue;
        }
        logger?.info(
          { serviceName: metadata.name, className: serviceClass.name },
          'Found service with @Service decorator',
        );
        services.push({ serviceClass, serviceMetadata: metadata });
      } catch (error) {
        logger?.warn({ error }, 'Error during service discovery');
      }
    }

    logger?.info({ servicesToExposeCount: services.length }, 'Services to expose');

    let exposed = 0;
    for (const { serviceClass, serviceMetadata } of services) {
      try {
        const instance = await this.resolveSafely(serviceClass);
        if (!instance) {
          logger?.info({ serviceName: serviceMetadata.name }, 'Service instance not found for auto-exposure');
          continue;
        }
        try {
          await netron.peer.exposeService(instance);
          exposed++;
          logger?.info(
            { serviceName: serviceMetadata.name, version: serviceMetadata.version },
            'Auto-exposed service to Netron',
          );
        } catch (error) {
          if (error instanceof Error && error.message.includes('already exposed')) {
            logger?.debug({ serviceName: serviceMetadata.name }, 'Service already exposed, skipping');
          } else {
            const errMsg = error instanceof Error ? error.message : String(error);
            const errStack = error instanceof Error ? error.stack : undefined;
            logger?.error(
              { serviceName: serviceMetadata.name, errMsg, errStack },
              'Failed to expose service to Netron',
            );
          }
        }
      } catch (error) {
        logger?.warn({ serviceName: serviceMetadata.name, error }, 'Error during service auto-exposure');
      }
    }

    logger?.info({ exposedCount: exposed }, `Auto-exposed ${exposed} service(s) to Netron`);
    return exposed;
  }

  private async resolveSafely(serviceClass: Constructor<unknown>): Promise<unknown | null> {
    const logger = this.getLogger();
    try {
      const hasService = this.container.has(serviceClass);
      logger?.info(
        { className: serviceClass.name, hasService },
        'Attempting to resolve service',
      );
      if (!hasService) return null;
      const instance = await this.container.resolveAsync(serviceClass);
      logger?.info({ resolved: !!instance }, 'Service resolution result');
      return instance ?? null;
    } catch (error) {
      logger?.info({ className: serviceClass.name, error }, 'Failed to resolve service instance for auto-exposure');
      return null;
    }
  }
}

/**
 * Inspect a registration's `provider` field — which can take shape
 * `Constructor`, `{useClass}`, `{useFactory}`, or `{useValue}` — and
 * return the class to introspect for `@Service` metadata. Returns null
 * when the provider doesn't carry a class (e.g. a primitive-valued
 * useValue or an unsupported shape).
 */
function extractServiceClass(provider: unknown): Constructor<unknown> | null {
  if (!provider) return null;
  if (typeof provider === 'function') return provider as Constructor<unknown>;
  if (typeof provider !== 'object') return null;

  type UseClass = { useClass?: Constructor<unknown> };
  type UseValue = { useValue?: { constructor?: Constructor<unknown> } };

  if ('useClass' in provider) {
    return (provider as UseClass).useClass ?? null;
  }
  if ('useValue' in provider) {
    return (provider as UseValue).useValue?.constructor ?? null;
  }
  return null;
}
