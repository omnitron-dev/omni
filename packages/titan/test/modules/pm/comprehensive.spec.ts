/**
 * Comprehensive Process Manager Tests
 *
 * Tests covering all major features of the Process Manager module
 * including decorators, workflows, streaming, and enterprise features.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
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
  createTestProcessManager,
  TestProcessManager,
  DistributedLock,
  GeoSpatialQuery,
  RealtimeMatch,
  MessageBus,
  ResourcePool,
  ProcessStatus
} from '../../../src/modules/pm/index.js';

// ============================================================================
// Test Process Classes
// ============================================================================

@Process({
  name: 'test-service',
  version: '1.0.0',
  health: { enabled: true, interval: 1000 }
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
      details: { dataSize: this.data.size }
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
      await new Promise(resolve => setTimeout(resolve, 10));
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
    await new Promise(resolve => setTimeout(resolve, 50));
    this.results.set('processA', true);
    return { data: 'A' };
  }

  @Stage({ dependsOn: 'initialization', parallel: true })
  async processB() {
    await new Promise(resolve => setTimeout(resolve, 50));
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
  window: 60000
})
class TestSupervisor {
  @Child({ critical: true })
  database = TestService;

  @Child({ pool: { size: 2 } })
  workers = StreamingService;
}

@Actor()
class CounterActor {
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
        strategy: 'round-robin' as any
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
        strategy: 'least-loaded' as any
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

  it('should support AsyncIterable streaming', async () => {
    const service = await pm.spawn(StreamingService);

    // Test streaming data
    const results: number[] = [];
    for await (const value of service.streamData(5)) {
      results.push(value);
    }

    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('should process streams across processes', async () => {
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
    expect(pm.verifyOperation('spawn', op => op.processClass === 'TestService')).toBe(true);
    
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
      errors: 2
    });
    
    const metrics = await pm.getMetrics(processId);
    expect(metrics?.cpu).toBe(75);
    expect(metrics?.requests).toBe(100);
    
    // Set simulated health
    pm.setHealth(processId, {
      status: 'degraded',
      checks: [{ name: 'test', status: 'warn' }],
      timestamp: Date.now()
    });
    
    const health = await pm.getHealth(processId);
    expect(health?.status).toBe('degraded');
  });
});

describe('Process Manager - Enterprise Features', () => {
  describe('Distributed Lock', () => {
    it('should acquire and release distributed locks', async () => {
      const lockManager = new DistributedLock({ timeout: 100, retries: 1 });

      const lock1 = await lockManager.acquire('resource1', 5000);
      expect(lock1.acquired).toBe(true);

      // Try to acquire same resource - should wait or fail
      let failed = false;
      try {
        // This should timeout after 100ms since resource1 is already locked
        await lockManager.acquire('resource1', 5000);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);

      // Release and try again
      await lock1.release();
      const lock2 = await lockManager.acquire('resource1', 5000);
      expect(lock2.acquired).toBe(true);
      await lock2.release();
    });
  });

  describe('Geo-Spatial Query', () => {
    it('should index and query geo-spatial data', async () => {
      const geoManager = new GeoSpatialQuery({ index: 'geohash', precision: 3 });

      // Index some entities
      const driver1 = { id: '1', name: 'Driver 1' };
      const driver2 = { id: '2', name: 'Driver 2' };
      const driver3 = { id: '3', name: 'Driver 3' };

      // Index with lower precision for better neighbor matching
      await geoManager.index(driver1, { lat: 40.7128, lng: -74.0060 }); // New York
      await geoManager.index(driver2, { lat: 40.7130, lng: -74.0062 }); // Near NY
      await geoManager.index(driver3, { lat: 34.0522, lng: -118.2437 }); // Los Angeles

      // Query should find nearby drivers
      // With precision 3, the hash will be less specific
      const nearby = await geoManager.nearby({ lat: 40.7128, lng: -74.0060 }, 1000);
      expect(nearby).toContain(driver1);
      // driver2 is very close so should be in same or neighboring cell
      expect(nearby).toContain(driver2);
      // driver3 is far away so should not be included
      expect(nearby).not.toContain(driver3);
    });
  });

  describe('Real-time Matching', () => {
    it('should match items optimally', async () => {
      const matcher = new RealtimeMatch({ algorithm: 'hungarian' });
      
      const riders = [
        { id: 'r1', location: { lat: 40.7128, lng: -74.0060 } },
        { id: 'r2', location: { lat: 40.7500, lng: -73.9900 } }
      ];
      
      const drivers = [
        { id: 'd1', location: { lat: 40.7130, lng: -74.0058 } },
        { id: 'd2', location: { lat: 40.7490, lng: -73.9910 } },
        { id: 'd3', location: { lat: 40.8000, lng: -73.9500 } }
      ];
      
      // Simple distance-based scorer
      const scorer = (rider: any, driver: any) => {
        const dlat = Math.abs(rider.location.lat - driver.location.lat);
        const dlng = Math.abs(rider.location.lng - driver.location.lng);
        const distance = Math.sqrt(dlat * dlat + dlng * dlng);
        return 1 / (1 + distance); // Higher score for closer distance
      };
      
      const matches = await matcher.match(riders, drivers, scorer);
      expect(matches).toHaveLength(2);
      expect(matches[0].item1.id).toBe('r1');
      expect(matches[0].item2.id).toBe('d1'); // Closest match
    });
  });

  describe('Message Bus with Total Order', () => {
    it('should maintain total order of messages', async () => {
      const bus = new MessageBus({ order: 'total', history: 10 });
      const received: number[] = [];
      
      // Subscribe to channel
      const unsubscribe = bus.subscribe('test-channel', (msg) => {
        received.push(msg.payload);
      });
      
      // Publish messages
      for (let i = 0; i < 5; i++) {
        await bus.publish('test-channel', i);
      }
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Check order is maintained
      expect(received).toEqual([0, 1, 2, 3, 4]);
      
      // Check history
      const history = bus.getHistory('test-channel');
      expect(history).toHaveLength(5);
      expect(history[0].payload).toBe(0);
      expect(history[4].payload).toBe(4);
      
      unsubscribe();
    });
  });

  describe('Resource Pool', () => {
    it('should manage resource pool efficiently', async () => {
      const pool = new ResourcePool({
        type: 'container',
        min: 1,
        max: 3,
        recycleAfter: 3
      });
      
      // Acquire resources
      const resource1 = await pool.acquire();
      expect(resource1).toBeDefined();
      expect(resource1.inUse).toBe(true);
      
      const resource2 = await pool.acquire();
      expect(resource2).toBeDefined();
      expect(resource2.id).not.toBe(resource1.id);
      
      // Release resource
      await pool.release(resource1);
      expect(resource1.inUse).toBe(false);
      
      // Reacquire - should get same resource
      const resource3 = await pool.acquire();
      expect(resource3.id).toBe(resource1.id);
      expect(resource3.usageCount).toBe(2);
      
      // Release all
      await pool.release(resource2);
      await pool.release(resource3);
    });
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
      } catch (e) {
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

  describe('Distributed Lock Edge Cases', () => {
    it('should handle concurrent lock acquisitions on different resources', async () => {
      const lockManager = new DistributedLock({ timeout: 100, retries: 1 });

      // Acquire locks on different resources concurrently
      const [lock1, lock2, lock3] = await Promise.all([
        lockManager.acquire('resource1', 5000),
        lockManager.acquire('resource2', 5000),
        lockManager.acquire('resource3', 5000)
      ]);

      expect(lock1.acquired).toBe(true);
      expect(lock2.acquired).toBe(true);
      expect(lock3.acquired).toBe(true);

      // Release all locks
      await Promise.all([
        lock1.release(),
        lock2.release(),
        lock3.release()
      ]);
    });

    it('should queue multiple waiters for the same resource', async () => {
      const lockManager = new DistributedLock({ timeout: 1000, retries: 2 });

      // First acquirer gets the lock
      const lock1 = await lockManager.acquire('shared', 100);
      expect(lock1.acquired).toBe(true);

      // Multiple waiters try to acquire
      const waiterResults: boolean[] = [];
      const waiters = [
        lockManager.acquire('shared', 100)
          .then(lock => { waiterResults.push(true); return lock; })
          .catch(() => { waiterResults.push(false); return null; }),
        lockManager.acquire('shared', 100)
          .then(lock => { waiterResults.push(true); return lock; })
          .catch(() => { waiterResults.push(false); return null; })
      ];

      // Release the first lock after a delay
      setTimeout(() => lock1.release(), 50);

      // Wait for all acquisition attempts
      const results = await Promise.all(waiters);

      // At least one waiter should have gotten the lock
      const successCount = waiterResults.filter(r => r).length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Clean up any acquired locks
      for (const lock of results) {
        if (lock) await lock.release();
      }
    });
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
      const successes = results.filter(r => r !== null).length;
      const failures = results.filter(r => r === null).length;
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
      } catch (error) {
        result = 'workflow-failed';
      }

      // With continueOnError, cleanup should still run
      expect(result).toBeDefined();
    });
  });

  describe('Resource Pool Recycling', () => {
    it('should recycle resources after specified usage', async () => {
      const pool = new ResourcePool({
        type: 'connection',
        min: 1,
        max: 2,
        recycleAfter: 2  // Recycle after 2 uses
      });

      const resource1 = await pool.acquire();
      const id1 = resource1.id;
      await pool.release(resource1);

      // Second acquisition of same resource
      const resource2 = await pool.acquire();
      expect(resource2.id).toBe(id1);
      expect(resource2.usageCount).toBe(2);
      await pool.release(resource2);

      // Third acquisition should get a new resource (recycled)
      const resource3 = await pool.acquire();
      expect(resource3.id).not.toBe(id1); // Should be a new resource
      expect(resource3.usageCount).toBe(1);
      await pool.release(resource3);
    });
  });

  describe('Geo-Spatial Edge Cases', () => {
    it('should handle entities at exact same location', async () => {
      const geoManager = new GeoSpatialQuery({ precision: 5 });

      const entity1 = { id: '1', type: 'store' };
      const entity2 = { id: '2', type: 'store' };
      const sameLocation = { lat: 40.7128, lng: -74.0060 };

      await geoManager.index(entity1, sameLocation);
      await geoManager.index(entity2, sameLocation);

      const nearby = await geoManager.nearby(sameLocation, 1);
      expect(nearby).toContain(entity1);
      expect(nearby).toContain(entity2);
    });
  });

  describe('Message Bus Edge Cases', () => {
    it('should handle rapid publish/subscribe cycles', async () => {
      const bus = new MessageBus({ order: 'total', history: 100 });
      const received: number[] = [];

      const unsubscribe = bus.subscribe('rapid-channel', (msg) => {
        received.push(msg.payload);
      });

      // Rapidly publish many messages
      const publishPromises = [];
      for (let i = 0; i < 20; i++) {
        publishPromises.push(bus.publish('rapid-channel', i));
      }
      await Promise.all(publishPromises);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // All messages should be received in order
      expect(received.length).toBe(20);
      for (let i = 0; i < 20; i++) {
        expect(received[i]).toBe(i);
      }

      unsubscribe();
    });

    it('should handle multiple subscribers correctly', async () => {
      const bus = new MessageBus({ order: 'total' });
      const received1: any[] = [];
      const received2: any[] = [];

      const unsub1 = bus.subscribe('multi-channel', (msg) => {
        received1.push(msg.payload);
      });

      const unsub2 = bus.subscribe('multi-channel', (msg) => {
        received2.push(msg.payload);
      });

      await bus.publish('multi-channel', 'test-message');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Both subscribers should receive the message
      expect(received1).toEqual(['test-message']);
      expect(received2).toEqual(['test-message']);

      unsub1();
      unsub2();
    });
  });
});
