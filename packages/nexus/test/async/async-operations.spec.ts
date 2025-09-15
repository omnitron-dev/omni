/**
 * Async Operations and Streaming Tests
 * Tests for async providers, lazy loading, and streaming capabilities
 */

import {
  Container,
  createToken,
  AsyncProvider,
  AsyncResolutionError,
  StreamProvider,
  LazyProvider,
  createAsyncToken,
  createStreamToken,
  createLazyToken
} from '../../src';

describe('Async Operations', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Async Providers', () => {
    it('should register and resolve async provider', async () => {
      const token = createAsyncToken<string>('AsyncService');
      
      container.registerAsync(token, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'async-result';
        }
      });

      const result = await container.resolveAsync(token);
      expect(result).toBe('async-result');
    });

    it('should handle async dependencies', async () => {
      const configToken = createAsyncToken<{ apiUrl: string }>('Config');
      const serviceToken = createAsyncToken<{ config: any }>('Service');

      container.registerAsync(configToken, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { apiUrl: 'https://api.example.com' };
        }
      });

      container.registerAsync(serviceToken, {
        useFactory: async (config) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { config };
        },
        inject: [configToken]
      });

      const service = await container.resolveAsync(serviceToken);
      expect(service.config.apiUrl).toBe('https://api.example.com');
    });

    it('should cache async singleton results', async () => {
      let callCount = 0;
      const token = createAsyncToken<number>('CachedAsync');

      container.registerAsync(token, {
        useFactory: async () => {
          callCount++;
          await new Promise(resolve => setTimeout(resolve, 10));
          return callCount;
        },
        scope: 'singleton'
      });

      const [first, second, third] = await Promise.all([
        container.resolveAsync(token),
        container.resolveAsync(token),
        container.resolveAsync(token)
      ]);

      expect(first).toBe(1);
      expect(second).toBe(1);
      expect(third).toBe(1);
      expect(callCount).toBe(1);
    });

    it('should handle async initialization errors', async () => {
      const token = createAsyncToken<any>('FailingAsync');

      container.registerAsync(token, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error('Async initialization failed');
        }
      });

      await expect(container.resolveAsync(token)).rejects.toThrow(AsyncResolutionError);
      await expect(container.resolveAsync(token)).rejects.toThrow('Async initialization failed');
    });

    it('should support async class providers', async () => {
      class AsyncService {
        private initialized = false;

        async onInit() {
          await new Promise(resolve => setTimeout(resolve, 10));
          this.initialized = true;
        }

        isInitialized() {
          return this.initialized;
        }
      }

      const token = createAsyncToken<AsyncService>('AsyncClass');
      
      container.registerAsync(token, {
        useClass: AsyncService,
        async: true
      });

      const service = await container.resolveAsync(token);
      await container.initialize();
      
      expect(service.isInitialized()).toBe(true);
    });

    it('should handle circular async dependencies', async () => {
      const tokenA = createAsyncToken<any>('AsyncA');
      const tokenB = createAsyncToken<any>('AsyncB');

      container.registerAsync(tokenA, {
        useFactory: async (b) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { b };
        },
        inject: [tokenB]
      });

      container.registerAsync(tokenB, {
        useFactory: async (a) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { a };
        },
        inject: [tokenA]
      });

      await expect(container.resolveAsync(tokenA)).rejects.toThrow('Circular dependency');
    });

    it('should support timeout for async resolution', async () => {
      const token = createAsyncToken<string>('SlowAsync');

      container.registerAsync(token, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return 'too-slow';
        },
        timeout: 100
      });

      await expect(container.resolveAsync(token)).rejects.toThrow('Async resolution timeout');
    });

    it('should support async resolution with retry', async () => {
      let attempts = 0;
      const token = createAsyncToken<string>('RetryAsync');

      container.registerAsync(token, {
        useFactory: async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        },
        retry: {
          maxAttempts: 3,
          delay: 10
        }
      });

      const result = await container.resolveAsync(token);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });
  });

  describe('Lazy Loading', () => {
    it('should create lazy proxy', () => {
      let created = false;
      const token = createLazyToken<{ value: string }>('LazyService');

      container.register(token, {
        useFactory: () => {
          created = true;
          return { value: 'lazy' };
        }
      });

      const proxy = container.resolveLazy(token);
      
      expect(created).toBe(false); // Not created yet
      
      // Access property triggers creation
      const value = proxy.value;
      
      expect(created).toBe(true);
      expect(value).toBe('lazy');
    });

    it('should cache lazy instance after first access', () => {
      let createCount = 0;
      const token = createLazyToken<{ getValue: () => number }>('CachedLazy');

      container.register(token, {
        useFactory: () => {
          createCount++;
          return {
            getValue: () => createCount
          };
        }
      });

      const proxy = container.resolveLazy(token);
      
      const first = proxy.getValue();
      const second = proxy.getValue();
      
      expect(first).toBe(1);
      expect(second).toBe(1);
      expect(createCount).toBe(1);
    });

    it('should support lazy loading with dependencies', () => {
      const depToken = createToken<string>('Dependency');
      const lazyToken = createLazyToken<{ dep: string }>('LazyWithDep');

      container.register(depToken, { useValue: 'dependency' });
      container.register(lazyToken, {
        useFactory: (dep) => ({ dep }),
        inject: [depToken]
      });

      const proxy = container.resolveLazy(lazyToken);
      expect(proxy.dep).toBe('dependency');
    });

    it('should handle lazy loading errors', () => {
      const token = createLazyToken<any>('FailingLazy');

      container.register(token, {
        useFactory: () => {
          throw new Error('Lazy initialization failed');
        }
      });

      const proxy = container.resolveLazy(token);
      
      expect(() => proxy.someProperty).toThrow('Lazy initialization failed');
    });

    it('should support async lazy loading', async () => {
      const token = createLazyToken<{ value: string }>('AsyncLazy');

      container.registerAsync(token, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { value: 'async-lazy' };
        }
      });

      const proxy = await container.resolveLazyAsync(token);
      const value = await proxy.value;
      
      expect(value).toBe('async-lazy');
    });
  });

  describe('Streaming', () => {
    it('should support stream providers', async () => {
      const token = createStreamToken<number>('NumberStream');

      container.registerStream(token, {
        useFactory: async function* () {
          for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
            yield i;
          }
        }
      });

      const stream = container.resolveStream(token);
      const values: number[] = [];
      
      for await (const value of stream) {
        values.push(value);
      }
      
      expect(values).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle stream errors', async () => {
      const token = createStreamToken<number>('ErrorStream');

      container.registerStream(token, {
        useFactory: async function* () {
          yield 1;
          yield 2;
          throw new Error('Stream error');
        }
      });

      const stream = container.resolveStream(token);
      const values: number[] = [];
      
      try {
        for await (const value of stream) {
          values.push(value);
        }
      } catch (error) {
        expect(error.message).toBe('Stream error');
      }
      
      expect(values).toEqual([1, 2]);
    });

    it('should support stream transformation', async () => {
      const sourceToken = createStreamToken<number>('Source');
      const transformedToken = createStreamToken<string>('Transformed');

      container.registerStream(sourceToken, {
        useFactory: async function* () {
          yield* [1, 2, 3, 4, 5];
        }
      });

      container.registerStream(transformedToken, {
        useFactory: async function* (source) {
          for await (const num of source) {
            yield `Number: ${num}`;
          }
        },
        inject: [sourceToken]
      });

      const stream = container.resolveStream(transformedToken);
      const values: string[] = [];
      
      for await (const value of stream) {
        values.push(value);
      }
      
      expect(values).toEqual([
        'Number: 1',
        'Number: 2',
        'Number: 3',
        'Number: 4',
        'Number: 5'
      ]);
    });

    it('should support stream filtering', async () => {
      const token = createStreamToken<number>('FilteredStream');

      container.registerStream(token, {
        useFactory: async function* () {
          for (let i = 0; i < 10; i++) {
            yield i;
          }
        },
        filter: (value) => value % 2 === 0 // Only even numbers
      });

      const stream = container.resolveStream(token);
      const values: number[] = [];
      
      for await (const value of stream) {
        values.push(value);
      }
      
      expect(values).toEqual([0, 2, 4, 6, 8]);
    });

    it('should support stream batching', async () => {
      const token = createStreamToken<number[]>('BatchedStream');

      container.registerStream(token, {
        useFactory: async function* () {
          for (let i = 0; i < 10; i++) {
            yield i;
          }
        },
        batch: { size: 3 }
      });

      const stream = container.resolveStream(token);
      const batches: number[][] = [];
      
      for await (const batch of stream) {
        batches.push(batch);
      }
      
      expect(batches).toEqual([
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [9]
      ]);
    });

    it('should handle stream cancellation', async () => {
      const token = createStreamToken<number>('CancellableStream');
      let cancelled = false;

      container.registerStream(token, {
        useFactory: async function* () {
          try {
            for (let i = 0; i < 100; i++) {
              await new Promise(resolve => setTimeout(resolve, 10));
              yield i;
            }
          } finally {
            cancelled = true;
          }
        }
      });

      const stream = container.resolveStream(token);
      const values: number[] = [];
      
      for await (const value of stream) {
        values.push(value);
        if (value === 4) break; // Cancel early
      }
      
      // Give time for cleanup
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(values).toEqual([0, 1, 2, 3, 4]);
      expect(cancelled).toBe(true);
    });

    it('should support stream merging', async () => {
      const stream1Token = createStreamToken<string>('Stream1');
      const stream2Token = createStreamToken<string>('Stream2');
      const mergedToken = createStreamToken<string>('Merged');

      container.registerStream(stream1Token, {
        useFactory: async function* () {
          yield 'a1';
          await new Promise(resolve => setTimeout(resolve, 20));
          yield 'a2';
        }
      });

      container.registerStream(stream2Token, {
        useFactory: async function* () {
          await new Promise(resolve => setTimeout(resolve, 10));
          yield 'b1';
          await new Promise(resolve => setTimeout(resolve, 20));
          yield 'b2';
        }
      });

      container.registerStream(mergedToken, {
        useFactory: async function* (s1, s2) {
          // Simple merge - interleave streams
          const iter1 = s1[Symbol.asyncIterator]();
          const iter2 = s2[Symbol.asyncIterator]();
          
          let done1 = false, done2 = false;
          
          while (!done1 || !done2) {
            if (!done1) {
              const result1 = await iter1.next();
              if (result1.done) {
                done1 = true;
              } else {
                yield result1.value;
              }
            }
            
            if (!done2) {
              const result2 = await iter2.next();
              if (result2.done) {
                done2 = true;
              } else {
                yield result2.value;
              }
            }
          }
        },
        inject: [stream1Token, stream2Token]
      });

      const stream = container.resolveStream(mergedToken);
      const values: string[] = [];
      
      for await (const value of stream) {
        values.push(value);
      }
      
      expect(values).toContain('a1');
      expect(values).toContain('a2');
      expect(values).toContain('b1');
      expect(values).toContain('b2');
    });
  });

  describe('Parallel Resolution', () => {
    it('should resolve multiple tokens in parallel', async () => {
      const tokens = Array.from({ length: 5 }, (_, i) => 
        createAsyncToken<number>(`Parallel${i}`)
      );

      tokens.forEach((token, i) => {
        container.registerAsync(token, {
          useFactory: async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return i;
          }
        });
      });

      const start = Date.now();
      const results = await container.resolveParallel(tokens);
      const duration = Date.now() - start;

      expect(results).toEqual([0, 1, 2, 3, 4]);
      expect(duration).toBeLessThan(100); // Should run in parallel, not 250ms
    });

    it('should handle partial failures in parallel resolution', async () => {
      const successToken = createAsyncToken<string>('Success');
      const failToken = createAsyncToken<string>('Fail');

      container.registerAsync(successToken, {
        useFactory: async () => 'success'
      });

      container.registerAsync(failToken, {
        useFactory: async () => {
          throw new Error('Failed');
        }
      });

      const results = await container.resolveParallelSettled([successToken, failToken]);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('fulfilled');
      expect(results[0].value).toBe('success');
      expect(results[1].status).toBe('rejected');
      expect(results[1].reason.message).toBe('Failed');
    });

    it('should support batch resolution with timeout', async () => {
      const fastToken = createAsyncToken<string>('Fast');
      const slowToken = createAsyncToken<string>('Slow');

      container.registerAsync(fastToken, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'fast';
        }
      });

      container.registerAsync(slowToken, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'slow';
        }
      });

      const results = await container.resolveBatch(
        { fast: fastToken, slow: slowToken },
        { timeout: 100 }
      );

      expect(results.fast).toBe('fast');
      expect(results.slow).toBeUndefined(); // Timed out
    });
  });
});