/**
 * Tests for DI Container
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { DIContainer } from '../../../src/di/container.js';
import { InjectionToken } from '../../../src/di/tokens.js';
import { Injectable } from '../../../src/di/injectable.js';

describe('DIContainer', () => {
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer();
  });

  describe('Registration', () => {
    it('should register a class provider', () => {
      @Injectable()
      class TestService {}

      container.register(TestService, TestService);
      expect(container.has(TestService)).toBe(true);
    });

    it('should register a value provider', () => {
      const API_URL = new InjectionToken<string>('API_URL');
      container.register(API_URL, { provide: API_URL, useValue: 'https://api.example.com' });

      expect(container.has(API_URL)).toBe(true);
    });

    it('should register a factory provider', () => {
      const TIMESTAMP = new InjectionToken<number>('TIMESTAMP');
      container.register(TIMESTAMP, {
        provide: TIMESTAMP,
        useFactory: () => Date.now(),
      });

      expect(container.has(TIMESTAMP)).toBe(true);
    });

    it('should register an existing provider (alias)', () => {
      @Injectable()
      class TestService {}

      const ALIAS = new InjectionToken<TestService>('ALIAS');

      container.register(TestService, TestService);
      container.register(ALIAS, { provide: ALIAS, useExisting: TestService });

      expect(container.has(ALIAS)).toBe(true);
    });
  });

  describe('Resolution', () => {
    it('should resolve class provider', () => {
      @Injectable()
      class TestService {
        value = 42;
      }

      container.register(TestService, TestService);
      const instance = container.resolve(TestService);

      expect(instance).toBeInstanceOf(TestService);
      expect(instance.value).toBe(42);
    });

    it('should resolve value provider', () => {
      const API_URL = new InjectionToken<string>('API_URL');
      container.register(API_URL, { provide: API_URL, useValue: 'https://api.example.com' });

      const value = container.resolve(API_URL);
      expect(value).toBe('https://api.example.com');
    });

    it('should resolve factory provider', () => {
      const RANDOM = new InjectionToken<number>('RANDOM');
      container.register(RANDOM, {
        provide: RANDOM,
        useFactory: () => Math.random(),
      });

      const value = container.resolve(RANDOM);
      expect(typeof value).toBe('number');
    });

    it('should throw error for unregistered token', () => {
      const UNKNOWN = new InjectionToken('UNKNOWN');
      expect(() => container.resolve(UNKNOWN)).toThrow('No provider for');
    });
  });

  describe('Singleton scope', () => {
    it('should return same instance for singleton', () => {
      @Injectable()
      class TestService {}

      container.register(TestService, TestService);

      const instance1 = container.resolve(TestService);
      const instance2 = container.resolve(TestService);

      expect(instance1).toBe(instance2);
    });
  });

  describe('Transient scope', () => {
    it('should return new instance for transient', () => {
      @Injectable({ scope: 'transient' })
      class TestService {
        id = Math.random();
      }

      container.register(TestService, TestService);

      const instance1 = container.resolve(TestService);
      const instance2 = container.resolve(TestService);

      expect(instance1).not.toBe(instance2);
      expect(instance1.id).not.toBe(instance2.id);
    });
  });

  describe('Dependency injection', () => {
    it('should inject dependencies in constructor', () => {
      @Injectable()
      class DependencyService {
        value = 'dependency';
      }

      @Injectable({ deps: [DependencyService] })
      class ConsumerService {
        constructor(public dep: DependencyService) {}
      }

      container.register(DependencyService, DependencyService);
      container.register(ConsumerService, ConsumerService);

      const instance = container.resolve(ConsumerService);
      expect(instance.dep).toBeInstanceOf(DependencyService);
      expect(instance.dep.value).toBe('dependency');
    });

    it('should inject multiple dependencies', () => {
      @Injectable()
      class ServiceA {
        name = 'A';
      }

      @Injectable()
      class ServiceB {
        name = 'B';
      }

      @Injectable({ deps: [ServiceA, ServiceB] })
      class ServiceC {
        constructor(
          public a: ServiceA,
          public b: ServiceB
        ) {}
      }

      container.register(ServiceA, ServiceA);
      container.register(ServiceB, ServiceB);
      container.register(ServiceC, ServiceC);

      const instance = container.resolve(ServiceC);
      expect(instance.a.name).toBe('A');
      expect(instance.b.name).toBe('B');
    });
  });

  describe('Factory with dependencies', () => {
    it('should inject dependencies into factory', () => {
      const CONFIG = new InjectionToken<string>('CONFIG');
      const API_CLIENT = new InjectionToken<any>('API_CLIENT');

      container.register(CONFIG, { provide: CONFIG, useValue: 'https://api.example.com' });
      container.register(API_CLIENT, {
        provide: API_CLIENT,
        useFactory: (url: string) => ({ url }),
        deps: [CONFIG],
      });

      const client = container.resolve(API_CLIENT);
      expect(client.url).toBe('https://api.example.com');
    });
  });

  describe('Multi providers', () => {
    it('should return array for multi providers', () => {
      const INTERCEPTORS = new InjectionToken<any[]>('INTERCEPTORS');

      class InterceptorA {}
      class InterceptorB {}
      class InterceptorC {}

      container.register(INTERCEPTORS, {
        provide: INTERCEPTORS,
        useClass: InterceptorA,
        multi: true,
      });
      container.register(INTERCEPTORS, {
        provide: INTERCEPTORS,
        useClass: InterceptorB,
        multi: true,
      });
      container.register(INTERCEPTORS, {
        provide: INTERCEPTORS,
        useClass: InterceptorC,
        multi: true,
      });

      const interceptors = container.resolve(INTERCEPTORS);
      expect(Array.isArray(interceptors)).toBe(true);
      expect(interceptors).toHaveLength(3);
    });
  });

  describe('Hierarchical injection', () => {
    it('should create child container', () => {
      const child = container.createChild();
      expect(child).toBeDefined();
    });

    it('should resolve from parent', () => {
      @Injectable()
      class ParentService {
        value = 'parent';
      }

      container.register(ParentService, ParentService);
      const child = container.createChild();

      const instance = child.get(ParentService);
      expect(instance.value).toBe('parent');
    });

    it('should override parent providers in child', () => {
      @Injectable()
      class TestService {
        value = 'parent';
      }

      container.register(TestService, {
        provide: TestService,
        useValue: { value: 'parent' } as any,
      });

      const child = container.createChild([
        { provide: TestService, useValue: { value: 'child' } as any },
      ]);

      const parentInstance = container.get(TestService);
      const childInstance = child.get(TestService);

      expect(parentInstance.value).toBe('parent');
      expect(childInstance.value).toBe('child');
    });
  });

  describe('Circular dependency detection', () => {
    it('should detect circular dependencies', () => {
      @Injectable({ deps: [] }) // Forward declaration, will be set later
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      @Injectable({ deps: [] })
      class ServiceB {
        constructor(public a: ServiceA) {}
      }

      // Set circular dependencies
      const serviceAOptions = Reflect.getMetadata('injectable:options', ServiceA);
      const serviceBOptions = Reflect.getMetadata('injectable:options', ServiceB);
      serviceAOptions.deps = [ServiceB];
      serviceBOptions.deps = [ServiceA];

      container.register(ServiceA, ServiceA);
      container.register(ServiceB, ServiceB);

      expect(() => container.resolve(ServiceA)).toThrow('Circular dependency detected');
    });
  });

  describe('Cleanup', () => {
    it('should clear all providers', () => {
      @Injectable()
      class TestService {}

      container.register(TestService, TestService);
      expect(container.has(TestService)).toBe(true);

      container.clear();
      expect(container.has(TestService)).toBe(false);
    });

    it('should dispose container', () => {
      @Injectable()
      class TestService {}

      container.register(TestService, TestService);
      container.dispose();

      expect(container.has(TestService)).toBe(false);
    });
  });
});
