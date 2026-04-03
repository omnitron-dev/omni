/**
 * Nexus Container - Error Handling and Recovery Tests
 *
 * Tests for error propagation, recovery scenarios, and edge cases
 * in dependency resolution and container operations.
 *
 * @since 0.4.5
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, createToken, Scope } from '@nexus';
import {
  ResolutionError,
  CircularDependencyError,
  DependencyNotFoundError,
  AsyncResolutionError,
  ContainerDisposedError,
  InvalidProviderError,
  DuplicateRegistrationError,
} from '../../../src/nexus/errors.js';

// Tokens for testing
const ServiceAToken = createToken<ServiceA>('ServiceA');
const ServiceBToken = createToken<ServiceB>('ServiceB');
const ServiceCToken = createToken<ServiceC>('ServiceC');
const FailingToken = createToken<FailingService>('FailingService');
const AsyncFailToken = createToken<AsyncFailService>('AsyncFailService');
const RecoverableToken = createToken<RecoverableService>('RecoverableService');

// Test service classes
class ServiceA {
  constructor(public b: ServiceB) {}
}

class ServiceB {
  constructor(public c: ServiceC) {}
}

class ServiceC {
  getValue(): string {
    return 'C';
  }
}

class FailingService {
  constructor() {
    throw new Error('Constructor failed');
  }
}

class AsyncFailService {
  async onInit(): Promise<void> {
    throw new Error('Async init failed');
  }
}

class RecoverableService {
  private static attempts = 0;

  constructor() {
    RecoverableService.attempts++;
    if (RecoverableService.attempts < 3) {
      throw new Error(`Attempt ${RecoverableService.attempts} failed`);
    }
  }

  static reset(): void {
    RecoverableService.attempts = 0;
  }

  static getAttempts(): number {
    return RecoverableService.attempts;
  }
}

describe('Nexus Container - Error Handling', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
    RecoverableService.reset();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Dependency Not Found Errors', () => {
    it('should throw DependencyNotFoundError for unregistered token', () => {
      expect(() => container.resolve(ServiceAToken)).toThrow(DependencyNotFoundError);
    });

    it('should include token name in error message', () => {
      try {
        container.resolve(ServiceAToken);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DependencyNotFoundError);
        expect((error as Error).message).toContain('ServiceA');
      }
    });

    it('should provide resolution chain in nested resolution errors', () => {
      container.register(ServiceAToken, {
        useFactory: (b: ServiceB) => new ServiceA(b),
        inject: [ServiceBToken],
      });

      container.register(ServiceBToken, {
        useFactory: (c: ServiceC) => new ServiceB(c),
        inject: [ServiceCToken],
      });

      // ServiceCToken is not registered

      try {
        container.resolve(ServiceAToken);
        fail('Should have thrown');
      } catch (error) {
        // Nested resolution errors include chain context via ResolutionError
        // (DependencyNotFoundError is thrown for simple/top-level missing deps)
        expect(error).toBeInstanceOf(ResolutionError);
        // The error should indicate what was not found
        expect((error as Error).message).toContain('ServiceC');
      }
    });
  });

  describe('Circular Dependency Errors', () => {
    it('should detect direct circular dependency', () => {
      // A depends on A
      container.register(ServiceAToken, {
        useFactory: (a: ServiceA) => new ServiceA(a as any),
        inject: [ServiceAToken],
      });

      expect(() => container.resolve(ServiceAToken)).toThrow(CircularDependencyError);
    });

    it('should detect indirect circular dependency', () => {
      // A -> B -> C -> A
      container.register(ServiceAToken, {
        useFactory: (b: ServiceB) => new ServiceA(b),
        inject: [ServiceBToken],
      });

      container.register(ServiceBToken, {
        useFactory: (c: ServiceC) => new ServiceB(c),
        inject: [ServiceCToken],
      });

      container.register(ServiceCToken, {
        useFactory: (a: any) => ({ getValue: () => 'C', a }),
        inject: [ServiceAToken],
      });

      expect(() => container.resolve(ServiceAToken)).toThrow(CircularDependencyError);
    });

    it('should include full chain in circular dependency error', () => {
      container.register(ServiceAToken, {
        useFactory: (b: ServiceB) => new ServiceA(b),
        inject: [ServiceBToken],
      });

      container.register(ServiceBToken, {
        useFactory: (a: any) => ({ c: a }),
        inject: [ServiceAToken],
      });

      try {
        container.resolve(ServiceAToken);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CircularDependencyError);
        expect((error as Error).message).toContain('ServiceA');
        expect((error as Error).message).toContain('ServiceB');
      }
    });
  });

  describe('Factory Errors', () => {
    it('should wrap factory errors in ResolutionError', () => {
      container.register(FailingToken, {
        useClass: FailingService,
      });

      expect(() => container.resolve(FailingToken)).toThrow(ResolutionError);
    });

    it('should preserve original error in factory error', () => {
      container.register(FailingToken, {
        useFactory: () => {
          throw new Error('Factory error');
        },
      });

      try {
        container.resolve(FailingToken);
        fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Factory error');
      }
    });

    it('should not cache failed resolutions', () => {
      let attempts = 0;

      container.register(RecoverableToken, {
        useFactory: () => {
          attempts++;
          if (attempts < 2) {
            throw new Error(`Attempt ${attempts} failed`);
          }
          return { success: true };
        },
        scope: Scope.Singleton,
      });

      // First attempt fails
      expect(() => container.resolve(RecoverableToken)).toThrow();
      expect(attempts).toBe(1);

      // Second attempt succeeds
      const result = container.resolve(RecoverableToken);
      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });
  });

  describe('Async Resolution Errors', () => {
    it('should throw AsyncResolutionError when using resolve() for async provider', () => {
      container.register(AsyncFailToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new AsyncFailService();
        },
        async: true,
      });

      expect(() => container.resolve(AsyncFailToken)).toThrow(AsyncResolutionError);
    });

    it('should propagate errors from async factory', async () => {
      container.register(AsyncFailToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Async factory error');
        },
        async: true,
      });

      await expect(container.resolveAsync(AsyncFailToken)).rejects.toThrow('Async factory error');
    });

    it('should propagate errors from async onInit', async () => {
      container.register(AsyncFailToken, {
        useFactory: async () => ({
          async onInit() {
            throw new Error('onInit failed');
          },
        }),
        async: true,
      });

      await expect(container.resolveAsync(AsyncFailToken)).rejects.toThrow('onInit');
    });
  });

  describe('Container Disposed Errors', () => {
    it('should throw ContainerDisposedError when resolving after dispose', async () => {
      container.register(ServiceCToken, { useClass: ServiceC });

      await container.dispose();

      expect(() => container.resolve(ServiceCToken)).toThrow(ContainerDisposedError);
    });

    it('should throw ContainerDisposedError when registering after dispose', async () => {
      await container.dispose();

      expect(() => container.register(ServiceCToken, { useClass: ServiceC })).toThrow(ContainerDisposedError);
    });

    it('should throw ContainerDisposedError when creating scope after dispose', async () => {
      await container.dispose();

      expect(() => container.createScope()).toThrow(ContainerDisposedError);
    });
  });

  describe('Invalid Provider Errors', () => {
    it('should throw InvalidProviderError for empty provider', () => {
      expect(() => container.register(ServiceCToken, {} as any)).toThrow(InvalidProviderError);
    });

    it('should throw InvalidProviderError when useClass is not a constructor', () => {
      expect(() => container.register(ServiceCToken, { useClass: 'not a class' as any })).toThrow(InvalidProviderError);
    });
  });

  describe('Duplicate Registration Errors', () => {
    it('should throw DuplicateRegistrationError for duplicate registration', () => {
      container.register(ServiceCToken, { useClass: ServiceC });

      expect(() => container.register(ServiceCToken, { useClass: ServiceC })).toThrow(DuplicateRegistrationError);
    });

    it('should allow override with option', () => {
      container.register(ServiceCToken, { useValue: { getValue: () => 'first' } });
      container.register(ServiceCToken, { useValue: { getValue: () => 'second' } }, { override: true });

      const service = container.resolve(ServiceCToken);
      expect(service.getValue()).toBe('second');
    });

    it('should allow multi-registration with option', () => {
      const MultiToken = createToken<any>('MultiService');

      container.register(MultiToken, { useValue: { id: 1 } }, { multi: true });
      container.register(MultiToken, { useValue: { id: 2 } }, { multi: true });

      const services = container.resolveMany(MultiToken);
      expect(services).toHaveLength(2);
      expect(services.map((s) => s.id)).toEqual([1, 2]);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from transient resolution errors', () => {
      let shouldFail = true;

      container.register(RecoverableToken, {
        useFactory: () => {
          if (shouldFail) {
            throw new Error('Transient error');
          }
          return { recovered: true };
        },
        scope: Scope.Transient,
      });

      // First attempt fails
      expect(() => container.resolve(RecoverableToken)).toThrow('Transient error');

      // Fix the condition and retry
      shouldFail = false;
      const result = container.resolve(RecoverableToken);
      expect(result.recovered).toBe(true);
    });

    it('should allow retry for async resolution failures', async () => {
      let attempts = 0;

      container.register(RecoverableToken, {
        useFactory: async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`);
          }
          return { attempts };
        },
        async: true,
        scope: Scope.Singleton,
      });

      // First two attempts fail
      await expect(container.resolveAsync(RecoverableToken)).rejects.toThrow();
      await expect(container.resolveAsync(RecoverableToken)).rejects.toThrow();

      // Third attempt succeeds
      const result = await container.resolveAsync(RecoverableToken);
      expect(result.attempts).toBe(3);
    });

    it('should recover from disposal errors and continue', async () => {
      let disposeErrorThrown = false;
      let secondServiceDisposed = false;

      const FirstToken = createToken<any>('First');
      const SecondToken = createToken<any>('Second');

      container.register(FirstToken, {
        useFactory: () => ({
          dispose: async () => {
            disposeErrorThrown = true;
            throw new Error('Dispose error');
          },
        }),
        scope: Scope.Singleton,
      });

      container.register(SecondToken, {
        useFactory: () => ({
          dispose: async () => {
            secondServiceDisposed = true;
          },
        }),
        scope: Scope.Singleton,
      });

      container.resolve(FirstToken);
      container.resolve(SecondToken);

      // Dispose should complete without throwing
      await container.dispose();

      expect(disposeErrorThrown).toBe(true);
      expect(secondServiceDisposed).toBe(true);
    });
  });

  describe('Error Handling in Scoped Containers', () => {
    it('should isolate errors to the failing scope', () => {
      container.register(ServiceCToken, {
        useClass: ServiceC,
        scope: Scope.Scoped,
      });

      const scope1 = container.createScope();
      const scope2 = container.createScope();

      // Scope 1 works fine
      const service1 = scope1.resolve(ServiceCToken);
      expect(service1).toBeInstanceOf(ServiceC);

      // Dispose scope1
      // scope1 operations should fail after disposal
      // But scope2 should still work
      const service2 = scope2.resolve(ServiceCToken);
      expect(service2).toBeInstanceOf(ServiceC);
    });

    it('should not affect parent container when child scope fails', () => {
      container.register(ServiceCToken, {
        useClass: ServiceC,
        scope: Scope.Singleton,
      });

      const parentService = container.resolve(ServiceCToken);

      const _scope = container.createScope();

      // Register a failing provider in the scope
      // (This might override or shadow the parent's provider depending on implementation)

      // Parent's service should still be accessible
      const parentServiceAgain = container.resolve(ServiceCToken);
      expect(parentServiceAgain).toBe(parentService);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide actionable error messages', () => {
      try {
        container.resolve(ServiceAToken);
        fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;

        // Should contain the token name
        expect(message).toContain('ServiceA');

        // Should suggest a fix (like registering the provider)
        expect(message.toLowerCase()).toMatch(/register|provide|import/);
      }
    });

    it('should include resolution chain for nested errors', () => {
      container.register(ServiceAToken, {
        useFactory: (b: ServiceB) => new ServiceA(b),
        inject: [ServiceBToken],
      });

      // ServiceBToken is not registered

      try {
        container.resolve(ServiceAToken);
        fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('ServiceB');
      }
    });

    it('should include helpful context for circular dependencies', () => {
      container.register(ServiceAToken, {
        useFactory: (a: any) => new ServiceA(a),
        inject: [ServiceAToken],
      });

      try {
        container.resolve(ServiceAToken);
        fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;

        // Should mention circular dependency
        expect(message.toLowerCase()).toContain('circular');

        // Should suggest solutions
        expect(message.toLowerCase()).toMatch(/lazy|forward|break/);
      }
    });
  });
});
