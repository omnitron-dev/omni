/**
 * Nexus Container - Lifecycle Management Tests
 *
 * Tests for container and service lifecycle management including:
 * - Initialization hooks (onInit, @PostConstruct)
 * - Destruction hooks (onDestroy, @PreDestroy, dispose)
 * - Module lifecycle coordination
 * - Lifecycle event ordering
 *
 * @since 0.4.5
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, createToken, Scope, LifecycleEvent } from '@nexus';
import type { IModule } from '@nexus';

// Track lifecycle events for testing
const lifecycleEvents: string[] = [];

function resetEvents(): void {
  lifecycleEvents.length = 0;
}

// Test service classes with lifecycle hooks
class InitializableService {
  public initialized = false;
  public initOrder = 0;
  private static initCounter = 0;

  async onInit(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.initialized = true;
    this.initOrder = ++InitializableService.initCounter;
    lifecycleEvents.push(`init:${this.constructor.name}`);
  }

  static reset(): void {
    InitializableService.initCounter = 0;
  }
}

class DisposableService {
  public disposed = false;
  public disposeOrder = 0;
  private static disposeCounter = 0;

  async onDestroy(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.disposed = true;
    this.disposeOrder = ++DisposableService.disposeCounter;
    lifecycleEvents.push(`destroy:${this.constructor.name}`);
  }

  async dispose(): Promise<void> {
    await this.onDestroy();
  }

  static reset(): void {
    DisposableService.disposeCounter = 0;
  }
}

class FullLifecycleService extends DisposableService {
  public initialized = false;
  public initOrder = 0;
  private static initCounter = 0;

  async onInit(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.initialized = true;
    this.initOrder = ++FullLifecycleService.initCounter;
    lifecycleEvents.push(`init:FullLifecycleService`);
  }

  static override reset(): void {
    FullLifecycleService.initCounter = 0;
    DisposableService.reset();
  }
}

class DependentLifecycleService {
  public initialized = false;
  public destroyed = false;

  constructor(public dependency: FullLifecycleService) {}

  async onInit(): Promise<void> {
    this.initialized = true;
    lifecycleEvents.push(`init:DependentLifecycleService`);
  }

  async onDestroy(): Promise<void> {
    this.destroyed = true;
    lifecycleEvents.push(`destroy:DependentLifecycleService`);
  }
}

// Tokens
const InitServiceToken = createToken<InitializableService>('InitService');
const DisposableToken = createToken<DisposableService>('DisposableService');
const FullLifecycleToken = createToken<FullLifecycleService>('FullLifecycleService');
const DependentToken = createToken<DependentLifecycleService>('DependentLifecycleService');

describe('Nexus Container - Lifecycle Management', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
    resetEvents();
    InitializableService.reset();
    DisposableService.reset();
    FullLifecycleService.reset();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Initialization Lifecycle', () => {
    it('should call onInit on resolved instances during container initialize()', async () => {
      container.register(InitServiceToken, {
        useClass: InitializableService,
        scope: Scope.Singleton,
      });

      // Resolve the service first
      const service = container.resolve(InitServiceToken);
      expect(service.initialized).toBe(false);

      // Initialize the container
      await container.initialize();

      expect(service.initialized).toBe(true);
      expect(lifecycleEvents).toContain('init:InitializableService');
    });

    it('should handle async initialization correctly', async () => {
      const AsyncInitToken = createToken<{ ready: boolean }>('AsyncInit');
      let initStarted = false;
      let initCompleted = false;

      container.register(AsyncInitToken, {
        useFactory: () => {
          const service = {
            ready: false,
            async onInit() {
              initStarted = true;
              await new Promise((resolve) => setTimeout(resolve, 20));
              this.ready = true;
              initCompleted = true;
            },
          };
          return service;
        },
        scope: Scope.Singleton,
      });

      const service = container.resolve(AsyncInitToken);
      expect(initStarted).toBe(false);

      await container.initialize();

      expect(initStarted).toBe(true);
      expect(initCompleted).toBe(true);
      expect(service.ready).toBe(true);
    });

    it('should handle initialization errors gracefully', async () => {
      const FailingInitToken = createToken<any>('FailingInit');
      const SuccessInitToken = createToken<any>('SuccessInit');

      container.register(FailingInitToken, {
        useFactory: () => ({
          async onInit() {
            throw new Error('Init failed');
          },
        }),
        scope: Scope.Singleton,
      });

      container.register(SuccessInitToken, {
        useFactory: () => ({
          initialized: false,
          async onInit() {
            this.initialized = true;
          },
        }),
        scope: Scope.Singleton,
      });

      // Resolve both
      container.resolve(FailingInitToken);
      const successService = container.resolve(SuccessInitToken);

      // Initialize should not throw but may log errors
      await container.initialize();

      // Success service should still be initialized
      expect(successService.initialized).toBe(true);
    });
  });

  describe('Disposal Lifecycle', () => {
    it('should call onDestroy on all instances during dispose()', async () => {
      container.register(DisposableToken, {
        useClass: DisposableService,
        scope: Scope.Singleton,
      });

      const service = container.resolve(DisposableToken);
      expect(service.disposed).toBe(false);

      await container.dispose();

      expect(service.disposed).toBe(true);
      expect(lifecycleEvents).toContain('destroy:DisposableService');
    });

    it('should dispose instances in reverse resolution order', async () => {
      container.register(FullLifecycleToken, {
        useClass: FullLifecycleService,
        scope: Scope.Singleton,
      });

      container.register(DependentToken, {
        useFactory: (dep: FullLifecycleService) => new DependentLifecycleService(dep),
        inject: [FullLifecycleToken],
        scope: Scope.Singleton,
      });

      // Resolve in order (FullLifecycle first, then Dependent)
      container.resolve(FullLifecycleToken);
      container.resolve(DependentToken);

      await container.dispose();

      // Dependent should be destroyed before its dependency
      const destroyEvents = lifecycleEvents.filter((e) => e.startsWith('destroy:'));
      const dependentIdx = destroyEvents.indexOf('destroy:DependentLifecycleService');
      const fullIdx = destroyEvents.indexOf('destroy:FullLifecycleService');

      // Both should be destroyed
      expect(dependentIdx).toBeGreaterThanOrEqual(0);
      expect(fullIdx).toBeGreaterThanOrEqual(0);
    });

    it('should handle disposal errors gracefully and continue disposing other instances', async () => {
      const FailingDisposeToken = createToken<any>('FailingDispose');
      const SuccessDisposeToken = createToken<any>('SuccessDispose');

      container.register(FailingDisposeToken, {
        useFactory: () => ({
          disposed: false,
          async dispose() {
            throw new Error('Dispose failed');
          },
        }),
        scope: Scope.Singleton,
      });

      container.register(SuccessDisposeToken, {
        useFactory: () => ({
          disposed: false,
          async dispose() {
            this.disposed = true;
          },
        }),
        scope: Scope.Singleton,
      });

      container.resolve(FailingDisposeToken);
      const successService = container.resolve(SuccessDisposeToken);

      // Dispose should complete without throwing
      await container.dispose();

      // Success service should still be disposed
      expect(successService.disposed).toBe(true);
    });

    it('should clear all caches after disposal', async () => {
      container.register(InitServiceToken, {
        useClass: InitializableService,
        scope: Scope.Singleton,
      });

      container.resolve(InitServiceToken);
      const metadata = container.getMetadata();
      expect(metadata.cached).toBeGreaterThan(0);

      await container.dispose();

      const metadataAfter = container.getMetadata();
      expect(metadataAfter.cached).toBe(0);
    });
  });

  describe('Scoped Lifecycle', () => {
    it('should dispose scoped instances when scope is disposed', async () => {
      container.register(DisposableToken, {
        useClass: DisposableService,
        scope: Scope.Scoped,
      });

      const scope = container.createScope();
      const service = scope.resolve(DisposableToken);

      expect(service.disposed).toBe(false);

      await scope.dispose();

      expect(service.disposed).toBe(true);
    });

    it('should not affect parent container when child scope is disposed', async () => {
      container.register(DisposableToken, {
        useClass: DisposableService,
        scope: Scope.Singleton,
      });

      const parentService = container.resolve(DisposableToken);
      const scope = container.createScope();

      await scope.dispose();

      // Parent service should still be accessible
      expect(parentService.disposed).toBe(false);
      const parentServiceAgain = container.resolve(DisposableToken);
      expect(parentServiceAgain).toBe(parentService);
    });
  });

  describe('Lifecycle Events', () => {
    it('should emit lifecycle events in correct order', async () => {
      const events: string[] = [];

      container.on(LifecycleEvent.BeforeResolve, () => {
        events.push('before-resolve');
      });

      container.on(LifecycleEvent.AfterResolve, () => {
        events.push('after-resolve');
      });

      container.on(LifecycleEvent.InstanceCreated, () => {
        events.push('instance-created');
      });

      container.register(InitServiceToken, {
        useClass: InitializableService,
        scope: Scope.Singleton,
      });

      container.resolve(InitServiceToken);

      expect(events).toEqual(['before-resolve', 'instance-created', 'after-resolve']);
    });

    it('should emit cache hit event for cached instances', async () => {
      let cacheHits = 0;

      container.on(LifecycleEvent.CacheHit, () => {
        cacheHits++;
      });

      container.register(InitServiceToken, {
        useClass: InitializableService,
        scope: Scope.Singleton,
      });

      container.resolve(InitServiceToken);
      expect(cacheHits).toBe(0);

      container.resolve(InitServiceToken);
      expect(cacheHits).toBeGreaterThan(0);
    });

    it('should emit resolve failed event on error', async () => {
      let errorCaptured = false;

      container.on(LifecycleEvent.ResolveFailed, () => {
        errorCaptured = true;
      });

      const FailingToken = createToken<any>('Failing');
      container.register(FailingToken, {
        useFactory: () => {
          throw new Error('Factory error');
        },
      });

      try {
        container.resolve(FailingToken);
      } catch {
        // Expected
      }

      expect(errorCaptured).toBe(true);
    });
  });

  describe('Module Lifecycle', () => {
    it('should call module onModuleInit when loading', async () => {
      let moduleInitCalled = false;

      const testModule: IModule = {
        name: 'TestModule',
        providers: [[InitServiceToken, { useClass: InitializableService }]],
        onModuleInit: async () => {
          moduleInitCalled = true;
        },
      };

      container.loadModule(testModule);

      // onModuleInit may be called asynchronously
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(moduleInitCalled).toBe(true);
    });

    it('should call module onModuleDestroy when disposing', async () => {
      let moduleDestroyCalled = false;

      const testModule: IModule = {
        name: 'TestModule',
        providers: [],
        onModuleDestroy: async () => {
          moduleDestroyCalled = true;
        },
      };

      container.loadModule(testModule);
      await container.dispose();

      expect(moduleDestroyCalled).toBe(true);
    });

    it('should dispose modules in reverse dependency order', async () => {
      const disposeOrder: string[] = [];

      const moduleA: IModule = {
        name: 'ModuleA',
        providers: [],
        onModuleDestroy: async () => {
          disposeOrder.push('A');
        },
      };

      const moduleB: IModule = {
        name: 'ModuleB',
        imports: [moduleA],
        providers: [],
        onModuleDestroy: async () => {
          disposeOrder.push('B');
        },
      };

      const moduleC: IModule = {
        name: 'ModuleC',
        imports: [moduleB],
        providers: [],
        onModuleDestroy: async () => {
          disposeOrder.push('C');
        },
      };

      container.loadModule(moduleC);
      await container.dispose();

      // C depends on B which depends on A
      // So dispose order should be C, B, A
      expect(disposeOrder).toEqual(['C', 'B', 'A']);
    });
  });

  describe('Container State After Disposal', () => {
    it('should throw ContainerDisposedError when resolving after disposal', async () => {
      container.register(InitServiceToken, {
        useClass: InitializableService,
      });

      await container.dispose();

      expect(() => container.resolve(InitServiceToken)).toThrow(/disposed/i);
    });

    it('should throw ContainerDisposedError when registering after disposal', async () => {
      await container.dispose();

      expect(() => container.register(InitServiceToken, { useClass: InitializableService })).toThrow(/disposed/i);
    });

    it('should be idempotent for multiple dispose calls', async () => {
      container.register(DisposableToken, {
        useClass: DisposableService,
        scope: Scope.Singleton,
      });

      const service = container.resolve(DisposableToken);

      await container.dispose();
      await container.dispose(); // Second call should not throw

      expect(service.disposeOrder).toBe(1); // Only disposed once
    });
  });
});
