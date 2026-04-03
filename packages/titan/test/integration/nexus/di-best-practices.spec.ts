/**
 * DI Best Practices Integration Tests
 *
 * Validates the patterns enforced across all 5 backend apps after DI improvements:
 * 1. Typed tokens via createToken() instead of @Inject('string')
 * 2. No duplicate bare class + token registrations
 * 3. Typed Token<IService> resolution
 * 4. Module export visibility / encapsulation
 * 5. useExisting provider aliasing
 * 6. Deferred eager initialization across modules
 *
 * These tests serve as documentation and regression guards for DI hygiene.
 *
 * @since 0.5.1
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, createToken, Scope, isToken, defineExisting } from '@nexus';
import type { IModule } from '@nexus';

// =============================================================================
// Interfaces — mirrors the typed-token pattern used across all apps
// =============================================================================

interface IRepository<T> {
  findById(id: string): T | undefined;
  save(entity: T): void;
}

interface IUserService {
  getUser(id: string): { id: string; name: string } | undefined;
  createUser(name: string): { id: string; name: string };
}

interface ICacheService {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

interface IConfigService {
  get<T>(key: string): T | undefined;
}

interface INotificationService {
  send(userId: string, message: string): void;
}

// =============================================================================
// Concrete implementations
// =============================================================================

class UserRepository implements IRepository<{ id: string; name: string }> {
  private store = new Map<string, { id: string; name: string }>();
  findById(id: string) {
    return this.store.get(id);
  }
  save(entity: { id: string; name: string }) {
    this.store.set(entity.id, entity);
  }
}

class UserService implements IUserService {
  constructor(private repo: IRepository<{ id: string; name: string }>) {}
  getUser(id: string) {
    return this.repo.findById(id);
  }
  createUser(name: string) {
    const user = { id: String(Date.now()), name };
    this.repo.save(user);
    return user;
  }
}

class InMemoryCache implements ICacheService {
  private cache = new Map<string, unknown>();
  get(key: string) {
    return this.cache.get(key);
  }
  set(key: string, value: unknown) {
    this.cache.set(key, value);
  }
}

class RedisCache implements ICacheService {
  private cache = new Map<string, unknown>();
  get(key: string) {
    return this.cache.get(key);
  }
  set(key: string, value: unknown) {
    this.cache.set(key, value);
  }
}

class ConfigService implements IConfigService {
  private config = new Map<string, unknown>();
  constructor(defaults?: Record<string, unknown>) {
    if (defaults) {
      for (const [k, v] of Object.entries(defaults)) this.config.set(k, v);
    }
  }
  get<T>(key: string) {
    return this.config.get(key) as T | undefined;
  }
}

class NotificationService implements INotificationService {
  sent: Array<{ userId: string; message: string }> = [];
  send(userId: string, message: string) {
    this.sent.push({ userId, message });
  }
}

// =============================================================================
// Typed tokens — pattern enforced in all 5 apps (replaces @Inject('string'))
// =============================================================================

const USER_REPO_TOKEN = createToken<IRepository<{ id: string; name: string }>>('UserRepository');
const USER_SERVICE_TOKEN = createToken<IUserService>('UserService');
const CACHE_SERVICE_TOKEN = createToken<ICacheService>('CacheService');
const CONFIG_SERVICE_TOKEN = createToken<IConfigService>('ConfigService');
const NOTIFICATION_TOKEN = createToken<INotificationService>('NotificationService');
const INTERNAL_HELPER_TOKEN = createToken<{ compute(): number }>('InternalHelper');

// =============================================================================
// TESTS
// =============================================================================

describe('DI Best Practices', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  // ---------------------------------------------------------------------------
  // 1. Typed tokens via createToken()
  // ---------------------------------------------------------------------------

  describe('Typed Tokens via createToken()', () => {
    it('should return a proper Token object with id, name, and metadata', () => {
      const token = createToken<IUserService>('TestUserService');

      expect(isToken(token)).toBe(true);
      expect(token.name).toBe('TestUserService');
      expect(typeof token.id).toBe('symbol');
      expect(token.metadata).toBeDefined();
      expect(token.toString()).toBe('[Token: TestUserService]');
    });

    it('should return the same token instance for the same name (registry caching)', () => {
      // createToken caches tokens without metadata — this ensures
      // tokens defined in shared/tokens.ts are stable singletons
      const tokenA = createToken<IUserService>('StableToken');
      const tokenB = createToken<IUserService>('StableToken');

      expect(tokenA).toBe(tokenB);
      expect(tokenA.id).toBe(tokenB.id);
    });

    it('should reject empty token names', () => {
      expect(() => createToken('')).toThrow();
      expect(() => createToken('   ')).toThrow();
    });

    it('should resolve typed token to the correct implementation', () => {
      const module: IModule = {
        name: 'TypedTokenModule',
        providers: [
          [USER_REPO_TOKEN, { useClass: UserRepository }],
          [
            USER_SERVICE_TOKEN,
            {
              useFactory: (repo: IRepository<{ id: string; name: string }>) => new UserService(repo),
              inject: [USER_REPO_TOKEN],
            },
          ],
        ],
        exports: [USER_SERVICE_TOKEN],
      };

      container.loadModule(module);

      const service = container.resolve(USER_SERVICE_TOKEN);
      // Type safety: service is IUserService, not any
      const user = service.createUser('Alice');
      expect(user.name).toBe('Alice');
      expect(service.getUser(user.id)).toEqual(user);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. No duplicate providers (bare class + token for same class)
  // ---------------------------------------------------------------------------

  describe('No Duplicate Provider Registrations', () => {
    it('should produce only one singleton instance when registered once via token', () => {
      let instanceCount = 0;

      class CountedService {
        readonly instanceId: number;
        constructor() {
          this.instanceId = ++instanceCount;
        }
      }

      const COUNTED_TOKEN = createToken<CountedService>('CountedService');

      const module: IModule = {
        name: 'SingleRegistrationModule',
        providers: [
          // CORRECT: register ONLY via token, not also as bare class
          [COUNTED_TOKEN, { useClass: CountedService, scope: Scope.Singleton }],
        ],
        exports: [COUNTED_TOKEN],
      };

      container.loadModule(module);

      const instance1 = container.resolve(COUNTED_TOKEN);
      const instance2 = container.resolve(COUNTED_TOKEN);

      // Same singleton instance
      expect(instance1).toBe(instance2);
      expect(instance1.instanceId).toBe(1);
      // Only one instance was ever created
      expect(instanceCount).toBe(1);
    });

    it('should create separate instances when the same class is registered under different tokens', () => {
      let instanceCount = 0;

      class SharedImpl implements ICacheService {
        readonly instanceId: number;
        private cache = new Map<string, unknown>();
        constructor() {
          this.instanceId = ++instanceCount;
        }
        get(key: string) {
          return this.cache.get(key);
        }
        set(key: string, value: unknown) {
          this.cache.set(key, value);
        }
      }

      const PRIMARY_CACHE = createToken<ICacheService>('PrimaryCache');
      const SECONDARY_CACHE = createToken<ICacheService>('SecondaryCache');

      const module: IModule = {
        name: 'DualCacheModule',
        providers: [
          [PRIMARY_CACHE, { useClass: SharedImpl, scope: Scope.Singleton }],
          [SECONDARY_CACHE, { useClass: SharedImpl, scope: Scope.Singleton }],
        ],
        exports: [PRIMARY_CACHE, SECONDARY_CACHE],
      };

      container.loadModule(module);

      const primary = container.resolve(PRIMARY_CACHE);
      const secondary = container.resolve(SECONDARY_CACHE);

      // Different tokens yield different singleton instances
      expect(primary).not.toBe(secondary);
      expect(instanceCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Module export visibility / encapsulation
  // ---------------------------------------------------------------------------

  describe('Module Export Visibility', () => {
    it('should allow resolution of exported providers from importing modules', () => {
      const coreModule: IModule = {
        name: 'CoreModule',
        providers: [
          [CONFIG_SERVICE_TOKEN, { useValue: new ConfigService({ env: 'test' }) }],
          [INTERNAL_HELPER_TOKEN, { useValue: { compute: () => 42 } }],
        ],
        exports: [CONFIG_SERVICE_TOKEN], // Only CONFIG is exported
      };

      const appModule: IModule = {
        name: 'AppModule',
        imports: [coreModule],
        providers: [
          [
            USER_SERVICE_TOKEN,
            {
              useFactory: (config: IConfigService) =>
                // Can use config because it is exported
                new UserService(new UserRepository()),
              inject: [CONFIG_SERVICE_TOKEN],
            },
          ],
        ],
        exports: [USER_SERVICE_TOKEN],
      };

      container.loadModule(appModule);

      const userService = container.resolve(USER_SERVICE_TOKEN);
      expect(userService).toBeDefined();

      // Config is accessible (exported)
      const config = container.resolve(CONFIG_SERVICE_TOKEN);
      expect(config).toBeDefined();
    });

    it('should make global module providers available without explicit import', () => {
      const globalConfigModule: IModule = {
        name: 'GlobalConfigModule',
        global: true,
        providers: [[CONFIG_SERVICE_TOKEN, { useValue: new ConfigService({ db: 'postgres' }) }]],
        exports: [CONFIG_SERVICE_TOKEN],
      };

      const featureModule: IModule = {
        name: 'FeatureModule',
        // No explicit import of GlobalConfigModule
        providers: [
          [
            USER_SERVICE_TOKEN,
            {
              useFactory: (config: IConfigService) => new UserService(new UserRepository()),
              inject: [CONFIG_SERVICE_TOKEN],
            },
          ],
        ],
        exports: [USER_SERVICE_TOKEN],
      };

      container.loadModule(globalConfigModule);
      container.loadModule(featureModule);

      const service = container.resolve(USER_SERVICE_TOKEN);
      expect(service).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. useExisting provider aliasing
  // ---------------------------------------------------------------------------

  describe('useExisting Provider Aliasing', () => {
    it('should resolve aliased token to the same instance as the original', () => {
      const LEGACY_CACHE = createToken<ICacheService>('LegacyCache');

      const module: IModule = {
        name: 'AliasModule',
        providers: [
          // Primary registration
          [CACHE_SERVICE_TOKEN, { useClass: InMemoryCache, scope: Scope.Singleton }],
          // Alias: LEGACY_CACHE resolves to the same instance as CACHE_SERVICE_TOKEN
          [LEGACY_CACHE, { useExisting: CACHE_SERVICE_TOKEN } as any],
        ],
        exports: [CACHE_SERVICE_TOKEN, LEGACY_CACHE],
      };

      container.loadModule(module);

      const primary = container.resolve(CACHE_SERVICE_TOKEN);
      const alias = container.resolve(LEGACY_CACHE);

      expect(primary).toBe(alias);
      expect(primary).toBeInstanceOf(InMemoryCache);
    });

    it('should support useExisting via defineExisting helper', () => {
      const ALIAS_TOKEN = createToken<ICacheService>('CacheAlias');

      const module: IModule = {
        name: 'DefineExistingModule',
        providers: [
          [CACHE_SERVICE_TOKEN, { useClass: RedisCache, scope: Scope.Singleton }],
          defineExisting(ALIAS_TOKEN, { useExisting: CACHE_SERVICE_TOKEN }),
        ],
        exports: [CACHE_SERVICE_TOKEN, ALIAS_TOKEN],
      };

      container.loadModule(module);

      const original = container.resolve(CACHE_SERVICE_TOKEN);
      const alias = container.resolve(ALIAS_TOKEN);

      expect(original).toBe(alias);
      expect(original).toBeInstanceOf(RedisCache);
    });

    it('should chain useExisting aliases (A -> B -> C)', () => {
      const TOKEN_A = createToken<ICacheService>('AliasA');
      const TOKEN_B = createToken<ICacheService>('AliasB');
      const TOKEN_C = createToken<ICacheService>('AliasC');

      const module: IModule = {
        name: 'ChainedAliasModule',
        providers: [
          [TOKEN_C, { useClass: InMemoryCache, scope: Scope.Singleton }],
          defineExisting(TOKEN_B, { useExisting: TOKEN_C }),
          defineExisting(TOKEN_A, { useExisting: TOKEN_B }),
        ],
        exports: [TOKEN_A, TOKEN_B, TOKEN_C],
      };

      container.loadModule(module);

      const a = container.resolve(TOKEN_A);
      const b = container.resolve(TOKEN_B);
      const c = container.resolve(TOKEN_C);

      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(c).toBeInstanceOf(InMemoryCache);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Deferred eager initialization across modules
  // ---------------------------------------------------------------------------

  describe('Deferred Eager Initialization', () => {
    it('should defer eager init until eagerlyInitialize() is called after all modules loaded', async () => {
      const initLog: string[] = [];

      const DEP_TOKEN = createToken<{ value: string }>('SharedDep');
      const HANDLER_TOKEN = createToken<unknown>('EagerHandler');

      // Module A provides a dependency
      const moduleA: IModule = {
        name: 'DepModule',
        providers: [[DEP_TOKEN, { useValue: { value: 'from-dep-module' } }]],
        exports: [DEP_TOKEN],
      };

      // Module B depends on DEP_TOKEN from Module A
      const moduleB: IModule = {
        name: 'HandlerModule',
        imports: [moduleA],
        providers: [
          [
            HANDLER_TOKEN,
            {
              useFactory: (dep: { value: string }) => {
                initLog.push(`handler-init:${dep.value}`);
                return { initialized: true };
              },
              inject: [DEP_TOKEN],
            },
          ],
        ],
        exports: [HANDLER_TOKEN],
      };

      // Load both modules via loadModuleAsync (collects eager tokens)
      await container.loadModuleAsync(moduleA);
      await container.loadModuleAsync(moduleB);

      // Before eagerlyInitialize — nothing instantiated yet
      expect(initLog).toHaveLength(0);

      // Now eagerly initialize — all cross-module deps available
      await container.eagerlyInitialize();

      expect(initLog).toContain('handler-init:from-dep-module');
    });

    it('should handle multiple modules with interdependent eager providers', async () => {
      const initOrder: string[] = [];

      const EVENT_BUS = createToken<{ listeners: string[] }>('EventBus');
      const SUBSCRIBER_A = createToken<unknown>('SubscriberA');
      const SUBSCRIBER_B = createToken<unknown>('SubscriberB');

      const infraModule: IModule = {
        name: 'InfraModule',
        global: true,
        providers: [[EVENT_BUS, { useValue: { listeners: [] as string[] } }]],
        exports: [EVENT_BUS],
      };

      const moduleA: IModule = {
        name: 'ModuleA',
        providers: [
          [
            SUBSCRIBER_A,
            {
              useFactory: (bus: { listeners: string[] }) => {
                bus.listeners.push('A');
                initOrder.push('A');
                return { name: 'A' };
              },
              inject: [EVENT_BUS],
            },
          ],
        ],
      };

      const moduleB: IModule = {
        name: 'ModuleB',
        providers: [
          [
            SUBSCRIBER_B,
            {
              useFactory: (bus: { listeners: string[] }) => {
                bus.listeners.push('B');
                initOrder.push('B');
                return { name: 'B' };
              },
              inject: [EVENT_BUS],
            },
          ],
        ],
      };

      container.loadModule(infraModule);
      await container.loadModuleAsync(moduleA);
      await container.loadModuleAsync(moduleB);

      expect(initOrder).toHaveLength(0);

      await container.eagerlyInitialize();

      // Both subscribers initialized
      expect(initOrder).toContain('A');
      expect(initOrder).toContain('B');

      // Event bus received both registrations
      const bus = container.resolve(EVENT_BUS);
      expect(bus.listeners).toContain('A');
      expect(bus.listeners).toContain('B');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. useToken provider (alternative to useExisting)
  // ---------------------------------------------------------------------------

  describe('useToken Provider', () => {
    it('should resolve useToken alias to the same singleton', () => {
      const PRIMARY = createToken<ICacheService>('PrimaryToken');
      const ALIAS = createToken<ICacheService>('AliasViaUseToken');

      const module: IModule = {
        name: 'UseTokenModule',
        providers: [
          [PRIMARY, { useClass: InMemoryCache, scope: Scope.Singleton }],
          [ALIAS, { useToken: PRIMARY }],
        ],
        exports: [PRIMARY, ALIAS],
      };

      container.loadModule(module);

      const primary = container.resolve(PRIMARY);
      const alias = container.resolve(ALIAS);

      expect(primary).toBe(alias);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. NestJS-style { provide, useClass, inject } pattern
  // ---------------------------------------------------------------------------

  describe('NestJS-Style Provider Objects', () => {
    it('should register and resolve providers using { provide, useClass } syntax', () => {
      const module: IModule = {
        name: 'NestJsStyleModule',
        providers: [
          { provide: USER_REPO_TOKEN, useClass: UserRepository },
          {
            provide: USER_SERVICE_TOKEN,
            useFactory: (repo: IRepository<{ id: string; name: string }>) => new UserService(repo),
            inject: [USER_REPO_TOKEN],
          },
        ],
        exports: [USER_SERVICE_TOKEN],
      };

      container.loadModule(module);

      const service = container.resolve(USER_SERVICE_TOKEN);
      const user = service.createUser('Bob');
      expect(user.name).toBe('Bob');
    });

    it('should handle mixed tuple and object providers in same module', () => {
      const module: IModule = {
        name: 'MixedProviderModule',
        providers: [
          // Tuple style
          [USER_REPO_TOKEN, { useClass: UserRepository }],
          // Object style
          { provide: CACHE_SERVICE_TOKEN, useClass: InMemoryCache },
          // Factory with inject
          {
            provide: USER_SERVICE_TOKEN,
            useFactory: (repo: IRepository<{ id: string; name: string }>, cache: ICacheService) =>
              new UserService(repo),
            inject: [USER_REPO_TOKEN, CACHE_SERVICE_TOKEN],
          },
        ],
        exports: [USER_SERVICE_TOKEN, CACHE_SERVICE_TOKEN],
      };

      container.loadModule(module);

      const service = container.resolve(USER_SERVICE_TOKEN);
      const cache = container.resolve(CACHE_SERVICE_TOKEN);

      expect(service).toBeDefined();
      expect(cache).toBeInstanceOf(InMemoryCache);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Override prevention without explicit flag
  // ---------------------------------------------------------------------------

  describe('Provider Override Safety', () => {
    it('should allow explicit override with override: true option', () => {
      const TOKEN = createToken<ICacheService>('OverridableCache');

      container.register(TOKEN, { useClass: InMemoryCache, scope: Scope.Singleton });

      // Override with explicit flag
      container.register(TOKEN, { useClass: RedisCache, scope: Scope.Singleton }, { override: true });

      const resolved = container.resolve(TOKEN);
      expect(resolved).toBeInstanceOf(RedisCache);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Unified tokens across framework and apps (no shadow tokens)
  // ---------------------------------------------------------------------------

  describe('Unified Token Identity', () => {
    it('should resolve the same token instance regardless of import location', () => {
      // Simulates the pattern where CACHE_SERVICE_TOKEN is defined once
      // in a shared tokens.ts and imported by multiple modules
      const sharedToken = createToken<ICacheService>('UnifiedCacheService');

      const providerModule: IModule = {
        name: 'ProviderModule',
        providers: [[sharedToken, { useClass: InMemoryCache, scope: Scope.Singleton }]],
        exports: [sharedToken],
      };

      const consumerModule: IModule = {
        name: 'ConsumerModule',
        imports: [providerModule],
        providers: [
          [
            NOTIFICATION_TOKEN,
            {
              useFactory: (cache: ICacheService) => {
                // Consumer can use the cache from the shared token
                cache.set('initialized', true);
                return new NotificationService();
              },
              inject: [sharedToken],
            },
          ],
        ],
        exports: [NOTIFICATION_TOKEN],
      };

      container.loadModule(consumerModule);

      const cache = container.resolve(sharedToken);
      const notif = container.resolve(NOTIFICATION_TOKEN);

      expect(cache.get('initialized')).toBe(true);
      expect(notif).toBeInstanceOf(NotificationService);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Scope correctness for useValue (always Singleton)
  // ---------------------------------------------------------------------------

  describe('Scope Correctness', () => {
    it('should treat useValue providers as singletons regardless of scope option', () => {
      const CONFIG = createToken<IConfigService>('ScopeTestConfig');
      const configInstance = new ConfigService({ mode: 'test' });

      const module: IModule = {
        name: 'ScopeTestModule',
        providers: [[CONFIG, { useValue: configInstance }]],
        exports: [CONFIG],
      };

      container.loadModule(module);

      const resolved1 = container.resolve(CONFIG);
      const resolved2 = container.resolve(CONFIG);

      // useValue always returns the exact same reference
      expect(resolved1).toBe(resolved2);
      expect(resolved1).toBe(configInstance);
    });

    it('should create new instances for Transient-scoped useClass providers', () => {
      let instanceCount = 0;

      class TransientService {
        readonly id: number;
        constructor() {
          this.id = ++instanceCount;
        }
      }

      const TOKEN = createToken<TransientService>('TransientService');

      const module: IModule = {
        name: 'TransientModule',
        providers: [[TOKEN, { useClass: TransientService, scope: Scope.Transient }]],
        exports: [TOKEN],
      };

      container.loadModule(module);

      const a = container.resolve(TOKEN);
      const b = container.resolve(TOKEN);

      expect(a).not.toBe(b);
      expect(a.id).not.toBe(b.id);
      expect(instanceCount).toBe(2);
    });
  });
});
