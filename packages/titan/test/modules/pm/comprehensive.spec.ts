/**
 * Comprehensive Process Manager Tests
 *
 * Tests covering all major features of the Process Manager module
 * including decorators, workflows, streaming, and enterprise features.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  ProcessManager,
  Process,
  Public,
  Workflow,
  Stage,
  Supervisor,
  Child,
  Actor,
  CircuitBreaker,
  SharedState,
  OnShutdown,
  InjectProcess,
  HealthCheck,
  createTestProcessManager,
  TestProcessManager,
  DistributedLock,
  GeoSpatialQuery,
  RealtimeMatch,
  MessageBus,
  ResourcePool,
  ProcessStatus,
  type ServiceProxy,
  type IProcessPool,
  type IGeoPoint
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

      // Test concurrent operations
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(pool.setData(`key${i}`, `value${i}`));
      }
      await Promise.all(promises);

      // Verify data distribution
      for (let i = 0; i < 10; i++) {
        const value = await pool.getData(`key${i}`);
        expect(value).toBe(`value${i}`);
      }
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

    // Create an async generator
    async function* generateData() {
      for (let i = 0; i < 3; i++) {
        yield i;
      }
    }

    // Process the stream
    const results = await service.processStream(generateData());
    expect(results).toEqual([0, 2, 4]);
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

    expect(result).toEqual({ status: 'completed' });
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
      const lockManager = new DistributedLock({ timeout: 1000 });
      
      const lock1 = await lockManager.acquire('resource1', 5000);
      expect(lock1.acquired).toBe(true);
      
      // Try to acquire same resource - should wait or fail
      const startTime = Date.now();
      let failed = false;
      try {
        await lockManager.acquire('resource1', 100);
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
      const geoManager = new GeoSpatialQuery({ index: 'geohash', precision: 7 });
      
      // Index some entities
      const driver1 = { id: '1', name: 'Driver 1' };
      const driver2 = { id: '2', name: 'Driver 2' };
      const driver3 = { id: '3', name: 'Driver 3' };
      
      await geoManager.index(driver1, { lat: 40.7128, lng: -74.0060 }); // New York
      await geoManager.index(driver2, { lat: 40.7130, lng: -74.0062 }); // Near NY
      await geoManager.index(driver3, { lat: 34.0522, lng: -118.2437 }); // Los Angeles
      
      // Query nearby drivers
      const nearby = await geoManager.nearby({ lat: 40.7129, lng: -74.0061 }, 1000);
      expect(nearby).toContain(driver1);
      expect(nearby).toContain(driver2);
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

      @CircuitBreaker({ threshold: 3, timeout: 100, fallback: 'getFallbackData' })
      async getData(): Promise<string> {
        this.callCount++;
        if (this.callCount <= 3) {
          throw new Error('Service unavailable');
        }
        return 'success';
      }

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
