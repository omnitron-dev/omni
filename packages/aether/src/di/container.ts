/**
 * Dependency Injection - Container Implementation
 *
 * Core DI container with hierarchical injection support
 */

import 'reflect-metadata';
import { ScopeManager, getDefaultScope } from './scope.js';
import type {
  Container,
  Injector,
  InjectableToken,
  InjectOptions,
  Provider,
  Type,
  ProviderScope,
  FactoryProvider,
} from './types.js';

/**
 * Normalize provider to full provider definition
 */
function normalizeProvider<T>(provider: Provider<T>): {
  token: InjectableToken<T>;
  type: 'class' | 'value' | 'factory' | 'existing';
  scope: ProviderScope;
  multi: boolean;
  def: any;
} {
  // Shorthand: Type → ClassProvider
  if (typeof provider === 'function') {
    return {
      token: provider,
      type: 'class',
      scope: getDefaultScope(provider),
      multi: false,
      def: provider,
    };
  }

  // Full provider definitions
  if ('useClass' in provider) {
    return {
      token: provider.provide,
      type: 'class',
      scope: provider.scope ?? getDefaultScope(provider.useClass),
      multi: provider.multi ?? false,
      def: provider.useClass,
    };
  }

  if ('useValue' in provider) {
    return {
      token: provider.provide,
      type: 'value',
      scope: 'singleton',
      multi: provider.multi ?? false,
      def: provider.useValue,
    };
  }

  if ('useFactory' in provider) {
    return {
      token: provider.provide,
      type: 'factory',
      scope: provider.scope ?? 'singleton',
      multi: provider.multi ?? false,
      def: provider,
    };
  }

  if ('useExisting' in provider) {
    return {
      token: provider.provide,
      type: 'existing',
      scope: 'singleton',
      multi: provider.multi ?? false,
      def: provider.useExisting,
    };
  }

  throw new Error(`Invalid provider: ${JSON.stringify(provider)}`);
}

/**
 * DI Container implementation
 */
export class DIContainer implements Container, Injector {
  private providers = new Map<any, any[]>();
  private scopeManager = new ScopeManager();
  private parent?: DIContainer;
  private moduleId?: string;
  private requestId?: string;
  private resolutionStack: any[] = [];

  constructor(options?: { parent?: DIContainer; moduleId?: string; requestId?: string }) {
    this.parent = options?.parent;
    this.moduleId = options?.moduleId;
    this.requestId = options?.requestId;
  }

  /**
   * Register a provider
   */
  register<T>(_token: InjectableToken<T>, provider: Provider<T>): void {
    const normalized = normalizeProvider(provider);

    if (normalized.multi) {
      // Multi provider - append to array
      const existing = this.providers.get(normalized.token) ?? [];
      existing.push(normalized);
      this.providers.set(normalized.token, existing);
    } else {
      // Single provider - replace
      this.providers.set(normalized.token, [normalized]);
    }
  }

  /**
   * Check if token is registered
   */
  has(token: InjectableToken): boolean {
    if (this.providers.has(token)) {
      return true;
    }
    if (this.parent) {
      return this.parent.has(token);
    }
    return false;
  }

  /**
   * Resolve a token
   */
  resolve<T>(token: InjectableToken<T>): T {
    return this.get(token);
  }

  /**
   * Get instance for a token
   */
  get<T>(token: InjectableToken<T>, options?: InjectOptions): T {
    // Check circular dependencies
    if (this.resolutionStack.includes(token)) {
      const chain = [...this.resolutionStack, token].map((t) => this.tokenToString(t)).join(' → ');
      throw new Error(`Circular dependency detected: ${chain}`);
    }

    this.resolutionStack.push(token);

    try {
      // Handle skipSelf
      if (options?.skipSelf && this.parent) {
        return this.parent.get(token, { ...options, skipSelf: false });
      }

      // Handle self
      if (options?.self) {
        return this.resolveLocal(token, options);
      }

      // Normal resolution with hierarchy
      return this.resolveWithHierarchy(token, options);
    } finally {
      this.resolutionStack.pop();
    }
  }

  /**
   * Resolve token locally (no parent lookup)
   */
  private resolveLocal<T>(token: InjectableToken<T>, options?: InjectOptions): T {
    const providers = this.providers.get(token);

    if (!providers || providers.length === 0) {
      if (options?.optional) {
        return undefined as any;
      }
      throw new Error(`No provider for ${this.tokenToString(token)}`);
    }

    if (providers.length === 1) {
      return this.instantiate(providers[0]);
    }

    // Multi providers - return array
    return providers.map((p) => this.instantiate(p)) as any;
  }

