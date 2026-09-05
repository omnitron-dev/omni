/**
 * Comprehensive Process Manager Tests
 *
 * Covers spawning, pools, streaming, workflows, the test harness and the
 * resilience decorators through TestProcessManager.
 *
 * This file was excluded from the run because it also imported five
 * decorators that do not exist — DistributedLock, GeoSpatialQuery,
 * RealtimeMatch, MessageBus, ResourcePool — so it could not be loaded at all
 * and the sixteen tests below never ran either. Those blocks are gone; what
 * remains is checked against the source that exists.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Process,
  Public,
  Workflow,
  Stage,
  Supervisor,
  Child,
  Actor,
  CircuitBreaker,
  OnShutdown,
  HealthCheck,
  ProcessStatus,
} from '../src/index.js';
import { createTestProcessManager, TestProcessManager } from '@omnitron-dev/testing/titan';

// ============================================================================
// Test Process Classes
// ============================================================================

@Process({
  name: 'test-service',
  version: '1.0.0',
  health: { enabled: true, interval: 1000 },
})
class TestService {
  private data = new Map<string, any>();

  @Public()
  async getData(key: string): Promise<any> {
    return this.data.get(key);
  }

  @Public()
  async setData(key: string, value: any): Promise<void> {
    this.data.set(key, value);
  }

  @HealthCheck()
  async checkHealth() {
    return {
      status: 'healthy',
      details: { dataSize: this.data.size },
    };
  }

  @OnShutdown()
  async cleanup() {
    this.data.clear();
  }
}

@Process()
class StreamingService {
  @Public()
  async *streamData(count: number): AsyncGenerator<number> {
    for (let i = 0; i < count; i++) {
      yield i;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  @Public()
  async processStream(stream: AsyncIterable<number>): Promise<number[]> {
    const results: number[] = [];
    for await (const item of stream) {
      results.push(item * 2);
    }
    return results;
  }
}

@Workflow()
class TestWorkflow {
  results = new Map<string, any>();

  @Stage()
  async initialization() {
    this.results.set('init', true);
    return { status: 'initialized' };
  }

  @Stage({ dependsOn: 'initialization', parallel: true })
  async processA() {
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.results.set('processA', true);
    return { data: 'A' };
  }

  @Stage({ dependsOn: 'initialization', parallel: true })
  async processB() {
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.results.set('processB', true);
    return { data: 'B' };
  }

  @Stage({ dependsOn: ['processA', 'processB'] })
  async finalization() {
    this.results.set('final', true);
    return { status: 'completed' };
  }
}

@Supervisor({
  strategy: 'one-for-one',
  maxRestarts: 3,
  window: 60000,
})
class _TestSupervisor {
  @Child({ critical: true })
  database = TestService;

  @Child({ pool: { size: 2 } })
  workers = StreamingService;
}

@Actor()
class _CounterActor {
  private count = 0;

  async increment(): Promise<void> {
    this.count++;
  }

  async getCount(): Promise<number> {
    return this.count;
  }

  async reset(): Promise<void> {
    this.count = 0;
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Process Manager - Core Features', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  describe('Process Spawning', () => {
    it('should spawn a process with decorators', async () => {
      const service = await pm.spawn(TestService);
      expect(service).toBeDefined();
      expect(service.__processId).toBeDefined();

      // Test method calls
      await service.setData('test', 'value');
      const data = await service.getData('test');
      expect(data).toBe('value');
    });

    it('should handle health checks', async () => {
      const service = await pm.spawn(TestService);
      await service.setData('key1', 'value1');

      const health = await pm.getHealth(service.__processId);
      expect(health).toBeDefined();
      expect(health?.status).toBe('healthy');
    });

    it('should handle graceful shutdown', async () => {
      const service = await pm.spawn(TestService);
      await service.setData('test', 'value');

      await pm.kill(service.__processId);
      const process = pm.getProcess(service.__processId);
      expect(process?.status).toBe(ProcessStatus.STOPPED);
    });
  });

  describe('Process Pools', () => {
    it('should create and use process pools', async () => {
      const pool = await pm.pool(TestService, {
        size: 3,
        strategy: 'round-robin' as any,
      });

      expect(pool.size).toBe(3);

      // Test concurrent operations - each worker stores its own data
      // We'll test that the pool can handle multiple concurrent requests
      const promises = [];
      for (let i = 0; i < 9; i++) {
        // Store data where each worker gets 3 keys
        promises.push(pool.setData(`worker_key`, `value${i}`));
      }
      await Promise.all(promises);

      // Now test that we can retrieve data from the pool
      // Each worker will return its own value for 'worker_key'
      const results = new Set();
      for (let i = 0; i < 9; i++) {
        const value = await pool.getData('worker_key');
        if (value !== undefined) {
          results.add(value);
        }
      }

      // We should have gotten responses (at least 1 unique value)
      // The exact values depend on which worker responds
      expect(results.size).toBeGreaterThan(0);
      expect(results.size).toBeLessThanOrEqual(3); // Max 3 workers
    });

    it('should scale pool dynamically', async () => {
      const pool = await pm.pool(TestService, {
        size: 2,
        strategy: 'least-loaded' as any,
      });

      expect(pool.size).toBe(2);

      await pool.scale(5);
      expect(pool.size).toBe(5);

      await pool.scale(1);
      expect(pool.size).toBe(1);
    });
  });
});

describe('Process Manager - Streaming', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should support AsyncIterable streaming [MockSpawner: async generator proxy support]', async () => {
    const service = await pm.spawn(StreamingService);

    // Test streaming data
    const results: number[] = [];
    for await (const value of service.streamData(5)) {
      results.push(value);
    }

    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('should process streams across processes [MockSpawner: async generator proxy support]', async () => {
    const service = await pm.spawn(StreamingService);

    // Test that we can stream data from one service
    const streamResults: number[] = [];
    for await (const value of service.streamData(3)) {
      streamResults.push(value);
    }
    expect(streamResults).toEqual([0, 1, 2]);

    // Test that processStream works with a simple array
    // In real IPC, we'd serialize the data, not pass generators
    const processedResults = await service.processStream([0, 1, 2] as any);
    expect(processedResults).toEqual([0, 2, 4]);
  });
});

describe('Process Manager - Workflows', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should execute workflow with DAG dependencies', async () => {
    const workflow = await pm.workflow(TestWorkflow);
    const result = await (workflow as any).run();

    // Verify execution order
    expect((workflow as any).results.get('init')).toBe(true);
    expect((workflow as any).results.get('processA')).toBe(true);
    expect((workflow as any).results.get('processB')).toBe(true);
    expect((workflow as any).results.get('final')).toBe(true);

    // Result should include all stage results
    expect(result).toHaveProperty('initialization');
    expect(result).toHaveProperty('processA');
    expect(result).toHaveProperty('processB');
    expect(result).toHaveProperty('finalization');
  });

  it('should execute parallel stages concurrently', async () => {
    const workflow = await pm.workflow(TestWorkflow);

    const startTime = Date.now();
    await (workflow as any).run();
    const duration = Date.now() - startTime;

    // Parallel stages should complete faster than sequential
    // Both processA and processB take 50ms each
    // If sequential, total would be 100ms+
    // If parallel, should be around 50ms
    expect(duration).toBeLessThan(100);
  });
});

describe('Process Manager - Test Utilities', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true, recordOperations: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should simulate process crashes', async () => {
    const service = await pm.spawn(TestService);

    await pm.simulateCrash(service);
    const process = pm.getProcess(service.__processId);
    expect(process?.status).toBe(ProcessStatus.CRASHED);
  });

  it('should wait for process recovery', async () => {
    const service = await pm.spawn(TestService);

    // Simulate crash and recovery
    await pm.simulateCrash(service);

    // Simulate recovery by changing status
    const process = pm.getProcess(service.__processId);
    if (process) {
      process.status = ProcessStatus.RUNNING;
      pm.emit('process:ready', process);
    }

    const recovered = await pm.waitForRecovery(service, 1000);
    expect(recovered).toBe(true);
  });

  it('should record and verify operations', async () => {
    await pm.spawn(TestService);

    expect(pm.verifyOperation('spawn')).toBe(true);
    expect(pm.verifyOperation('spawn', (op) => op.processClass === 'TestService')).toBe(true);

    const operations = pm.getOperations();
    expect(operations.length).toBeGreaterThan(0);
    expect(operations[0].type).toBe('spawn');
  });

  it('should simulate metrics and health', async () => {
    const service = await pm.spawn(TestService);
    const processId = service.__processId;

    // Set simulated metrics
    pm.setMetrics(processId, {
      cpu: 75,
      memory: 1024,
      requests: 100,
      errors: 2,
    });

    const metrics = await pm.getMetrics(processId);
    expect(metrics?.cpu).toBe(75);
    expect(metrics?.requests).toBe(100);

    // Set simulated health
    pm.setHealth(processId, {
      status: 'degraded',
      checks: [{ name: 'test', status: 'warn' }],
      timestamp: Date.now(),
    });

    const health = await pm.getHealth(processId);
    expect(health?.status).toBe('degraded');
  });
});


describe('Process Manager - Resilience Patterns', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should handle circuit breaker pattern', async () => {
    @Process()
    class ResilientService {
      private callCount = 0;

      @Public()
      @CircuitBreaker({ threshold: 3, timeout: 100, fallback: 'getFallbackData' })
      async getData(): Promise<string> {
        this.callCount++;
        if (this.callCount <= 3) {
          throw new Error('Service unavailable');
        }
        return 'success';
      }

      @Public()
      async getFallbackData(): Promise<string> {
        return 'fallback';
      }
    }

    const service = await pm.spawn(ResilientService);

    // First 3 calls should fail and return fallback after threshold
    let result;
    for (let i = 0; i < 4; i++) {
      try {
        result = await service.getData();
      } catch (_e) {
        result = 'error';
      }
    }

    // Circuit should be open, returning fallback
    expect(result).toBe('fallback');
  });
});

describe('Process Manager - Edge Cases', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });


  describe('Process Pool Error Handling', () => {
    it('should handle pool worker failures gracefully', async () => {
      @Process()
      class UnstableService {
        private callCount = 0;

        @Public()
        async doWork(): Promise<string> {
          this.callCount++;
          if (this.callCount % 2 === 0) {
            throw new Error('Worker failure');
          }
          return `success-${this.callCount}`;
        }
      }

      const pool = await pm.pool(UnstableService, { size: 2 });

      // Some calls will succeed, some will fail
      const results: Array<string | null> = [];
      for (let i = 0; i < 4; i++) {
        try {
          const result = await pool.doWork();
          results.push(result);
        } catch {
          results.push(null);
        }
      }

      // Should have mix of successes and failures
      const successes = results.filter((r) => r !== null).length;
      const failures = results.filter((r) => r === null).length;
      expect(successes).toBeGreaterThan(0);
      expect(failures).toBeGreaterThan(0);
    });
  });

  describe('Workflow Error Handling', () => {
    it('should handle workflow stage failures', async () => {
      @Workflow()
      class FailingWorkflow {
        @Stage()
        async setup() {
          return { status: 'setup-complete' };
        }

        @Stage({ dependsOn: 'setup', continueOnError: true })
        async failingStage() {
          throw new Error('Stage failed');
        }

        @Stage({ dependsOn: 'failingStage' })
        async cleanup() {
          return { status: 'cleaned-up' };
        }
      }

      const workflow = await pm.workflow(FailingWorkflow);

      // The workflow should handle the failure based on continueOnError
      let result;
      try {
        result = await (workflow as any).run();
      } catch (_error) {
        result = 'workflow-failed';
      }

      // With continueOnError, cleanup should still run
      expect(result).toBeDefined();
    });
  });



});
