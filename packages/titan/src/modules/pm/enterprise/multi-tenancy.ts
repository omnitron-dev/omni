/**
 * Multi-Tenancy Support for Process Manager
 *
 * Provides first-class multi-tenancy with automatic data isolation,
 * tenant-aware routing, and resource partitioning.
 */

import type { ILogger } from '../../logger/logger.types.js';
import { Errors } from '../../../errors/index.js';
import type { ServiceProxy, IProcessPool } from '../types.js';

/**
 * Tenant context interface
 */
export interface ITenantContext {
  id: string;
  name: string;
  tier?: 'free' | 'standard' | 'premium' | 'enterprise';
  metadata?: Record<string, any>;
  dataPartition?: string;
  resourceQuota?: IResourceQuota;
}

/**
 * Resource quota for tenants
 */
export interface IResourceQuota {
  maxProcesses?: number;
  maxMemory?: string;
  maxCpu?: number;
  maxRequests?: number;
  maxStorage?: string;
}

/**
 * Multi-tenancy configuration
 */
export interface IMultiTenancyConfig {
  enabled: boolean;
  isolation: 'strict' | 'shared';
  dataPartitioning: boolean;
  tenantHeader?: string;
  tenantResolver?: (request: any) => Promise<string | null>;
  defaultTenant?: string;
  quotaEnforcement?: boolean;
}

/**
 * Tenant-aware process pool
 */
export interface ITenantProcessPool<T> {
  getTenantProxy(tenantId: string): Promise<IProcessPool<T>>;
  getAllTenants(): string[];
  getTenantMetrics(tenantId: string): Promise<any>;
  evictTenant(tenantId: string): Promise<void>;
}

/**
 * Multi-tenancy manager
 */
export class MultiTenancyManager {
  private tenants = new Map<string, ITenantContext>();
  private tenantProcesses = new Map<string, Map<string, any>>();
  private tenantQuotas = new Map<string, IResourceQuota>();
  private tenantUsage = new Map<string, any>();

  constructor(
    private readonly logger: ILogger,
    private readonly config: IMultiTenancyConfig
  ) {}

  /**
   * Register a tenant
   */
  async registerTenant(tenant: ITenantContext): Promise<void> {
    this.logger.info({ tenant: tenant.id }, 'Registering tenant');

    this.tenants.set(tenant.id, tenant);

    if (tenant.resourceQuota) {
      this.tenantQuotas.set(tenant.id, tenant.resourceQuota);
    }

    // Initialize tenant process map
    this.tenantProcesses.set(tenant.id, new Map());
    this.tenantUsage.set(tenant.id, {
      processes: 0,
      memory: 0,
      cpu: 0,
      requests: 0,
    });
  }

  /**
   * Unregister a tenant
   */
  async unregisterTenant(tenantId: string): Promise<void> {
    this.logger.info({ tenantId }, 'Unregistering tenant');

    // Cleanup tenant processes
    const processes = this.tenantProcesses.get(tenantId);
    if (processes) {
      for (const [, process] of processes) {
        await this.destroyProcess(process);
      }
    }

    this.tenants.delete(tenantId);
    this.tenantProcesses.delete(tenantId);
    this.tenantQuotas.delete(tenantId);
    this.tenantUsage.delete(tenantId);
  }

  /**
   * Get tenant context
   */
  getTenant(tenantId: string): ITenantContext | undefined {
    return this.tenants.get(tenantId);
  }

