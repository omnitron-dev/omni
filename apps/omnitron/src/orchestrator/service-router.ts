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
  instance: object;
}

/** Publishes stable sibling-service proxies within one application's Netron. */
export class ServiceRouter {
  private readonly services = new Map<string, ServiceRegistration>();

  constructor(
    private readonly netron: Netron,
    private readonly logger: ILogger,
  ) {}

  async exposePoolService(
    processName: string, serviceName: string, serviceVersion: string,
    pool: ProcessPool<unknown>, methodNames: string[],
  ): Promise<void> {
    const instance = this.createProxy(serviceName, serviceVersion, methodNames,
      (method, args) => pool.execute('callExposedService', serviceName, method, args));
    await this.register({ type: 'pool', processName, serviceName, serviceVersion, instance });
  }

  async exposeChildService(
    processName: string, serviceName: string, serviceVersion: string,
    getProxy: () => { callExposedService?: (...args: unknown[]) => Promise<unknown> } | null,
    methodNames: string[],
  ): Promise<void> {
    const instance = this.createProxy(serviceName, serviceVersion, methodNames, (method, args) => {
      // Resolve on every call: a supervisor can replace this child without
      // invalidating the service definition held by its siblings.
      const child = getProxy();
      if (!child?.callExposedService) {
        throw new Error(`${serviceName}.${method}: the process providing this service is not running`);
      }
      return child.callExposedService(serviceName, method, args);
    });
    await this.register({ type: 'single', processName, serviceName, serviceVersion, instance });
  }

  private async register(registration: ServiceRegistration): Promise<void> {
    const { serviceName, serviceVersion, processName, instance } = registration;
    const qualifiedName = serviceVersion ? `${serviceName}@${serviceVersion}` : serviceName;
    const existing = this.services.get(qualifiedName);
    if (existing) {
      throw new Error(`Topology service '${qualifiedName}' from '${processName}' conflicts with provider '${existing.processName}'`);
    }
    // Track the attempt before awaiting publication: Netron can register the
    // instance before a service-expose subscriber rejects its notification.
    this.services.set(qualifiedName, registration);
    try {
      await this.netron.peer.exposeService(instance);
    } catch (error) {
      if (this.netron.services.get(qualifiedName)?.instance !== instance) this.services.delete(qualifiedName);
      throw error;
    }
    this.logger.info({ processName, qualifiedName }, 'Service exposed in application topology');
  }

  async unexposeService(serviceName: string, serviceVersion?: string): Promise<void> {
    const qualifiedName = serviceVersion ? `${serviceName}@${serviceVersion}` : serviceName;
    const registration = this.services.get(qualifiedName);
    if (!registration) return;
    const current = this.netron.services.get(qualifiedName);
    if (current) {
      if (current.instance !== registration.instance) {
        throw new Error(`Topology service '${qualifiedName}' is no longer owned by this router`);
      }
      await this.netron.peer.unexposeService(qualifiedName);
    }
    this.services.delete(qualifiedName);
    this.logger.info({ qualifiedName }, 'Service removed from application topology');
  }

  async releaseAll(): Promise<void> {
    const failures: unknown[] = [];
    for (const qualifiedName of [...this.services.keys()]) {
      try { await this.unexposeService(qualifiedName); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures,
      `Topology services remain registered: ${[...this.services.keys()].join(', ')}`);
  }

  getServiceNames(): string[] { return [...this.services.keys()]; }

  getService(qualifiedName: string): ServiceRegistration | undefined { return this.services.get(qualifiedName); }

  private createProxy(
    name: string, version: string, methodNames: string[],
    invoke: (method: string, args: unknown[]) => Promise<unknown>,
  ): object {
    const DynamicRouterService = { [name]: class {} }[name]!;
    const metadata = { name, version, description: `Application topology proxy for '${name}'`,
      methods: {} as Record<string, { type: string; arguments: unknown[] }>,
      properties: {}, events: [],
    };
    for (const method of methodNames) {
      Object.defineProperty(DynamicRouterService.prototype, method, {
        value: async (...args: unknown[]) => invoke(method, args),
      });
      metadata.methods[method] = { type: 'Promise', arguments: [] };
    }
    Reflect.defineMetadata(SERVICE_ANNOTATION, metadata, DynamicRouterService);
    return new DynamicRouterService();
  }
}
