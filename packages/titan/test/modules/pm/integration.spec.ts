/**
 * Process Manager Integration Tests
 *
 * Comprehensive tests for the entire PM system working together
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { ProcessManagerModule } from '../../../src/modules/pm/pm.module.js';
import { LoggerModule } from '../../../src/modules/logger/logger.module.js';
import { ConfigModule } from '../../../src/modules/config/config.module.js';
import {
  Process,
  Public,
  RateLimit,
  Cache,
  HealthCheck,
  Supervisor,
  Child,
  Workflow,
  Stage,
  CircuitBreaker
} from '../../../src/modules/pm/decorators.js';
import { TenantAware } from '../../../src/modules/pm/enterprise/multi-tenancy.js';
import {
  ProcessManager,
  MultiTenancyManager,
  SagaOrchestrator,
  ServiceMeshProxy,
  type ITenantContext
} from '../../../src/modules/pm/index.js';

// ============================================================================
// Test Services
// ============================================================================

@Process({
  name: 'calculator',
  version: '1.0.0',
  health: { enabled: true }
})
class CalculatorService {
  private operations = 0;

  @Public()
  async add(a: number, b: number): Promise<number> {
    this.operations++;
    return a + b;
  }

  @Public()
  async multiply(a: number, b: number): Promise<number> {
    this.operations++;
    return a * b;
  }

  @Public()
  @Cache({ ttl: 60000 })
  async fibonacci(n: number): Promise<number> {
    if (n <= 1) return n;
    return await this.fibonacci(n - 1) + await this.fibonacci(n - 2);
  }

  @HealthCheck()
  async checkHealth() {
    return {
      status: 'healthy' as const,
      checks: [{
        name: 'operations',
        status: 'pass' as const,
        details: { count: this.operations }
      }]
    };
  }
}

@Process()
class DataProcessorService {
  @Public()
  async processData(data: string[]): Promise<string[]> {
    return data.map(item => item.toUpperCase());
  }

  @Public()
  async *streamProcess(count: number): AsyncGenerator<number> {
    for (let i = 0; i < count; i++) {
      yield i * 2;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

@Process()
class NotificationService {
  private notifications: any[] = [];

  @Public()
  @RateLimit({ rps: 5 })
  async send(message: string, recipient: string): Promise<void> {
    this.notifications.push({ message, recipient, timestamp: Date.now() });
  }

  @Public()
  async getNotifications(): Promise<any[]> {
    return this.notifications;
  }
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Process Manager Integration', () => {
  let app: Application;
  let pm: ProcessManager;

  beforeEach(async () => {
    app = await Application.create({
      name: 'test-app',
      imports: [
        ConfigModule.forRoot(),
        LoggerModule.forRoot({ level: 'error' }),
        ProcessManagerModule.forRoot({
          netron: { transport: 'unix' },
          monitoring: { metrics: true }
        })
      ]
    });

    await app.start();
    pm = app.get(ProcessManager);
  });

  afterEach(async () => {
    await pm.shutdown({ force: true });
    await app.stop();
  });

  describe('Basic Process Management', () => {
    it('should spawn and use multiple services', async () => {
      const calculator = await pm.spawn(CalculatorService);
      const processor = await pm.spawn(DataProcessorService);
      const notifier = await pm.spawn(NotificationService);

      // Use calculator
      const sum = await calculator.add(5, 3);
      expect(sum).toBe(8);

      // Use processor
      const processed = await processor.processData(['hello', 'world']);
      expect(processed).toEqual(['HELLO', 'WORLD']);

      // Use notifier
      await notifier.send('Test message', 'user@example.com');
      const notifications = await notifier.getNotifications();
      expect(notifications).toHaveLength(1);
    });

    it('should support service discovery', async () => {
      await pm.spawn(CalculatorService, { name: 'calc-service' });

      const discovered = await pm.discover<CalculatorService>('calc-service');
      expect(discovered).toBeDefined();

      const result = await discovered!.multiply(4, 5);
      expect(result).toBe(20);
    });

    it('should handle streaming methods', async () => {
      const processor = await pm.spawn(DataProcessorService);

      const results: number[] = [];
      for await (const value of processor.streamProcess(5)) {
        results.push(value);
      }

      expect(results).toEqual([0, 2, 4, 6, 8]);
    });
  });

  describe('Process Pools', () => {
    it('should create and use process pools', async () => {
      const pool = await pm.pool(CalculatorService, {
        size: 3,
        strategy: 'round-robin' as any
      });

      // Make parallel requests
      const results = await Promise.all([
        pool.add(1, 2),
        pool.add(3, 4),
        pool.add(5, 6),
        pool.add(7, 8)
      ]);

      expect(results).toEqual([3, 7, 11, 15]);
      expect(pool.size).toBe(3);
    });

    it('should scale pool dynamically', async () => {
      const pool = await pm.pool(DataProcessorService, { size: 2 });

      expect(pool.size).toBe(2);

      await pool.scale(4);
      expect(pool.size).toBe(4);

      await pool.scale(1);
      expect(pool.size).toBe(1);
    });

    it('should collect pool metrics', async () => {
      const pool = await pm.pool(CalculatorService, {
        size: 2,
        metrics: true
      });

      await Promise.all([
        pool.add(1, 1),
        pool.add(2, 2),
        pool.add(3, 3)
      ]);

      const metrics = pool.metrics;
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(3);
      expect(metrics.activeWorkers).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Health Monitoring', () => {
    it('should monitor process health', async () => {
      const calc = await pm.spawn(CalculatorService, {
        health: { enabled: true, interval: 100 }
      });

      // Make some operations
      await calc.add(1, 2);
      await calc.multiply(3, 4);

      // Check health
      const health = await pm.getHealth(calc.__processId);
      expect(health).toBeDefined();
      expect(health?.status).toBe('healthy');
      expect(health?.checks).toHaveLength(1);
    });

    it('should collect process metrics', async () => {
      const calc = await pm.spawn(CalculatorService, {
        observability: { metrics: true }
      });

      await calc.fibonacci(5);

      const metrics = await pm.getMetrics(calc.__processId);
      expect(metrics).toBeDefined();
      expect(metrics?.cpu).toBeGreaterThanOrEqual(0);
      expect(metrics?.memory).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Caching', () => {
    it('should cache method results', async () => {
      const calc = await pm.spawn(CalculatorService);

      // First call - calculates
      const start1 = Date.now();
      const result1 = await calc.fibonacci(10);
      const time1 = Date.now() - start1;

      // Second call - should be cached
      const start2 = Date.now();
      const result2 = await calc.fibonacci(10);
      const time2 = Date.now() - start2;

      expect(result1).toBe(result2);
      // Cached call should be much faster
      expect(time2).toBeLessThan(time1);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const notifier = await pm.spawn(NotificationService);

      // Try to send many notifications quickly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          notifier.send(`Message ${i}`, 'user@example.com')
            .catch(e => e.message)
        );
      }

      const results = await Promise.all(promises);
      const errors = results.filter(r => typeof r === 'string');

      // Some should be rate limited
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

describe('Enterprise Features Integration', () => {
  let app: Application;
  let pm: ProcessManager;

  beforeEach(async () => {
    app = await Application.create({
      name: 'enterprise-test',
      imports: [
        ConfigModule.forRoot(),
        LoggerModule.forRoot({ level: 'error' }),
        ProcessManagerModule.forRoot({
          netron: { transport: 'unix' }
        })
      ]
    });

    await app.start();
    pm = app.get(ProcessManager);
  });

  afterEach(async () => {
    await pm.shutdown({ force: true });
    await app.stop();
  });

  describe('Multi-Tenancy', () => {
    @Process()
    class TenantService {
      private data = new Map<string, Map<string, any>>();

      @Public()
      @TenantAware()
      async store(tenant: ITenantContext, key: string, value: any): Promise<void> {
        if (!this.data.has(tenant.id)) {
          this.data.set(tenant.id, new Map());
        }
        this.data.get(tenant.id)!.set(key, value);
      }

      @Public()
      @TenantAware()
      async retrieve(tenant: ITenantContext, key: string): Promise<any> {
        return this.data.get(tenant.id)?.get(key);
      }
    }

    it('should isolate tenant data', async () => {
      const multiTenancy = new MultiTenancyManager(console as any, {
        enabled: true,
        isolation: 'shared',
        dataPartitioning: true
      });

      await multiTenancy.registerTenant({
        id: 'tenant-a',
        name: 'Company A'
      });

      await multiTenancy.registerTenant({
        id: 'tenant-b',
        name: 'Company B'
      });

      const serviceA = await multiTenancy.createTenantProcess(
        'tenant-a',
        TenantService,
        pm
      );

      const serviceB = await multiTenancy.createTenantProcess(
        'tenant-b',
        TenantService,
        pm
      );

      // Store data for each tenant
      await serviceA.store('secret', 'tenant-a-secret');
      await serviceB.store('secret', 'tenant-b-secret');

      // Verify isolation
      const secretA = await serviceA.retrieve('secret');
      const secretB = await serviceB.retrieve('secret');

      expect(secretA).toBe('tenant-a-secret');
      expect(secretB).toBe('tenant-b-secret');
    });
  });

  describe('Service Mesh', () => {
    it('should apply service mesh features', async () => {
      const calc = await pm.spawn(CalculatorService);

      const meshProxy = new ServiceMeshProxy(calc, {
        circuitBreaker: { threshold: 5 },
        rateLimit: { rps: 10 },
        retry: { attempts: 2 },
        metrics: true
      }, console as any);

      const meshedService = meshProxy.createProxy();

      // Should work normally
      const result = await meshedService.add(10, 20);
      expect(result).toBe(30);

      // Get mesh metrics
      const metrics = meshProxy.getMetrics();
      expect(metrics.service.requests).toBe(1);
      expect(metrics.service.successes).toBe(1);
    });
  });

  describe('Saga Orchestration', () => {
    it('should execute distributed saga', async () => {
      const orchestrator = new SagaOrchestrator(console as any);

      const orderData = { items: ['item1'], payment: { amount: 100 } };
      const results: any = {};

      orchestrator.registerSaga('order-saga', [
        {
          name: 'validate',
          handler: async (data: any) => {
            results.validated = true;
            return { valid: true };
          }
        },
        {
          name: 'process',
          handler: async (validation: any) => {
            results.processed = validation.valid;
            return { orderId: 'order-123' };
          },
          dependsOn: ['validate']
        }
      ]);

      const sagaResult = await orchestrator.execute('order-saga', orderData);

      expect(results.validated).toBe(true);
      expect(results.processed).toBe(true);
      expect(sagaResult.process.orderId).toBe('order-123');
    });
  });
});

describe('Workflow Orchestration', () => {
  let app: Application;
  let pm: ProcessManager;

  beforeEach(async () => {
    app = await Application.create({
      name: 'workflow-test',
      imports: [
        ConfigModule.forRoot(),
        LoggerModule.forRoot({ level: 'error' }),
        ProcessManagerModule.forRoot()
      ]
    });

    await app.start();
    pm = app.get(ProcessManager);
  });

  afterEach(async () => {
    await pm.shutdown({ force: true });
    await app.stop();
  });

  @Workflow()
  class DataPipeline {
    private data: any[] = [];

    @Stage()
    async extract(): Promise<any[]> {
      return [
        { id: 1, value: 'raw1' },
        { id: 2, value: 'raw2' }
      ];
    }

    @Stage({ dependsOn: 'extract' })
    async transform(data: any[]): Promise<any[]> {
      return data.map(item => ({
        ...item,
        value: item.value.toUpperCase(),
        transformed: true
      }));
    }

    @Stage({ dependsOn: 'transform' })
    async load(data: any[]): Promise<void> {
      this.data = data;
    }
  }

  it('should execute workflow stages in order', async () => {
    const pipeline = await pm.workflow(DataPipeline);
    const result = await (pipeline as any).run();

    expect(result.extract).toBeDefined();
    expect(result.transform).toBeDefined();
    expect(result.transform[0].transformed).toBe(true);
    expect(result.transform[0].value).toBe('RAW1');
  });
});

describe('Supervisor Trees', () => {
  let app: Application;
  let pm: ProcessManager;

  beforeEach(async () => {
    app = await Application.create({
      name: 'supervisor-test',
      imports: [
        ConfigModule.forRoot(),
        LoggerModule.forRoot({ level: 'error' }),
        ProcessManagerModule.forRoot()
      ]
    });

    await app.start();
    pm = app.get(ProcessManager);
  });

  afterEach(async () => {
    await pm.shutdown({ force: true });
    await app.stop();
  });

  @Supervisor({
    strategy: 'one-for-one' as any,
    maxRestarts: 3
  })
  class TestSupervisor {
    @Child({ critical: true })
    calculator = CalculatorService;

    @Child({ pool: { size: 2 } })
    processor = DataProcessorService;

    async onChildCrash(child: any, error: Error): Promise<any> {
      console.log('Child crashed:', child.name);
      return 'restart';
    }
  }

  it('should create supervisor with child processes', async () => {
    const supervisor = await pm.supervisor(TestSupervisor);

    expect(supervisor).toBeDefined();

    // Verify processes are running
    const processes = pm.listProcesses();
    expect(processes.length).toBeGreaterThan(0);
  });
});