  /**
   * Create tenant-isolated process
   */
  async createTenantProcess<T>(
    tenantId: string,
    ProcessClass: new (...args: any[]) => T,
    processManager: any
  ): Promise<ServiceProxy<T>> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw Errors.notFound(`Tenant ${tenantId} not found`);
    }

    // Check quota
    if (this.config.quotaEnforcement) {
      await this.checkQuota(tenantId, 'process');
    }

    // Create process with tenant isolation
    const proxy = await this.createIsolatedProcess(tenant, ProcessClass, processManager);

    // Track process
    const processes = this.tenantProcesses.get(tenantId)!;
    processes.set(proxy.__processId, proxy);

    // Update usage
    const usage = this.tenantUsage.get(tenantId);
    usage.processes++;

    return proxy;
  }

  /**
   * Create isolated process for tenant
   */
  private async createIsolatedProcess<T>(
    tenant: ITenantContext,
    ProcessClass: new (...args: any[]) => T,
    processManager: any
  ): Promise<ServiceProxy<T>> {
    const isolation = this.config.isolation;

    if (isolation === 'strict') {
      // Create completely isolated process
      return processManager.spawn(ProcessClass, {
        name: `${ProcessClass.name}-${tenant.id}`,
        env: {
          TENANT_ID: tenant.id,
          TENANT_NAME: tenant.name,
          TENANT_TIER: tenant.tier,
          DATA_PARTITION: tenant.dataPartition,
        },
        security: {
          isolation: 'vm',
          permissions: {
            network: true,
            filesystem: 'read-only',
          },
        },
        memory: {
          limit: tenant.resourceQuota?.maxMemory || '256MB',
        },
      });
    } else {
      // Shared process with tenant context
      const proxy = await processManager.spawn(ProcessClass, {
        name: `${ProcessClass.name}-shared`,
      });

      // Wrap proxy with tenant context
      return this.wrapWithTenantContext(proxy, tenant) as ServiceProxy<T>;
    }
  }

  /**
   * Wrap proxy with tenant context
   */
  private wrapWithTenantContext<T>(proxy: ServiceProxy<T>, tenant: ITenantContext): ServiceProxy<T> {
    return new Proxy(proxy as any, {
      get: (target: any, prop: string | symbol) => {
        const value = target[prop];
        if (typeof value === 'function') {
          return async (...args: any[]) => {
            // Inject tenant context as first argument
            const tenantAwareArgs = [{ __tenant: tenant }, ...args];
            return value.apply(target, tenantAwareArgs);
          };
        }
        return value;
      },
    }) as ServiceProxy<T>;
  }

  /**
   * Check resource quota
   */
  private async checkQuota(tenantId: string, resource: 'process' | 'memory' | 'cpu' | 'requests'): Promise<void> {
    const quota = this.tenantQuotas.get(tenantId);
    if (!quota) return;

    const usage = this.tenantUsage.get(tenantId);
    if (!usage) return;

    switch (resource) {
      case 'process':
        if (quota.maxProcesses && usage.processes >= quota.maxProcesses) {
          throw Errors.notFound(`Tenant ${tenantId} exceeded process quota`);
        }
        break;
      case 'memory':
        if (quota.maxMemory && usage.memory >= this.parseMemory(quota.maxMemory)) {
          throw Errors.notFound(`Tenant ${tenantId} exceeded memory quota`);
        }
        break;
      case 'cpu':
        if (quota.maxCpu && usage.cpu >= quota.maxCpu) {
          throw Errors.notFound(`Tenant ${tenantId} exceeded CPU quota`);
        }
        break;
      case 'requests':
        if (quota.maxRequests && usage.requests >= quota.maxRequests) {
          throw Errors.notFound(`Tenant ${tenantId} exceeded request quota`);
        }
        break;
      default:
        // Unknown resource type, skip check
        break;
    }
  }

  /**
   * Destroy a process
   */
  private async destroyProcess(proxy: any): Promise<void> {
    if ('__destroy' in proxy) {
      await proxy.__destroy();
    }
  }

  /**
   * Parse memory string
   */
  private parseMemory(memory: string): number {
    const match = memory.match(/^(\d+)([KMGT]?)B?$/i);
    if (!match) return 0;

    const [, value, unit] = match;
    if (!value) return 0;
    const num = parseInt(value, 10);

    switch (unit?.toUpperCase()) {
      case 'K':
        return num * 1024;
      case 'M':
        return num * 1024 * 1024;
      case 'G':
        return num * 1024 * 1024 * 1024;
      case 'T':
        return num * 1024 * 1024 * 1024 * 1024;
      default:
        return num;
    }
  }

  /**
   * Get tenant usage statistics
   */
  async getTenantUsage(tenantId: string): Promise<any> {
    return this.tenantUsage.get(tenantId);
  }

  /**
   * Get all tenant statistics
   */
  async getAllTenantStats(): Promise<Map<string, any>> {
    const stats = new Map<string, any>();

    for (const [tenantId, tenant] of this.tenants) {
      const usage = this.tenantUsage.get(tenantId);
      const processes = this.tenantProcesses.get(tenantId);

      stats.set(tenantId, {
        tenant,
        usage,
        processCount: processes?.size || 0,
        quota: this.tenantQuotas.get(tenantId),
      });
    }

    return stats;
  }
}