  /**
   * Resolve with hierarchical lookup
   */
  private resolveWithHierarchy<T>(token: InjectableToken<T>, options?: InjectOptions): T {
    const providers = this.providers.get(token);

    if (providers && providers.length > 0) {
      if (providers.length === 1) {
        return this.instantiate(providers[0]);
      }
      // Multi providers - return array
      return providers.map((p) => this.instantiate(p)) as any;
    }

    // Not found locally, check parent
    if (this.parent) {
      return this.parent.get(token, options);
    }

    // Not found anywhere
    if (options?.optional) {
      return undefined as any;
    }

    throw new Error(`No provider for ${this.tokenToString(token)}`);
  }

  /**
   * Instantiate a provider
   */
  private instantiate<T>(providerDef: any): T {
    const { token, type, scope, def } = providerDef;

    // Check if instance already exists in scope
    const existing = this.scopeManager.getInstance<T>(token, scope, this.moduleId, this.requestId);

    if (existing !== undefined) {
      return existing;
    }

    // Create new instance
    let instance: T;

    switch (type) {
      case 'class':
        instance = this.instantiateClass(def);
        break;

      case 'value':
        instance = def;
        break;

      case 'factory':
        instance = this.instantiateFactory(def);
        break;

      case 'existing':
        instance = this.get(def);
        break;

      default:
        throw new Error(`Unknown provider type: ${type}`);
    }

    // Store in scope
    this.scopeManager.setInstance(token, instance, scope, this.moduleId, this.requestId);

    return instance;
  }

  /**
   * Instantiate a class with dependency injection
   */
  private instantiateClass<T>(Class: Type<T>): T {
    // Try to get explicit dependencies from @Injectable({ deps: [...] })
    const injectableOptions = Reflect.getMetadata?.('injectable:options', Class);
    let paramTypes = injectableOptions?.deps ?? [];

    // Fallback to design:paramtypes (may not work in all environments)
    if (!paramTypes || paramTypes.length === 0) {
      paramTypes = Reflect.getMetadata?.('design:paramtypes', Class) ?? [];
    }

    // Get optional, self, skipSelf metadata
    const optionalIndices = Reflect.getMetadata?.('inject:optional', Class) ?? [];
    const selfIndices = Reflect.getMetadata?.('inject:self', Class) ?? [];
    const skipSelfIndices = Reflect.getMetadata?.('inject:skipSelf', Class) ?? [];

    // Resolve dependencies
    const deps = paramTypes.map((paramType: any, index: number) => {
      if (paramType === undefined || paramType === Object) {
        // No type information - cannot inject
        return undefined;
      }

      const options: InjectOptions = {
        optional: optionalIndices.includes(index),
        self: selfIndices.includes(index),
        skipSelf: skipSelfIndices.includes(index),
      };

      try {
        return this.get(paramType, options);
      } catch (error) {
        if (options.optional) {
          return undefined;
        }
        throw error;
      }
    });

    // Create instance
    return new Class(...deps);
  }

  /**
   * Instantiate a factory provider
   */
  private instantiateFactory<T>(factoryDef: FactoryProvider<T>): T {
    const { useFactory, deps = [] } = factoryDef;

    // Resolve factory dependencies
    const resolvedDeps = deps.map((dep) => this.get(dep));

    // Call factory
    const result = useFactory(...resolvedDeps);

    // Handle async factories
    if (factoryDef.async && result instanceof Promise) {
      throw new Error('Async providers must be resolved asynchronously. Use resolveAsync() instead.');
    }

    return result as T;
  }

  /**
   * Create a child injector
   */
  createChild(providers?: Provider[]): Injector {
    const child = new DIContainer({ parent: this });

    if (providers) {
      providers.forEach((provider) => {
        const normalized = normalizeProvider(provider);
        child.register(normalized.token, provider);
      });
    }

    return child;
  }

  /**
   * Clear all instances and providers
   */
  clear(): void {
    this.providers.clear();
    this.scopeManager.clear();
  }

  /**
   * Dispose the container
   */
  dispose(): void {
    this.clear();
  }

  /**
   * Convert token to string for error messages
   */
  private tokenToString(token: any): string {
    if (typeof token === 'function') {
      return token.name || 'Anonymous';
    }
    if (token && typeof token.toString === 'function') {
      return token.toString();
    }
    return String(token);
  }
}

/**
 * Global root injector
 */
let rootInjector: DIContainer | null = null;

/**
 * Get or create the root injector
 */
export function getRootInjector(): DIContainer {
  if (!rootInjector) {
    rootInjector = new DIContainer();
  }
  return rootInjector;
}

/**
 * Reset the root injector (for testing)
 */
export function resetRootInjector(): void {
  rootInjector?.dispose();
  rootInjector = null;
}
