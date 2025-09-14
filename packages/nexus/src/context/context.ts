/**
 * Advanced contextual injection for Nexus DI Container
 */

import { ResolutionContext, InjectionToken, Scope } from '../types/core';

/**
 * Context key for typed context access
 */
export interface ContextKey<T> {
  readonly id: symbol;
  readonly name: string;
  readonly type?: T;
}

/**
 * Create a context key
 */
export function createContextKey<T>(name: string): ContextKey<T> {
  return {
    id: Symbol(name),
    name,
    type: undefined as any
  };
}

/**
 * Common context keys
 */
export const ContextKeys = {
  Request: createContextKey<any>('request'),
  Response: createContextKey<any>('response'),
  User: createContextKey<{ id: string; name: string; roles: string[] }>('user'),
  Tenant: createContextKey<{ id: string; name: string }>('tenant'),
  Environment: createContextKey<'development' | 'production' | 'test'>('environment'),
  Features: createContextKey<string[]>('features'),
  Locale: createContextKey<string>('locale'),
  RequestId: createContextKey<string>('requestId'),
  SessionId: createContextKey<string>('sessionId'),
  CorrelationId: createContextKey<string>('correlationId'),
  Transaction: createContextKey<any>('transaction'),
  Logger: createContextKey<any>('logger'),
  Metrics: createContextKey<any>('metrics')
} as const;

/**
 * Context provider for injecting context values
 */
export interface ContextProvider {
  /**
   * Get context value
   */
  get<T>(key: ContextKey<T>): T | undefined;
  
  /**
   * Set context value
   */
  set<T>(key: ContextKey<T>, value: T): void;
  
  /**
   * Check if context has key
   */
  has(key: ContextKey<any>): boolean;
  
  /**
   * Delete context value
   */
  delete(key: ContextKey<any>): void;
  
  /**
   * Clear all context
   */
  clear(): void;
  
  /**
   * Get all context keys
   */
  keys(): ContextKey<any>[];
  
  /**
   * Get all context as object
   */
  toObject(): Record<string, any>;
  
  /**
   * Create child context
   */
  createChild(): ContextProvider;
}

/**
 * Context provider implementation
 */
export class DefaultContextProvider implements ContextProvider {
  private context = new Map<symbol, any>();
  private parent?: ContextProvider;
  
  constructor(parent?: ContextProvider) {
    this.parent = parent;
  }
  
  get<T>(key: ContextKey<T>): T | undefined {
    if (this.context.has(key.id)) {
      return this.context.get(key.id);
    }
    return this.parent?.get(key);
  }
  
  set<T>(key: ContextKey<T>, value: T): void {
    this.context.set(key.id, value);
  }
  
  has(key: ContextKey<any>): boolean {
    return this.context.has(key.id) || (this.parent?.has(key) ?? false);
  }
  
  delete(key: ContextKey<any>): void {
    this.context.delete(key.id);
  }
  
  clear(): void {
    this.context.clear();
  }
  
  keys(): ContextKey<any>[] {
    const keys: ContextKey<any>[] = [];
    const seen = new Set<symbol>();
    
    // Add local keys
    for (const [id] of this.context) {
      if (!seen.has(id)) {
        keys.push({ id, name: id.toString() } as ContextKey<any>);
        seen.add(id);
      }
    }
    
    // Add parent keys
    if (this.parent) {
      for (const key of this.parent.keys()) {
        if (!seen.has(key.id)) {
          keys.push(key);
          seen.add(key.id);
        }
      }
    }
    
    return keys;
  }
  
  toObject(): Record<string, any> {
    const obj: Record<string, any> = {};
    
    // Add parent context
    if (this.parent) {
      Object.assign(obj, this.parent.toObject());
    }
    
    // Add local context
    for (const [id, value] of this.context) {
      const key = id.toString().replace(/^Symbol\((.*)\)$/, '$1');
      obj[key] = value;
    }
    
    return obj;
  }
  
  createChild(): ContextProvider {
    return new DefaultContextProvider(this);
  }
}

/**
 * Context-aware resolution strategy
 */
export interface ResolutionStrategy {
  /**
   * Strategy name
   */
  name: string;
  
  /**
   * Check if strategy applies
   */
  applies(token: InjectionToken<any>, context: ResolutionContext): boolean;
  
  /**
   * Select provider based on context
   */
  select<T>(providers: any[], context: ResolutionContext): any;
}

/**
 * Built-in resolution strategies
 */

/**
 * Environment-based resolution
 */
export class EnvironmentStrategy implements ResolutionStrategy {
  name = 'environment';
  
  applies(token: InjectionToken<any>, context: ResolutionContext): boolean {
    return context.metadata?.environment !== undefined;
  }
  
  select<T>(providers: any[], context: ResolutionContext): any {
    const env = context.metadata?.environment;
    
    for (const provider of providers) {
      if (provider.environment === env) {
        return provider;
      }
    }
    
    // Fallback to first provider
    return providers[0];
  }
}

/**
 * Feature flag resolution
 */
export class FeatureFlagStrategy implements ResolutionStrategy {
  name = 'feature-flag';
  
  applies(token: InjectionToken<any>, context: ResolutionContext): boolean {
    return context.metadata?.features !== undefined;
  }
  
