/**
 * Middleware Tests
 * Tests for the Nexus middleware system including pipeline, built-in middleware, and composition
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  MiddlewarePipeline,
  MiddlewareContext,
  createMiddleware,
  createLoggingMiddleware,
  LoggingMiddleware,
  CachingMiddleware,
  RetryMiddleware,
  ValidationMiddleware,
  TransactionMiddleware,
  CircuitBreakerMiddleware,
  RateLimitMiddleware,
  composeMiddleware,
} from '../../../src/nexus/middleware.js';
import { Container, createToken } from '../../../src/nexus/index.js';
import { ValidationError } from '../../../src/errors/index.js';

describe('Middleware System', () => {
  describe('MiddlewarePipeline', () => {
    let pipeline: MiddlewarePipeline;

    beforeEach(() => {
      pipeline = new MiddlewarePipeline();
    });

    describe('use', () => {
      it('should add middleware to pipeline', () => {
        const middleware = createMiddleware({
          name: 'test',
          execute: (ctx, next) => next(),
        });

        pipeline.use(middleware);

        expect(pipeline.has('test')).toBe(true);
        expect(pipeline.get('test')).toBe(middleware);
      });

      it('should return this for chaining', () => {
        const middleware = createMiddleware({
          name: 'test',
          execute: (ctx, next) => next(),
        });

        const result = pipeline.use(middleware);

        expect(result).toBe(pipeline);
      });

      it('should sort middleware by priority (higher first)', () => {
        const low = createMiddleware({
          name: 'low',
          priority: 10,
          execute: (ctx, next) => next(),
        });
        const high = createMiddleware({
          name: 'high',
          priority: 100,
          execute: (ctx, next) => next(),
        });
        const medium = createMiddleware({
          name: 'medium',
          priority: 50,
          execute: (ctx, next) => next(),
        });

        pipeline.use(low).use(high).use(medium);

        const all = pipeline.getAll();
        expect(all[0].name).toBe('high');
        expect(all[1].name).toBe('medium');
        expect(all[2].name).toBe('low');
      });

      it('should handle middleware without priority as 0', () => {
        const withPriority = createMiddleware({
          name: 'withPriority',
          priority: 10,
          execute: (ctx, next) => next(),
        });
        const withoutPriority = createMiddleware({
          name: 'withoutPriority',
          execute: (ctx, next) => next(),
        });

        pipeline.use(withoutPriority).use(withPriority);

        const all = pipeline.getAll();
        expect(all[0].name).toBe('withPriority');
        expect(all[1].name).toBe('withoutPriority');
      });
    });

    describe('remove', () => {
      it('should remove middleware by name', () => {
        const middleware = createMiddleware({
          name: 'test',
          execute: (ctx, next) => next(),
        });

        pipeline.use(middleware);
        expect(pipeline.has('test')).toBe(true);

        pipeline.remove('test');
        expect(pipeline.has('test')).toBe(false);
      });

      it('should return this for chaining', () => {
        const middleware = createMiddleware({
          name: 'test',
          execute: (ctx, next) => next(),
        });

        pipeline.use(middleware);
        const result = pipeline.remove('test');

        expect(result).toBe(pipeline);
      });

      it('should handle removing non-existent middleware', () => {
        expect(() => pipeline.remove('non-existent')).not.toThrow();
      });
    });

    describe('clear', () => {
      it('should remove all middleware', () => {
        pipeline
          .use(createMiddleware({ name: 'a', execute: (ctx, next) => next() }))
          .use(createMiddleware({ name: 'b', execute: (ctx, next) => next() }))
          .use(createMiddleware({ name: 'c', execute: (ctx, next) => next() }));

        expect(pipeline.getAll().length).toBe(3);

        pipeline.clear();

        expect(pipeline.getAll().length).toBe(0);
      });

      it('should return this for chaining', () => {
        const result = pipeline.clear();
        expect(result).toBe(pipeline);
      });
    });

    describe('get', () => {
      it('should return middleware by name', () => {
        const middleware = createMiddleware({
          name: 'test',
          execute: (ctx, next) => next(),
        });

        pipeline.use(middleware);

        expect(pipeline.get('test')).toBe(middleware);
      });

      it('should return undefined for non-existent middleware', () => {
        expect(pipeline.get('non-existent')).toBeUndefined();
      });
    });

    describe('has', () => {
      it('should return true if middleware exists', () => {
        const middleware = createMiddleware({
          name: 'test',
          execute: (ctx, next) => next(),
        });

        pipeline.use(middleware);

        expect(pipeline.has('test')).toBe(true);
      });

      it('should return false if middleware does not exist', () => {
        expect(pipeline.has('non-existent')).toBe(false);
      });
    });

    describe('getAll', () => {
      it('should return a copy of all middleware', () => {
        const a = createMiddleware({ name: 'a', execute: (ctx, next) => next() });
        const b = createMiddleware({ name: 'b', execute: (ctx, next) => next() });

        pipeline.use(a).use(b);

        const all = pipeline.getAll();
        expect(all).toHaveLength(2);

        // Should be a copy
        all.pop();
        expect(pipeline.getAll()).toHaveLength(2);
      });
    });

    describe('execute', () => {
      it('should execute middleware in order and call final handler', async () => {
        const order: string[] = [];
        const container = new Container();
        const token = createToken<string>('test');

        pipeline
          .use(
            createMiddleware({
              name: 'first',
              priority: 100,
              execute: (ctx, next) => {
                order.push('first-before');
                const result = next();
                if (result instanceof Promise) {
                  return result.then((r) => {
                    order.push('first-after');
                    return r;
                  });
                }
                order.push('first-after');
                return result;
              },
            })
          )
          .use(
            createMiddleware({
              name: 'second',
              priority: 50,
              execute: (ctx, next) => {
                order.push('second-before');
                const result = next();
                if (result instanceof Promise) {
                  return result.then((r) => {
                    order.push('second-after');
                    return r;
                  });
                }
                order.push('second-after');
                return result;
              },
            })
          );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        const result = await pipeline.execute(context, () => {
          order.push('final');
          return 'result';
        });

        expect(result).toBe('result');
        expect(order).toEqual(['first-before', 'second-before', 'final', 'second-after', 'first-after']);

        await container.dispose();
      });

      it('should handle async middleware', async () => {
        const container = new Container();
        const token = createToken<string>('test');

        pipeline.use(
          createMiddleware({
            name: 'async',
            execute: async (ctx, next) => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              return next();
            },
          })
        );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        const result = await pipeline.execute(context, () => 'async-result');

        expect(result).toBe('async-result');

        await container.dispose();
      });

      it('should filter middleware by condition', async () => {
        const container = new Container();
        const token = createToken<string>('test');
        const executed: string[] = [];

        pipeline
          .use(
            createMiddleware({
              name: 'always',
              execute: (ctx, next) => {
                executed.push('always');
                return next();
              },
            })
          )
          .use(
            createMiddleware({
              name: 'conditional',
              condition: (ctx) => ctx.token.name === 'other',
              execute: (ctx, next) => {
                executed.push('conditional');
                return next();
              },
            })
          );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        await pipeline.execute(context, () => 'result');

        expect(executed).toEqual(['always']);

        await container.dispose();
      });

      it('should call onError handler when middleware throws', async () => {
        const container = new Container();
        const token = createToken<string>('test');
        const errorHandler = vi.fn();
        const error = new Error('middleware error');

        pipeline.use(
          createMiddleware({
            name: 'failing',
            execute: () => {
              throw error;
            },
            onError: errorHandler,
          })
        );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        await expect(pipeline.execute(context, () => 'result')).rejects.toThrow('middleware error');
        expect(errorHandler).toHaveBeenCalledWith(error, context);

        await container.dispose();
      });

      it('should throw error when next() is called multiple times', async () => {
        const container = new Container();
        const token = createToken<string>('test');

        pipeline.use(
          createMiddleware({
            name: 'bad',
            execute: async (ctx, next) => {
              await next();
              return next(); // Second call should throw
            },
          })
        );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        await expect(pipeline.execute(context, () => 'result')).rejects.toThrow('next() multiple times');

        await container.dispose();
      });

      it('should allow multiple next() calls for retry middleware', async () => {
        const container = new Container();
        const token = createToken<string>('test');
        let attempts = 0;

        pipeline.use({
          name: 'retry',
          isRetryMiddleware: true,
          execute: async (ctx, next) => {
            for (let i = 0; i < 3; i++) {
              try {
                return await next();
              } catch {
                attempts++;
              }
            }
            throw new Error('All retries failed');
          },
        } as any);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        let callCount = 0;
        await expect(
          pipeline.execute(context, () => {
            callCount++;
            if (callCount < 3) {
              throw new Error('Not yet');
            }
            return 'success';
          })
        ).resolves.toBe('success');

        expect(callCount).toBe(3);
        expect(attempts).toBe(2);

        await container.dispose();
      });
    });

    describe('executeSync', () => {
      it('should execute middleware synchronously', () => {
        const container = new Container();
        const token = createToken<string>('test');
        const order: string[] = [];

        pipeline
          .use(
            createMiddleware({
              name: 'first',
              priority: 100,
              execute: (ctx, next) => {
                order.push('first-before');
                const result = next();
                order.push('first-after');
                return result;
              },
            })
          )
          .use(
            createMiddleware({
              name: 'second',
              priority: 50,
              execute: (ctx, next) => {
                order.push('second-before');
                const result = next();
                order.push('second-after');
                return result;
              },
            })
          );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        const result = pipeline.executeSync(context, () => {
          order.push('final');
          return 'sync-result';
        });

        expect(result).toBe('sync-result');
        expect(order).toEqual(['first-before', 'second-before', 'final', 'second-after', 'first-after']);
      });

      it('should throw error for async middleware in sync execution', () => {
        const container = new Container();
        const token = createToken<string>('test');

        pipeline.use(
          createMiddleware({
            name: 'async',
            execute: async (ctx, next) => {
              await Promise.resolve();
              return next();
            },
          })
        );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        expect(() => pipeline.executeSync(context, () => 'result')).toThrow('async/sync mismatch');
      });

      it('should throw error when next() is called multiple times in sync mode', () => {
        const container = new Container();
        const token = createToken<string>('test');

        pipeline.use(
          createMiddleware({
            name: 'bad',
            execute: (ctx, next) => {
              next();
              return next(); // Second call should throw
            },
          })
        );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        expect(() => pipeline.executeSync(context, () => 'result')).toThrow('next() multiple times');
      });
    });
  });

  describe('createMiddleware', () => {
    it('should create middleware from config', () => {
      const config = {
        name: 'test',
        priority: 50,
        execute: (ctx: MiddlewareContext, next: () => any) => next(),
      };

      const middleware = createMiddleware(config);

      expect(middleware.name).toBe('test');
      expect(middleware.priority).toBe(50);
      expect(middleware.execute).toBe(config.execute);
    });
  });

  describe('LoggingMiddleware', () => {
    it('should have correct name and priority', () => {
      expect(LoggingMiddleware.name).toBe('logging');
      expect(LoggingMiddleware.priority).toBe(100);
    });

    it('should pass through results', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(LoggingMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      const result = await pipeline.execute(context, () => 'logged-result');

      expect(result).toBe('logged-result');

      await container.dispose();
    });

    it('should handle async results', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(LoggingMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      const result = await pipeline.execute(context, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'async-logged-result';
      });

      expect(result).toBe('async-logged-result');

      await container.dispose();
    });

    it('should propagate errors', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(LoggingMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      await expect(
        pipeline.execute(context, () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      await container.dispose();
    });

    it('should work with createLoggingMiddleware with custom logger', async () => {
      const logs: string[] = [];
      const customLogger = {
        child: () => ({
          debug: (msg: any) => logs.push(typeof msg === 'string' ? msg : JSON.stringify(msg)),
          error: (msg: any) => logs.push(typeof msg === 'string' ? msg : JSON.stringify(msg)),
        }),
      };

      const middleware = createLoggingMiddleware(customLogger as any);
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(middleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      await pipeline.execute(context, () => 'result');

      expect(logs.length).toBeGreaterThan(0);

      await container.dispose();
    });
  });

  describe('CachingMiddleware', () => {
    it('should have correct name and priority', () => {
      expect(CachingMiddleware.name).toBe('caching');
      expect(CachingMiddleware.priority).toBe(90);
    });

    it('should pass through when no cache is configured', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(CachingMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      let callCount = 0;
      const result = await pipeline.execute(context, () => {
        callCount++;
        return 'result';
      });

      expect(result).toBe('result');
      expect(callCount).toBe(1);

      await container.dispose();
    });

    it('should cache results when cache is configured', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const cache = new Map();
      (container as any).__middlewareCache = cache;

      const pipeline = new MiddlewarePipeline().use(CachingMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      let callCount = 0;

      // First call
      const result1 = await pipeline.execute(context, () => {
        callCount++;
        return 'cached-result';
      });

      // Second call should use cache
      const result2 = await pipeline.execute(context, () => {
        callCount++;
        return 'cached-result';
      });

      expect(result1).toBe('cached-result');
      expect(result2).toBe('cached-result');
      expect(callCount).toBe(1);

      await container.dispose();
    });
  });

  describe('RetryMiddleware', () => {
    it('should have correct name and priority', () => {
      expect(RetryMiddleware.name).toBe('retry');
      expect(RetryMiddleware.priority).toBe(80);
    });

    it('should pass through on success for sync operations', () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(RetryMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      // Sync execution (via executeSync) - retry middleware just passes through
      const result = pipeline.executeSync(context, () => 'success');

      expect(result).toBe('success');
      expect(context.attempt).toBe(1);
    });

    it('should set attempt on context for sync operations', () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(RetryMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      pipeline.executeSync(context, () => {
        expect(context.attempt).toBe(1);
        return 'result';
      });
    });

    it('should retry on async failures using custom retry middleware', async () => {
      // Create a custom retry middleware for async retry testing
      const retry = createMiddleware({
        name: 'custom-retry',
        priority: 80,
        isRetryMiddleware: true,
        execute: async (context, next) => {
          const maxAttempts = 3;
          const delay = 10;
          let lastError: Error | null = null;

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              context.attempt = attempt;
              return await next();
            } catch (error) {
              lastError = error as Error;

              if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            }
          }

          throw lastError || new Error('All retry attempts failed');
        },
      } as any);

      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(retry);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      let attempts = 0;
      const result = await pipeline.execute(context, () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('not yet');
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);

      await container.dispose();
    });
  });

  describe('ValidationMiddleware', () => {
    it('should have correct name and priority', () => {
      expect(ValidationMiddleware.name).toBe('validation');
      expect(ValidationMiddleware.priority).toBe(95);
    });

    it('should pass through when no validation is configured', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(ValidationMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      const result = await pipeline.execute(context, () => 'result');

      expect(result).toBe('result');

      await container.dispose();
    });

    it('should throw on validation failure', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(ValidationMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
        validate: () => false,
      };

      await expect(pipeline.execute(context, () => 'result')).rejects.toThrow(ValidationError);

      await container.dispose();
    });

    it('should allow when validation passes', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(ValidationMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
        validate: () => true,
      };

      const result = await pipeline.execute(context, () => 'valid-result');

      expect(result).toBe('valid-result');

      await container.dispose();
    });

    it('should validate result when validateResult is configured', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(ValidationMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
        validateResult: (value: unknown) => value === 'valid',
      };

      await expect(pipeline.execute(context, () => 'invalid')).rejects.toThrow(ValidationError);

      await container.dispose();
    });
  });

  describe('TransactionMiddleware', () => {
    it('should have correct name and priority', () => {
      expect(TransactionMiddleware.name).toBe('transaction');
      expect(TransactionMiddleware.priority).toBe(70);
    });

    it('should pass through when no transaction is configured', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(TransactionMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      const result = await pipeline.execute(context, () => 'result');

      expect(result).toBe('result');

      await container.dispose();
    });

    it('should call begin and commit on success', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(TransactionMiddleware);

      const tx = {
        begin: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
      };

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
        transaction: tx,
      };

      const result = await pipeline.execute(context, () => 'tx-result');

      expect(result).toBe('tx-result');
      expect(tx.begin).toHaveBeenCalled();
      expect(tx.commit).toHaveBeenCalled();
      expect(tx.rollback).not.toHaveBeenCalled();

      await container.dispose();
    });

    it('should call begin and rollback on failure with async transactions', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(TransactionMiddleware);

      const tx = {
        begin: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
      };

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
        transaction: tx,
      };

      await expect(
        pipeline.execute(context, async () => {
          throw new Error('tx error');
        })
      ).rejects.toThrow('tx error');

      expect(tx.begin).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalled();

      await container.dispose();
    });

    it('should call begin and rollback on failure with sync transactions', () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(TransactionMiddleware);

      const tx = {
        begin: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
      };

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
        transaction: tx,
      };

      expect(() =>
        pipeline.executeSync(context, () => {
          throw new Error('tx error');
        })
      ).toThrow('tx error');

      // Note: tx.begin is called twice - once in the initial check (line 450) and once in sync handling (line 474)
      expect(tx.begin).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalled();
    });

    it('should handle async transactions', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(TransactionMiddleware);

      const tx = {
        begin: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
      };

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
        transaction: tx,
      };

      const result = await pipeline.execute(context, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'async-tx-result';
      });

      expect(result).toBe('async-tx-result');
      expect(tx.begin).toHaveBeenCalled();
      expect(tx.commit).toHaveBeenCalled();

      await container.dispose();
    });
  });

  describe('CircuitBreakerMiddleware', () => {
    it('should have correct name and priority', () => {
      const cb = new CircuitBreakerMiddleware();
      expect(cb.name).toBe('circuit-breaker');
      expect(cb.priority).toBe(85);
    });

    it('should pass through on success (closed state)', async () => {
      const cb = new CircuitBreakerMiddleware({ threshold: 3 });
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(cb);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      const result = await pipeline.execute(context, () => 'success');

      expect(result).toBe('success');

      await container.dispose();
    });

    it('should open circuit after threshold failures', async () => {
      const cb = new CircuitBreakerMiddleware({ threshold: 3, resetTimeout: 60000 });
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(cb);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      // Cause failures up to threshold
      for (let i = 0; i < 3; i++) {
        await expect(
          pipeline.execute(context, () => {
            throw new Error('failure');
          })
        ).rejects.toThrow('failure');
      }

      // Next call should be rejected immediately (circuit open)
      await expect(pipeline.execute(context, () => 'success')).rejects.toThrow('Circuit breaker is open');

      await container.dispose();
    });

    it('should transition to half-open after reset timeout', async () => {
      const cb = new CircuitBreakerMiddleware({ threshold: 2, resetTimeout: 50 });
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(cb);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          pipeline.execute(context, () => {
            throw new Error('failure');
          })
        ).rejects.toThrow('failure');
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should allow a test request (half-open)
      const result = await pipeline.execute(context, () => 'recovered');
      expect(result).toBe('recovered');

      await container.dispose();
    });

    it('should close circuit on success in half-open state', async () => {
      const cb = new CircuitBreakerMiddleware({ threshold: 2, resetTimeout: 50 });
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(cb);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          pipeline.execute(context, () => {
            throw new Error('failure');
          })
        ).rejects.toThrow('failure');
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Success should close the circuit
      await pipeline.execute(context, () => 'success');

      // Additional calls should work
      const result = await pipeline.execute(context, () => 'working');
      expect(result).toBe('working');

      await container.dispose();
    });

    it('should track failures per key', async () => {
      const cb = new CircuitBreakerMiddleware({ threshold: 2 });
      const container = new Container();
      const token1 = createToken<string>('service1');
      const token2 = createToken<string>('service2');
      const pipeline = new MiddlewarePipeline().use(cb);

      const context1: MiddlewareContext = {
        token: token1,
        container,
        metadata: {},
      };

      const context2: MiddlewareContext = {
        token: token2,
        container,
        metadata: {},
      };

      // Fail service1
      for (let i = 0; i < 2; i++) {
        await expect(
          pipeline.execute(context1, () => {
            throw new Error('failure');
          })
        ).rejects.toThrow('failure');
      }

      // service1 should be open
      await expect(pipeline.execute(context1, () => 'success')).rejects.toThrow('Circuit breaker is open');

      // service2 should still work
      const result = await pipeline.execute(context2, () => 'service2-success');
      expect(result).toBe('service2-success');

      await container.dispose();
    });

    it('should implement install method for container', () => {
      const cb = new CircuitBreakerMiddleware();
      const mockContainer = {
        addMiddleware: vi.fn(),
      };

      cb.install(mockContainer);

      expect(mockContainer.addMiddleware).toHaveBeenCalledWith(cb);
    });
  });

  describe('RateLimitMiddleware', () => {
    it('should have correct name and priority', () => {
      const rl = new RateLimitMiddleware();
      expect(rl.name).toBe('rate-limit');
      expect(rl.priority).toBe(88);
    });

    it('should allow requests within limit', async () => {
      const rl = new RateLimitMiddleware(5, 1000); // 5 requests per second
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(rl);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      for (let i = 0; i < 5; i++) {
        const result = await pipeline.execute(context, () => `result-${i}`);
        expect(result).toBe(`result-${i}`);
      }

      await container.dispose();
    });

    it('should reject requests over limit', async () => {
      const rl = new RateLimitMiddleware(3, 1000); // 3 requests per second
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(rl);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        await pipeline.execute(context, () => 'ok');
      }

      // 4th request should be rejected
      await expect(pipeline.execute(context, () => 'too many')).rejects.toThrow('Too many requests');

      await container.dispose();
    });

    it('should reset after window expires', async () => {
      const rl = new RateLimitMiddleware(2, 50); // 2 requests per 50ms
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(rl);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      // Use up the limit
      await pipeline.execute(context, () => 'first');
      await pipeline.execute(context, () => 'second');

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should work again
      const result = await pipeline.execute(context, () => 'third');
      expect(result).toBe('third');

      await container.dispose();
    });

    it('should use rateLimitKey from context', async () => {
      const rl = new RateLimitMiddleware(2, 1000);
      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(rl);

      const context1: MiddlewareContext = {
        token,
        container,
        metadata: {},
        rateLimitKey: 'user1',
      };

      const context2: MiddlewareContext = {
        token,
        container,
        metadata: {},
        rateLimitKey: 'user2',
      };

      // Use up user1's limit
      await pipeline.execute(context1, () => 'u1-1');
      await pipeline.execute(context1, () => 'u1-2');

      // user1 should be limited
      await expect(pipeline.execute(context1, () => 'u1-3')).rejects.toThrow('Too many requests');

      // user2 should still be able to make requests
      const result = await pipeline.execute(context2, () => 'u2-1');
      expect(result).toBe('u2-1');

      await container.dispose();
    });
  });

  describe('composeMiddleware', () => {
    it('should compose multiple middleware into one', async () => {
      const order: string[] = [];

      const a = createMiddleware({
        name: 'a',
        priority: 100,
        execute: (ctx, next) => {
          order.push('a-before');
          const result = next();
          if (result instanceof Promise) {
            return result.then((r) => {
              order.push('a-after');
              return r;
            });
          }
          order.push('a-after');
          return result;
        },
      });

      const b = createMiddleware({
        name: 'b',
        priority: 50,
        execute: (ctx, next) => {
          order.push('b-before');
          const result = next();
          if (result instanceof Promise) {
            return result.then((r) => {
              order.push('b-after');
              return r;
            });
          }
          order.push('b-after');
          return result;
        },
      });

      const composed = composeMiddleware(a, b);

      expect(composed.name).toBe('composed');

      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(composed);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      const result = await pipeline.execute(context, () => {
        order.push('final');
        return 'composed-result';
      });

      expect(result).toBe('composed-result');
      expect(order).toEqual(['a-before', 'b-before', 'final', 'b-after', 'a-after']);

      await container.dispose();
    });

    it('should handle empty middleware array', async () => {
      const composed = composeMiddleware();

      const container = new Container();
      const token = createToken<string>('test');
      const pipeline = new MiddlewarePipeline().use(composed);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      const result = await pipeline.execute(context, () => 'direct');

      expect(result).toBe('direct');

      await container.dispose();
    });
  });

  describe('Integration Tests', () => {
    it('should work with multiple middleware in correct order', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const order: string[] = [];

      const pipeline = new MiddlewarePipeline()
        .use(LoggingMiddleware)
        .use(CachingMiddleware)
        .use(RetryMiddleware)
        .use(ValidationMiddleware)
        .use(TransactionMiddleware);

      // Add tracking middleware
      const tracking = createMiddleware({
        name: 'tracking',
        priority: 0, // Lowest priority, runs last (innermost)
        execute: (ctx, next) => {
          order.push('tracking');
          return next();
        },
      });
      pipeline.use(tracking);

      const _context: MiddlewareContext = {
        token,
        container,
        metadata: {},
      };

      const all = pipeline.getAll();
      expect(all[0].name).toBe('logging'); // 100
      expect(all[1].name).toBe('validation'); // 95
      expect(all[2].name).toBe('caching'); // 90
      expect(all[3].name).toBe('retry'); // 80
      expect(all[4].name).toBe('transaction'); // 70
      expect(all[5].name).toBe('tracking'); // 0

      await container.dispose();
    });

    it('should handle complex middleware chain with errors', async () => {
      const container = new Container();
      const token = createToken<string>('test');
      const cb = new CircuitBreakerMiddleware({ threshold: 5 });
      const rl = new RateLimitMiddleware(100, 60000);

      const pipeline = new MiddlewarePipeline().use(LoggingMiddleware).use(rl).use(cb).use(ValidationMiddleware);

      const context: MiddlewareContext = {
        token,
        container,
        metadata: {},
        validate: () => false,
      };

      await expect(pipeline.execute(context, () => 'result')).rejects.toThrow(ValidationError);

      await container.dispose();
    });
  });

  describe('Edge Cases and Additional Coverage', () => {
    describe('LoggingMiddleware sync path', () => {
      it('should log sync success without promise', () => {
        const container = new Container();
        const token = createToken<string>('test');
        const pipeline = new MiddlewarePipeline().use(LoggingMiddleware);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        const result = pipeline.executeSync(context, () => 'sync-logged');

        expect(result).toBe('sync-logged');
      });

      it('should log sync error without promise', () => {
        const container = new Container();
        const token = createToken<string>('test');
        const pipeline = new MiddlewarePipeline().use(LoggingMiddleware);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        expect(() =>
          pipeline.executeSync(context, () => {
            throw new Error('sync error');
          })
        ).toThrow('sync error');
      });
    });

    describe('CachingMiddleware with different token types', () => {
      it('should handle symbol tokens', async () => {
        const container = new Container();
        const symbolToken = Symbol('test-symbol') as any;
        const cache = new Map();
        (container as any).__middlewareCache = cache;

        const pipeline = new MiddlewarePipeline().use(CachingMiddleware);

        const context: MiddlewareContext = {
          token: symbolToken,
          container,
          metadata: {},
        };

        let callCount = 0;
        await pipeline.execute(context, () => {
          callCount++;
          return 'symbol-cached';
        });

        expect(callCount).toBe(1);

        await container.dispose();
      });

      it('should handle string tokens', async () => {
        const container = new Container();
        const stringToken = 'string-token' as any;
        const cache = new Map();
        (container as any).__middlewareCache = cache;

        const pipeline = new MiddlewarePipeline().use(CachingMiddleware);

        const context: MiddlewareContext = {
          token: stringToken,
          container,
          metadata: {},
        };

        let callCount = 0;
        await pipeline.execute(context, () => {
          callCount++;
          return 'string-cached';
        });

        expect(callCount).toBe(1);

        await container.dispose();
      });

      it('should handle sync caching path', () => {
        const container = new Container();
        const token = createToken<string>('test');
        const cache = new Map();
        (container as any).__middlewareCache = cache;

        const pipeline = new MiddlewarePipeline().use(CachingMiddleware);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        let callCount = 0;
        const result = pipeline.executeSync(context, () => {
          callCount++;
          return 'sync-cached';
        });

        expect(result).toBe('sync-cached');
        expect(callCount).toBe(1);
      });
    });

    describe('CircuitBreakerMiddleware sync paths', () => {
      it('should handle sync success in closed state', () => {
        const cb = new CircuitBreakerMiddleware({ threshold: 3 });
        const container = new Container();
        const token = createToken<string>('test');
        const pipeline = new MiddlewarePipeline().use(cb);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        const result = pipeline.executeSync(context, () => 'sync-success');

        expect(result).toBe('sync-success');
      });

      it('should handle sync failure and open circuit', () => {
        const cb = new CircuitBreakerMiddleware({ threshold: 2 });
        const container = new Container();
        const token = createToken<string>('test');
        const pipeline = new MiddlewarePipeline().use(cb);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        // Cause sync failures
        for (let i = 0; i < 2; i++) {
          expect(() =>
            pipeline.executeSync(context, () => {
              throw new Error('sync failure');
            })
          ).toThrow('sync failure');
        }

        // Circuit should be open
        expect(() => pipeline.executeSync(context, () => 'should not reach')).toThrow('Circuit breaker is open');
      });

      it('should close circuit on sync success in half-open state', async () => {
        const cb = new CircuitBreakerMiddleware({ threshold: 2, resetTimeout: 50 });
        const container = new Container();
        const token = createToken<string>('test');
        const pipeline = new MiddlewarePipeline().use(cb);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        // Open the circuit with sync failures
        for (let i = 0; i < 2; i++) {
          expect(() =>
            pipeline.executeSync(context, () => {
              throw new Error('sync failure');
            })
          ).toThrow('sync failure');
        }

        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 60));

        // Sync success should close the circuit
        const result = pipeline.executeSync(context, () => 'recovered');
        expect(result).toBe('recovered');

        await container.dispose();
      });
    });

    describe('ValidationMiddleware sync paths', () => {
      it('should validate sync result', () => {
        const container = new Container();
        const token = createToken<string>('test');
        const pipeline = new MiddlewarePipeline().use(ValidationMiddleware);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
          validateResult: (value: unknown) => value === 'valid',
        };

        // Should fail validation
        expect(() => pipeline.executeSync(context, () => 'invalid')).toThrow(ValidationError);
      });

      it('should pass sync result validation', () => {
        const container = new Container();
        const token = createToken<string>('test');
        const pipeline = new MiddlewarePipeline().use(ValidationMiddleware);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
          validateResult: (value: unknown) => value === 'valid',
        };

        const result = pipeline.executeSync(context, () => 'valid');
        expect(result).toBe('valid');
      });
    });

    describe('Middleware pipeline skip behavior', () => {
      it('should skip middleware when condition returns false', async () => {
        const container = new Container();
        const token = createToken<string>('skip-test');
        const executed: string[] = [];

        const pipeline = new MiddlewarePipeline()
          .use(
            createMiddleware({
              name: 'skipper',
              condition: (ctx) => ctx.token.name !== 'skip-test',
              execute: (ctx, next) => {
                executed.push('skipped-middleware');
                return next();
              },
            })
          )
          .use(
            createMiddleware({
              name: 'runner',
              execute: (ctx, next) => {
                executed.push('running-middleware');
                return next();
              },
            })
          );

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        await pipeline.execute(context, () => 'result');

        expect(executed).toEqual(['running-middleware']);
        expect(executed).not.toContain('skipped-middleware');

        await container.dispose();
      });
    });

    describe('CachingMiddleware with async results', () => {
      it('should cache async results using built-in CachingMiddleware', async () => {
        const container = new Container();
        const token = createToken<string>('async-cache-test');
        const cache = new Map();
        (container as any).__middlewareCache = cache;

        const pipeline = new MiddlewarePipeline().use(CachingMiddleware);

        const context: MiddlewareContext = {
          token,
          container,
          metadata: {},
        };

        let callCount = 0;

        // First async call
        const result1 = await pipeline.execute(context, async () => {
          callCount++;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return 'async-cached';
        });

        // Second call should use cache
        const result2 = await pipeline.execute(context, async () => {
          callCount++;
          return 'should-not-call';
        });

        expect(result1).toBe('async-cached');
        expect(result2).toBe('async-cached');
        expect(callCount).toBe(1);

        await container.dispose();
      });
    });
  });
});
