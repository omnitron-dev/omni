/**
 * Decorator Support Tests
 * Tests for optional decorator-based dependency injection
 * Note: These tests require reflect-metadata to be installed
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import 'reflect-metadata'; // Required for decorator support
import { Container, createToken } from '../../src/nexus/index.js';
import {
  Injectable,
  Inject,
  Optional,
  Module,
  Service,
  Singleton,
  Transient,
  Scoped,
  Value,
  InjectAll,
  PostConstruct,
  PreDestroy,
  Lazy,
} from '../../src/decorators/index.js';

describe('Decorator Support', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('@Injectable Decorator', () => {
    it('should mark class as injectable', () => {
      @Injectable()
      class TestService {
        getValue() {
          return 'test-value';
        }
      }

      const token = createToken<TestService>('TestService');
      container.register(token, { useClass: TestService });

      const service = container.resolve(token);
      expect(service.getValue()).toBe('test-value');
    });

    it('should handle constructor injection', () => {
      const depToken = createToken<string>('Dependency');

      @Injectable()
      class ServiceWithDep {
        constructor(@Inject(depToken) public dep: string) {}
      }

      container.register(depToken, { useValue: 'injected-value' });

      const token = createToken<ServiceWithDep>('ServiceWithDep');
      container.register(token, { useClass: ServiceWithDep });

      const service = container.resolve(token);
      expect(service.dep).toBe('injected-value');
    });

    it('should handle multiple injections', () => {
      const token1 = createToken<string>('Dep1');
      const token2 = createToken<number>('Dep2');
      const token3 = createToken<boolean>('Dep3');

      @Injectable()
      class MultiDepService {
        constructor(
          @Inject(token1) public dep1: string,
          @Inject(token2) public dep2: number,
          @Inject(token3) public dep3: boolean
        ) {}
      }

      container.register(token1, { useValue: 'string' });
      container.register(token2, { useValue: 42 });
      container.register(token3, { useValue: true });

      const serviceToken = createToken<MultiDepService>('MultiDepService');
      container.register(serviceToken, { useClass: MultiDepService });

      const service = container.resolve(serviceToken);
      expect(service.dep1).toBe('string');
      expect(service.dep2).toBe(42);
      expect(service.dep3).toBe(true);
    });
  });

  describe('@Optional Decorator', () => {
    it('should handle optional dependencies', () => {
      const requiredToken = createToken<string>('Required');
      const optionalToken = createToken<string>('Optional');

      @Injectable()
      class ServiceWithOptional {
        constructor(
          @Inject(requiredToken) public required: string,
          @Optional() @Inject(optionalToken) public optional?: string
        ) {}
      }

      container.register(requiredToken, { useValue: 'required' });
      // Don't register optional

      const token = createToken<ServiceWithOptional>('ServiceWithOptional');
      container.register(token, { useClass: ServiceWithOptional });

      const service = container.resolve(token);
      expect(service.required).toBe('required');
      expect(service.optional).toBeUndefined();
    });

    it('should inject optional dependency when available', () => {
      const optionalToken = createToken<string>('Optional');

      @Injectable()
      class ServiceWithOptional {
        constructor(@Optional() @Inject(optionalToken) public optional?: string) {}
      }

      container.register(optionalToken, { useValue: 'optional-value' });

      const token = createToken<ServiceWithOptional>('ServiceWithOptional');
      container.register(token, { useClass: ServiceWithOptional });

      const service = container.resolve(token);
      expect(service.optional).toBe('optional-value');
    });
  });

  describe('Scope Decorators', () => {
    it('should apply @Singleton scope', () => {
      let instanceCount = 0;

      @Singleton()
      class SingletonService {
        instanceId = ++instanceCount;
      }

      const token = createToken<SingletonService>('SingletonService');
      container.register(token, { useClass: SingletonService });

      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);

      expect(instance1.instanceId).toBe(1);
      expect(instance2.instanceId).toBe(1);
      expect(instance1).toBe(instance2);
    });

    it('should apply @Transient scope', () => {
      let instanceCount = 0;

      @Transient()
      class TransientService {
        instanceId = ++instanceCount;
      }

      const token = createToken<TransientService>('TransientService');
      container.register(token, { useClass: TransientService });

      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);

      expect(instance1.instanceId).toBe(1);
      expect(instance2.instanceId).toBe(2);
      expect(instance1).not.toBe(instance2);
    });

    it('should apply @Scoped scope', () => {
      let instanceCount = 0;

      @Scoped()
      class ScopedService {
        instanceId = ++instanceCount;
      }

      const token = createToken<ScopedService>('ScopedService');
      container.register(token, { useClass: ScopedService });

      const scope1 = container.createScope();
      const scope2 = container.createScope();

      const instance1 = scope1.resolve(token);
      const instance2 = scope1.resolve(token);
      const instance3 = scope2.resolve(token);

      expect(instance1.instanceId).toBe(1);
      expect(instance2.instanceId).toBe(1);
      expect(instance3.instanceId).toBe(2);
    });
  });

  describe('@Service Decorator', () => {
    it('should auto-register service with name', () => {
      @Service('UserService')
      class UserService {
        getUser() {
          return { id: 1, name: 'John' };
        }
      }

      container.autoRegister(UserService);

      const token = createToken<UserService>('UserService');
      const service = container.resolve(token);

      expect(service.getUser()).toEqual({ id: 1, name: 'John' });
    });

    it('should handle service with dependencies', () => {
      const dbToken = createToken<{ query: () => string }>('Database');

      @Service('UserRepository')
      class UserRepository {
        constructor(@Inject(dbToken) private db: any) {}

        findAll() {
          return this.db.query();
        }
      }

      container.register(dbToken, {
        useValue: { query: () => 'users-from-db' },
      });
      container.autoRegister(UserRepository);

      const token = createToken<UserRepository>('UserRepository');
      const repo = container.resolve(token);

      expect(repo.findAll()).toBe('users-from-db');
    });
  });
});
