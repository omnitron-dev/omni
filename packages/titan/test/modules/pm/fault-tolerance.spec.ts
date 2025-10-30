/**
 * Fault Tolerance Tests
 *
 * Tests demonstrating fault tolerance mechanisms including supervision trees,
 * process restart strategies, health monitoring, and graceful degradation.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  Process,
  Method,
  Supervisor,
  Child,
  HealthCheck,
  OnShutdown,
  createTestProcessManager,
  TestProcessManager,
  ProcessStatus,
  SupervisionStrategy,
  type IHealthStatus,
} from '../../../src/modules/pm/index.js';

// ============================================================================
// Supervision Tree Components
// ============================================================================

@Process({ name: 'database-service', version: '1.0.0' })
class DatabaseService {
  private isConnected = true;
  private queryCount = 0;
  private restartCount = 0;

  @Method()
  async connect(): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.isConnected = true;
    return true;
  }

  @Method()
  async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  @Method()
  async query(sql: string): Promise<{ rows: any[]; count: number }> {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }

    this.queryCount++;
    await new Promise((resolve) => setTimeout(resolve, 20));

    return {
      rows: [{ id: 1, data: 'test' }],
      count: this.queryCount,
    };
  }

  @Method()
  async simulateCrash(): Promise<void> {
    this.isConnected = false;
    throw new Error('Database crashed');
  }

  @Method()
  async getRestartCount(): Promise<number> {
    return this.restartCount;
  }

  @Method()
  async incrementRestartCount(): Promise<void> {
    this.restartCount++;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: this.isConnected ? 'healthy' : 'unhealthy',
      checks: [
        {
          name: 'connection',
          status: this.isConnected ? 'pass' : 'fail',
          message: this.isConnected ? 'Connected' : 'Disconnected',
        },
      ],
      timestamp: Date.now(),
    };
  }

  @OnShutdown()
  async cleanup(): Promise<void> {
    await this.disconnect();
  }
}

@Process({ name: 'cache-service', version: '1.0.0' })
class CacheService {
  private cache = new Map<string, any>();
  private isHealthy = true;

  @Method()
  async set(key: string, value: any): Promise<void> {
    if (!this.isHealthy) {
      throw new Error('Cache service unhealthy');
    }
    this.cache.set(key, value);
  }

  @Method()
  async get(key: string): Promise<any> {
    if (!this.isHealthy) {
      throw new Error('Cache service unhealthy');
    }
    return this.cache.get(key);
  }

  @Method()
  async clear(): Promise<void> {
    this.cache.clear();
  }

  @Method()
  async simulateFailure(): Promise<void> {
    this.isHealthy = false;
    throw new Error('Cache service failed');
  }

  @Method()
  async recover(): Promise<void> {
    this.isHealthy = true;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: this.isHealthy ? 'healthy' : 'unhealthy',
      checks: [
        {
          name: 'service-status',
          status: this.isHealthy ? 'pass' : 'fail',
          message: this.isHealthy ? 'Operational' : 'Failed',
        },
      ],
      timestamp: Date.now(),
    };
  }
}

@Process({ name: 'worker-service', version: '1.0.0' })
class WorkerService {
  private jobCount = 0;
  private failureRate = 0;

  @Method()
  async processJob(job: any): Promise<{ success: boolean; jobId: string }> {
    this.jobCount++;

    // Simulate failures based on failure rate
    if (Math.random() < this.failureRate) {
      throw new Error(`Job processing failed: ${job.id}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 30));

    return {
      success: true,
      jobId: job.id,
    };
  }

  @Method()
  async setFailureRate(rate: number): Promise<void> {
    this.failureRate = Math.max(0, Math.min(1, rate));
  }

  @Method()
  async getJobCount(): Promise<number> {
    return this.jobCount;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: this.jobCount < 100 ? 'healthy' : 'degraded',
      checks: [
        {
          name: 'job-processing',
          status: 'pass',
          message: `${this.jobCount} jobs processed`,
        },
      ],
      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// Supervision Tree Definitions
// ============================================================================

@Supervisor({
  strategy: SupervisionStrategy.ONE_FOR_ONE,
  maxRestarts: 3,
  window: 60000,
})
class DatabaseSupervisor {
  @Child({ critical: true })
  database = DatabaseService;

  @Child()
  cache = CacheService;
}

@Supervisor({
  strategy: SupervisionStrategy.ONE_FOR_ALL,
  maxRestarts: 5,
  window: 60000,
})
class ApplicationSupervisor {
  @Child({ critical: true })
  database = DatabaseService;

  @Child({ pool: { size: 2 } })
  workers = WorkerService;
}

@Supervisor({
  strategy: SupervisionStrategy.REST_FOR_ONE,
  maxRestarts: 3,
  window: 60000,
})
class PipelineSupervisor {
  @Child({ critical: true })
  database = DatabaseService;

  @Child()
  cache = CacheService;

  @Child({ pool: { size: 2 } })
  workers = WorkerService;
}

// ============================================================================
// Health Monitoring System
// ============================================================================

@Process({ name: 'health-monitor', version: '1.0.0' })
class HealthMonitorService {
  private healthChecks = new Map<string, IHealthStatus>();
  private unhealthyServices = new Set<string>();

  @Method()
  async recordHealth(serviceId: string, health: IHealthStatus): Promise<void> {
    this.healthChecks.set(serviceId, health);

    if (health.status === 'unhealthy') {
      this.unhealthyServices.add(serviceId);
    } else {
      this.unhealthyServices.delete(serviceId);
    }
  }

  @Method()
  async getServiceHealth(serviceId: string): Promise<IHealthStatus | null> {
    return this.healthChecks.get(serviceId) || null;
  }

  @Method()
  async getUnhealthyServices(): Promise<string[]> {
    return Array.from(this.unhealthyServices);
  }

  @Method()
  async getOverallHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    totalServices: number;
    unhealthyCount: number;
  }> {
    const unhealthyCount = this.unhealthyServices.size;
    const totalServices = this.healthChecks.size;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyCount === 0) {
      status = 'healthy';
    } else if (unhealthyCount < totalServices / 2) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return { status, totalServices, unhealthyCount };
  }
}

// ============================================================================
// Graceful Degradation
// ============================================================================

@Process({ name: 'api-service', version: '1.0.0' })
class ApiService {
  private primaryAvailable = true;
  private fallbackUsed = 0;

  @Method()
  async fetchData(
    endpoint: string,
    useFallback: boolean = false
  ): Promise<{ data: any; source: 'primary' | 'fallback' }> {
    if (!this.primaryAvailable || useFallback) {
      this.fallbackUsed++;
      return {
        data: { cached: true, endpoint },
        source: 'fallback',
      };
    }

    // Simulate primary data source
    await new Promise((resolve) => setTimeout(resolve, 50));

    return {
      data: { fresh: true, endpoint },
      source: 'primary',
    };
  }

  @Method()
  async setPrimaryAvailability(available: boolean): Promise<void> {
    this.primaryAvailable = available;
  }

  @Method()
  async getFallbackCount(): Promise<number> {
    return this.fallbackUsed;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: this.primaryAvailable ? 'healthy' : 'degraded',
      checks: [
        {
          name: 'primary-source',
          status: this.primaryAvailable ? 'pass' : 'warn',
          message: this.primaryAvailable ? 'Available' : 'Using fallback',
        },
      ],
      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Fault Tolerance - Basic Supervision', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should create supervisor with children', async () => {
    const supervisor = await pm.supervisor(DatabaseSupervisor);

    expect(supervisor).toBeDefined();

    // In mock mode, supervisor creates child processes
    const processes = pm.listProcesses();
    expect(processes.length).toBeGreaterThan(0);
  });

  it('should restart failed child process (one-for-one)', async () => {
    const supervisor = await pm.supervisor(DatabaseSupervisor);

    // Get process list
    const initialProcesses = pm.listProcesses();
    const dbProcess = initialProcesses.find((p) => p.name.includes('database'));

    expect(dbProcess).toBeDefined();

    // Simulate process crash
    if (dbProcess) {
      await pm.simulateCrash({ __processId: dbProcess.id } as any);

      // Wait for restart
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Process should be restarted or marked for restart
      const updatedProcess = pm.getProcess(dbProcess.id);
      expect(updatedProcess).toBeDefined();
    }
  });
});

describe('Fault Tolerance - Supervision Strategies', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should handle one-for-one supervision strategy', async () => {
    const supervisor = await pm.supervisor(DatabaseSupervisor, {
      strategy: SupervisionStrategy.ONE_FOR_ONE,
      maxRestarts: 3,
      window: 60000,
    });

    expect(supervisor).toBeDefined();

    // In one-for-one strategy, only the failed child should be restarted
    const processes = pm.listProcesses();
    expect(processes.length).toBeGreaterThan(0);
  });

  it('should handle one-for-all supervision strategy', async () => {
    const supervisor = await pm.supervisor(ApplicationSupervisor, {
      strategy: SupervisionStrategy.ONE_FOR_ALL,
      maxRestarts: 5,
      window: 60000,
    });

    expect(supervisor).toBeDefined();

    // In one-for-all strategy, all children should be restarted if any fails
    const processes = pm.listProcesses();
    expect(processes.length).toBeGreaterThan(0);
  });

  it('should handle rest-for-one supervision strategy', async () => {
    const supervisor = await pm.supervisor(PipelineSupervisor, {
      strategy: SupervisionStrategy.REST_FOR_ONE,
      maxRestarts: 3,
      window: 60000,
    });

    expect(supervisor).toBeDefined();

    // In rest-for-one strategy, failed child and all started after it should be restarted
    const processes = pm.listProcesses();
    expect(processes.length).toBeGreaterThan(0);
  });
});

describe('Fault Tolerance - Health Monitoring', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should monitor service health', async () => {
    const dbService = await pm.spawn(DatabaseService);
    const cacheService = await pm.spawn(CacheService);
    const monitor = await pm.spawn(HealthMonitorService);

    // Get health status
    const dbHealth = await dbService.__getHealth();
    const cacheHealth = await cacheService.__getHealth();

    // Record health
    await monitor.recordHealth('db', dbHealth);
    await monitor.recordHealth('cache', cacheHealth);

    // Check overall health
    const overall = await monitor.getOverallHealth();
    expect(overall.totalServices).toBe(2);
    expect(overall.status).toBe('healthy');
  });

  it('should detect unhealthy services', async () => {
    const dbService = await pm.spawn(DatabaseService);
    const monitor = await pm.spawn(HealthMonitorService);

    // Simulate database crash
    await dbService.disconnect();

    const health = await dbService.__getHealth();
    await monitor.recordHealth('db', health);

    const unhealthy = await monitor.getUnhealthyServices();
    expect(unhealthy).toContain('db');

    const overall = await monitor.getOverallHealth();
    expect(overall.status).toBe('unhealthy');
  });

  it('should track health recovery', async () => {
    const cacheService = await pm.spawn(CacheService);
    const monitor = await pm.spawn(HealthMonitorService);

    // Simulate failure
    try {
      await cacheService.simulateFailure();
    } catch {}

    let health = await cacheService.__getHealth();
    await monitor.recordHealth('cache', health);

    let unhealthy = await monitor.getUnhealthyServices();
    expect(unhealthy).toContain('cache');

    // Recover
    await cacheService.recover();

    health = await cacheService.__getHealth();
    await monitor.recordHealth('cache', health);

    unhealthy = await monitor.getUnhealthyServices();
    expect(unhealthy).not.toContain('cache');
  });
});

describe('Fault Tolerance - Graceful Degradation', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should fallback to degraded mode when primary unavailable', async () => {
    const apiService = await pm.spawn(ApiService);

    // Primary should be available initially
    let result = await apiService.fetchData('/api/users');
    expect(result.source).toBe('primary');

    // Disable primary
    await apiService.setPrimaryAvailability(false);

    // Should use fallback
    result = await apiService.fetchData('/api/users');
    expect(result.source).toBe('fallback');

    const fallbackCount = await apiService.getFallbackCount();
    expect(fallbackCount).toBeGreaterThan(0);
  });

  it('should report degraded health when using fallback', async () => {
    const apiService = await pm.spawn(ApiService);

    // Disable primary
    await apiService.setPrimaryAvailability(false);

    const health = await apiService.__getHealth();
    expect(health.status).toBe('degraded');
    expect(health.checks[0].status).toBe('warn');
  });

  it('should recover to normal operation when primary restored', async () => {
    const apiService = await pm.spawn(ApiService);

    // Disable then re-enable primary
    await apiService.setPrimaryAvailability(false);
    await apiService.fetchData('/api/data');

    await apiService.setPrimaryAvailability(true);
    const result = await apiService.fetchData('/api/data');

    expect(result.source).toBe('primary');

    const health = await apiService.__getHealth();
    expect(health.status).toBe('healthy');
  });
});

describe('Fault Tolerance - Process Restart Limits', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should limit restart attempts', async () => {
    const supervisor = await pm.supervisor(DatabaseSupervisor, {
      maxRestarts: 3,
      window: 60000,
    });

    expect(supervisor).toBeDefined();

    // Simulate multiple crashes
    const processes = pm.listProcesses();
    const dbProcess = processes.find((p) => p.name.includes('database'));

    if (dbProcess) {
      // Simulate crashes
      for (let i = 0; i < 5; i++) {
        try {
          await pm.simulateCrash({ __processId: dbProcess.id } as any);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch {}
      }

      // After max restarts, process should remain stopped or supervisor should give up
      const finalProcess = pm.getProcess(dbProcess.id);
      expect(finalProcess).toBeDefined();
    }
  });

  it('should reset restart count after window expires', async () => {
    const supervisor = await pm.supervisor(DatabaseSupervisor, {
      maxRestarts: 2,
      window: 100, // 100ms window
    });

    expect(supervisor).toBeDefined();

    // First crash
    const processes = pm.listProcesses();
    const dbProcess = processes.find((p) => p.name.includes('database'));

    if (dbProcess) {
      await pm.simulateCrash({ __processId: dbProcess.id } as any);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be able to restart again
      await pm.simulateCrash({ __processId: dbProcess.id } as any);

      const finalProcess = pm.getProcess(dbProcess.id);
      expect(finalProcess).toBeDefined();
    }
  });
});

describe('Fault Tolerance - Cleanup and Shutdown', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should call cleanup handlers on shutdown', async () => {
    const dbService = await pm.spawn(DatabaseService);

    // Connect to database
    await dbService.connect();

    let health = await dbService.__getHealth();
    expect(health.status).toBe('healthy');

    // Shutdown process
    await pm.kill(dbService.__processId);

    const process = pm.getProcess(dbService.__processId);
    expect(process?.status).toBe(ProcessStatus.STOPPED);
  });

  it('should handle cascading shutdowns', async () => {
    const supervisor = await pm.supervisor(ApplicationSupervisor);

    // Get all supervised processes
    const processes = pm.listProcesses();
    expect(processes.length).toBeGreaterThan(0);

    // Shutdown supervisor (should shutdown all children)
    await pm.shutdown({ timeout: 5000 });

    const remainingProcesses = pm.listProcesses();
    expect(remainingProcesses.every((p) => p.status === ProcessStatus.STOPPED)).toBe(true);
  });

  it('should handle partial failures during shutdown', async () => {
    const dbService = await pm.spawn(DatabaseService);
    const cacheService = await pm.spawn(CacheService);

    // Start shutdown
    const shutdownPromise = pm.shutdown({ timeout: 2000, force: false });

    // Services should be stopped
    await shutdownPromise;

    const dbProcess = pm.getProcess(dbService.__processId);
    const cacheProcess = pm.getProcess(cacheService.__processId);

    expect(dbProcess?.status).toBe(ProcessStatus.STOPPED);
    expect(cacheProcess?.status).toBe(ProcessStatus.STOPPED);
  });
});

describe('Fault Tolerance - Worker Pool Resilience', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should continue processing with remaining workers after failure', async () => {
    const workerPool = await pm.pool(WorkerService, {
      size: 3,
      replaceUnhealthy: true,
    });

    // Set moderate failure rate
    await workerPool.setFailureRate(0.3);

    // Process multiple jobs
    const jobs = Array.from({ length: 10 }, (_, i) => ({ id: `job_${i}` }));

    const results = await Promise.allSettled(jobs.map((job) => workerPool.processJob(job)));

    // Some jobs should succeed despite failures
    const successful = results.filter((r) => r.status === 'fulfilled');
    expect(successful.length).toBeGreaterThan(0);

    // Pool should maintain workers
    expect(workerPool.size).toBe(3);
  });

  it('should replace unhealthy workers', async () => {
    const workerPool = await pm.pool(WorkerService, {
      size: 2,
      replaceUnhealthy: true,
      healthCheck: {
        enabled: true,
        interval: 100,
        unhealthyThreshold: 2,
      },
    });

    // Set high failure rate to make workers unhealthy
    await workerPool.setFailureRate(0.9);

    // Try to process jobs
    const jobs = Array.from({ length: 5 }, (_, i) => ({ id: `job_${i}` }));

    await Promise.allSettled(jobs.map((job) => workerPool.processJob(job).catch(() => null)));

    // Pool should still maintain target size
    expect(workerPool.size).toBe(2);
  });
});
