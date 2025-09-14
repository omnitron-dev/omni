import { EventEmitter } from '../src';

describe('EventEmitter - Concurrency with pLimit', () => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  describe('Constructor concurrency', () => {
    it('should accept concurrency in constructor', () => {
      const emitter = new EventEmitter(5);
      expect(emitter).toBeDefined();
    });

    it('should not set limiter when concurrency is not provided', () => {
      const emitter = new EventEmitter();
      expect((emitter as any).limiter).toBeUndefined();
    });

    it('should not set limiter when concurrency is invalid', () => {
      const emitter1 = new EventEmitter(0);
      const emitter2 = new EventEmitter(-1);
      const emitter3 = new EventEmitter(0.5);

      expect((emitter1 as any).limiter).toBeUndefined();
      expect((emitter2 as any).limiter).toBeUndefined();
      expect((emitter3 as any).limiter).toBeUndefined();
    });

    it('should set limiter when concurrency is valid', () => {
      const emitter = new EventEmitter(1);
      expect((emitter as any).limiter).toBeDefined();
    });
  });

  describe('setConcurrency method', () => {
    it('should set limiter when called with valid concurrency', () => {
      const emitter = new EventEmitter();
      expect((emitter as any).limiter).toBeUndefined();

      emitter.setConcurrency(3);
      expect((emitter as any).limiter).toBeDefined();
    });

    it('should return this for chaining', () => {
      const emitter = new EventEmitter();
      const result = emitter.setConcurrency(5);
      expect(result).toBe(emitter);
    });

    it('should update limiter when called multiple times', () => {
      const emitter = new EventEmitter();

      emitter.setConcurrency(2);
      const limiter1 = (emitter as any).limiter;

      emitter.setConcurrency(4);
      const limiter2 = (emitter as any).limiter;

      expect(limiter1).toBeDefined();
      expect(limiter2).toBeDefined();
      expect(limiter1).not.toBe(limiter2);
    });
  });

  describe('Concurrent execution control', () => {
    it('should limit concurrent execution to specified number', async () => {
      const concurrency = 2;
      const emitter = new EventEmitter(concurrency);
      const executionOrder: number[] = [];
      let currentlyExecuting = 0;
      let maxConcurrentExecutions = 0;

      // Add 5 listeners that track concurrent execution
      for (let i = 0; i < 5; i++) {
        emitter.on('test', async () => {
          currentlyExecuting++;
          maxConcurrentExecutions = Math.max(maxConcurrentExecutions, currentlyExecuting);
          executionOrder.push(i);

          await delay(50);

          currentlyExecuting--;
          return i;
        });
      }

      const results = await emitter.emitParallel('test');

      expect(maxConcurrentExecutions).toBeLessThanOrEqual(concurrency);
      expect(results).toHaveLength(5);
      expect(executionOrder).toHaveLength(5);
    });

    it('should process all listeners even with concurrency limit', async () => {
      const emitter = new EventEmitter(1);
      const results: number[] = [];

      for (let i = 0; i < 10; i++) {
        emitter.on('test', async () => {
          await delay(10);
          results.push(i);
          return i;
        });
      }

      const emitResults = await emitter.emitParallel('test');

      expect(results).toHaveLength(10);
      expect(emitResults).toHaveLength(10);
      expect(results.sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should enforce concurrency for emitSerial', async () => {
      const concurrency = 2;
      const emitter = new EventEmitter(concurrency);
      let maxConcurrentExecutions = 0;
      let currentlyExecuting = 0;

      emitter.on('test', async () => {
        currentlyExecuting++;
        maxConcurrentExecutions = Math.max(maxConcurrentExecutions, currentlyExecuting);
        await delay(50);
        currentlyExecuting--;
        return 1;
      });

      emitter.on('test', async () => {
        currentlyExecuting++;
        maxConcurrentExecutions = Math.max(maxConcurrentExecutions, currentlyExecuting);
        await delay(50);
        currentlyExecuting--;
        return 2;
      });

      await emitter.emitSerial('test');

      // Serial execution should run one at a time regardless of concurrency setting
      expect(maxConcurrentExecutions).toBe(1);
    });

    it('should enforce concurrency for emitReduce', async () => {
      const concurrency = 1;
      const emitter = new EventEmitter(concurrency);
      const executionOrder: number[] = [];

      emitter.on('test', async (value: number) => {
        executionOrder.push(1);
        await delay(30);
        return value + 1;
      });

      emitter.on('test', async (value: number) => {
        executionOrder.push(2);
        await delay(30);
        return value + 2;
      });

      emitter.on('test', async (value: number) => {
        executionOrder.push(3);
        await delay(30);
        return value + 3;
      });

      const result = await emitter.emitReduce('test', 0);

      // With reduce, execution should be sequential
      expect(executionOrder).toEqual([1, 2, 3]);
      expect(result).toBe(6); // 0 + 1 + 2 + 3
    });
  });

  describe('Error handling with concurrency', () => {
    it('should handle errors within concurrent execution', async () => {
      const emitter = new EventEmitter(2);

      emitter.on('test', async () => {
        await delay(10);
        throw new Error('Error 1');
      });

      emitter.on('test', async () => {
        await delay(20);
        return 'Success';
      });

      emitter.on('test', async () => {
        await delay(5);
        throw new Error('Error 2');
      });

      try {
        await emitter.emitParallel('test');
        fail('Should have thrown an error');
      } catch (error: any) {
        // Should catch one of the errors
        expect(error.message).toMatch(/Error [12]/);
      }
    });

    it('should handle synchronous errors with limiter', async () => {
      const emitter = new EventEmitter(2);

      emitter.on('test', () => {
        throw new Error('Sync error');
      });

      emitter.on('test', async () => {
        await delay(10);
        return 'Success';
      });

      try {
        await emitter.emitParallel('test');
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Sync error');
      }
    });

    it('should continue processing other listeners after error', async () => {
      const emitter = new EventEmitter(1);
      const results: string[] = [];

      emitter.on('test', async () => {
        results.push('listener1');
        throw new Error('Error in listener 1');
      });

      emitter.on('test', async () => {
        await delay(10);
        results.push('listener2');
        return 'Success 2';
      });

      emitter.on('test', async () => {
        await delay(10);
        results.push('listener3');
        return 'Success 3';
      });

      try {
        await emitter.emitParallel('test');
      } catch (error) {
        // Expected error
      }

      // Wait a bit for other listeners to complete
      await delay(50);

      // All listeners should have been attempted
      expect(results).toEqual(['listener1', 'listener2', 'listener3']);
    });
  });

  describe('Multiple event types with concurrency', () => {
    it('should apply concurrency limit across different event types', async () => {
      const concurrency = 2;
      const emitter = new EventEmitter(concurrency);
      let maxConcurrentExecutions = 0;
      let currentlyExecuting = 0;

      const trackExecution = async (eventName: string, index: number) => {
        currentlyExecuting++;
        maxConcurrentExecutions = Math.max(maxConcurrentExecutions, currentlyExecuting);
        await delay(30);
        currentlyExecuting--;
        return `${eventName}-${index}`;
      };

      emitter.on('event1', () => trackExecution('event1', 1));
      emitter.on('event1', () => trackExecution('event1', 2));
      emitter.on('event2', () => trackExecution('event2', 1));
      emitter.on('event2', () => trackExecution('event2', 2));

      const [results1, results2] = await Promise.all([emitter.emitParallel('event1'), emitter.emitParallel('event2')]);

      expect(maxConcurrentExecutions).toBeLessThanOrEqual(concurrency);
      expect(results1).toHaveLength(2);
      expect(results2).toHaveLength(2);
    });
  });

  describe('Performance characteristics', () => {
    it('should complete faster with higher concurrency', async () => {
      const taskDuration = 50;
      const taskCount = 6;

      // Test with concurrency = 1
      const emitter1 = new EventEmitter(1);
      for (let i = 0; i < taskCount; i++) {
        emitter1.on('test', async () => {
          await delay(taskDuration);
          return i;
        });
      }

      const start1 = Date.now();
      await emitter1.emitParallel('test');
      const duration1 = Date.now() - start1;

      // Test with concurrency = 3
      const emitter2 = new EventEmitter(3);
      for (let i = 0; i < taskCount; i++) {
        emitter2.on('test', async () => {
          await delay(taskDuration);
          return i;
        });
      }

      const start2 = Date.now();
      await emitter2.emitParallel('test');
      const duration2 = Date.now() - start2;

      // With concurrency=3, it should be roughly 2x faster than concurrency=1
      // Allow some tolerance for timing variations
      expect(duration2).toBeLessThan(duration1 * 0.7);
    });

    it('should handle no concurrency limit efficiently', async () => {
      const emitter = new EventEmitter(); // No concurrency limit
      const taskCount = 10;
      const results: number[] = [];

      for (let i = 0; i < taskCount; i++) {
        emitter.on('test', async () => {
          await delay(10);
          results.push(i);
          return i;
        });
      }

      const start = Date.now();
      const emitResults = await emitter.emitParallel('test');
      const duration = Date.now() - start;

      // Without concurrency limit, all should run in parallel
      // So duration should be close to single task duration (10ms) plus overhead
      expect(duration).toBeLessThan(50); // Should complete quickly
      expect(emitResults).toHaveLength(taskCount);
      expect(results).toHaveLength(taskCount);
    });
  });

  describe('Edge cases', () => {
    it('should handle concurrency with no listeners', async () => {
      const emitter = new EventEmitter(2);
      const results = await emitter.emitParallel('test');
      expect(results).toEqual([]);
    });

    it('should handle concurrency with single listener', async () => {
      const emitter = new EventEmitter(5);
      emitter.on('test', () => 'single');

      const results = await emitter.emitParallel('test');
      expect(results).toEqual(['single']);
    });

    it('should handle changing concurrency during execution', async () => {
      const emitter = new EventEmitter(1);
      const executionOrder: number[] = [];

      for (let i = 0; i < 5; i++) {
        emitter.on('test', async () => {
          executionOrder.push(i);
          await delay(20);

          // Change concurrency mid-execution
          if (i === 2) {
            emitter.setConcurrency(3);
          }

          return i;
        });
      }

      const results = await emitter.emitParallel('test');

      expect(results).toHaveLength(5);
      expect(executionOrder).toHaveLength(5);
    });

    it('should handle very high concurrency values', () => {
      const emitter = new EventEmitter(1000);
      expect((emitter as any).limiter).toBeDefined();
    });

    it('should handle Infinity concurrency', () => {
      const emitter = new EventEmitter(Infinity);
      expect((emitter as any).limiter).toBeDefined();
    });
  });

  describe('Integration with pLimit from @omnitron-dev/common', () => {
    it('should properly use pLimit function signature', async () => {
      const emitter = new EventEmitter(2);
      const limiter = (emitter as any).limiter;

      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe('function');

      // Verify pLimit properties exist
      expect(limiter.activeCount).toBeDefined();
      expect(limiter.pendingCount).toBeDefined();
      expect(limiter.clearQueue).toBeDefined();
    });

    it('should track activeCount and pendingCount correctly', async () => {
      const emitter = new EventEmitter(2);
      const limiter = (emitter as any).limiter;

      let capturedActiveCount = 0;
      let capturedPendingCount = 0;

      // Add multiple slow listeners
      for (let i = 0; i < 5; i++) {
        emitter.on('test', async () => {
          // Capture counts during execution
          if (i === 2) {
            capturedActiveCount = limiter.activeCount;
            capturedPendingCount = limiter.pendingCount;
          }
          await delay(50);
          return i;
        });
      }

      const promise = emitter.emitParallel('test');

      // Give some time for execution to start
      await delay(20);

      // Check counts during execution
      expect(limiter.activeCount).toBeGreaterThan(0);
      expect(limiter.activeCount).toBeLessThanOrEqual(2);

      await promise;

      // After completion, counts should be zero
      expect(limiter.activeCount).toBe(0);
      expect(limiter.pendingCount).toBe(0);
    });
  });
});
