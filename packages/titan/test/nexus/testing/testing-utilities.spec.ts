/**
 * Testing Utilities Tests
 * Tests for the built-in testing helpers and utilities
 */

import {
  Container,
  createToken,
  createModule
} from '../../../src/nexus/index.js';
import {
  TestContainer,
  createTestContainer,
  MockProvider,
  SpyProvider,
  StubProvider,
  TestModule,
  createTestModule,
  TestHarness,
  createTestHarness,
  IsolatedContainer,
  SnapshotContainer,
  expectResolution,
  expectRejection,
  expectDependency,
  expectLifecycle
} from '../../../src/nexus/testing/index.js';

describe('Testing Utilities', () => {
  describe('TestContainer', () => {
    it('should create test container with auto-mocking', () => {
      const testContainer = createTestContainer({
        autoMock: true
      });

      const token = createToken<{ getData: () => string }>('Service');

      // Auto-mock creates mock even if not registered
      const service = testContainer.resolve(token);

      expect(service).toBeDefined();
      expect(typeof service.getData).toBe('function');
      expect(service.getData()).toBeUndefined(); // Mock returns undefined by default
    });

    it('should override providers', () => {
      const container = new Container();
      const token = createToken<string>('Service');

      container.register(token, { useValue: 'original' });

      const testContainer = TestContainer.from(container);
      testContainer.override(token).useValue('overridden');

      expect(testContainer.resolve(token)).toBe('overridden');
      expect(container.resolve(token)).toBe('original'); // Original unchanged
    });

    it('should create mocks', () => {
      const testContainer = createTestContainer();
      const token = createToken<{ method: (arg: string) => string }>('Service');

      testContainer.mock(token, {
        method: jest.fn().mockReturnValue('mocked')
      });

      const service = testContainer.resolve(token);
      const result = service.method('test');

      expect(result).toBe('mocked');
      expect(service.method).toHaveBeenCalledWith('test');
    });

    it('should create spies', () => {
      const testContainer = createTestContainer();
      const token = createToken<{ method: () => string }>('Service');

      const original = { method: () => 'original' };
      testContainer.register(token, { useValue: original });

      const spy = testContainer.spy(token, 'method');

      const service = testContainer.resolve(token);
      const result = service.method();

      expect(result).toBe('original'); // Original behavior preserved
      expect(spy).toHaveBeenCalled();
    });

    it('should create stubs', () => {
      const testContainer = createTestContainer();
      const token = createToken<{
        method1: () => string;
        method2: (n: number) => number;
      }>('Service');

      testContainer.stub(token, {
        method1: 'stubbed',
        method2: 42
      });

      const service = testContainer.resolve(token);

      expect(service.method1()).toBe('stubbed');
      expect(service.method2(10)).toBe(42);
    });

    it('should reset mocks', () => {
      const testContainer = createTestContainer();
      const token = createToken<{ method: () => void }>('Service');

      const mock = jest.fn();
      testContainer.mock(token, { method: mock });

      const service = testContainer.resolve(token);
      service.method();
      service.method();

      expect(mock).toHaveBeenCalledTimes(2);

      testContainer.resetMocks();

      expect(mock).toHaveBeenCalledTimes(0);
    });

    it('should restore original providers', () => {
      const container = new Container();
      const token = createToken<string>('Service');

      container.register(token, { useValue: 'original' });

      const testContainer = TestContainer.from(container);
      testContainer.override(token).useValue('test');

      expect(testContainer.resolve(token)).toBe('test');

      testContainer.restore();

      expect(testContainer.resolve(token)).toBe('original');
    });

    it('should verify interactions', () => {
      const testContainer = createTestContainer();
      const token = createToken<{ method: (arg: string) => void }>('Service');

      const mock = jest.fn();
      testContainer.mock(token, { method: mock });

      const service = testContainer.resolve(token);
      service.method('test1');
      service.method('test2');

      const interactions = testContainer.getInteractions(token);

      expect(interactions).toEqual([
        { method: 'method', args: ['test1'] },
        { method: 'method', args: ['test2'] }
      ]);
    });
  });

  describe('TestModule', () => {
    it('should create test module', () => {
      const serviceToken = createToken<string>('Service');
      const mockToken = createToken<string>('Mock');

      const testModule = createTestModule({
        name: 'TestModule',
        providers: [
          { provide: serviceToken, useValue: 'test-service' }
        ],
        mocks: [
          { provide: mockToken, useValue: 'mock-value' }
        ]
      });

      const container = new Container();
      container.loadModule(testModule);

      expect(container.resolve(serviceToken)).toBe('test-service');
      expect(container.resolve(mockToken)).toBe('mock-value');
    });

    it('should override module providers', () => {
      const token = createToken<string>('Service');

      const originalModule = createModule({
        name: 'Original',
        providers: [
          { provide: token, useValue: 'original' }
        ]
      });

      const testModule = TestModule.override(originalModule, {
        providers: [
          { provide: token, useValue: 'overridden' }
        ]
      });

      const container = new Container();
      container.loadModule(testModule);

      expect(container.resolve(token)).toBe('overridden');
    });

    it('should create module with test doubles', async () => {
      interface UserService {
        getUser(id: string): Promise<{ id: string; name: string }>;
      }

      const userServiceToken = createToken<UserService>('UserService');

      const testModule = createTestModule({
        name: 'TestModule',
        mocks: [{
          provide: userServiceToken,
          useValue: {
            getUser: jest.fn().mockResolvedValue({ id: '1', name: 'Test User' })
          }
        }]
      });

      const container = new Container();
      container.loadModule(testModule);

      const userService = container.resolve(userServiceToken);
      const user = await userService.getUser('1');

      expect(user).toEqual({ id: '1', name: 'Test User' });
      expect(userService.getUser).toHaveBeenCalledWith('1');
    });
  });

  describe('TestHarness', () => {
    it('should create test harness for component', async () => {
      class TestComponent {
        constructor(
          private service: { getData: () => string }
        ) { }

        process() {
          return this.service.getData();
        }
      }

      const serviceToken = createToken<{ getData: () => string }>('Service');
      const componentToken = createToken<TestComponent>('Component');

      const harness = createTestHarness({
        component: TestComponent,
        providers: [
          { provide: serviceToken, useValue: { getData: () => 'test-data' } },
          {
            provide: componentToken,
            useFactory: (service) => new TestComponent(service),
            inject: [serviceToken]
          }
        ]
      });

      await harness.initialize();

      const component = harness.get(componentToken);
      const result = component.process();

      expect(result).toBe('test-data');

      await harness.cleanup();
    });

    it('should detect changes in harness', async () => {
      let value = 'initial';

      const serviceToken = createToken<{ getValue: () => string }>('Service');

      const harness = createTestHarness({
        providers: [
          {
            provide: serviceToken,
            useFactory: () => ({ getValue: () => value })
          }
        ]
      });

      await harness.initialize();

      const service1 = harness.get(serviceToken);
      expect(service1.getValue()).toBe('initial');

      value = 'changed';
      await harness.detectChanges();

      const service2 = harness.get(serviceToken);
      expect(service2.getValue()).toBe('changed');

      await harness.cleanup();
    });

    it('should run in zone', async () => {
      const events: string[] = [];

      const harness = createTestHarness({
        zone: {
          onEnter: () => events.push('enter'),
          onLeave: () => events.push('leave'),
          onError: (error) => events.push(`error: ${error.message}`)
        }
      });

      await harness.initialize();

      await harness.runInZone(async () => {
        events.push('executing');
        await new Promise(resolve => setTimeout(resolve, 10));
        events.push('completed');
      });

      expect(events).toEqual(['enter', 'executing', 'completed', 'leave']);

      await harness.cleanup();
    });
  });

  describe('IsolatedContainer', () => {
    it('should create isolated container', () => {
      const globalContainer = new Container();
      const globalToken = createToken<string>('Global');
      globalContainer.register(globalToken, { useValue: 'global' });

      const isolated = new IsolatedContainer();
      const isolatedToken = createToken<string>('Isolated');
      isolated.register(isolatedToken, { useValue: 'isolated' });

      // Isolated container doesn't see global registrations
      expect(() => isolated.resolve(globalToken)).toThrow();
      expect(isolated.resolve(isolatedToken)).toBe('isolated');

      // Global container doesn't see isolated registrations
      expect(() => globalContainer.resolve(isolatedToken)).toThrow();
    });

    it('should allow selective imports', () => {
      const sourceContainer = new Container();
      const token1 = createToken<string>('Token1');
      const token2 = createToken<string>('Token2');
      const token3 = createToken<string>('Token3');

      sourceContainer.register(token1, { useValue: 'value1' });
      sourceContainer.register(token2, { useValue: 'value2' });
      sourceContainer.register(token3, { useValue: 'value3' });

      const isolated = IsolatedContainer.withImports(sourceContainer, [token1, token2]);

      expect(isolated.resolve(token1)).toBe('value1');
      expect(isolated.resolve(token2)).toBe('value2');
      expect(() => isolated.resolve(token3)).toThrow(); // Not imported
    });
  });

  describe('SnapshotContainer', () => {
    it('should create and restore snapshots', () => {
      const container = new SnapshotContainer();
      const token = createToken<number>('Counter');

      let counter = 0;
      container.register(token, {
        useFactory: () => ++counter,
        scope: 'transient'
      });

      // Take snapshot
      const snapshot1 = container.snapshot();

      // Resolve some values
      container.resolve(token); // 1
      container.resolve(token); // 2

      expect(counter).toBe(2);

      // Take another snapshot
      const snapshot2 = container.snapshot();

      // Resolve more
      container.resolve(token); // 3

      expect(counter).toBe(3);

      // Restore to first snapshot
      container.restore(snapshot1);
      counter = 0; // Reset counter

      container.resolve(token); // 1 again
      expect(counter).toBe(1);
    });

    it('should handle nested snapshots', () => {
      const container = new SnapshotContainer();
      const token = createToken<string>('Value');

      container.register(token, { useValue: 'initial' });

      container.withSnapshot(() => {
        container.register(token, { useValue: 'nested1' }, { override: true });
        expect(container.resolve(token)).toBe('nested1');

        container.withSnapshot(() => {
          container.register(token, { useValue: 'nested2' }, { override: true });
          expect(container.resolve(token)).toBe('nested2');
        });

        // Back to nested1
        expect(container.resolve(token)).toBe('nested1');
      });

      // Back to initial
      expect(container.resolve(token)).toBe('initial');
    });
  });

  describe('Expectation Helpers', () => {
    it('should use expectResolution', async () => {
      const container = new Container();
      const token = createToken<string>('Service');

      container.register(token, { useValue: 'expected' });

      await expectResolution(container, token)
        .toResolve()
        .withValue('expected')
        .inTime(100);
    });

    it('should use expectRejection', async () => {
      const container = new Container();
      const token = createToken<any>('Failing');

      container.register(token, {
        useFactory: () => {
          throw new Error('Expected failure');
        }
      });

      await expectRejection(container, token)
        .toThrow('Expected failure')
        .withErrorType(Error);
    });

    it('should use expectDependency', () => {
      const container = new Container();
      const depToken = createToken<string>('Dependency');
      const serviceToken = createToken<any>('Service');

      container.register(depToken, { useValue: 'dep' });
      container.register(serviceToken, {
        useFactory: (dep) => ({ dep }),
        inject: [depToken]
      });

      expectDependency(container, serviceToken)
        .toHaveDependency(depToken)
        .withCardinality(1);
    });

    it('should use expectLifecycle', async () => {
      const container = new Container();
      const initSpy = jest.fn();
      const destroySpy = jest.fn();

      class TestService {
        async onInit() { initSpy(); }
        async onDestroy() { destroySpy(); }
      }

      const token = createToken<TestService>('TestService');
      container.register(token, {
        useClass: TestService,
        scope: 'singleton'
      });

      container.resolve(token);

      await expectLifecycle(container, token)
        .toCallOnInit()
        .toCallOnDestroy();

      await container.initialize();
      expect(initSpy).toHaveBeenCalled();

      await container.dispose();
      expect(destroySpy).toHaveBeenCalled();
    });
  });

  describe('Mock Providers', () => {
    it('should create mock provider', () => {
      const mockProvider = new MockProvider({
        getData: jest.fn().mockReturnValue('mocked-data'),
        processData: jest.fn()
      });

      expect(mockProvider.getData()).toBe('mocked-data');
      expect(mockProvider.getData).toHaveBeenCalled();

      mockProvider.processData('input');
      expect(mockProvider.processData).toHaveBeenCalledWith('input');
    });

    it('should create spy provider', () => {
      const original = {
        method: () => 'original-result'
      };

      const spyProvider = new SpyProvider(original, ['method']);

      const result = spyProvider.method();

      expect(result).toBe('original-result');
      expect(spyProvider.getCallCount('method')).toBe(1);
      expect(spyProvider.getLastCall('method')).toEqual({ args: [], result: 'original-result' });
    });

    it('should create stub provider', () => {
      const stubProvider = new StubProvider({
        method1: 'stubbed1',
        method2: 42,
        method3: { nested: 'value' }
      });

      expect(stubProvider.method1()).toBe('stubbed1');
      expect(stubProvider.method2()).toBe(42);
      expect(stubProvider.method3()).toEqual({ nested: 'value' });
    });
  });

  describe('Leak Detection', () => {
    it('should detect leaked tokens', async () => {
      const testContainer = createTestContainer({
        detectLeaks: true
      });

      const token1 = createToken<any>('Token1');
      const token2 = createToken<any>('Token2');

      testContainer.register(token1, {
        useValue: { data: 'value1' },
        scope: 'singleton'
      });

      testContainer.register(token2, {
        useValue: { data: 'value2' },
        scope: 'singleton'
      });

      // Resolve token1 but not token2
      testContainer.resolve(token1);

      await testContainer.dispose();

      const leaks = testContainer.getLeakedTokens();

      expect(leaks).toHaveLength(1);
      expect(leaks[0]).toBe(token2);
    });

    it('should track memory usage', () => {
      const testContainer = createTestContainer({
        trackMemory: true
      });

      const initialMemory = testContainer.getMemoryUsage();
      expect(initialMemory.objectCount).toBe(0); // Should start at 0

      // Create many services
      for (let i = 0; i < 10; i++) { // Use smaller number for easier debugging
        const token = createToken(`Service${i}`);
        testContainer.register(token, {
          useValue: new Array(1000).fill(i)
        });
      }

      const finalMemory = testContainer.getMemoryUsage();

      expect(finalMemory.heapUsed).toBeGreaterThan(initialMemory.heapUsed);
      expect(finalMemory.objectCount).toBe(10); // Should be exactly 10 after registering 10 tokens
    });
  });

  describe('Parallel Testing', () => {
    it('should run tests in parallel containers', async () => {
      const results = await Promise.all([
        (async () => {
          const container = createTestContainer();
          const token = createToken<string>('Service');
          container.register(token, { useValue: 'container1' });
          return container.resolve(token);
        })(),
        (async () => {
          const container = createTestContainer();
          const token = createToken<string>('Service');
          container.register(token, { useValue: 'container2' });
          return container.resolve(token);
        })(),
        (async () => {
          const container = createTestContainer();
          const token = createToken<string>('Service');
          container.register(token, { useValue: 'container3' });
          return container.resolve(token);
        })()
      ]);

      expect(results).toEqual(['container1', 'container2', 'container3']);
    });
  });
});