/**
 * Comprehensive Tests for Nexus Context System
 *
 * Tests cover:
 * - ContextKey creation and usage
 * - DefaultContextProvider functionality
 * - Context inheritance and nesting
 * - ContextManager with AsyncLocalStorage
 * - Resolution strategies (Environment, FeatureFlag, Tenant, RoleBased)
 * - InjectContext decorator
 * - ContextAwareProvider
 * - Error handling and edge cases
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import {
  createContextKey,
  ContextKeys,
  DefaultContextProvider,
  ContextManager,
  EnvironmentStrategy,
  FeatureFlagStrategy,
  TenantStrategy,
  RoleBasedStrategy,
  InjectContext,
  createContextAwareProvider,
  getContextManager,
  getCurrentAuthContext,
  type ContextKey,
  type ContextProvider,
  type ResolutionStrategy,
  type ContextAwareProvider,
} from '../../../src/nexus/context.js';

import { Scope, type ResolutionContext, type IContainer } from '../../../src/nexus/types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestUser {
  id: string;
  name: string;
  roles: string[];
}

interface TestTenant {
  id: string;
  name: string;
}

interface TestAuthContext {
  userId: string;
  roles: string[];
  permissions: string[];
  scopes?: string[];
}

function createMockContainer(): IContainer {
  return {
    register: jest.fn().mockReturnThis(),
    resolve: jest.fn(),
    resolveAsync: jest.fn(),
    resolveMany: jest.fn().mockReturnValue([]),
    resolveOptional: jest.fn(),
    registerStream: jest.fn().mockReturnThis(),
    resolveStream: jest.fn(),
    resolveParallel: jest.fn(),
    resolveParallelSettled: jest.fn(),
    resolveBatch: jest.fn(),
    has: jest.fn().mockReturnValue(false),
    createScope: jest.fn(),
    initialize: jest.fn(),
    dispose: jest.fn(),
    clearCache: jest.fn(),
    getMetadata: jest.fn().mockReturnValue({ registrations: 0, cached: 0, scopes: 0 }),
    getContext: jest.fn(),
    resolveLazy: jest.fn(),
    resolveLazyAsync: jest.fn(),
    addMiddleware: jest.fn().mockReturnThis(),
    use: jest.fn().mockReturnThis(),
  } as unknown as IContainer;
}

function createMockResolutionContext(metadata?: Record<string, any>): ResolutionContext {
  return {
    container: createMockContainer(),
    scope: Scope.Singleton,
    metadata,
  };
}

// ============================================================================
// createContextKey Tests
// ============================================================================

describe('createContextKey', () => {
  it('should create a context key with unique symbol id', () => {
    const key = createContextKey<string>('testKey');

    expect(key.id).toBeDefined();
    expect(typeof key.id).toBe('symbol');
    expect(key.name).toBe('testKey');
  });

  it('should create unique keys for the same name', () => {
    const key1 = createContextKey<string>('duplicateName');
    const key2 = createContextKey<string>('duplicateName');

    expect(key1.id).not.toBe(key2.id);
    expect(key1.name).toBe(key2.name);
  });

  it('should preserve type information in the key', () => {
    const stringKey = createContextKey<string>('stringKey');
    const numberKey = createContextKey<number>('numberKey');
    const objectKey = createContextKey<{ foo: string }>('objectKey');

    // Type is undefined at runtime but type-safe at compile time
    expect(stringKey.type).toBeUndefined();
    expect(numberKey.type).toBeUndefined();
    expect(objectKey.type).toBeUndefined();
  });

  it('should handle empty string name', () => {
    const key = createContextKey<string>('');

    expect(key.name).toBe('');
    expect(key.id).toBeDefined();
  });

  it('should handle special characters in name', () => {
    const key = createContextKey<string>('test:key/with-special.chars');

    expect(key.name).toBe('test:key/with-special.chars');
  });
});

// ============================================================================
// ContextKeys Tests
// ============================================================================

describe('ContextKeys', () => {
  it('should have Request context key', () => {
    expect(ContextKeys.Request).toBeDefined();
    expect(ContextKeys.Request.name).toBe('request');
  });

  it('should have Response context key', () => {
    expect(ContextKeys.Response).toBeDefined();
    expect(ContextKeys.Response.name).toBe('response');
  });

  it('should have User context key with proper type', () => {
    expect(ContextKeys.User).toBeDefined();
    expect(ContextKeys.User.name).toBe('user');
  });

  it('should have AuthContext key with proper type', () => {
    expect(ContextKeys.AuthContext).toBeDefined();
    expect(ContextKeys.AuthContext.name).toBe('authContext');
  });

  it('should have Tenant context key', () => {
    expect(ContextKeys.Tenant).toBeDefined();
    expect(ContextKeys.Tenant.name).toBe('tenant');
  });

  it('should have Environment context key', () => {
    expect(ContextKeys.Environment).toBeDefined();
    expect(ContextKeys.Environment.name).toBe('environment');
  });

  it('should have Features context key', () => {
    expect(ContextKeys.Features).toBeDefined();
    expect(ContextKeys.Features.name).toBe('features');
  });

  it('should have Locale context key', () => {
    expect(ContextKeys.Locale).toBeDefined();
    expect(ContextKeys.Locale.name).toBe('locale');
  });

  it('should have RequestId context key', () => {
    expect(ContextKeys.RequestId).toBeDefined();
    expect(ContextKeys.RequestId.name).toBe('requestId');
  });

  it('should have SessionId context key', () => {
    expect(ContextKeys.SessionId).toBeDefined();
    expect(ContextKeys.SessionId.name).toBe('sessionId');
  });

  it('should have CorrelationId context key', () => {
    expect(ContextKeys.CorrelationId).toBeDefined();
    expect(ContextKeys.CorrelationId.name).toBe('correlationId');
  });

  it('should have Transaction context key', () => {
    expect(ContextKeys.Transaction).toBeDefined();
    expect(ContextKeys.Transaction.name).toBe('transaction');
  });

  it('should have Logger context key', () => {
    expect(ContextKeys.Logger).toBeDefined();
    expect(ContextKeys.Logger.name).toBe('logger');
  });

  it('should have Metrics context key', () => {
    expect(ContextKeys.Metrics).toBeDefined();
    expect(ContextKeys.Metrics.name).toBe('metrics');
  });

  it('should have unique ids for all context keys', () => {
    const ids = new Set([
      ContextKeys.Request.id,
      ContextKeys.Response.id,
      ContextKeys.User.id,
      ContextKeys.AuthContext.id,
      ContextKeys.Tenant.id,
      ContextKeys.Environment.id,
      ContextKeys.Features.id,
      ContextKeys.Locale.id,
      ContextKeys.RequestId.id,
      ContextKeys.SessionId.id,
      ContextKeys.CorrelationId.id,
      ContextKeys.Transaction.id,
      ContextKeys.Logger.id,
      ContextKeys.Metrics.id,
    ]);

    expect(ids.size).toBe(14);
  });
});

// ============================================================================
// DefaultContextProvider Tests
// ============================================================================

describe('DefaultContextProvider', () => {
  let provider: DefaultContextProvider;

  beforeEach(() => {
    provider = new DefaultContextProvider();
  });

  describe('set and get', () => {
    it('should set and get a value', () => {
      const key = createContextKey<string>('test');
      provider.set(key, 'testValue');

      expect(provider.get(key)).toBe('testValue');
    });

    it('should return undefined for unset key', () => {
      const key = createContextKey<string>('unset');

      expect(provider.get(key)).toBeUndefined();
    });

    it('should overwrite existing value', () => {
      const key = createContextKey<string>('overwrite');
      provider.set(key, 'first');
      provider.set(key, 'second');

      expect(provider.get(key)).toBe('second');
    });

    it('should handle null values', () => {
      const key = createContextKey<string | null>('nullable');
      provider.set(key, null);

      expect(provider.get(key)).toBeNull();
    });

    it('should handle undefined values', () => {
      const key = createContextKey<string | undefined>('optional');
      provider.set(key, undefined);

      // The key is set, but to undefined
      expect(provider.has(key)).toBe(true);
      expect(provider.get(key)).toBeUndefined();
    });

    it('should handle complex objects', () => {
      const key = createContextKey<TestUser>('user');
      const user: TestUser = { id: '1', name: 'Test User', roles: ['admin', 'user'] };
      provider.set(key, user);

      const retrieved = provider.get(key);
      expect(retrieved).toEqual(user);
      expect(retrieved).toBe(user); // Same reference
    });

    it('should handle array values', () => {
      const key = createContextKey<string[]>('features');
      const features = ['feature1', 'feature2'];
      provider.set(key, features);

      expect(provider.get(key)).toEqual(features);
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      const key = createContextKey<string>('exists');
      provider.set(key, 'value');

      expect(provider.has(key)).toBe(true);
    });

    it('should return false for non-existing key', () => {
      const key = createContextKey<string>('notExists');

      expect(provider.has(key)).toBe(false);
    });

    it('should return true for key set to undefined', () => {
      const key = createContextKey<string | undefined>('undefinedValue');
      provider.set(key, undefined);

      expect(provider.has(key)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete an existing key', () => {
      const key = createContextKey<string>('toDelete');
      provider.set(key, 'value');
      provider.delete(key);

      expect(provider.has(key)).toBe(false);
      expect(provider.get(key)).toBeUndefined();
    });

    it('should not throw when deleting non-existing key', () => {
      const key = createContextKey<string>('nonExisting');

      expect(() => provider.delete(key)).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all values', () => {
      const key1 = createContextKey<string>('key1');
      const key2 = createContextKey<string>('key2');
      provider.set(key1, 'value1');
      provider.set(key2, 'value2');

      provider.clear();

      expect(provider.has(key1)).toBe(false);
      expect(provider.has(key2)).toBe(false);
    });

    it('should not throw when clearing empty provider', () => {
      expect(() => provider.clear()).not.toThrow();
    });
  });

  describe('keys', () => {
    it('should return all keys', () => {
      const key1 = createContextKey<string>('key1');
      const key2 = createContextKey<number>('key2');
      provider.set(key1, 'value1');
      provider.set(key2, 42);

      const keys = provider.keys();

      expect(keys.length).toBe(2);
    });

    it('should return empty array when no keys', () => {
      expect(provider.keys()).toEqual([]);
    });
  });

  describe('toObject', () => {
    it('should return context as plain object', () => {
      const key1 = createContextKey<string>('key1');
      const key2 = createContextKey<number>('key2');
      provider.set(key1, 'value1');
      provider.set(key2, 42);

      const obj = provider.toObject();

      expect(obj['key1']).toBe('value1');
      expect(obj['key2']).toBe(42);
    });

    it('should return empty object when no values', () => {
      expect(provider.toObject()).toEqual({});
    });
  });

  describe('parent context inheritance', () => {
    it('should inherit values from parent', () => {
      const parentKey = createContextKey<string>('parent');
      const parent = new DefaultContextProvider();
      parent.set(parentKey, 'parentValue');

      const child = new DefaultContextProvider(parent);

      expect(child.get(parentKey)).toBe('parentValue');
    });

    it('should override parent values with local values', () => {
      const key = createContextKey<string>('shared');
      const parent = new DefaultContextProvider();
      parent.set(key, 'parentValue');

      const child = new DefaultContextProvider(parent);
      child.set(key, 'childValue');

      expect(child.get(key)).toBe('childValue');
      expect(parent.get(key)).toBe('parentValue');
    });

    it('should check parent for has() when not in local', () => {
      const key = createContextKey<string>('parentOnly');
      const parent = new DefaultContextProvider();
      parent.set(key, 'value');

      const child = new DefaultContextProvider(parent);

      expect(child.has(key)).toBe(true);
    });

    it('should include parent keys in keys()', () => {
      const parentKey = createContextKey<string>('parentKey');
      const childKey = createContextKey<string>('childKey');

      const parent = new DefaultContextProvider();
      parent.set(parentKey, 'parentValue');

      const child = new DefaultContextProvider(parent);
      child.set(childKey, 'childValue');

      const keys = child.keys();

      expect(keys.length).toBe(2);
    });

    it('should not duplicate keys in keys() when overridden', () => {
      const sharedKey = createContextKey<string>('shared');

      const parent = new DefaultContextProvider();
      parent.set(sharedKey, 'parentValue');

      const child = new DefaultContextProvider(parent);
      child.set(sharedKey, 'childValue');

      const keys = child.keys();

      expect(keys.length).toBe(1);
    });

    it('should merge parent context in toObject()', () => {
      const parentKey = createContextKey<string>('parentKey');
      const childKey = createContextKey<string>('childKey');

      const parent = new DefaultContextProvider();
      parent.set(parentKey, 'parentValue');

      const child = new DefaultContextProvider(parent);
      child.set(childKey, 'childValue');

      const obj = child.toObject();

      expect(obj['parentKey']).toBe('parentValue');
      expect(obj['childKey']).toBe('childValue');
    });

    it('should override parent values in toObject()', () => {
      const sharedKey = createContextKey<string>('shared');

      const parent = new DefaultContextProvider();
      parent.set(sharedKey, 'parentValue');

      const child = new DefaultContextProvider(parent);
      child.set(sharedKey, 'childValue');

      const obj = child.toObject();

      expect(obj['shared']).toBe('childValue');
    });

    it('should support multiple levels of nesting', () => {
      const level1Key = createContextKey<string>('level1');
      const level2Key = createContextKey<string>('level2');
      const level3Key = createContextKey<string>('level3');

      const level1 = new DefaultContextProvider();
      level1.set(level1Key, 'value1');

      const level2 = new DefaultContextProvider(level1);
      level2.set(level2Key, 'value2');

      const level3 = new DefaultContextProvider(level2);
      level3.set(level3Key, 'value3');

      expect(level3.get(level1Key)).toBe('value1');
      expect(level3.get(level2Key)).toBe('value2');
      expect(level3.get(level3Key)).toBe('value3');
    });
  });

  describe('createChild', () => {
    it('should create a child context with parent reference', () => {
      const parentKey = createContextKey<string>('parent');
      provider.set(parentKey, 'parentValue');

      const child = provider.createChild();

      expect(child.get(parentKey)).toBe('parentValue');
    });

    it('should create independent children', () => {
      const parentKey = createContextKey<string>('parent');
      provider.set(parentKey, 'parentValue');

      const child1 = provider.createChild();
      const child2 = provider.createChild();

      const child1Key = createContextKey<string>('child1');
      const child2Key = createContextKey<string>('child2');

      child1.set(child1Key, 'child1Value');
      child2.set(child2Key, 'child2Value');

      expect(child1.has(child2Key)).toBe(false);
      expect(child2.has(child1Key)).toBe(false);
    });
  });
});

// ============================================================================
// EnvironmentStrategy Tests
// ============================================================================

describe('EnvironmentStrategy', () => {
  let strategy: EnvironmentStrategy;

  beforeEach(() => {
    strategy = new EnvironmentStrategy();
  });

  it('should have correct name', () => {
    expect(strategy.name).toBe('environment');
  });

  describe('applies', () => {
    it('should return true when environment is in metadata', () => {
      const context = createMockResolutionContext({ environment: 'production' });

      expect(strategy.applies({} as any, context)).toBe(true);
    });

    it('should return false when environment is not in metadata', () => {
      const context = createMockResolutionContext({});

      expect(strategy.applies({} as any, context)).toBe(false);
    });

    it('should return false when metadata is undefined', () => {
      const context = createMockResolutionContext(undefined);

      expect(strategy.applies({} as any, context)).toBe(false);
    });
  });

  describe('select', () => {
    it('should select provider matching environment', () => {
      const context = createMockResolutionContext({ environment: 'production' });
      const providers = [
        { environment: 'development', value: 'dev' },
        { environment: 'production', value: 'prod' },
        { environment: 'test', value: 'test' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('prod');
    });

    it('should fallback to first provider when no match', () => {
      const context = createMockResolutionContext({ environment: 'staging' });
      const providers = [
        { environment: 'development', value: 'dev' },
        { environment: 'production', value: 'prod' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('dev');
    });

    it('should return first provider for empty providers list', () => {
      const context = createMockResolutionContext({ environment: 'production' });

      const selected = strategy.select([], context);

      expect(selected).toBeUndefined();
    });
  });
});

// ============================================================================
// FeatureFlagStrategy Tests
// ============================================================================

describe('FeatureFlagStrategy', () => {
  let strategy: FeatureFlagStrategy;

  beforeEach(() => {
    strategy = new FeatureFlagStrategy();
  });

  it('should have correct name', () => {
    expect(strategy.name).toBe('feature-flag');
  });

  describe('applies', () => {
    it('should return true when features is in metadata', () => {
      const context = createMockResolutionContext({ features: ['newUI'] });

      expect(strategy.applies({} as any, context)).toBe(true);
    });

    it('should return false when features is not in metadata', () => {
      const context = createMockResolutionContext({});

      expect(strategy.applies({} as any, context)).toBe(false);
    });
  });

  describe('select', () => {
    it('should select provider with matching feature', () => {
      const context = createMockResolutionContext({ features: ['newUI', 'darkMode'] });
      const providers = [
        { feature: 'oldUI', value: 'old' },
        { feature: 'newUI', value: 'new' },
        { value: 'default' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('new');
    });

    it('should select first matching feature when multiple match', () => {
      const context = createMockResolutionContext({ features: ['feature1', 'feature2'] });
      const providers = [
        { feature: 'feature2', value: 'second' },
        { feature: 'feature1', value: 'first' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('second');
    });

    it('should fallback to provider without feature when no match', () => {
      const context = createMockResolutionContext({ features: ['unknownFeature'] });
      const providers = [
        { feature: 'feature1', value: 'featured' },
        { value: 'default' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('default');
    });

    it('should fallback to first provider when no default and no match', () => {
      const context = createMockResolutionContext({ features: ['unknownFeature'] });
      const providers = [
        { feature: 'feature1', value: 'first' },
        { feature: 'feature2', value: 'second' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('first');
    });

    it('should handle empty features array', () => {
      const context = createMockResolutionContext({ features: [] });
      const providers = [
        { feature: 'feature1', value: 'featured' },
        { value: 'default' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('default');
    });
  });
});

// ============================================================================
// TenantStrategy Tests
// ============================================================================

describe('TenantStrategy', () => {
  let strategy: TenantStrategy;

  beforeEach(() => {
    strategy = new TenantStrategy();
  });

  it('should have correct name', () => {
    expect(strategy.name).toBe('tenant');
  });

  describe('applies', () => {
    it('should return true when tenant is in metadata', () => {
      const context = createMockResolutionContext({ tenant: { id: 'tenant1', name: 'Tenant 1' } });

      expect(strategy.applies({} as any, context)).toBe(true);
    });

    it('should return false when tenant is not in metadata', () => {
      const context = createMockResolutionContext({});

      expect(strategy.applies({} as any, context)).toBe(false);
    });
  });

  describe('select', () => {
    it('should select provider matching tenant id object', () => {
      const context = createMockResolutionContext({ tenant: { id: 'tenant2', name: 'Tenant 2' } });
      const providers = [
        { tenant: 'tenant1', value: 't1' },
        { tenant: 'tenant2', value: 't2' },
        { multiTenant: true, value: 'multi' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('t2');
    });

    it('should select provider matching tenant string', () => {
      const context = createMockResolutionContext({ tenant: 'tenant1' });
      const providers = [
        { tenant: 'tenant1', value: 't1' },
        { tenant: 'tenant2', value: 't2' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('t1');
    });

    it('should fallback to multi-tenant provider when no match', () => {
      const context = createMockResolutionContext({ tenant: { id: 'unknown', name: 'Unknown' } });
      const providers = [
        { tenant: 'tenant1', value: 't1' },
        { multiTenant: true, value: 'multi' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('multi');
    });

    it('should fallback to first provider when no match and no multi-tenant', () => {
      const context = createMockResolutionContext({ tenant: { id: 'unknown', name: 'Unknown' } });
      const providers = [
        { tenant: 'tenant1', value: 't1' },
        { tenant: 'tenant2', value: 't2' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('t1');
    });
  });
});

// ============================================================================
// RoleBasedStrategy Tests
// ============================================================================

describe('RoleBasedStrategy', () => {
  let strategy: RoleBasedStrategy;

  beforeEach(() => {
    strategy = new RoleBasedStrategy();
  });

  it('should have correct name', () => {
    expect(strategy.name).toBe('role-based');
  });

  describe('applies', () => {
    it('should return true when user roles are in metadata', () => {
      const context = createMockResolutionContext({ user: { roles: ['admin'] } });

      expect(strategy.applies({} as any, context)).toBe(true);
    });

    it('should return false when user is not in metadata', () => {
      const context = createMockResolutionContext({});

      expect(strategy.applies({} as any, context)).toBe(false);
    });

    it('should return false when user has no roles', () => {
      const context = createMockResolutionContext({ user: {} });

      expect(strategy.applies({} as any, context)).toBe(false);
    });
  });

  describe('select', () => {
    it('should select provider matching user role', () => {
      const context = createMockResolutionContext({ user: { roles: ['admin', 'user'] } });
      const providers = [
        { requiredRole: 'superadmin', value: 'super' },
        { requiredRole: 'admin', value: 'admin' },
        { value: 'public' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('admin');
    });

    it('should select first matching role when multiple match', () => {
      const context = createMockResolutionContext({ user: { roles: ['admin', 'moderator'] } });
      const providers = [
        { requiredRole: 'moderator', value: 'mod' },
        { requiredRole: 'admin', value: 'admin' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('mod');
    });

    it('should fallback to public provider when no role match', () => {
      const context = createMockResolutionContext({ user: { roles: ['guest'] } });
      const providers = [
        { requiredRole: 'admin', value: 'admin' },
        { value: 'public' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('public');
    });

    it('should fallback to first provider when no match and no public', () => {
      const context = createMockResolutionContext({ user: { roles: ['guest'] } });
      const providers = [
        { requiredRole: 'admin', value: 'admin' },
        { requiredRole: 'moderator', value: 'mod' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('admin');
    });

    it('should handle empty roles array', () => {
      const context = createMockResolutionContext({ user: { roles: [] } });
      const providers = [
        { requiredRole: 'admin', value: 'admin' },
        { value: 'public' },
      ];

      const selected = strategy.select(providers, context);

      expect(selected.value).toBe('public');
    });
  });
});

// ============================================================================
// ContextManager Tests
// ============================================================================

describe('ContextManager', () => {
  let manager: ContextManager;

  beforeEach(() => {
    manager = new ContextManager();
  });

  describe('strategy registration', () => {
    it('should register default strategies on creation', () => {
      // Strategies are registered but not directly accessible
      // Test through selectProvider behavior
      const context = createMockResolutionContext({ environment: 'production' });
      const providers = [
        { environment: 'development', value: 'dev' },
        { environment: 'production', value: 'prod' },
      ];

      const selected = manager.selectProvider({} as any, providers, context);

      expect(selected.value).toBe('prod');
    });

    it('should allow registering custom strategy', () => {
      const customStrategy: ResolutionStrategy = {
        name: 'custom',
        applies: (token, context) => context.metadata?.['custom'] !== undefined,
        select: (providers, context) => providers.find((p) => p.custom === context.metadata?.['custom']) || providers[0],
      };

      manager.registerStrategy(customStrategy);

      const context = createMockResolutionContext({ custom: 'value1' });
      const providers = [
        { custom: 'value2', value: 'second' },
        { custom: 'value1', value: 'first' },
      ];

      const selected = manager.selectProvider({} as any, providers, context);

      expect(selected.value).toBe('first');
    });

    it('should allow unregistering strategy', () => {
      manager.unregisterStrategy('environment');

      const context = createMockResolutionContext({ environment: 'production' });
      const providers = [
        { environment: 'development', value: 'dev' },
        { environment: 'production', value: 'prod' },
      ];

      const selected = manager.selectProvider({} as any, providers, context);

      // Without environment strategy, should return first provider
      expect(selected.value).toBe('dev');
    });
  });

  describe('getCurrentContext', () => {
    it('should return global context when not in async context', () => {
      const context = manager.getCurrentContext();

      expect(context).toBeDefined();
    });

    it('should return same global context on multiple calls', () => {
      const context1 = manager.getCurrentContext();
      const context2 = manager.getCurrentContext();

      expect(context1).toBe(context2);
    });
  });

  describe('runWithContext', () => {
    it('should run function with custom context', () => {
      const customContext = new DefaultContextProvider();
      const testKey = createContextKey<string>('test');
      customContext.set(testKey, 'customValue');

      const result = manager.runWithContext(customContext, () => {
        const current = manager.getCurrentContext();
        return current.get(testKey);
      });

      expect(result).toBe('customValue');
    });

    it('should restore previous context after run', () => {
      const globalContext = manager.getCurrentContext();
      const globalKey = createContextKey<string>('global');
      globalContext.set(globalKey, 'globalValue');

      const customContext = new DefaultContextProvider();
      const customKey = createContextKey<string>('custom');
      customContext.set(customKey, 'customValue');

      manager.runWithContext(customContext, () => {
        // Inside custom context
        expect(manager.getCurrentContext().get(customKey)).toBe('customValue');
      });

      // Should be back to global context
      expect(manager.getCurrentContext().get(globalKey)).toBe('globalValue');
    });

    it('should handle nested runWithContext', () => {
      const outerContext = new DefaultContextProvider();
      const outerKey = createContextKey<string>('outer');
      outerContext.set(outerKey, 'outerValue');

      const innerContext = new DefaultContextProvider();
      const innerKey = createContextKey<string>('inner');
      innerContext.set(innerKey, 'innerValue');

      manager.runWithContext(outerContext, () => {
        expect(manager.getCurrentContext().get(outerKey)).toBe('outerValue');

        manager.runWithContext(innerContext, () => {
          expect(manager.getCurrentContext().get(innerKey)).toBe('innerValue');
          expect(manager.getCurrentContext().get(outerKey)).toBeUndefined();
        });

        expect(manager.getCurrentContext().get(outerKey)).toBe('outerValue');
      });
    });

    it('should handle async operations with AsyncLocalStorage', async () => {
      const asyncContext = new DefaultContextProvider();
      const asyncKey = createContextKey<string>('async');
      asyncContext.set(asyncKey, 'asyncValue');

      await manager.runWithContext(asyncContext, async () => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));

        const current = manager.getCurrentContext();
        expect(current.get(asyncKey)).toBe('asyncValue');
      });
    });

    it('should maintain context across promise chains', async () => {
      const testContext = new DefaultContextProvider();
      const testKey = createContextKey<string>('promise');
      testContext.set(testKey, 'promiseValue');

      const result = await manager.runWithContext(testContext, async () => {
        const value1 = await Promise.resolve().then(() => {
          return manager.getCurrentContext().get(testKey);
        });

        const value2 = await Promise.resolve().then(() => {
          return manager.getCurrentContext().get(testKey);
        });

        return [value1, value2];
      });

      expect(result).toEqual(['promiseValue', 'promiseValue']);
    });
  });

  describe('createScopedContext', () => {
    it('should create context with current context as parent', () => {
      const globalContext = manager.getCurrentContext();
      const globalKey = createContextKey<string>('global');
      globalContext.set(globalKey, 'globalValue');

      const scopedContext = manager.createScopedContext();

      expect(scopedContext.get(globalKey)).toBe('globalValue');
    });

    it('should create context with specified parent', () => {
      const customParent = new DefaultContextProvider();
      const parentKey = createContextKey<string>('parent');
      customParent.set(parentKey, 'parentValue');

      const scopedContext = manager.createScopedContext(customParent);

      expect(scopedContext.get(parentKey)).toBe('parentValue');
    });

    it('should allow overriding parent values in scoped context', () => {
      const globalContext = manager.getCurrentContext();
      const sharedKey = createContextKey<string>('shared');
      globalContext.set(sharedKey, 'globalValue');

      const scopedContext = manager.createScopedContext();
      scopedContext.set(sharedKey, 'scopedValue');

      expect(scopedContext.get(sharedKey)).toBe('scopedValue');
      expect(globalContext.get(sharedKey)).toBe('globalValue');
    });
  });

  describe('selectProvider', () => {
    it('should return undefined for empty providers array', () => {
      const context = createMockResolutionContext({});

      const selected = manager.selectProvider({} as any, [], context);

      expect(selected).toBeUndefined();
    });

    it('should return single provider directly', () => {
      const context = createMockResolutionContext({});
      const providers = [{ value: 'only' }];

      const selected = manager.selectProvider({} as any, providers, context);

      expect(selected.value).toBe('only');
    });

    it('should apply multiple strategies in order', () => {
      const context = createMockResolutionContext({
        environment: 'production',
        tenant: { id: 'tenant1', name: 'Tenant 1' },
      });
      const providers = [
        { environment: 'development', value: 'dev' },
        { environment: 'production', value: 'prod' },
        { tenant: 'tenant1', value: 'tenant' },
      ];

      // Environment strategy is first, so it takes precedence
      const selected = manager.selectProvider({} as any, providers, context);

      expect(selected.value).toBe('prod');
    });

    it('should fallback to first provider when no strategy applies', () => {
      const context = createMockResolutionContext({});
      const providers = [
        { value: 'first' },
        { value: 'second' },
      ];

      const selected = manager.selectProvider({} as any, providers, context);

      expect(selected.value).toBe('first');
    });
  });

  describe('createResolutionContext', () => {
    it('should create resolution context with container and scope', () => {
      const container = createMockContainer();

      const resolutionContext = manager.createResolutionContext(container, Scope.Singleton);

      expect(resolutionContext.container).toBe(container);
      expect(resolutionContext.scope).toBe(Scope.Singleton);
    });

    it('should include current context values in metadata', () => {
      const currentContext = manager.getCurrentContext();
      const testKey = createContextKey<string>('test');
      currentContext.set(testKey, 'testValue');

      const container = createMockContainer();
      const resolutionContext = manager.createResolutionContext(container);

      expect(resolutionContext.metadata?.['test']).toBe('testValue');
    });

    it('should merge custom metadata with context metadata', () => {
      const currentContext = manager.getCurrentContext();
      const contextKey = createContextKey<string>('context');
      currentContext.set(contextKey, 'contextValue');

      const container = createMockContainer();
      const resolutionContext = manager.createResolutionContext(container, Scope.Singleton, { custom: 'customValue' });

      expect(resolutionContext.metadata?.['context']).toBe('contextValue');
      expect(resolutionContext.metadata?.['custom']).toBe('customValue');
    });

    it('should override context metadata with custom metadata', () => {
      const currentContext = manager.getCurrentContext();
      const sharedKey = createContextKey<string>('shared');
      currentContext.set(sharedKey, 'contextValue');

      const container = createMockContainer();
      const resolutionContext = manager.createResolutionContext(container, Scope.Singleton, { shared: 'customValue' });

      expect(resolutionContext.metadata?.['shared']).toBe('customValue');
    });

    it('should default to Singleton scope', () => {
      const container = createMockContainer();

      const resolutionContext = manager.createResolutionContext(container);

      expect(resolutionContext.scope).toBe(Scope.Singleton);
    });
  });
});

// ============================================================================
// InjectContext Decorator Tests
// ============================================================================

describe('InjectContext decorator', () => {
  it('should be a parameter decorator', () => {
    expect(typeof InjectContext).toBe('function');
  });

  it('should accept a context key and return decorator', () => {
    const decorator = InjectContext(ContextKeys.User);

    expect(typeof decorator).toBe('function');
  });

  it('should store context metadata on target', () => {
    class TestClass {
      method(@InjectContext(ContextKeys.User) user: any) {
        return user;
      }
    }

    const contextTokens = Reflect.getMetadata('context:inject', TestClass.prototype, 'method');

    expect(contextTokens).toBeDefined();
    expect(contextTokens[0]).toBe(ContextKeys.User);
  });

  it('should handle multiple context parameters', () => {
    class TestClass {
      method(
        @InjectContext(ContextKeys.User) user: any,
        @InjectContext(ContextKeys.Tenant) tenant: any,
      ) {
        return { user, tenant };
      }
    }

    const contextTokens = Reflect.getMetadata('context:inject', TestClass.prototype, 'method');

    expect(contextTokens[0]).toBe(ContextKeys.User);
    expect(contextTokens[1]).toBe(ContextKeys.Tenant);
  });
});

// ============================================================================
// createContextAwareProvider Tests
// ============================================================================

describe('createContextAwareProvider', () => {
  it('should create a context-aware provider', () => {
    const provider = createContextAwareProvider({
      provide: (context) => ({ env: context.metadata?.['environment'] }),
    });

    expect(provider.provide).toBeDefined();
  });

  it('should call provide with context', () => {
    const context = createMockResolutionContext({ environment: 'test' });
    const provider = createContextAwareProvider({
      provide: (ctx) => ctx.metadata?.['environment'],
    });

    const result = provider.provide(context);

    expect(result).toBe('test');
  });

  it('should support async provide function', async () => {
    const context = createMockResolutionContext({ environment: 'async' });
    const provider = createContextAwareProvider({
      provide: async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return ctx.metadata?.['environment'];
      },
    });

    const result = await provider.provide(context);

    expect(result).toBe('async');
  });

  it('should support optional canProvide function', () => {
    const provider = createContextAwareProvider({
      provide: (context) => 'value',
      canProvide: (context) => context.metadata?.['allowed'] === true,
    });

    const allowedContext = createMockResolutionContext({ allowed: true });
    const deniedContext = createMockResolutionContext({ allowed: false });

    expect(provider.canProvide?.(allowedContext)).toBe(true);
    expect(provider.canProvide?.(deniedContext)).toBe(false);
  });
});

// ============================================================================
// Edge Cases and Error Handling Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('DefaultContextProvider edge cases', () => {
    it('should handle symbols as values', () => {
      const provider = new DefaultContextProvider();
      const key = createContextKey<symbol>('symbolValue');
      const symbolValue = Symbol('test');

      provider.set(key, symbolValue);

      expect(provider.get(key)).toBe(symbolValue);
    });

    it('should handle functions as values', () => {
      const provider = new DefaultContextProvider();
      const key = createContextKey<() => string>('functionValue');
      const fn = () => 'result';

      provider.set(key, fn);

      expect(provider.get(key)).toBe(fn);
      expect(provider.get(key)?.()).toBe('result');
    });

    it('should handle deeply nested objects', () => {
      const provider = new DefaultContextProvider();
      const key = createContextKey<any>('nested');
      const nested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };

      provider.set(key, nested);

      expect(provider.get(key)?.level1?.level2?.level3?.value).toBe('deep');
    });

    it('should handle circular references in values', () => {
      const provider = new DefaultContextProvider();
      const key = createContextKey<any>('circular');
      const circular: any = { name: 'circular' };
      circular.self = circular;

      provider.set(key, circular);

      const retrieved = provider.get(key);
      expect(retrieved?.name).toBe('circular');
      expect(retrieved?.self).toBe(retrieved);
    });
  });

  describe('ContextManager edge cases', () => {
    it('should handle error thrown in runWithContext', () => {
      const manager = new ContextManager();
      const context = new DefaultContextProvider();

      expect(() => {
        manager.runWithContext(context, () => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');

      // Context should be restored even after error
      expect(manager.getCurrentContext()).toBeDefined();
    });

    it('should handle async error thrown in runWithContext', async () => {
      const manager = new ContextManager();
      const context = new DefaultContextProvider();

      await expect(
        manager.runWithContext(context, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Async error');
        })
      ).rejects.toThrow('Async error');
    });
  });

  describe('Resolution strategy edge cases', () => {
    it('should handle undefined metadata gracefully', () => {
      const strategies = [
        new EnvironmentStrategy(),
        new FeatureFlagStrategy(),
        new TenantStrategy(),
        new RoleBasedStrategy(),
      ];

      const context: ResolutionContext = {
        container: createMockContainer(),
        scope: Scope.Singleton,
      };

      strategies.forEach((strategy) => {
        expect(() => strategy.applies({} as any, context)).not.toThrow();
        expect(() => strategy.select([], context)).not.toThrow();
      });
    });

    it('should handle null values in metadata', () => {
      const strategy = new EnvironmentStrategy();
      const context = createMockResolutionContext({ environment: null });

      expect(strategy.applies({} as any, context)).toBe(true);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  it('should work with complete context flow', async () => {
    const manager = new ContextManager();

    // Create request context
    const requestContext = manager.createScopedContext();
    requestContext.set(ContextKeys.User, { id: '1', name: 'Test User', roles: ['admin'] });
    requestContext.set(ContextKeys.Tenant, { id: 'tenant1', name: 'Test Tenant' });
    requestContext.set(ContextKeys.Environment, 'production');
    requestContext.set(ContextKeys.Features, ['newUI', 'darkMode']);
    requestContext.set(ContextKeys.RequestId, 'req-123');
    requestContext.set(ContextKeys.CorrelationId, 'corr-456');

    // Run with request context
    const result = await manager.runWithContext(requestContext, async () => {
      const current = manager.getCurrentContext();

      // Verify all context values are accessible
      expect(current.get(ContextKeys.User)?.name).toBe('Test User');
      expect(current.get(ContextKeys.Tenant)?.id).toBe('tenant1');
      expect(current.get(ContextKeys.Environment)).toBe('production');
      expect(current.get(ContextKeys.Features)).toContain('newUI');
      expect(current.get(ContextKeys.RequestId)).toBe('req-123');

      // Create resolution context
      const container = createMockContainer();
      const resolutionContext = manager.createResolutionContext(container, Scope.Request);

      // Select provider based on context
      const providers = [
        { environment: 'development', value: 'dev-service' },
        { environment: 'production', value: 'prod-service' },
      ];

      const selected = manager.selectProvider({} as any, providers, resolutionContext);

      return selected.value;
    });

    expect(result).toBe('prod-service');
  });

  it('should support multi-tenant isolation', () => {
    const manager = new ContextManager();

    const tenant1Context = manager.createScopedContext();
    tenant1Context.set(ContextKeys.Tenant, { id: 'tenant1', name: 'Tenant 1' });

    const tenant2Context = manager.createScopedContext();
    tenant2Context.set(ContextKeys.Tenant, { id: 'tenant2', name: 'Tenant 2' });

    manager.runWithContext(tenant1Context, () => {
      const current = manager.getCurrentContext();
      expect(current.get(ContextKeys.Tenant)?.id).toBe('tenant1');

      // Nested tenant context
      manager.runWithContext(tenant2Context, () => {
        const nested = manager.getCurrentContext();
        expect(nested.get(ContextKeys.Tenant)?.id).toBe('tenant2');
      });

      // Back to tenant1
      expect(current.get(ContextKeys.Tenant)?.id).toBe('tenant1');
    });
  });

  it('should support auth context propagation', () => {
    const manager = new ContextManager();

    const authContext: TestAuthContext = {
      userId: 'user-123',
      roles: ['admin', 'user'],
      permissions: ['read', 'write', 'delete'],
      scopes: ['api:full'],
    };

    const requestContext = manager.createScopedContext();
    requestContext.set(ContextKeys.AuthContext, authContext);

    manager.runWithContext(requestContext, () => {
      const current = manager.getCurrentContext();
      const auth = current.get(ContextKeys.AuthContext);

      expect(auth?.userId).toBe('user-123');
      expect(auth?.roles).toContain('admin');
      expect(auth?.permissions).toContain('write');
      expect(auth?.scopes).toContain('api:full');
    });
  });
});

// ============================================================================
// getContextManager Tests
// ============================================================================

describe('getContextManager', () => {
  it('should return a ContextManager instance', () => {
    const manager = getContextManager();

    expect(manager).toBeInstanceOf(ContextManager);
  });

  it('should return the same instance on multiple calls (singleton)', () => {
    const manager1 = getContextManager();
    const manager2 = getContextManager();

    expect(manager1).toBe(manager2);
  });

  it('should return a manager with default strategies', () => {
    const manager = getContextManager();

    // Test that default strategies work
    const context: ResolutionContext = {
      container: createMockContainer(),
      scope: Scope.Singleton,
      metadata: { environment: 'production' },
    };

    const providers = [
      { environment: 'development', value: 'dev' },
      { environment: 'production', value: 'prod' },
    ];

    const selected = manager.selectProvider({} as any, providers, context);

    expect(selected.value).toBe('prod');
  });
});

// ============================================================================
// getCurrentAuthContext Tests
// ============================================================================

describe('getCurrentAuthContext', () => {
  it('should return undefined when no auth context is set', () => {
    const manager = getContextManager();
    const emptyContext = new DefaultContextProvider();

    const result = manager.runWithContext(emptyContext, () => {
      return getCurrentAuthContext();
    });

    expect(result).toBeUndefined();
  });

  it('should return auth context when set in current context', () => {
    const manager = getContextManager();
    const contextWithAuth = new DefaultContextProvider();

    const authData: TestAuthContext = {
      userId: 'user-456',
      roles: ['editor'],
      permissions: ['read', 'write'],
      scopes: ['api:read'],
    };

    contextWithAuth.set(ContextKeys.AuthContext, authData);

    const result = manager.runWithContext(contextWithAuth, () => {
      return getCurrentAuthContext();
    });

    expect(result).toBeDefined();
    expect(result?.userId).toBe('user-456');
    expect(result?.roles).toEqual(['editor']);
    expect(result?.permissions).toContain('write');
  });

  it('should return auth context from nested context', () => {
    const manager = getContextManager();

    const parentContext = new DefaultContextProvider();
    parentContext.set(ContextKeys.AuthContext, {
      userId: 'parent-user',
      roles: ['admin'],
      permissions: ['all'],
    });

    const childContext = new DefaultContextProvider(parentContext);

    const result = manager.runWithContext(childContext, () => {
      return getCurrentAuthContext();
    });

    expect(result?.userId).toBe('parent-user');
  });

  it('should return overridden auth context from child context', () => {
    const manager = getContextManager();

    const parentContext = new DefaultContextProvider();
    parentContext.set(ContextKeys.AuthContext, {
      userId: 'parent-user',
      roles: ['admin'],
      permissions: ['all'],
    });

    const childContext = new DefaultContextProvider(parentContext);
    childContext.set(ContextKeys.AuthContext, {
      userId: 'child-user',
      roles: ['user'],
      permissions: ['read'],
    });

    const result = manager.runWithContext(childContext, () => {
      return getCurrentAuthContext();
    });

    expect(result?.userId).toBe('child-user');
    expect(result?.roles).toEqual(['user']);
  });

  it('should handle auth context with optional scopes', () => {
    const manager = getContextManager();
    const contextWithAuth = new DefaultContextProvider();

    // Auth context without scopes
    contextWithAuth.set(ContextKeys.AuthContext, {
      userId: 'user-789',
      roles: ['guest'],
      permissions: [],
    });

    const result = manager.runWithContext(contextWithAuth, () => {
      return getCurrentAuthContext();
    });

    expect(result?.userId).toBe('user-789');
    expect(result?.scopes).toBeUndefined();
  });

  it('should work with async operations', async () => {
    const manager = getContextManager();
    const contextWithAuth = new DefaultContextProvider();

    contextWithAuth.set(ContextKeys.AuthContext, {
      userId: 'async-user',
      roles: ['async'],
      permissions: ['async-perm'],
      scopes: ['async-scope'],
    });

    const result = await manager.runWithContext(contextWithAuth, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return getCurrentAuthContext();
    });

    expect(result?.userId).toBe('async-user');
    expect(result?.scopes).toContain('async-scope');
  });
});

// ============================================================================
// Concurrent Access Tests
// ============================================================================

describe('Concurrent Access', () => {
  it('should isolate context between concurrent async operations', async () => {
    const manager = getContextManager();

    const context1 = new DefaultContextProvider();
    context1.set(ContextKeys.RequestId, 'req-1');
    context1.set(ContextKeys.User, { id: 'user-1', name: 'User 1', roles: [] });

    const context2 = new DefaultContextProvider();
    context2.set(ContextKeys.RequestId, 'req-2');
    context2.set(ContextKeys.User, { id: 'user-2', name: 'User 2', roles: [] });

    const [result1, result2] = await Promise.all([
      manager.runWithContext(context1, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const current = manager.getCurrentContext();
        return {
          requestId: current.get(ContextKeys.RequestId),
          userId: current.get(ContextKeys.User)?.id,
        };
      }),
      manager.runWithContext(context2, async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const current = manager.getCurrentContext();
        return {
          requestId: current.get(ContextKeys.RequestId),
          userId: current.get(ContextKeys.User)?.id,
        };
      }),
    ]);

    expect(result1.requestId).toBe('req-1');
    expect(result1.userId).toBe('user-1');
    expect(result2.requestId).toBe('req-2');
    expect(result2.userId).toBe('user-2');
  });

  it('should maintain context across multiple nested async calls', async () => {
    const manager = getContextManager();
    const context = new DefaultContextProvider();
    context.set(ContextKeys.CorrelationId, 'corr-multi');

    const result = await manager.runWithContext(context, async () => {
      const level1 = await Promise.resolve().then(() => {
        return manager.getCurrentContext().get(ContextKeys.CorrelationId);
      });

      const level2 = await Promise.resolve().then(async () => {
        return await Promise.resolve().then(() => {
          return manager.getCurrentContext().get(ContextKeys.CorrelationId);
        });
      });

      const level3 = await new Promise<string | undefined>((resolve) => {
        setTimeout(() => {
          resolve(manager.getCurrentContext().get(ContextKeys.CorrelationId));
        }, 10);
      });

      return [level1, level2, level3];
    });

    expect(result).toEqual(['corr-multi', 'corr-multi', 'corr-multi']);
  });
});