  select<T>(providers: any[], context: ResolutionContext): any {
    const features = context.metadata?.features as string[] || [];
    
    for (const provider of providers) {
      if (provider.feature && features.includes(provider.feature)) {
        return provider;
      }
    }
    
    // Return default provider
    return providers.find(p => !p.feature) || providers[0];
  }
}

/**
 * Tenant-based resolution
 */
export class TenantStrategy implements ResolutionStrategy {
  name = 'tenant';
  
  applies(token: InjectionToken<any>, context: ResolutionContext): boolean {
    return context.metadata?.tenant !== undefined;
  }
  
  select<T>(providers: any[], context: ResolutionContext): any {
    const tenant = context.metadata?.tenant;
    
    for (const provider of providers) {
      if (provider.tenant === tenant?.id || provider.tenant === tenant) {
        return provider;
      }
    }
    
    // Return multi-tenant provider or first
    return providers.find(p => p.multiTenant) || providers[0];
  }
}

/**
 * User role-based resolution
 */
export class RoleBasedStrategy implements ResolutionStrategy {
  name = 'role-based';
  
  applies(token: InjectionToken<any>, context: ResolutionContext): boolean {
    return context.metadata?.user?.roles !== undefined;
  }
  
  select<T>(providers: any[], context: ResolutionContext): any {
    const roles = context.metadata?.user?.roles as string[] || [];
    
    // Find provider with matching required role
    for (const provider of providers) {
      if (provider.requiredRole && roles.includes(provider.requiredRole)) {
        return provider;
      }
    }
    
    // Return public provider or first
    return providers.find(p => !p.requiredRole) || providers[0];
  }
}

/**
 * Context manager for managing resolution contexts
 */
export class ContextManager {
  private strategies = new Map<string, ResolutionStrategy>();
  private globalContext: ContextProvider;
  private asyncLocalStorage?: any; // AsyncLocalStorage for Node.js
  
  constructor() {
    this.globalContext = new DefaultContextProvider();
    
    // Try to use AsyncLocalStorage if available (Node.js)
    try {
      const { AsyncLocalStorage } = require('async_hooks');
      this.asyncLocalStorage = new AsyncLocalStorage();
    } catch {
      // Not available, will use global context only
    }
    
    // Register default strategies
    this.registerStrategy(new EnvironmentStrategy());
    this.registerStrategy(new FeatureFlagStrategy());
    this.registerStrategy(new TenantStrategy());
    this.registerStrategy(new RoleBasedStrategy());
  }
  
  /**
   * Register a resolution strategy
   */
  registerStrategy(strategy: ResolutionStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }
  
  /**
   * Unregister a strategy
   */
  unregisterStrategy(name: string): void {
    this.strategies.delete(name);
  }
  
  /**
   * Get current context
   */
  getCurrentContext(): ContextProvider {
    if (this.asyncLocalStorage) {
      const store = this.asyncLocalStorage.getStore();
      if (store?.context) {
        return store.context;
      }
    }
    return this.globalContext;
  }
  
  /**
   * Run with context
   */
  runWithContext<T>(context: ContextProvider, fn: () => T): T {
    if (this.asyncLocalStorage) {
      return this.asyncLocalStorage.run({ context }, fn);
    }
    
    // Fallback: temporarily replace global context
    const prev = this.globalContext;
    this.globalContext = context;
    try {
      return fn();
    } finally {
      this.globalContext = prev;
    }
  }
  
  /**
   * Create scoped context
   */
  createScopedContext(parent?: ContextProvider): ContextProvider {
    return new DefaultContextProvider(parent || this.getCurrentContext());
  }
  
  /**
   * Apply strategies to select provider
   */
  selectProvider<T>(
    token: InjectionToken<T>,
    providers: any[],
    context: ResolutionContext
  ): any {
    if (providers.length === 0) {
      return undefined;
    }
    
    if (providers.length === 1) {
      return providers[0];
    }
    
    // Apply strategies
    for (const strategy of this.strategies.values()) {
      if (strategy.applies(token, context)) {
        const selected = strategy.select(providers, context);
        if (selected) {
          return selected;
        }
      }
    }
    
    // Default to first provider
    return providers[0];
  }
  
  /**
   * Create resolution context
   */
  createResolutionContext(
    container: any,
    scope: Scope = Scope.Singleton,
    metadata?: Record<string, any>
  ): ResolutionContext {
    const contextProvider = this.getCurrentContext();
    
    return {
      container,
      scope,
      metadata: {
        ...contextProvider.toObject(),
        ...metadata
      }
    };
  }
}

/**
 * Context decorator for injecting context values
 */
export function InjectContext<T>(key: ContextKey<T>): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const existingTokens = Reflect.getMetadata('design:paramtypes', target, propertyKey!) || [];
    const contextTokens = Reflect.getMetadata('context:inject', target, propertyKey!) || {};
    
    contextTokens[parameterIndex] = key;
    
    Reflect.defineMetadata('context:inject', contextTokens, target, propertyKey!);
  };
}

/**
 * Context-aware provider
 */
export interface ContextAwareProvider<T = any> {
  /**
   * Provide value based on context
   */
  provide(context: ResolutionContext): T | Promise<T>;
  
  /**
   * Check if provider can handle context
   */
  canProvide?(context: ResolutionContext): boolean;
}

/**
 * Create context-aware provider
 */
export function createContextAwareProvider<T>(
  provider: ContextAwareProvider<T>
): ContextAwareProvider<T> {
  return provider;
}