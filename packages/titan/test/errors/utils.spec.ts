/**
 * Comprehensive tests for error utilities
 */

import { describe, it, expect } from '@jest/globals';
import {
  tryAsync,
  trySync,
  handleError,
  ErrorHandlerChain,
  createErrorBoundary,
  retryWithBackoff,
  CircuitBreaker,
  ErrorLogger,
  ErrorMatcher,
} from '../../src/errors/utils.js';
import { TitanError } from '../../src/errors/core.js';
import { ErrorCode } from '../../src/errors/codes.js';

describe('Error Utilities', () => {
  describe('tryAsync()', () => {
    it('should return result on success', async () => {
      const result = await tryAsync(async () => 'success');

      expect(result).toBe('success');
    });

    it('should convert Error to TitanError', async () => {
      await expect(
        tryAsync(async () => {
          throw new Error('Something failed');
        })
      ).rejects.toThrow(TitanError);
    });

    it('should preserve TitanError', async () => {
      const original = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
      });

      await expect(
        tryAsync(async () => {
          throw original;
        })
      ).rejects.toThrow(original);
    });

    it('should use custom error code', async () => {
      try {
        await tryAsync(async () => {
          throw new Error('Failed');
        }, ErrorCode.BAD_REQUEST);
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        expect((error as TitanError).code).toBe(ErrorCode.BAD_REQUEST);
      }
    });

    it('should include cause', async () => {
      const original = new Error('Original error');

      try {
        await tryAsync(async () => {
          throw original;
        });
      } catch (error) {
        expect((error as any).cause).toBe(original);
      }
    });
  });

  describe('trySync()', () => {
    it('should return result on success', () => {
      const result = trySync(() => 'success');

      expect(result).toBe('success');
    });

    it('should convert Error to TitanError', () => {
      expect(() => {
        trySync(() => {
          throw new Error('Failed');
        });
      }).toThrow(TitanError);
    });

    it('should preserve TitanError', () => {
      const original = new TitanError({
        code: ErrorCode.FORBIDDEN,
        message: 'Forbidden',
      });

      expect(() => {
        trySync(() => {
          throw original;
        });
      }).toThrow(original);
    });

    it('should use custom error code', () => {
      try {
        trySync(() => {
          throw new Error('Failed');
        }, ErrorCode.SERVICE_UNAVAILABLE);
      } catch (error) {
        expect((error as TitanError).code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      }
    });
  });

  describe('handleError()', () => {
    it('should return result on success', async () => {
      const result = await handleError(async () => 'success', {});

      expect(result).toBe('success');
    });

    it('should handle specific error code', async () => {
      const result = await handleError(
        async () => {
          throw new TitanError({
            code: ErrorCode.NOT_FOUND,
            message: 'Not found',
          });
        },
        {
          [ErrorCode.NOT_FOUND]: async () => 'recovered',
        }
      );

      expect(result).toBe('recovered');
    });

    it('should use default handler', async () => {
      const result = await handleError(
        async () => {
          throw new TitanError({
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Error',
          });
        },
        {
          default: async () => 'default recovery',
        }
      );

      expect(result).toBe('default recovery');
    });

    it('should throw if no handler matches', async () => {
      await expect(
        handleError(
          async () => {
            throw new TitanError({
              code: ErrorCode.NOT_FOUND,
              message: 'Not found',
            });
          },
          {
            [ErrorCode.BAD_REQUEST]: async () => 'recovered',
          }
        )
      ).rejects.toThrow(TitanError);
    });

    it('should convert non-TitanError', async () => {
      const result = await handleError(
        async () => {
          throw new Error('Generic error');
        },
        {
          [ErrorCode.INTERNAL_ERROR]: async () => 'handled',
        }
      );

      expect(result).toBe('handled');
    });
  });

  describe('ErrorHandlerChain', () => {
    it('should add and execute handlers', async () => {
      const chain = new ErrorHandlerChain();
      const calls: string[] = [];

      chain.add(async () => {
        calls.push('handler1');
      });

      chain.add(async () => {
        calls.push('handler2');
      });

      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error',
      });

      await chain.handle(error);

      expect(calls).toEqual(['handler1', 'handler2']);
    });

    it('should filter handlers by condition', async () => {
      const chain = new ErrorHandlerChain();
      const calls: string[] = [];

      chain.add(
        async () => {
          calls.push('all');
        },
        () => true
      );

      chain.add(
        async () => {
          calls.push('not-found');
        },
        (error) => error.code === ErrorCode.NOT_FOUND
      );

      await chain.handle(new TitanError({ code: ErrorCode.BAD_REQUEST, message: 'Bad request' }));

      expect(calls).toEqual(['all']);
    });

    it('should add handler for specific error code', async () => {
      const chain = new ErrorHandlerChain();
      let handled = false;

      chain.addForCode(ErrorCode.NOT_FOUND, async () => {
        handled = true;
      });

      await chain.handle(new TitanError({ code: ErrorCode.NOT_FOUND, message: 'Not found' }));

      expect(handled).toBe(true);
    });

    it('should add handler for error category', async () => {
      const chain = new ErrorHandlerChain();
      let handled = false;

      chain.addForCategory('client', async () => {
        handled = true;
      });

      await chain.handle(new TitanError({ code: ErrorCode.BAD_REQUEST, message: 'Bad request' }));

      expect(handled).toBe(true);
    });
  });

  describe('createErrorBoundary()', () => {
    it('should return result on success', async () => {
      const boundary = createErrorBoundary('default');
      const result = await boundary(async () => 'success');

      expect(result).toBe('success');
    });

    it('should return default value on error', async () => {
      const boundary = createErrorBoundary('default');
      const result = await boundary(async () => {
        throw new Error('Failed');
      });

      expect(result).toBe('default');
    });

    it('should call onError callback', async () => {
      let errorCaught: TitanError | null = null;

      const boundary = createErrorBoundary('default', (error) => {
        errorCaught = error;
      });

      await boundary(async () => {
        throw new TitanError({ code: ErrorCode.NOT_FOUND, message: 'Not found' });
      });

      expect(errorCaught).toBeInstanceOf(TitanError);
      expect(errorCaught!.code).toBe(ErrorCode.NOT_FOUND);
    });

    it('should convert non-TitanError', async () => {
      let errorCaught: TitanError | null = null;

      const boundary = createErrorBoundary(null, (error) => {
        errorCaught = error;
      });

      await boundary(async () => {
        throw new Error('Generic error');
      });

      expect(errorCaught).toBeInstanceOf(TitanError);
    });
  });

  describe('retryWithBackoff()', () => {
    it('should return result on first success', async () => {
      const result = await retryWithBackoff(async () => 'success');

      expect(result).toBe('success');
    });

    it('should retry on failure', async () => {
      let attempts = 0;

      const result = await retryWithBackoff(async () => {
        attempts++;
        if (attempts < 3) {
          throw new TitanError({
            code: ErrorCode.SERVICE_UNAVAILABLE,
            message: 'Unavailable',
          });
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should respect maxAttempts', async () => {
      let attempts = 0;

      await expect(
        retryWithBackoff(
          async () => {
            attempts++;
            throw new TitanError({
              code: ErrorCode.SERVICE_UNAVAILABLE,
              message: 'Unavailable',
            });
          },
          { maxAttempts: 2 }
        )
      ).rejects.toThrow();

      expect(attempts).toBe(2);
    });

    it('should use exponential backoff', async () => {
      const delays: number[] = [];

      try {
        await retryWithBackoff(
          async () => {
            throw new TitanError({
              code: ErrorCode.SERVICE_UNAVAILABLE,
              message: 'Unavailable',
            });
          },
          {
            maxAttempts: 3,
            initialDelay: 100,
            backoffFactor: 2,
            onRetry: (_error, _attempt, delay) => {
              delays.push(delay);
            },
          }
        );
      } catch {
        // Expected to fail
      }

      expect(delays).toEqual([100, 200]);
    });

    it('should respect maxDelay', async () => {
      const delays: number[] = [];

      try {
        await retryWithBackoff(
          async () => {
            throw new TitanError({
              code: ErrorCode.SERVICE_UNAVAILABLE,
              message: 'Unavailable',
            });
          },
          {
            maxAttempts: 4,
            initialDelay: 1000,
            maxDelay: 1500,
            backoffFactor: 2,
            onRetry: (_error, _attempt, delay) => {
              delays.push(delay);
            },
          }
        );
      } catch {
        // Expected to fail
      }

      expect(delays[0]).toBe(1000);
      expect(delays[1]).toBe(1500); // Capped at maxDelay
      expect(delays[2]).toBe(1500);
    });

    it('should use custom shouldRetry', async () => {
      let attempts = 0;

      await expect(
        retryWithBackoff(
          async () => {
            attempts++;
            throw new TitanError({
              code: ErrorCode.BAD_REQUEST,
              message: 'Bad request',
            });
          },
          {
            shouldRetry: (error) => error.code === ErrorCode.SERVICE_UNAVAILABLE,
          }
        )
      ).rejects.toThrow();

      expect(attempts).toBe(1); // Should not retry
    });
  });

  describe('CircuitBreaker', () => {
    it('should execute successfully when closed', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 1000,
      });

      const result = await breaker.execute(async () => 'success');

      expect(result).toBe('success');
    });

    it('should open after failure threshold', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 1000,
      });

      // Trigger 3 failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failed');
          });
        } catch {
          // Expected to fail
        }
      }

      // Circuit should now be open
      await expect(breaker.execute(async () => 'success')).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 100,
      });

      // Trigger failures to open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failed');
          });
        } catch {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should allow one test request
      const result = await breaker.execute(async () => 'success');

      expect(result).toBe('success');
      expect(breaker.getState().state).toBe('closed');
    });

    it('should provide circuit state', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        resetTimeout: 1000,
      });

      const state = breaker.getState();

      expect(state.state).toBe('closed');
      expect(state.failures).toBe(0);
    });

    it('should reset circuit manually', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 10000,
      });

      // Trigger failure
      try {
        await breaker.execute(async () => {
          throw new Error('Failed');
        });
      } catch {
        // Expected
      }

      breaker.reset();

      const state = breaker.getState();
      expect(state.state).toBe('closed');
      expect(state.failures).toBe(0);
    });
  });

  describe('ErrorLogger', () => {
    it('should log server errors', () => {
      const logs: any[] = [];
      const logger = new ErrorLogger({
        logger: {
          error: (msg, data) => logs.push({ level: 'error', msg, data }),
          warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
          info: (msg, data) => logs.push({ level: 'info', msg, data }),
        },
      });

      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal error',
      });

      logger.log(error);

      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].msg).toBe('Internal error');
    });

    it('should log client errors as warnings', () => {
      const logs: any[] = [];
      const logger = new ErrorLogger({
        logger: {
          error: (msg, data) => logs.push({ level: 'error', msg, data }),
          warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
          info: (msg, data) => logs.push({ level: 'info', msg, data }),
        },
      });

      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Bad request',
      });

      logger.log(error);

      expect(logs[0].level).toBe('warn');
    });

    it('should include stack when configured', () => {
      const logs: any[] = [];
      const logger = new ErrorLogger({
        includeStack: true,
        logger: {
          error: (msg, data) => logs.push({ level: 'error', msg, data }),
          warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
          info: (msg, data) => logs.push({ level: 'info', msg, data }),
        },
      });

      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error',
      });

      logger.log(error);

      expect(logs[0].data.stack).toBeDefined();
    });

    it('should include context when configured', () => {
      const logs: any[] = [];
      const logger = new ErrorLogger({
        includeContext: true,
        logger: {
          error: (msg, data) => logs.push({ level: 'error', msg, data }),
          warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
          info: (msg, data) => logs.push({ level: 'info', msg, data }),
        },
      });

      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error',
        context: { userId: '123' },
      });

      logger.log(error);

      expect(logs[0].data.context).toEqual({ userId: '123' });
    });

    it('should filter errors', () => {
      const logs: any[] = [];
      const logger = new ErrorLogger({
        filter: (error) => error.code !== ErrorCode.NOT_FOUND,
        logger: {
          error: (msg, data) => logs.push({ level: 'error', msg, data }),
          warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
          info: (msg, data) => logs.push({ level: 'info', msg, data }),
        },
      });

      logger.log(new TitanError({ code: ErrorCode.NOT_FOUND, message: 'Not found' }));
      logger.log(new TitanError({ code: ErrorCode.INTERNAL_ERROR, message: 'Error' }));

      expect(logs).toHaveLength(1);
      expect(logs[0].data.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('should include correlation IDs', () => {
      const logs: any[] = [];
      const logger = new ErrorLogger({
        logger: {
          error: (msg, data) => logs.push({ level: 'error', msg, data }),
          warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
          info: (msg, data) => logs.push({ level: 'info', msg, data }),
        },
      });

      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error',
        requestId: 'req-123',
        correlationId: 'corr-456',
      });

      logger.log(error);

      expect(logs[0].data.requestId).toBe('req-123');
      expect(logs[0].data.correlationId).toBe('corr-456');
    });
  });

  describe('ErrorMatcher', () => {
    it('should match by error code', () => {
      const matcher = new ErrorMatcher().withCode(ErrorCode.NOT_FOUND);

      const error1 = new TitanError({ code: ErrorCode.NOT_FOUND, message: 'Not found' });
      const error2 = new TitanError({ code: ErrorCode.BAD_REQUEST, message: 'Bad request' });

      expect(matcher.matches(error1)).toBe(true);
      expect(matcher.matches(error2)).toBe(false);
    });

    it('should match by message string', () => {
      const matcher = new ErrorMatcher().withMessage('Not found');

      const error1 = new TitanError({ code: ErrorCode.NOT_FOUND, message: 'Not found' });
      const error2 = new TitanError({ code: ErrorCode.NOT_FOUND, message: 'User not found' });

      expect(matcher.matches(error1)).toBe(true);
      expect(matcher.matches(error2)).toBe(false);
    });

    it('should match by message regex', () => {
      const matcher = new ErrorMatcher().withMessage(/not found/i);

      const error1 = new TitanError({ code: ErrorCode.NOT_FOUND, message: 'User Not Found' });
      const error2 = new TitanError({ code: ErrorCode.NOT_FOUND, message: 'Missing' });

      expect(matcher.matches(error1)).toBe(true);
      expect(matcher.matches(error2)).toBe(false);
    });

    it('should match by details', () => {
      const matcher = new ErrorMatcher().withDetails((details) => details.userId === '123');

      const error1 = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
        details: { userId: '123' },
      });

      const error2 = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
        details: { userId: '456' },
      });

      expect(matcher.matches(error1)).toBe(true);
      expect(matcher.matches(error2)).toBe(false);
    });

    it('should combine multiple conditions', () => {
      const matcher = new ErrorMatcher()
        .withCode(ErrorCode.NOT_FOUND)
        .withMessage(/user/i)
        .withDetails((details) => details.id !== undefined);

      const matchingError = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'User not found',
        details: { id: '123' },
      });

      const nonMatchingError = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Post not found',
        details: { id: '123' },
      });

      expect(matcher.matches(matchingError)).toBe(true);
      expect(matcher.matches(nonMatchingError)).toBe(false);
    });
  });
});
