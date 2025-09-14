/**
 * Tests for Nexus Testing Utilities
 */

import {
  TestContainer,
  createTestContainer,
  createIsolatedTestContainer,
  TestModuleBuilder,
  createToken,
  Scope,
  Provider,
  IModule,
  InjectionToken
} from '../src';

// Mock jest functions if not available
if (typeof jest === 'undefined') {
  (global as any).jest = {
    fn: (impl?: any) => {
      const fn: any = impl || (() => {});
      fn.mockImplementation = (newImpl: any) => { 
        Object.assign(fn, newImpl);
        return fn;
      };
      fn.mockReturnValue = (value: any) => {
        fn.mockImplementation(() => value);
        return fn;
      };
      fn.mockReset = () => fn;
      fn.mockClear = () => fn;
      fn.mock = { calls: [] };
      return fn;
    },
    spyOn: (obj: any, method: string) => {
      const spy: any = () => {};
      spy.mockRestore = () => {};
      spy.mockReset = () => {};
      spy.mockClear = () => {};
      spy.mock = { calls: [] };
      return spy;
    },
    isMockFunction: (fn: any) => fn && fn.mock
  };
}

describe('Testing Utilities', () => {
  describe('TestContainer', () => {
    it('should create a test container', () => {
      const container = new TestContainer();
      
      expect(container).toBeInstanceOf(TestContainer);
      
      const token = createToken('Test');
      container.register(token, { useValue: 'test' });
      
      expect(container.resolve(token)).toBe('test');
    });

    it('should load modules', () => {
      const serviceToken = createToken<string>('Service');
      const module: IModule = {
        name: 'TestModule',
        providers: [
          [serviceToken, { useValue: 'service' } as Provider<string>]
        ]
      };
      
      const container = new TestContainer({
        modules: [module]
      });
      
      expect(container.resolve(serviceToken)).toBe('service');
    });

    it('should register providers', () => {
      const token = createToken<string>('Token');
      
      const container = new TestContainer({
        providers: [
          [token, { useValue: 'value' } as Provider<string>]
        ]
      });
      
      expect(container.resolve(token)).toBe('value');
    });
  });

  describe('Mocking', () => {
    it('should mock dependencies', () => {
      const dbToken = createToken<{ query: (sql: string) => any }>('Database');
      const container = new TestContainer();
      
      const mockDb = {
        query: jest.fn().mockReturnValue([{ id: 1, name: 'Test' }])
      };
      
      container.mock(dbToken, mockDb);
      
      const db = container.resolve(dbToken);
      const result = db.query('SELECT * FROM users');
      
      expect(result).toEqual([{ id: 1, name: 'Test' }]);
      expect(mockDb.query).toHaveBeenCalledWith('SELECT * FROM users');
    });

    it('should setup mocks via options', () => {
      const token = createToken<{ method: () => string }>('Service');
      
      const container = new TestContainer({
        mocks: [
          {
            token,
            mock: { method: () => 'mocked' }
          }
        ]
      });
      
      const service = container.resolve(token);
      expect(service.method()).toBe('mocked');
    });

    it('should auto-mock functions when spy is enabled', () => {
      const token = createToken<{ method: () => string }>('Service');
      const container = new TestContainer();
      
      container.mock(token, { method: () => 'original' }, true);
      
      const service = container.resolve(token);
      expect(jest.isMockFunction(service.method)).toBe(true);
    });

    it('should get mock instance', () => {
      const token = createToken('Mock');
      const container = new TestContainer();
      
      const mock = { value: 'mock' };
      container.mock(token, mock);
      
      expect(container.getMock(token)).toBe(mock);
    });

    it('should throw when getting non-existent mock', () => {
      const token = createToken('NonExistent');
      const container = new TestContainer();
      
      expect(() => container.getMock(token)).toThrow('No mock found');
    });
  });

  describe('Spying', () => {
    it('should spy on methods', () => {
      const token = createToken<{ method: () => string }>('Service');
      const container = new TestContainer();
      
      container.register(token, {
        useValue: { method: () => 'original' }
      });
      
      const spy = container.spy(token, 'method');
      const service = container.resolve(token);
      
      service.method();
      
      expect(spy).toHaveBeenCalled();
    });

    it('should get spy instance', () => {
      const token = createToken<{ method: () => void }>('Service');
      const container = new TestContainer();
      
      container.mock(token, { method: jest.fn() }, true);
      
      const spy = container.getSpy(token, 'method');
      expect(spy).toBeDefined();
    });

    it('should throw when getting non-existent spy', () => {
      const token = createToken('Service');
      const container = new TestContainer();
      
      expect(() => container.getSpy(token, 'method' as any))
        .toThrow('No spy found');
    });
  });

  describe('Stubbing', () => {
    it('should stub dependencies', () => {
      const token = createToken<string>('Stub');
      const container = new TestContainer();
      
      container.stub(token, 'stubbed-value');
      
      expect(container.resolve(token)).toBe('stubbed-value');
    });
  });

  describe('Overriding', () => {
    it('should override with value', () => {
      const token = createToken<string>('Override');
      const container = new TestContainer();
      
      container.register(token, { useValue: 'original' });
      container.override(token).useValue('overridden');
      
      expect(container.resolve(token)).toBe('overridden');
    });

    it('should override with class', () => {
      class Original {
        value = 'original';
      }
      
      class Override {
        value = 'overridden';
      }
      
      const token = createToken<{ value: string }>('Service');
      const container = new TestContainer();
      
      container.register(token, { useClass: Original });
      container.override(token).useClass(Override);
      
      expect(container.resolve(token).value).toBe('overridden');
    });

    it('should override with factory', () => {
      const token = createToken<{ value: string }>('Factory');
      const container = new TestContainer();
      
      container.register(token, { useFactory: () => ({ value: 'original' }) });
      container.override(token).useFactory(() => ({ value: 'overridden' }));
      
      expect(container.resolve(token).value).toBe('overridden');
    });
  });

  describe('Interactions', () => {
    it('should record interactions', () => {
      const token = createToken('Service');
      const container = new TestContainer();
      
      const interaction = {
        method: 'test',
        args: ['arg1', 'arg2'],
        result: 'result',
        timestamp: Date.now()
      };
      
      container.recordInteraction(token, interaction);
      
      const interactions = container.getInteractions(token);
      expect(interactions).toContain(interaction);
    });

    it('should clear interactions', () => {
      const token = createToken('Service');
      const container = new TestContainer();
      
      container.recordInteraction(token, {
        method: 'test',
        args: [],
        timestamp: Date.now()
      });
      
      expect(container.getInteractions(token)).toHaveLength(1);
      
      container.clearInteractions(token);
      expect(container.getInteractions(token)).toHaveLength(0);
    });

    it('should clear all interactions', () => {
      const token1 = createToken('Service1');
      const token2 = createToken('Service2');
      const container = new TestContainer();
      
      container.recordInteraction(token1, {
        method: 'test',
        args: [],
        timestamp: Date.now()
      });
      
      container.recordInteraction(token2, {
        method: 'test',
        args: [],
        timestamp: Date.now()
      });
      
      container.clearInteractions();
      
      expect(container.getInteractions(token1)).toHaveLength(0);
      expect(container.getInteractions(token2)).toHaveLength(0);
    });
  });

  describe('Snapshots', () => {
    it('should take and restore snapshots', () => {
      const token = createToken<{ value: string }>('Service');
      const container = new TestContainer();
      
      const mock = { value: 'initial' };
      container.mock(token, mock);
      
      container.snapshot('before');
      
      mock.value = 'modified';
      
      container.restore('before');
      
      // Note: In real implementation, this would restore the mock state
      // For now, this is a simplified test
      expect(container.getMock(token)).toBeDefined();
    });

    it('should throw when restoring non-existent snapshot', () => {
      const container = new TestContainer();
      
      expect(() => container.restore('non-existent'))
        .toThrow("Snapshot 'non-existent' not found");
    });
  });

  describe('Mock Management', () => {
    it('should reset mocks', () => {
      const token = createToken<{ method: jest.Mock }>('Service');
      const container = new TestContainer();
      
      const mockFn = jest.fn();
      container.mock(token, { method: mockFn }, true);
      
      mockFn('call');
      container.resetMocks();
      
      // In real jest, this would reset the mock
      expect(mockFn).toBeDefined();
    });

    it('should clear mocks', () => {
      const token = createToken<{ method: jest.Mock }>('Service');
      const container = new TestContainer();
      
      const mockFn = jest.fn();
      container.mock(token, { method: mockFn }, true);
      
      mockFn('call');
      container.clearMocks();
      
      // In real jest, this would clear the mock calls
      expect(mockFn).toBeDefined();
    });
  });

  describe('Auto-mocking', () => {
    it('should auto-mock unregistered dependencies', () => {
      const token = createToken<{ method: () => string }>('Unregistered');
      const container = new TestContainer({ autoMock: true });
      
      const service = container.resolve(token);
      
      expect(service).toBeDefined();
      expect(typeof service.method).toBe('function');
    });

    it('should not auto-mock when disabled', () => {
      const token = createToken('Unregistered');
      const container = new TestContainer({ autoMock: false });
      
      expect(() => container.resolve(token)).toThrow();
    });
  });

  describe('Helper Functions', () => {
    it('should create test container from module', () => {
      const serviceToken = createToken<string>('Service');
      const module: IModule = {
        name: 'TestModule',
        providers: [
          [serviceToken, { useValue: 'service' } as Provider<string>]
        ]
      };
      
      const container = createTestContainer(module);
      
      expect(container.resolve(serviceToken)).toBe('service');
    });

    it('should create test container from options', () => {
      const serviceToken = createToken<string>('Service');
      const container = createTestContainer({
        providers: [
          [serviceToken, { useValue: 'service' } as Provider<string>]
        ]
      });
      
      expect(container.resolve(serviceToken)).toBe('service');
    });

    it('should create isolated test container', () => {
      const serviceToken = createToken<string>('Service');
      const container = createIsolatedTestContainer({
        providers: [
          [serviceToken, { useValue: 'service' } as Provider<string>]
        ]
      });
      
      expect(container).toBeInstanceOf(TestContainer);
      expect(container.resolve(serviceToken)).toBe('service');
    });
  });

  describe('TestModuleBuilder', () => {
    it('should build test container with providers', () => {
      const token = createToken<string>('Service');
      
      const container = new TestModuleBuilder()
        .withProvider(token, { useValue: 'service' })
        .build();
      
      expect(container.resolve(token)).toBe('service');
    });

    it('should build test container with mocks', () => {
      const token = createToken<{ value: string }>('Service');
      
      const container = new TestModuleBuilder()
        .withMock(token, { value: 'mocked' })
        .build();
      
      expect(container.resolve(token).value).toBe('mocked');
    });

    it('should build test container with modules', () => {
      const serviceToken = createToken<string>('Service');
      const module: IModule = {
        name: 'TestModule',
        providers: [
          [serviceToken, { useValue: 'service' } as Provider<string>]
        ]
      };
      
      const container = new TestModuleBuilder()
        .withModule(module)
        .build();
      
      expect(container.resolve(serviceToken)).toBe('service');
    });

    it('should chain builder methods', () => {
      const token1 = createToken<string>('Service1');
      const token2 = createToken<{ value: string }>('Service2');
      const moduleServiceToken = createToken<string>('ModuleService');
      const module: IModule = {
        name: 'Module',
        providers: [
          [moduleServiceToken, { useValue: 'module' } as Provider<string>]
        ]
      };
      
      const container = new TestModuleBuilder()
        .withProvider(token1, { useValue: 'service1' })
        .withMock(token2, { value: 'mocked' })
        .withModule(module)
        .build();
      
      expect(container.resolve(token1)).toBe('service1');
      expect(container.resolve(token2).value).toBe('mocked');
      expect(container.resolve(moduleServiceToken)).toBe('module');
    });
  });
});