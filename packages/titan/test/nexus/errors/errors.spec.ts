/**
 * Nexus Error Tests
 * Tests for all error classes and error handling utilities
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createToken,
  NexusError,
  ResolutionError,
  CircularDependencyError,
  RegistrationError,
  DuplicateRegistrationError,
  DependencyNotFoundError,
  ScopeMismatchError,
  InvalidProviderError,
  AsyncResolutionError,
  DisposalError,
  ModuleError,
  InitializationError,
  ContainerDisposedError,
  NotInjectableError,
  NexusAggregateError,
  isNexusError,
  getRootCause,
} from '../../../src/nexus/index.js';
import { ErrorHandler } from '../../../src/nexus/errors.js';

describe('Nexus Errors', () => {
  describe('ResolutionError', () => {
    it('should create error with token only', () => {
      const token = createToken<string>('TestService');
      const error = new ResolutionError(token);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('RESOLUTION_ERROR');
      expect(error.token).toBe(token);
      expect(error.chain).toEqual([]);
      expect(error.message).toContain('TestService');
      expect(error.message).toContain('not registered');
    });

    it('should create error with resolution chain', () => {
      const token = createToken<string>('ServiceA');
      const chain = [createToken<string>('ServiceB'), createToken<string>('ServiceC')];
      const error = new ResolutionError(token, chain);

      expect(error.chain).toEqual(chain);
      expect(error.message).toContain('ServiceA');
    });

    it('should create error with cause', () => {
      const token = createToken<string>('TestService');
      const cause = new Error('Factory failed');
      const error = new ResolutionError(token, [], cause);

      expect(error.cause).toBe(cause);
      expect(error.message).toContain('Factory failed');
      expect(error.message).toContain('factory function');
    });

    it('should suggest async resolution for async errors', () => {
      const token = createToken<string>('AsyncService');
      const cause = new Error('Cannot use Promise synchronously');
      const error = new ResolutionError(token, [], cause);

      expect(error.message).toContain('resolveAsync');
    });
  });

  describe('CircularDependencyError', () => {
    it('should create error with dependency chain', () => {
      const chain = [createToken<string>('ServiceA'), createToken<string>('ServiceB'), createToken<string>('ServiceA')];
      const error = new CircularDependencyError(chain);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('CIRCULAR_DEPENDENCY');
      expect(error.chain).toEqual(chain);
      expect(error.message).toContain('Circular dependency');
      expect(error.message).toContain('ServiceA');
    });

    it('should show cycle path in message', () => {
      const chain = [
        createToken<string>('A'),
        createToken<string>('B'),
        createToken<string>('C'),
        createToken<string>('B'),
      ];
      const error = new CircularDependencyError(chain);

      expect(error.message).toContain('B -> C -> B');
    });
  });

  describe('RegistrationError', () => {
    it('should create error with token and reason', () => {
      const token = createToken<string>('TestService');
      const error = new RegistrationError(token, 'Invalid provider configuration');

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('REGISTRATION_ERROR');
      expect(error.token).toBe(token);
      expect(error.reason).toBe('Invalid provider configuration');
      expect(error.message).toContain('TestService');
      expect(error.message).toContain('Invalid provider configuration');
    });
  });

  describe('DuplicateRegistrationError', () => {
    it('should create error with token', () => {
      const token = createToken<string>('TestService');
      const error = new DuplicateRegistrationError(token);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('DUPLICATE_REGISTRATION');
      expect(error.token).toBe(token);
      expect(error.message).toContain('already registered');
      expect(error.message).toContain('override: true');
    });
  });

  describe('DependencyNotFoundError', () => {
    it('should create error with token only', () => {
      const token = createToken<string>('MissingService');
      const error = new DependencyNotFoundError(token);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('DEPENDENCY_NOT_FOUND');
      expect(error.token).toBe(token);
      expect(error.message).toContain('MissingService');
      expect(error.message).toContain('not found');
    });

    it('should create error with dependent token', () => {
      const token = createToken<string>('MissingService');
      const dependent = createToken<string>('ConsumerService');
      const error = new DependencyNotFoundError(token, dependent);

      expect(error.dependent).toBe(dependent);
      expect(error.message).toContain('ConsumerService');
      expect(error.message).toContain('requires');
    });

    it('should show available tokens', () => {
      const token = createToken<string>('MissingService');
      const availableTokens = ['ServiceA', 'ServiceB', 'ServiceC'];
      const error = new DependencyNotFoundError(token, undefined, availableTokens);

      expect(error.availableTokens).toEqual(availableTokens);
      expect(error.message).toContain('did you mean');
    });
  });

  describe('ScopeMismatchError', () => {
    it('should create error with scope information', () => {
      const token = createToken<string>('TestService');
      const error = new ScopeMismatchError(token, 'singleton', 'transient');

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('SCOPE_MISMATCH');
      expect(error.token).toBe(token);
      expect(error.expectedScope).toBe('singleton');
      expect(error.actualScope).toBe('transient');
      expect(error.message).toContain('singleton');
      expect(error.message).toContain('transient');
    });
  });

  describe('InvalidProviderError', () => {
    it('should create error with token and reason', () => {
      const token = createToken<string>('TestService');
      const error = new InvalidProviderError(token, 'Missing useClass or useFactory');

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('INVALID_PROVIDER');
      expect(error.token).toBe(token);
      expect(error.reason).toBe('Missing useClass or useFactory');
    });

    it('should handle undefined token', () => {
      const error = new InvalidProviderError(undefined as any, 'No token provided');

      expect(error.message).toContain('Unknown');
    });
  });

  describe('AsyncResolutionError', () => {
    it('should create error with token', () => {
      const token = createToken<string>('AsyncService');
      const error = new AsyncResolutionError(token);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('ASYNC_RESOLUTION_ERROR');
      expect(error.token).toBe(token);
      expect(error.message).toContain('async resolution');
      expect(error.message).toContain('resolveAsync');
    });
  });

  describe('DisposalError', () => {
    it('should create error with token and cause', () => {
      const token = createToken<string>('TestService');
      const cause = new Error('Connection already closed');
      const error = new DisposalError(token, cause);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('DISPOSAL_ERROR');
      expect(error.token).toBe(token);
      expect(error.cause).toBe(cause);
      expect(error.message).toContain('dispose');
      expect(error.message).toContain('Connection already closed');
    });
  });

  describe('ModuleError', () => {
    it('should create error for import operation', () => {
      const error = new ModuleError('UserModule', 'import', 'Module not found');

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('MODULE_ERROR');
      expect(error.moduleName).toBe('UserModule');
      expect(error.operation).toBe('import');
      expect(error.reason).toBe('Module not found');
      expect(error.message).toContain('UserModule');
      expect(error.message).toContain('import');
    });

    it('should create error for load operation', () => {
      const error = new ModuleError('UserModule', 'load', 'Configuration error');

      expect(error.message).toContain('load');
      expect(error.message).toContain('Configuration error');
    });

    it('should show available modules', () => {
      const availableModules = ['CoreModule', 'AuthModule'];
      const error = new ModuleError('UserModule', 'import', 'Not found', availableModules);

      expect(error.availableModules).toEqual(availableModules);
      expect(error.message).toContain('Available modules');
    });
  });

  describe('InitializationError', () => {
    it('should create error with token and cause', () => {
      const token = createToken<string>('TestService');
      const cause = new Error('Database connection failed');
      const error = new InitializationError(token, cause);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('INITIALIZATION_ERROR');
      expect(error.token).toBe(token);
      expect(error.cause).toBe(cause);
      expect(error.message).toContain('initialize');
      expect(error.message).toContain('Database connection failed');
    });
  });

  describe('ContainerDisposedError', () => {
    it('should create error without parameters', () => {
      const error = new ContainerDisposedError();

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('CONTAINER_DISPOSED');
      expect(error.message).toContain('disposed');
      expect(error.message).toContain('new Container');
    });
  });

  describe('NotInjectableError', () => {
    it('should create error with class', () => {
      class TestClass {}
      const error = new NotInjectableError(TestClass);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('NOT_INJECTABLE');
      expect(error.target).toBe(TestClass);
      expect(error.message).toContain('TestClass');
      expect(error.message).toContain('@Injectable()');
    });

    it('should handle instance', () => {
      class TestClass {}
      const instance = new TestClass();
      const error = new NotInjectableError(instance);

      expect(error.message).toContain('TestClass');
    });

    it('should handle undefined target', () => {
      const error = new NotInjectableError(undefined);

      expect(error.message).toContain('Unknown');
    });
  });

  describe('NexusAggregateError', () => {
    it('should aggregate multiple errors', () => {
      const errors = [new Error('First error'), new Error('Second error'), new Error('Third error')];
      const error = new NexusAggregateError(errors);

      expect(error).toBeInstanceOf(NexusError);
      expect(error.code).toBe('AGGREGATE_ERROR');
      expect(error.errors).toEqual(errors);
      expect(error.message).toContain('3 total');
      expect(error.message).toContain('First error');
      expect(error.message).toContain('Second error');
      expect(error.message).toContain('Third error');
    });
  });

  describe('isNexusError', () => {
    it('should return true for NexusError instances', () => {
      const error = new ContainerDisposedError();
      expect(isNexusError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Regular error');
      expect(isNexusError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isNexusError(null)).toBe(false);
      expect(isNexusError(undefined)).toBe(false);
      expect(isNexusError('error')).toBe(false);
      expect(isNexusError({})).toBe(false);
    });
  });

  describe('getRootCause', () => {
    it('should return error if no cause', () => {
      const error = new Error('No cause');
      expect(getRootCause(error)).toBe(error);
    });

    it('should return root cause from chain', () => {
      const root = new Error('Root cause');
      const middle = new Error('Middle error');
      (middle as any).cause = root;
      const top = new Error('Top error');
      (top as any).cause = middle;

      expect(getRootCause(top)).toBe(root);
    });
  });

  describe('ErrorHandler', () => {
    beforeEach(() => {
      ErrorHandler.clear();
    });

    afterEach(() => {
      ErrorHandler.clear();
    });

    it('should register and call custom handler', () => {
      const token = createToken<string>('TestService');
      const error = new AsyncResolutionError(token);
      let handledError: NexusError | null = null;

      ErrorHandler.register('ASYNC_RESOLUTION_ERROR', (e) => {
        handledError = e;
      });

      ErrorHandler.handle(error);

      expect(handledError).toBe(error);
    });

    it('should handle errors without registered handler', () => {
      const error = new ContainerDisposedError();

      // Should not throw
      expect(() => ErrorHandler.handle(error)).not.toThrow();
    });

    it('should handle non-NexusError', () => {
      const error = new Error('Regular error');

      // Should not throw
      expect(() => ErrorHandler.handle(error)).not.toThrow();
    });

    it('should clear all handlers', () => {
      const token = createToken<string>('TestService');
      let called = false;

      ErrorHandler.register('ASYNC_RESOLUTION_ERROR', () => {
        called = true;
      });

      ErrorHandler.clear();

      const error = new AsyncResolutionError(token);
      ErrorHandler.handle(error);

      expect(called).toBe(false);
    });
  });
});
