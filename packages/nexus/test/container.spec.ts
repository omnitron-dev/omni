/**
 * Tests for Nexus Container core functionality
 */

import {
  Container,
  createToken,
  createMultiToken,
  createOptionalToken,
  Scope,
  ResolutionError,
  CircularDependencyError,
  DependencyNotFoundError,
  AsyncResolutionError,
  DuplicateRegistrationError,
  IModule,
  Provider
} from '../src';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Basic Registration and Resolution', () => {
    it('should register and resolve a value provider', () => {
      const token = createToken<string>('TestValue');
      const value = 'test-value';

      container.register(token, { useValue: value });
      const resolved = container.resolve(token);

      expect(resolved).toBe(value);
    });

    it('should register and resolve a class provider', () => {
      class TestService {
        getValue() {
          return 'test';
        }
      }

      const token = createToken<TestService>('TestService');
      container.register(token, { useClass: TestService });

      const resolved = container.resolve(token);
      expect(resolved).toBeInstanceOf(TestService);
      expect(resolved.getValue()).toBe('test');
    });

    it('should register and resolve a factory provider', () => {
      const token = createToken<{ id: number }>('TestFactory');
      let id = 0;

      container.register(token, {
        useFactory: () => ({ id: ++id })
      });

      const resolved1 = container.resolve(token);
      const resolved2 = container.resolve(token);

      expect(resolved1.id).toBe(1);
      expect(resolved2.id).toBe(2);
    });

    it('should register and resolve with class constructor directly', () => {
      class TestService {
        name = 'test';
      }

      container.register(TestService, TestService);
      const resolved = container.resolve(TestService);

      expect(resolved).toBeInstanceOf(TestService);
      expect(resolved.name).toBe('test');
    });

    it('should throw on duplicate registration', () => {
      const token = createToken('Duplicate');
      
      container.register(token, { useValue: 'first' });
      
      expect(() => {
        container.register(token, { useValue: 'second' });
      }).toThrow(DuplicateRegistrationError);
    });

    it('should allow override with tag', () => {
      const token = createToken('Override');
      
      container.register(token, { useValue: 'first' });
      container.register(token, { useValue: 'second' }, { tags: ['override'] });
      
      expect(container.resolve(token)).toBe('second');
    });
  });

  describe('Dependency Injection', () => {
    it('should inject dependencies into class constructor', () => {
      class Database {
        name = 'db';
      }

      class UserService {
        constructor(public db: Database) {}
      }

      const dbToken = createToken<Database>('Database');
      const userToken = createToken<UserService>('UserService');

      container.register(dbToken, { useClass: Database });
      container.register(userToken, {
        useClass: UserService,
        inject: [dbToken]
      });

      const userService = container.resolve(userToken);
      expect(userService.db).toBeInstanceOf(Database);
      expect(userService.db.name).toBe('db');
    });

    it('should inject dependencies into factory', () => {
      const configToken = createToken<{ apiUrl: string }>('Config');
      const apiToken = createToken<{ url: string }>('Api');

      container.register(configToken, {
        useValue: { apiUrl: 'https://api.example.com' }
      });

      container.register(apiToken, {
        useFactory: (config: any) => ({ url: config.apiUrl }),
        inject: [configToken]
      });

      const api = container.resolve(apiToken);
      expect(api.url).toBe('https://api.example.com');
    });

    it('should resolve token provider', () => {
      const originalToken = createToken<string>('Original');
      const aliasToken = createToken<string>('Alias');

      container.register(originalToken, { useValue: 'original-value' });
      container.register(aliasToken, { useToken: originalToken });

      expect(container.resolve(aliasToken)).toBe('original-value');
    });

    it('should throw on missing dependency', () => {
      const serviceToken = createToken('Service');
      const missingToken = createToken('Missing');

      container.register(serviceToken, {
        useFactory: (missing: any) => ({ missing }),
        inject: [missingToken]
      });

      expect(() => container.resolve(serviceToken)).toThrow(DependencyNotFoundError);
    });

    it('should detect circular dependencies', () => {
      const aToken = createToken('A');
      const bToken = createToken('B');
      const cToken = createToken('C');

      container.register(aToken, {
        useFactory: (b: any) => ({ b }),
        inject: [bToken]
      });

      container.register(bToken, {
        useFactory: (c: any) => ({ c }),
        inject: [cToken]
      });

      container.register(cToken, {
        useFactory: (a: any) => ({ a }),
        inject: [aToken]
      });

      expect(() => container.resolve(aToken)).toThrow(CircularDependencyError);
    });
  });

  describe('Lifecycle Management', () => {
    it('should create singleton instances', () => {
      let instanceCount = 0;

      class SingletonService {
        id = ++instanceCount;
      }

      const token = createToken<SingletonService>('Singleton');
      container.register(token, {
        useClass: SingletonService,
        scope: Scope.Singleton
      });

      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);

      expect(instance1).toBe(instance2);
      expect(instance1.id).toBe(1);
      expect(instanceCount).toBe(1);
    });

    it('should create transient instances', () => {
      let instanceCount = 0;

      class TransientService {
        id = ++instanceCount;
      }

      const token = createToken<TransientService>('Transient');
      container.register(token, {
        useClass: TransientService,
        scope: Scope.Transient
      });

      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);

      expect(instance1).not.toBe(instance2);
      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
    });

    it('should create scoped instances', () => {
      class ScopedService {
        id = Math.random();
      }

      const token = createToken<ScopedService>('Scoped');
      container.register(token, {
        useClass: ScopedService,
        scope: Scope.Scoped
      });

      const scope1 = container.createScope({ metadata: { scopeId: 'scope1' } });
      const scope2 = container.createScope({ metadata: { scopeId: 'scope2' } });

      const instance1a = scope1.resolve(token);
      const instance1b = scope1.resolve(token);
      const instance2 = scope2.resolve(token);

      expect(instance1a).toBe(instance1b);
      expect(instance1a).not.toBe(instance2);
    });

    it('should dispose resources', async () => {
      const disposed: string[] = [];

      class DisposableService {
        constructor(public name: string) {}
        
        async dispose() {
          disposed.push(this.name);
        }
      }

      const token1 = createToken<DisposableService>('Service1');
      const token2 = createToken<DisposableService>('Service2');

      container.register(token1, {
        useFactory: () => new DisposableService('service1'),
        scope: Scope.Singleton
      });

      container.register(token2, {
        useFactory: () => new DisposableService('service2'),
        scope: Scope.Singleton
      });

      container.resolve(token1);
      container.resolve(token2);

      await container.dispose();

      expect(disposed).toContain('service1');
      expect(disposed).toContain('service2');
    });

    it('should initialize resources', () => {
      let initialized = false;

      class InitializableService {
        initialized = false;
        
        initialize() {
          this.initialized = true;
          initialized = true;
        }
      }

      const token = createToken<InitializableService>('Initializable');
      container.register(token, {
        useClass: InitializableService
      });

      const service = container.resolve(token);
      
      expect(service.initialized).toBe(true);
      expect(initialized).toBe(true);
    });
  });

  describe('Multi-Token Support', () => {
    it('should register and resolve multiple providers', () => {
      interface Plugin {
        name: string;
      }

      const pluginToken = createMultiToken<Plugin>('Plugin');

      container.register(pluginToken, { useValue: { name: 'plugin1' } });
      container.register(pluginToken, { useValue: { name: 'plugin2' } });
      container.register(pluginToken, { useValue: { name: 'plugin3' } });

      const plugins = container.resolveMany(pluginToken);

      expect(plugins).toHaveLength(3);
      expect(plugins.map(p => p.name)).toEqual(['plugin1', 'plugin2', 'plugin3']);
    });

    it('should return empty array for unregistered multi-token', () => {
      const token = createMultiToken('Unregistered');
      const resolved = container.resolveMany(token);
      
      expect(resolved).toEqual([]);
    });
  });

  describe('Optional Dependencies', () => {
    it('should resolve optional token to undefined when not registered', () => {
      const token = createOptionalToken<string>('Optional');
      const resolved = container.resolveOptional(token);
      
      expect(resolved).toBeUndefined();
    });

    it('should resolve optional token when registered', () => {
      const token = createOptionalToken<string>('Optional');
      container.register(token, { useValue: 'value' });
      
      const resolved = container.resolveOptional(token);
      expect(resolved).toBe('value');
    });
  });

  describe('Async Resolution', () => {
    it('should resolve async factory provider', async () => {
      const token = createToken<{ data: string }>('AsyncService');

      container.registerAsync(token, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { data: 'async-data' };
        }
      });

      const resolved = await container.resolveAsync(token);
      expect(resolved.data).toBe('async-data');
    });

    it('should throw when resolving async provider synchronously', () => {
      const token = createToken('AsyncOnly');

      container.registerAsync(token, {
        useFactory: async () => 'async-value'
      });

      expect(() => container.resolve(token)).toThrow(AsyncResolutionError);
    });

    it('should resolve async dependencies', async () => {
      const configToken = createToken<{ db: string }>('Config');
      const dbToken = createToken<{ url: string }>('Database');

      container.registerAsync(configToken, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { db: 'postgres://localhost' };
        }
      });

      container.registerAsync(dbToken, {
        useFactory: async (config) => ({ url: config.db }),
        inject: [configToken]
      });

      const db = await container.resolveAsync(dbToken);
      expect(db.url).toBe('postgres://localhost');
    });
  });

  describe('Conditional Providers', () => {
    it('should resolve based on condition', () => {
      const token = createToken<string>('Conditional');

      let useProduction = false;

      container.register(token, {
        when: () => useProduction,
        useFactory: () => 'production',
        fallback: { useValue: 'development' }
      } as any);

      expect(container.resolve(token)).toBe('development');

      useProduction = true;
      container.clearCache();
      
      expect(container.resolve(token)).toBe('production');
    });
  });

  describe('Parent-Child Containers', () => {
    it('should resolve from parent container', () => {
      const parentToken = createToken<string>('Parent');
      const childToken = createToken<string>('Child');

      container.register(parentToken, { useValue: 'parent-value' });
      
      const child = container.createScope();
      child.register(childToken, { useValue: 'child-value' });

      expect(child.resolve(parentToken)).toBe('parent-value');
      expect(child.resolve(childToken)).toBe('child-value');
      expect(() => container.resolve(childToken)).toThrow(DependencyNotFoundError);
    });

    it('should override parent registration in child', () => {
      const token = createToken<string>('Shared');

      container.register(token, { useValue: 'parent' });
      
      const child = container.createScope();
      child.register(token, { useValue: 'child' }, { tags: ['override'] });

      expect(container.resolve(token)).toBe('parent');
      expect(child.resolve(token)).toBe('child');
    });
  });

  describe('Module System', () => {
    it('should load and initialize modules', () => {
      let moduleInitialized = false;
      const serviceToken = createToken<string>('Service');

      const testModule: IModule = {
        name: 'TestModule',
        providers: [
          [serviceToken, { useValue: 'service' } as Provider<string>]
        ],
        onModuleInit: () => {
          moduleInitialized = true;
        }
      };

      container.loadModule(testModule);
      
      expect(moduleInitialized).toBe(true);
      expect(container.resolve(serviceToken)).toBe('service');
    });

    it('should handle module imports', () => {
      const databaseToken = createToken<string>('Database');
      const appToken = createToken<string>('App');
      
      const dbModule: IModule = {
        name: 'DatabaseModule',
        providers: [
          [databaseToken, { useValue: 'db' } as Provider<string>]
        ]
      };

      const appModule: IModule = {
        name: 'AppModule',
        imports: [dbModule],
        providers: [
          [appToken, { useValue: 'app' } as Provider<string>]
        ]
      };

      container.loadModule(appModule);
      
      expect(container.resolve(databaseToken)).toBe('db');
      expect(container.resolve(appToken)).toBe('app');
    });
  });

  describe('Metadata and Introspection', () => {
    it('should check if token is registered', () => {
      const token = createToken('Check');
      
      expect(container.has(token)).toBe(false);
      
      container.register(token, { useValue: 'value' });
      
      expect(container.has(token)).toBe(true);
    });

    it('should get container metadata', () => {
      const token1 = createToken('Token1');
      const token2 = createToken('Token2');

      container.register(token1, { useValue: 'value1' });
      container.register(token2, { 
        useValue: 'value2',
        scope: Scope.Singleton 
      });

      container.resolve(token2); // Cache singleton

      const metadata = container.getMetadata();
      
      expect(metadata.registrations).toBe(2);
      expect(metadata.cached).toBeGreaterThan(0);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', () => {
      let callCount = 0;
      
      const token = createToken<{ id: number }>('Cached');
      container.register(token, {
        useFactory: () => ({ id: ++callCount }),
        scope: Scope.Singleton
      });

      const instance1 = container.resolve(token);
      expect(instance1.id).toBe(1);

      container.clearCache();

      const instance2 = container.resolve(token);
      expect(instance2.id).toBe(2);
    });
  });
});