/**
 * Tenant-aware process pool implementation
 */
export class TenantProcessPool<T> implements ITenantProcessPool<T> {
  private tenantPools = new Map<string, IProcessPool<T>>();

  constructor(
    private readonly ProcessClass: new (...args: any[]) => T,
    private readonly processManager: any,
    private readonly multiTenancyManager: MultiTenancyManager,
    private readonly logger: ILogger
  ) {}

  /**
   * Get tenant-specific proxy
   */
  async getTenantProxy(tenantId: string): Promise<IProcessPool<T>> {
    let pool = this.tenantPools.get(tenantId);

    if (!pool) {
      // Lazy create pool for tenant
      pool = await this.createTenantPool(tenantId);
      this.tenantPools.set(tenantId, pool);
    }

    return pool;
  }

  /**
   * Create pool for tenant
   */
  private async createTenantPool(tenantId: string): Promise<IProcessPool<T>> {
    const tenant = this.multiTenancyManager.getTenant(tenantId);
    if (!tenant) {
      throw Errors.notFound(`Tenant ${tenantId} not found`);
    }

    // Create pool with tenant isolation
    return await this.processManager.pool(this.ProcessClass, {
      size: this.getPoolSizeForTenant(tenant),
      name: `${this.ProcessClass.name}-${tenantId}`,
    });
  }

  /**
   * Determine pool size based on tenant tier
   */
  private getPoolSizeForTenant(tenant: ITenantContext): number {
    switch (tenant.tier) {
      case 'enterprise':
        return 10;
      case 'premium':
        return 5;
      case 'standard':
        return 2;
      case 'free':
        return 1;
      default:
        return 1;
    }
  }

  /**
   * Get all tenant IDs
   */
  getAllTenants(): string[] {
    return Array.from(this.tenantPools.keys());
  }

  /**
   * Get metrics for a tenant
   */
  async getTenantMetrics(tenantId: string): Promise<any> {
    const pool = this.tenantPools.get(tenantId);
    if (!pool) {
      return null;
    }

    return pool.metrics;
  }

  /**
   * Evict tenant from pool
   */
  async evictTenant(tenantId: string): Promise<void> {
    const pool = this.tenantPools.get(tenantId);
    if (pool) {
      await pool.destroy();
      this.tenantPools.delete(tenantId);
    }
  }
}

/**
 * Decorator for tenant-aware methods
 */
export function TenantAware(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: any, ...args: any[]) {
      // Extract tenant context from first argument
      const [context, ...restArgs] = args;

      if (context?.__tenant) {
        // Set tenant context for this execution
        const tenantContext = context.__tenant;

        // Execute with tenant context
        return originalMethod.apply(this, [tenantContext, ...restArgs]);
      }

      // No tenant context, execute normally
      return originalMethod.apply(this, args);
    };
  };
}

/**
 * Decorator to inject tenant context
 */
export function TenantContext(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const existingMetadata = Reflect.getMetadata('tenant:context', target, propertyKey!) || [];
    existingMetadata.push(parameterIndex);
    Reflect.defineMetadata('tenant:context', existingMetadata, target, propertyKey!);
  };
}
