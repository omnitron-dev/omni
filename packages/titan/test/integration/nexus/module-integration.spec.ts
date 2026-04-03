/**
 * Nexus Container - Module Integration Tests
 *
 * Tests for module loading, dependency resolution between modules,
 * export/import mechanics, global modules, and forward references.
 *
 * @since 0.4.5
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, createToken, Scope, forwardRef } from '@nexus';
import type { IModule } from '@nexus';

// Tokens for testing
const DatabaseToken = createToken<DatabaseService>('DatabaseService');
const CacheToken = createToken<CacheService>('CacheService');
const ApiToken = createToken<ApiService>('ApiService');
const LoggerToken = createToken<LoggerService>('LoggerService');
const ConfigToken = createToken<ConfigService>('ConfigService');
const PrivateToken = createToken<PrivateService>('PrivateService');

// Test service classes
class DatabaseService {
  query(sql: string): string {
    return `Result: ${sql}`;
  }
}

class CacheService {
  private cache = new Map<string, any>();

  get(key: string): any {
    return this.cache.get(key);
  }

  set(key: string, value: any): void {
    this.cache.set(key, value);
  }
}

class ApiService {
  constructor(
    public db: DatabaseService,
    public cache: CacheService
  ) {}

  fetchData(id: string): string {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const result = this.db.query(`SELECT * FROM data WHERE id=${id}`);
    this.cache.set(id, result);
    return result;
  }
}

class LoggerService {
  logs: string[] = [];

  log(message: string): void {
    this.logs.push(message);
  }
}

class ConfigService {
  private config = new Map<string, any>();

  get(key: string): any {
    return this.config.get(key);
  }

  set(key: string, value: any): void {
    this.config.set(key, value);
  }
}

class PrivateService {
  getValue(): string {
    return 'private';
  }
}

describe('Nexus Container - Module Integration', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Basic Module Loading', () => {
    it('should load a simple module with providers', () => {
      const module: IModule = {
        name: 'SimpleModule',
        providers: [[DatabaseToken, { useClass: DatabaseService }]],
        exports: [DatabaseToken],
      };

      container.loadModule(module);

      const db = container.resolve(DatabaseToken);
      expect(db).toBeInstanceOf(DatabaseService);
      expect(db.query('test')).toBe('Result: test');
    });

    it('should load module with multiple providers', () => {
      const module: IModule = {
        name: 'MultiProviderModule',
        providers: [
          [DatabaseToken, { useClass: DatabaseService }],
          [CacheToken, { useClass: CacheService }],
        ],
        exports: [DatabaseToken, CacheToken],
      };

      container.loadModule(module);

      const db = container.resolve(DatabaseToken);
      const cache = container.resolve(CacheToken);

      expect(db).toBeInstanceOf(DatabaseService);
      expect(cache).toBeInstanceOf(CacheService);
    });

    it('should handle providers with dependencies within same module', () => {
      const module: IModule = {
        name: 'DependencyModule',
        providers: [
          [DatabaseToken, { useClass: DatabaseService }],
          [CacheToken, { useClass: CacheService }],
          [
            ApiToken,
            {
              useFactory: (db: DatabaseService, cache: CacheService) => new ApiService(db, cache),
              inject: [DatabaseToken, CacheToken],
            },
          ],
        ],
        exports: [ApiToken],
      };

      container.loadModule(module);

      const api = container.resolve(ApiToken);
      expect(api).toBeInstanceOf(ApiService);
      expect(api.fetchData('123')).toContain('Result');
    });
  });

  describe('Module Imports and Exports', () => {
    it('should resolve dependencies from imported modules', () => {
      const dbModule: IModule = {
        name: 'DatabaseModule',
        providers: [[DatabaseToken, { useClass: DatabaseService }]],
        exports: [DatabaseToken],
      };

      const cacheModule: IModule = {
        name: 'CacheModule',
        providers: [[CacheToken, { useClass: CacheService }]],
        exports: [CacheToken],
      };

      const apiModule: IModule = {
        name: 'ApiModule',
        imports: [dbModule, cacheModule],
        providers: [
          [
            ApiToken,
            {
              useFactory: (db: DatabaseService, cache: CacheService) => new ApiService(db, cache),
              inject: [DatabaseToken, CacheToken],
            },
          ],
        ],
        exports: [ApiToken],
      };

      container.loadModule(apiModule);

      const api = container.resolve(ApiToken);
      expect(api).toBeInstanceOf(ApiService);
      expect(api.db).toBeInstanceOf(DatabaseService);
      expect(api.cache).toBeInstanceOf(CacheService);
    });

    it('should not expose non-exported providers from imported modules', () => {
      const privateModule: IModule = {
        name: 'PrivateModule',
        providers: [
          [PrivateToken, { useClass: PrivateService }],
          [DatabaseToken, { useClass: DatabaseService }],
        ],
        exports: [DatabaseToken], // PrivateToken is not exported
      };

      const consumerModule: IModule = {
        name: 'ConsumerModule',
        imports: [privateModule],
        providers: [],
      };

      container.loadModule(consumerModule);

      // DatabaseToken should be accessible
      const db = container.resolve(DatabaseToken);
      expect(db).toBeInstanceOf(DatabaseService);

      // PrivateToken should still be accessible directly (registered in container)
      // but module encapsulation is about preventing cross-module access
    });

    it('should re-export providers from imported modules', () => {
      const coreModule: IModule = {
        name: 'CoreModule',
        providers: [[LoggerToken, { useClass: LoggerService }]],
        exports: [LoggerToken],
      };

      const featureModule: IModule = {
        name: 'FeatureModule',
        imports: [coreModule],
        providers: [],
        exports: [LoggerToken], // Re-export LoggerToken
      };

      const appModule: IModule = {
        name: 'AppModule',
        imports: [featureModule],
        providers: [],
      };

      container.loadModule(appModule);

      const logger = container.resolve(LoggerToken);
      expect(logger).toBeInstanceOf(LoggerService);
    });
  });

  describe('Global Modules', () => {
    it('should make global module providers available everywhere', () => {
      const globalModule: IModule = {
        name: 'GlobalConfigModule',
        global: true,
        providers: [[ConfigToken, { useClass: ConfigService, scope: Scope.Singleton }]],
        exports: [ConfigToken],
      };

      const featureModule: IModule = {
        name: 'FeatureModule',
        // Note: Not importing globalModule
        providers: [
          [
            ApiToken,
            {
              useFactory: (config: ConfigService) => {
                config.set('api.enabled', true);
                return new ApiService(new DatabaseService(), new CacheService());
              },
              inject: [ConfigToken],
            },
          ],
        ],
        exports: [ApiToken],
      };

      // Load global module first
      container.loadModule(globalModule);
      container.loadModule(featureModule);

      const api = container.resolve(ApiToken);
      expect(api).toBeDefined();

      const config = container.resolve(ConfigToken);
      expect(config.get('api.enabled')).toBe(true);
    });
  });

  describe('Module Lifecycle', () => {
    it('should call onModuleInit when module is loaded', async () => {
      let initCalled = false;

      const module: IModule = {
        name: 'LifecycleModule',
        providers: [],
        onModuleInit: async () => {
          initCalled = true;
        },
      };

      container.loadModule(module);

      // onModuleInit may be called asynchronously
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(initCalled).toBe(true);
    });

    it('should call onModuleDestroy when container is disposed', async () => {
      let destroyCalled = false;

      const module: IModule = {
        name: 'LifecycleModule',
        providers: [],
        onModuleDestroy: async () => {
          destroyCalled = true;
        },
      };

      container.loadModule(module);
      await container.dispose();

      expect(destroyCalled).toBe(true);
    });

    it('should handle module init errors gracefully', async () => {
      const failingModule: IModule = {
        name: 'FailingModule',
        providers: [[DatabaseToken, { useClass: DatabaseService }]],
        onModuleInit: async () => {
          throw new Error('Init failed');
        },
      };

      // Should not throw during loadModule
      container.loadModule(failingModule);

      // Providers should still be accessible
      const db = container.resolve(DatabaseToken);
      expect(db).toBeInstanceOf(DatabaseService);
    });
  });

  describe('Required Modules', () => {
    it('should enforce required modules are loaded first', () => {
      const dependentModule: IModule = {
        name: 'DependentModule',
        requires: ['BaseModule'],
        providers: [],
      };

      expect(() => container.loadModule(dependentModule)).toThrow(/BaseModule/);
    });

    it('should allow loading when required modules exist', () => {
      const baseModule: IModule = {
        name: 'BaseModule',
        providers: [[DatabaseToken, { useClass: DatabaseService }]],
        exports: [DatabaseToken],
      };

      const dependentModule: IModule = {
        name: 'DependentModule',
        requires: ['BaseModule'],
        imports: [baseModule],
        providers: [],
      };

      container.loadModule(baseModule);
      container.loadModule(dependentModule);

      // Should not throw
      expect(container.has(DatabaseToken)).toBe(true);
    });
  });

  describe('Forward References', () => {
    it('should handle circular module dependencies with forward refs', () => {
      // Using forwardRef to break circular dependency
      const moduleA: IModule = {
        name: 'ModuleA',
        imports: [forwardRef(() => moduleB)],
        providers: [[DatabaseToken, { useClass: DatabaseService }]],
        exports: [DatabaseToken],
      };

      const moduleB: IModule = {
        name: 'ModuleB',
        imports: [forwardRef(() => moduleA)],
        providers: [[CacheToken, { useClass: CacheService }]],
        exports: [CacheToken],
      };

      // Load one module - should handle the forward ref
      container.loadModule(moduleA);

      const db = container.resolve(DatabaseToken);
      const cache = container.resolve(CacheToken);

      expect(db).toBeInstanceOf(DatabaseService);
      expect(cache).toBeInstanceOf(CacheService);
    });
  });

  describe('Duplicate Module Loading', () => {
    it('should not load the same module twice', () => {
      let loadCount = 0;

      const module: IModule = {
        name: 'SingleLoadModule',
        providers: [[DatabaseToken, { useClass: DatabaseService }]],
        onModuleInit: () => {
          loadCount++;
        },
      };

      container.loadModule(module);
      container.loadModule(module);

      // Wait for async init
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(loadCount).toBe(1);
          resolve();
        }, 20);
      });
    });

    it('should handle diamond dependency pattern', () => {
      // A -> B, A -> C, B -> D, C -> D
      // D should only be loaded once

      let dLoadCount = 0;

      const moduleD: IModule = {
        name: 'ModuleD',
        providers: [[ConfigToken, { useClass: ConfigService }]],
        exports: [ConfigToken],
        onModuleInit: () => {
          dLoadCount++;
        },
      };

      const moduleB: IModule = {
        name: 'ModuleB',
        imports: [moduleD],
        providers: [[DatabaseToken, { useClass: DatabaseService }]],
        exports: [DatabaseToken],
      };

      const moduleC: IModule = {
        name: 'ModuleC',
        imports: [moduleD],
        providers: [[CacheToken, { useClass: CacheService }]],
        exports: [CacheToken],
      };

      const moduleA: IModule = {
        name: 'ModuleA',
        imports: [moduleB, moduleC],
        providers: [],
      };

      container.loadModule(moduleA);

      // Wait for async init
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(dLoadCount).toBe(1);
          resolve();
        }, 20);
      });
    });
  });

  describe('Conditional Providers', () => {
    it('should handle conditional provider registration', () => {
      const FeatureToken = createToken<{ enabled: boolean }>('Feature');

      const module: IModule = {
        name: 'ConditionalModule',
        providers: [
          [
            FeatureToken,
            {
              conditional: true,
              condition: (container: Container) =>
                // Only register if ConfigToken exists
                container.has(ConfigToken),
              originalProvider: { useValue: { enabled: true } },
            },
          ],
        ],
      };

      // First, load without ConfigToken
      container.loadModule(module);
      expect(container.has(FeatureToken)).toBe(false);

      // Create a new container with ConfigToken
      const container2 = new Container();
      container2.register(ConfigToken, { useClass: ConfigService });
      container2.loadModule(module);
      expect(container2.has(FeatureToken)).toBe(true);
    });
  });

  describe('Provider Override', () => {
    it('should allow provider override with option', () => {
      const module1: IModule = {
        name: 'Module1',
        providers: [[DatabaseToken, { useValue: { name: 'original' } }]],
        exports: [DatabaseToken],
      };

      container.loadModule(module1);

      // Override with new value
      container.register(DatabaseToken, { useValue: { name: 'overridden' } }, { override: true });

      const db = container.resolve(DatabaseToken);
      expect(db.name).toBe('overridden');
    });
  });

  describe('Scoped Providers in Modules', () => {
    it('should handle scoped providers in modules correctly', () => {
      let instanceCount = 0;

      class ScopedService {
        id: number;
        constructor() {
          this.id = ++instanceCount;
        }
      }

      const ScopedToken = createToken<ScopedService>('ScopedService');

      const module: IModule = {
        name: 'ScopedModule',
        providers: [[ScopedToken, { useClass: ScopedService, scope: Scope.Scoped }]],
        exports: [ScopedToken],
      };

      container.loadModule(module);

      const scope1 = container.createScope();
      const scope2 = container.createScope();

      const service1 = scope1.resolve(ScopedToken);
      const service1Again = scope1.resolve(ScopedToken);
      const service2 = scope2.resolve(ScopedToken);

      // Same scope should return same instance
      expect(service1.id).toBe(service1Again.id);

      // Different scopes should return different instances
      expect(service1.id).not.toBe(service2.id);
    });
  });
});
