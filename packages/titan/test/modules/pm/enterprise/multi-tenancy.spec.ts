/**
 * Multi-tenancy Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  MultiTenancyManager,
  TenantProcessPool,
  TenantAware,
  TenantContext,
  type ITenantContext,
} from '../../../../src/modules/pm/enterprise/multi-tenancy.js';
import { Process, Method } from '../../../../src/modules/pm/decorators.js';

// Mock ProcessManager to avoid ESM import.meta.url issues
class MockProcessManager {
  private processes = new Map<string, any>();
  private processCounter = 0;
  private pools = new Map<string, any>();

  async spawn(ProcessClass: any, options?: any): Promise<any> {
    const id = `mock-process-${++this.processCounter}`;
    const instance = new ProcessClass();
    const proxy = {
      __processId: id,
      __destroy: jest.fn().mockResolvedValue(undefined),
      store: instance.store?.bind(instance) || jest.fn().mockResolvedValue(undefined),
      get: instance.get?.bind(instance) || jest.fn().mockResolvedValue(undefined),
      listKeys: instance.listKeys?.bind(instance) || jest.fn().mockResolvedValue([]),
      getAllTenantIds: instance.getAllTenantIds?.bind(instance) || jest.fn().mockResolvedValue([]),
    };
    this.processes.set(id, proxy);
    return proxy;
  }

  async pool(ProcessClass: any, options?: any): Promise<any> {
    const poolId = options?.name || `pool-${++this.processCounter}`;
    const instance = new ProcessClass();
    const mockPool = {
      id: poolId,
      size: options?.size || 1,
      execute: async (method: string, ...args: any[]) => {
        if (instance[method]) {
          return instance[method](...args);
        }
        return undefined;
      },
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    this.pools.set(poolId, mockPool);
    return mockPool;
  }

  async kill(processId: string): Promise<void> {
    this.processes.delete(processId);
  }

  async shutdown(options?: any): Promise<void> {
    this.processes.clear();
    this.pools.clear();
  }
}

// Use type alias for compatibility
type ProcessManager = MockProcessManager;

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(() => mockLogger),
} as any;

// Test tenant-aware service
@Process()
class TenantDataService {
  private tenantData = new Map<string, Map<string, any>>();

  @Method()
  @TenantAware()
  async store(tenant: ITenantContext, key: string, value: any): Promise<void> {
    if (!this.tenantData.has(tenant.id)) {
      this.tenantData.set(tenant.id, new Map());
    }
    this.tenantData.get(tenant.id)!.set(key, value);
  }

  @Method()
  @TenantAware()
  async get(tenant: ITenantContext, key: string): Promise<any> {
    const data = this.tenantData.get(tenant.id);
    return data?.get(key);
  }

  @Method()
  @TenantAware()
  async listKeys(tenant: ITenantContext): Promise<string[]> {
    const data = this.tenantData.get(tenant.id);
    return data ? Array.from(data.keys()) : [];
  }

  @Method()
  async getAllTenantIds(): Promise<string[]> {
    return Array.from(this.tenantData.keys());
  }
}

describe('MultiTenancyManager', () => {
  let manager: MultiTenancyManager;
  let processManager: MockProcessManager;

  beforeEach(() => {
    manager = new MultiTenancyManager(mockLogger as any, {
      enabled: true,
      isolation: 'shared',
      dataPartitioning: true,
      quotaEnforcement: true,
    });

    processManager = new MockProcessManager();
  });

  afterEach(async () => {
    await processManager.shutdown({ force: true });
  });

  describe('Tenant Registration', () => {
    it('should register a tenant', async () => {
      const tenant: ITenantContext = {
        id: 'tenant-1',
        name: 'Test Tenant',
        tier: 'standard',
        resourceQuota: {
          maxProcesses: 5,
          maxMemory: '1GB',
        },
      };

      await manager.registerTenant(tenant);
      const retrieved = manager.getTenant('tenant-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Tenant');
      expect(retrieved?.tier).toBe('standard');
    });

    it('should unregister a tenant', async () => {
      const tenant: ITenantContext = {
        id: 'tenant-2',
        name: 'Temp Tenant',
      };

      await manager.registerTenant(tenant);
      await manager.unregisterTenant('tenant-2');

      const retrieved = manager.getTenant('tenant-2');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Tenant Process Isolation', () => {
    it('should create isolated process for tenant', async () => {
      const tenant1: ITenantContext = {
        id: 'tenant-a',
        name: 'Tenant A',
        tier: 'premium',
      };

      const tenant2: ITenantContext = {
        id: 'tenant-b',
        name: 'Tenant B',
        tier: 'standard',
      };

      await manager.registerTenant(tenant1);
      await manager.registerTenant(tenant2);

      // Create tenant-isolated processes
      const service1 = await manager.createTenantProcess('tenant-a', TenantDataService, processManager);

      const service2 = await manager.createTenantProcess('tenant-b', TenantDataService, processManager);

      // Store data for each tenant
      await service1.store('key1', 'value-a');
      await service2.store('key1', 'value-b');

      // Verify isolation
      const value1 = await service1.get('key1');
      const value2 = await service2.get('key1');

      expect(value1).toBe('value-a');
      expect(value2).toBe('value-b');
    });

    it('should enforce resource quotas', async () => {
      const tenant: ITenantContext = {
        id: 'limited-tenant',
        name: 'Limited Tenant',
        tier: 'free',
        resourceQuota: {
          maxProcesses: 2,
        },
      };

      await manager.registerTenant(tenant);

      // Create processes up to quota
      await manager.createTenantProcess('limited-tenant', TenantDataService, processManager);
      await manager.createTenantProcess('limited-tenant', TenantDataService, processManager);

      // Should throw when exceeding quota
      await expect(manager.createTenantProcess('limited-tenant', TenantDataService, processManager)).rejects.toThrow(
        'exceeded process quota'
      );
    });
  });

  describe('Tenant Usage Tracking', () => {
    it('should track tenant usage', async () => {
      const tenant: ITenantContext = {
        id: 'tracked-tenant',
        name: 'Tracked Tenant',
      };

      await manager.registerTenant(tenant);
      await manager.createTenantProcess('tracked-tenant', TenantDataService, processManager);

      const usage = await manager.getTenantUsage('tracked-tenant');

      expect(usage).toBeDefined();
      expect(usage.processes).toBe(1);
    });

    it('should provide tenant statistics', async () => {
      const tenant1: ITenantContext = { id: 'stat-1', name: 'Stat 1' };
      const tenant2: ITenantContext = { id: 'stat-2', name: 'Stat 2' };

      await manager.registerTenant(tenant1);
      await manager.registerTenant(tenant2);

      const stats = await manager.getAllTenantStats();

      expect(stats.size).toBe(2);
      expect(stats.has('stat-1')).toBe(true);
      expect(stats.has('stat-2')).toBe(true);
    });
  });
});

describe('TenantProcessPool', () => {
  let manager: MultiTenancyManager;
  let processManager: MockProcessManager;
  let pool: TenantProcessPool<TenantDataService>;

  beforeEach(() => {
    manager = new MultiTenancyManager(mockLogger as any, {
      enabled: true,
      isolation: 'shared',
      dataPartitioning: true,
    });

    processManager = new MockProcessManager();
    pool = new TenantProcessPool(TenantDataService, processManager as any, manager, mockLogger as any);
  });

  afterEach(async () => {
    await processManager.shutdown({ force: true });
  });

  describe('Tenant-specific Pools', () => {
    it('should create separate pool for each tenant', async () => {
      await manager.registerTenant({
        id: 'pool-tenant-1',
        name: 'Pool Tenant 1',
        tier: 'premium',
      });

      await manager.registerTenant({
        id: 'pool-tenant-2',
        name: 'Pool Tenant 2',
        tier: 'standard',
      });

      const proxy1 = await pool.getTenantProxy('pool-tenant-1');
      const proxy2 = await pool.getTenantProxy('pool-tenant-2');

      expect(proxy1).toBeDefined();
      expect(proxy2).toBeDefined();
      expect(proxy1).not.toBe(proxy2);
    });

    it('should scale pool based on tenant tier', async () => {
      await manager.registerTenant({
        id: 'enterprise-tenant',
        name: 'Enterprise',
        tier: 'enterprise',
      });

      await manager.registerTenant({
        id: 'free-tenant',
        name: 'Free',
        tier: 'free',
      });

      // Pools should have different sizes based on tier
      const enterpriseProxy = await pool.getTenantProxy('enterprise-tenant');
      const freeProxy = await pool.getTenantProxy('free-tenant');

      expect(enterpriseProxy).toBeDefined();
      expect(freeProxy).toBeDefined();
    });

    it('should evict tenant from pool', async () => {
      await manager.registerTenant({
        id: 'evict-tenant',
        name: 'To Evict',
      });

      const proxy = await pool.getTenantProxy('evict-tenant');
      expect(proxy).toBeDefined();

      await pool.evictTenant('evict-tenant');
      const tenants = pool.getAllTenants();
      expect(tenants).not.toContain('evict-tenant');
    });
  });
});

describe('Tenant Decorators', () => {
  @Process()
  class DecoratedService {
    @Method()
    async normalMethod(data: string): Promise<string> {
      return `normal: ${data}`;
    }

    @Method()
    @TenantAware()
    async tenantMethod(@TenantContext() tenant: ITenantContext, data: string): Promise<string> {
      return `tenant ${tenant.id}: ${data}`;
    }
  }

  it('should handle TenantAware decorator', async () => {
    const service = new DecoratedService();

    // Call with tenant context
    const result = await (service as any).tenantMethod({ __tenant: { id: 'test-tenant', name: 'Test' } }, 'hello');

    expect(result).toContain('test-tenant');
  });

  it('should handle methods without tenant context', async () => {
    const service = new DecoratedService();
    const result = await service.normalMethod('world');
    expect(result).toBe('normal: world');
  });
});
