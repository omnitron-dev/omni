/**
 * Lock Decorators Tests
 *
 * Comprehensive unit tests for the @WithDistributedLock and @Lock decorators.
 * Tests cover decorator application, lock service injection, lock acquisition/release,
 * concurrent execution prevention, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WithDistributedLock, Lock } from '../src/lock.decorators.js';
import type { IDistributedLockService } from '../src/lock.types.js';

type Mock = ReturnType<typeof vi.fn>;

describe('Lock Decorators', () => {
  let mockLockService: IDistributedLockService;
  let mockLogger: { debug: Mock };

  beforeEach(() => {
    // Reset all mocks before each test
    mockLogger = {
      debug: vi.fn(),
    };

    mockLockService = {
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
      extendLock: vi.fn(),
      withLock: vi.fn(),
      isLocked: vi.fn(),
      getLockTtl: vi.fn(),
    };
  });

  describe('Decorator Application', () => {
    it('should throw error when applied to non-function', () => {
      expect(() => {
        class TestService {
          @WithDistributedLock('test-lock')
          // @ts-expect-error - intentionally testing invalid decorator application
          testProperty: string = 'value';
        }
        new TestService();
      }).toThrow(); // Will throw "Cannot read properties of undefined" because properties don't have descriptors
    });

    it('should successfully apply to async methods', () => {
      expect(() => {
        class TestService {
          __lockService__ = mockLockService;

          @WithDistributedLock('test-lock')
          async testMethod(): Promise<string> {
            return 'success';
          }
        }
        new TestService();
      }).not.toThrow();
    });

    it('should successfully apply to synchronous methods (will be wrapped as async)', () => {
      expect(() => {
        class TestService {
          __lockService__ = mockLockService;

          @WithDistributedLock('test-lock')
          testMethod(): string {
            return 'success';
          }
        }
        new TestService();
      }).not.toThrow();
    });

    it('should successfully apply multiple decorators to same class', () => {
      expect(() => {
        class TestService {
          __lockService__ = mockLockService;

          @WithDistributedLock('lock-1')
          async method1(): Promise<void> {}

          @WithDistributedLock('lock-2')
          async method2(): Promise<void> {}
        }
        new TestService();
      }).not.toThrow();
    });

    it('should accept custom TTL parameter', () => {
      expect(() => {
        class TestService {
          __lockService__ = mockLockService;

          @WithDistributedLock('test-lock', 5000)
          async testMethod(): Promise<void> {}
        }
        new TestService();
      }).not.toThrow();
    });

    it('should use default TTL when not specified', () => {
      expect(() => {
        class TestService {
          __lockService__ = mockLockService;

          @WithDistributedLock('test-lock')
          async testMethod(): Promise<void> {}
        }
        new TestService();
      }).not.toThrow();
    });
  });

  describe('Lock Service Injection Requirement', () => {
    it('should throw error when __lockService__ is not injected', async () => {
      class TestService {
        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'should not reach here';
        }
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toThrow(
        'DistributedLockService not found on TestService. ' +
          'Ensure the service is injected as __lockService__ with @Inject(LOCK_SERVICE_TOKEN).'
      );
    });

    it('should throw error with correct class name', async () => {
      class MyCustomService {
        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'should not reach here';
        }
      }

      const service = new MyCustomService();
      await expect(service.testMethod()).rejects.toThrow('DistributedLockService not found on MyCustomService');
    });

    it('should throw error when __lockService__ is undefined', async () => {
      class TestService {
        __lockService__?: IDistributedLockService = undefined;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'should not reach here';
        }
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toThrow('DistributedLockService not found');
    });

    it('should throw error when __lockService__ is null', async () => {
      class TestService {
        __lockService__: IDistributedLockService | null = null;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'should not reach here';
        }
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toThrow('DistributedLockService not found');
    });

    it('should work when __lockService__ is properly injected', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'success';
        }
      }

      const service = new TestService();
      const result = await service.testMethod();
      expect(result).toBe('success');
    });
  });

  describe('Lock Acquisition Before Method Execution', () => {
    it('should attempt to acquire lock before executing method', async () => {
      let lockAcquired = false;
      let methodExecuted = false;

      (mockLockService.acquireLock as Mock).mockImplementation(async () => {
        lockAcquired = true;
        expect(methodExecuted).toBe(false); // Method should not have executed yet
        return 'lock-id-123';
      });
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock', 30000)
        async testMethod(): Promise<void> {
          methodExecuted = true;
          expect(lockAcquired).toBe(true); // Lock should have been acquired first
        }
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('test-lock', 30000);
      expect(lockAcquired).toBe(true);
      expect(methodExecuted).toBe(true);
    });

    it('should pass correct lock key to acquireLock', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('my-custom-lock-key')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('my-custom-lock-key', 60000);
    });

    it('should pass correct TTL to acquireLock', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock', 15000)
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('test-lock', 15000);
    });

    it('should use default TTL of 60000ms when not specified', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('test-lock', 60000);
    });

    it('should execute method when lock is acquired', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      let methodExecuted = false;

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          methodExecuted = true;
        }
      }

      const service = new TestService();
      await service.testMethod();

      expect(methodExecuted).toBe(true);
    });

    it('should return method result when lock is acquired', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<{ data: string }> {
          return { data: 'test-result' };
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toEqual({ data: 'test-result' });
    });

    it('should pass method arguments correctly', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(a: number, b: string, c: boolean): Promise<string> {
          return `${a}-${b}-${c}`;
        }
      }

      const service = new TestService();
      const result = await service.testMethod(42, 'test', true);

      expect(result).toBe('42-test-true');
    });
  });

  describe('Skip Behavior When Lock is Held', () => {
    it('should skip execution when lock cannot be acquired', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue(null);

      let methodExecuted = false;

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          methodExecuted = true;
        }
      }

      const service = new TestService();
      await service.testMethod();

      expect(methodExecuted).toBe(false);
    });

    it('should return undefined when lock is held', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue(null);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'should not return this';
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBeUndefined();
    });

    it('should not call releaseLock when lock is not acquired', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue(null);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.releaseLock).not.toHaveBeenCalled();
    });

    it('should log debug message when lock is held and logger is available', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue(null);

      class TestService {
        __lockService__ = mockLockService;
        logger = mockLogger;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { lockKey: 'test-lock', method: 'testMethod' },
        '[WithDistributedLock] Lock held by another instance, skipping'
      );
    });

    it('should log debug message using loggerModule when logger is not available', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue(null);

      class TestService {
        __lockService__ = mockLockService;
        loggerModule = { logger: mockLogger };

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { lockKey: 'test-lock', method: 'testMethod' },
        '[WithDistributedLock] Lock held by another instance, skipping'
      );
    });

    it('should not throw error when logger is not available', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue(null);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await expect(service.testMethod()).resolves.toBeUndefined();
    });

    it('should prefer logger over loggerModule when both are available', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue(null);

      const secondLogger = { debug: vi.fn() };

      class TestService {
        __lockService__ = mockLockService;
        logger = mockLogger;
        loggerModule = { logger: secondLogger };

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(secondLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe('Lock Release After Execution', () => {
    it('should release lock after successful execution', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'success';
        }
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.releaseLock).toHaveBeenCalledWith('test-lock', 'lock-id-123');
    });

    it('should release lock with correct lockId', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('unique-lock-id-456');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.releaseLock).toHaveBeenCalledWith('test-lock', 'unique-lock-id-456');
    });

    it('should call releaseLock exactly once', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.releaseLock).toHaveBeenCalledTimes(1);
    });

    it('should release lock after method completes', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      const executionOrder: string[] = [];

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          executionOrder.push('method-executed');
        }
      }

      const service = new TestService();
      await service.testMethod();

      // Capture when releaseLock was called
      expect(mockLockService.releaseLock).toHaveBeenCalled();
      expect(executionOrder).toContain('method-executed');
    });

    it('should work even if releaseLock returns false', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(false);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'success';
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBe('success');
      expect(mockLockService.releaseLock).toHaveBeenCalled();
    });
  });

  describe('Lock Release Even When Method Throws', () => {
    it('should release lock when method throws error', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          throw new Error('Method error');
        }
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toThrow('Method error');

      expect(mockLockService.releaseLock).toHaveBeenCalledWith('test-lock', 'lock-id-123');
    });

    it('should release lock when method throws custom error', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          throw new CustomError('Custom error occurred');
        }
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toThrow(CustomError);

      expect(mockLockService.releaseLock).toHaveBeenCalledWith('test-lock', 'lock-id-123');
    });

    it('should release lock when method throws string', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          throw 'String error';
        }
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toBe('String error');

      expect(mockLockService.releaseLock).toHaveBeenCalledWith('test-lock', 'lock-id-123');
    });

    it('should propagate error after releasing lock', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          throw new Error('Original error');
        }
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toThrow('Original error');
    });

    it('should release lock even if releaseLock fails', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockRejectedValue(new Error('Release failed'));

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          throw new Error('Method error');
        }
      }

      const service = new TestService();
      // The name of this test is about the release being ATTEMPTED, and that
      // still holds. What the assertion used to pin was a different thing: that
      // an awaited throw inside `finally` takes precedence over the method's
      // own error — a language mechanic, described in the comment here as
      // "expected behavior", but not a contract anyone would choose. It meant
      // the caller learned why the CLEANUP failed and never why their call did.
      await expect(service.testMethod()).rejects.toThrow('Method error');

      expect(mockLockService.releaseLock).toHaveBeenCalled();
    });

    it('should release lock when method rejects promise', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          return Promise.reject(new Error('Promise rejected'));
        }
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toThrow('Promise rejected');

      expect(mockLockService.releaseLock).toHaveBeenCalled();
    });
  });

  describe('Concurrent Execution Prevention', () => {
    it('should prevent concurrent execution of same method', async () => {
      let lockCount = 0;
      (mockLockService.acquireLock as Mock).mockImplementation(async () => {
        lockCount++;
        if (lockCount === 1) {
          return 'lock-id-123';
        }
        return null; // Second call fails to acquire
      });
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      let executionCount = 0;

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {
          executionCount++;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const service = new TestService();

      // Start two concurrent calls
      const [result1, result2] = await Promise.all([service.testMethod(), service.testMethod()]);

      expect(executionCount).toBe(1); // Only one should execute
      expect(result1).toBeUndefined(); // One returns undefined (skipped)
      expect(result2).toBeUndefined(); // One returns undefined (skipped)
    });

    it('should allow sequential execution after lock is released', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      let executionCount = 0;

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<number> {
          executionCount++;
          return executionCount;
        }
      }

      const service = new TestService();

      const result1 = await service.testMethod();
      const result2 = await service.testMethod();

      expect(result1).toBe(1);
      expect(result2).toBe(2);
      expect(executionCount).toBe(2);
    });

    it('should use different locks for different methods', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('lock-1')
        async method1(): Promise<string> {
          return 'method1';
        }

        @WithDistributedLock('lock-2')
        async method2(): Promise<string> {
          return 'method2';
        }
      }

      const service = new TestService();

      await service.method1();
      await service.method2();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('lock-1', 60000);
      expect(mockLockService.acquireLock).toHaveBeenCalledWith('lock-2', 60000);
    });

    it('should maintain correct this context during execution', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;
        instanceValue = 'test-instance';

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return this.instanceValue;
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBe('test-instance');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined return value', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<undefined> {
          return undefined;
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBeUndefined();
      expect(mockLockService.releaseLock).toHaveBeenCalled();
    });

    it('should handle null return value', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<null> {
          return null;
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBeNull();
      expect(mockLockService.releaseLock).toHaveBeenCalled();
    });

    it('should handle empty string lock key', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('', 60000);
    });

    it('should handle zero TTL', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock', 0)
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('test-lock', 0);
    });

    it('should handle negative TTL', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock', -1000)
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('test-lock', -1000);
    });

    it('should handle very large TTL', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock', 999999999)
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith('test-lock', 999999999);
    });

    it('should handle method with no parameters', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return 'success';
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBe('success');
    });

    it('should handle method with many parameters', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(a: number, b: string, c: boolean, d: object, e: unknown[]): Promise<number> {
          return a + e.length;
        }
      }

      const service = new TestService();
      const result = await service.testMethod(10, 'test', true, {}, [1, 2, 3]);

      expect(result).toBe(13);
    });

    it('should handle complex object return values', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      const complexObject = {
        nested: {
          array: [1, 2, 3],
          map: new Map([['key', 'value']]),
        },
        date: new Date('2024-01-01'),
      };

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<typeof complexObject> {
          return complexObject;
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBe(complexObject);
    });

    it('should handle acquireLock throwing error', async () => {
      (mockLockService.acquireLock as Mock).mockRejectedValue(new Error('Lock service error'));

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await expect(service.testMethod()).rejects.toThrow('Lock service error');
    });

    it('should handle special characters in lock key', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test:lock:with:colons:and-dashes_and_underscores')
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      await service.testMethod();

      expect(mockLockService.acquireLock).toHaveBeenCalledWith(
        'test:lock:with:colons:and-dashes_and_underscores',
        60000
      );
    });
  });

  describe('@Lock Alias', () => {
    it('should be an alias for @WithDistributedLock', () => {
      expect(Lock).toBe(WithDistributedLock);
    });

    it('should work the same as @WithDistributedLock', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @Lock('test-lock', 30000)
        async testMethod(): Promise<string> {
          return 'success';
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBe('success');
      expect(mockLockService.acquireLock).toHaveBeenCalledWith('test-lock', 30000);
      expect(mockLockService.releaseLock).toHaveBeenCalledWith('test-lock', 'lock-id-123');
    });
  });

  describe('Symbol Property Keys', () => {
    it('should handle symbol property keys', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      const testSymbol = Symbol('testMethod');

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('test-lock')
        async [testSymbol](): Promise<string> {
          return 'success';
        }
      }

      const service = new TestService();
      const result = await service[testSymbol]();

      expect(result).toBe('success');
    });

    it('should log correct symbol method name when lock is held', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue(null);

      const testSymbol = Symbol('testMethod');

      class TestService {
        __lockService__ = mockLockService;
        logger = mockLogger;

        @WithDistributedLock('test-lock')
        async [testSymbol](): Promise<void> {}
      }

      const service = new TestService();
      await service[testSymbol]();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { lockKey: 'test-lock', method: expect.stringContaining('testMethod') },
        '[WithDistributedLock] Lock held by another instance, skipping'
      );
    });
  });

  describe('Method Context Preservation', () => {
    it('should preserve class instance properties', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;
        counter = 0;

        @WithDistributedLock('test-lock')
        async increment(): Promise<number> {
          this.counter++;
          return this.counter;
        }
      }

      const service = new TestService();
      const result1 = await service.increment();
      const result2 = await service.increment();

      expect(result1).toBe(1);
      expect(result2).toBe(2);
      expect(service.counter).toBe(2);
    });

    it('should allow access to other instance methods', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        helper(): string {
          return 'helper-result';
        }

        @WithDistributedLock('test-lock')
        async testMethod(): Promise<string> {
          return this.helper();
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBe('helper-result');
    });

    it('should allow calling other decorated methods', async () => {
      (mockLockService.acquireLock as Mock).mockResolvedValue('lock-id-123');
      (mockLockService.releaseLock as Mock).mockResolvedValue(true);

      class TestService {
        __lockService__ = mockLockService;

        @WithDistributedLock('lock-1')
        async method1(): Promise<string> {
          return 'method1';
        }

        @WithDistributedLock('lock-2')
        async method2(): Promise<string> {
          const result1 = await this.method1();
          return `method2-${result1}`;
        }
      }

      const service = new TestService();
      const result = await service.method2();

      expect(result).toBe('method2-method1');
      expect(mockLockService.acquireLock).toHaveBeenCalledWith('lock-1', 60000);
      expect(mockLockService.acquireLock).toHaveBeenCalledWith('lock-2', 60000);
    });
  });
});

describe('Lock Decorators - release failure', () => {
  /**
   * The lock is released in a `finally`, and the release is awaited. An
   * exception from `releaseLock` therefore REPLACES whatever the decorated
   * method was about to return — a completed piece of work is discarded and the
   * caller is handed a Redis error instead, for a lock that will expire by its
   * own TTL a moment later.
   *
   * The same applies in the other direction: a method that threw for its own
   * reason had that reason overwritten by the release failure, which is the
   * worse of the two, because the original error is the one worth having.
   */
  function serviceWith(releaseImpl: () => Promise<boolean>) {
    const logs: Array<[unknown, string]> = [];
    const lockService = {
      acquireLock: vi.fn(async () => 'lock-id'),
      releaseLock: vi.fn(releaseImpl),
      extendLock: vi.fn(),
      withLock: vi.fn(),
      isLocked: vi.fn(),
      getLockTtl: vi.fn(),
    } as unknown as IDistributedLockService;

    class TestService {
      __lockService__ = lockService;
      logger = {
        debug: vi.fn(),
        warn: (obj: unknown, msg: string) => {
          logs.push([obj, msg]);
        },
      };

      @WithDistributedLock('release-fails')
      async work(): Promise<string> {
        return 'done';
      }

      @WithDistributedLock('release-fails')
      async failing(): Promise<string> {
        throw new Error('the real problem');
      }
    }

    return { service: new TestService(), logs, lockService };
  }

  it('returns the method result even when the release fails', async () => {
    const { service, logs } = serviceWith(async () => {
      throw new Error('redis went away');
    });

    await expect(service.work()).resolves.toBe('done');
    expect(logs.map(([, msg]) => msg).join('\n')).toMatch(/release/i);
  });

  it('keeps the method own error when the release also fails', async () => {
    const { service } = serviceWith(async () => {
      throw new Error('redis went away');
    });

    // The caller must learn why THEIR call failed, not why the cleanup did.
    await expect(service.failing()).rejects.toThrow('the real problem');
  });

  it('still releases the lock on the happy path', async () => {
    const { service, lockService, logs } = serviceWith(async () => true);

    await expect(service.work()).resolves.toBe('done');
    expect(lockService.releaseLock).toHaveBeenCalledWith('release-fails', 'lock-id');
    expect(logs).toHaveLength(0);
  });
});
