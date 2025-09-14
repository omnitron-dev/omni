/**
 * Core container implementation for Nexus DI
 */

import {
  IContainer,
  InjectionToken,
  Provider,
  ClassProvider,
  ValueProvider,
  FactoryProvider,
  AsyncFactoryProvider,
  TokenProvider,
  ConditionalProvider,
  Constructor,
  ResolutionContext,
  RegistrationOptions,
  Scope,
  ContainerMetadata,
  Disposable,
  Initializable,
  IModule
} from '../types/core';

import {
  ResolutionError,
  CircularDependencyError,
  DependencyNotFoundError,
  AsyncResolutionError,
  DisposalError,
  ContainerDisposedError,
  InvalidProviderError,
  DuplicateRegistrationError,
  InitializationError
} from '../errors/errors';

import { isToken, isMultiToken, isOptionalToken, getTokenName } from '../token/token';
import { PerformanceTimer } from '../utils/runtime';
import { PluginManager, Plugin } from '../plugins/plugin';
import { MiddlewarePipeline, Middleware, MiddlewareContext } from '../middleware/middleware';
import { LifecycleManager, LifecycleEvent } from '../lifecycle/lifecycle';
import { ContextManager, ContextProvider } from '../context/context';
import { ModuleCompiler, ModuleRef } from '../modules/module';

/**
 * Registration metadata
 */
interface Registration {
  token: InjectionToken<any>;
  provider: Provider<any>;
  options: RegistrationOptions;
  scope: Scope;
  instance?: any;
  factory?: (...args: any[]) => any;
  dependencies?: InjectionToken<any>[];
  isAsync?: boolean;
}

/**
 * Resolution state for circular dependency detection
 */
interface ResolutionState {
  chain: InjectionToken<any>[];
  resolved: Map<InjectionToken<any>, any>;
}

/**
 * Container implementation with Phase 2 features
 */
export class Container implements IContainer {
  private registrations = new Map<InjectionToken<any>, Registration | Registration[]>();
  private instances = new Map<InjectionToken<any>, any>();
  private scopedInstances = new Map<string, Map<InjectionToken<any>, any>>();
  private parent?: IContainer;
  private disposed = false;
  private modules = new Map<string, IModule>();
  private resolutionState?: ResolutionState;
  private context: ResolutionContext;
  
  // Phase 2 features
  private pluginManager: PluginManager;
  private middlewarePipeline: MiddlewarePipeline;
  private lifecycleManager: LifecycleManager;
  private contextManager: ContextManager;
  private moduleCompiler: ModuleCompiler;
  private contextProvider: ContextProvider;

  constructor(parent?: IContainer, context: Partial<ResolutionContext> = {}) {
    this.parent = parent;
    this.context = {
      container: this,
      scope: Scope.Singleton,
      parent: parent ? { container: parent } as ResolutionContext : undefined,
      ...context
    };
    
    
    // Initialize Phase 2 features
    this.pluginManager = new PluginManager(this);
    this.middlewarePipeline = new MiddlewarePipeline();
    this.lifecycleManager = new LifecycleManager();
    this.contextManager = new ContextManager();
    this.moduleCompiler = new ModuleCompiler();
    
    // Create context provider (child contexts inherit from parent)
    if (parent) {
      this.contextProvider = this.contextManager.createScopedContext(parent.getContext());
    } else {
      this.contextProvider = this.contextManager.createScopedContext();
    }
    
    // Emit container created event
    this.lifecycleManager.emitSync(LifecycleEvent.ContainerCreated, { context: this.context });
  }

  /**
   * Register a provider
   */
  register<T>(
    token: InjectionToken<T>,
    provider: Provider<T>,
    options: RegistrationOptions = {}
  ): this {
    this.checkDisposed();

    // Handle multi-token registration
    if (isMultiToken(token)) {
      return this.registerMulti(token, provider, options);
    }

    // Check for duplicate registration
    if (this.registrations.has(token) && !options.tags?.includes('override')) {
      throw new DuplicateRegistrationError(token);
    }

    const registration = this.createRegistration(token, provider, options);
    this.registrations.set(token, registration);

    // Emit after register event
    this.lifecycleManager.emitSync(LifecycleEvent.AfterRegister, { 
      token, 
      metadata: { provider }
    });

    return this;
  }

  /**
   * Register an async provider
   */
  registerAsync<T>(
    token: InjectionToken<T>,
    provider: AsyncFactoryProvider<T>,
    options: RegistrationOptions = {}
  ): this {
    this.checkDisposed();

    const registration = this.createRegistration(token, provider, options);
    registration.isAsync = true;
    this.registrations.set(token, registration);

    // Emit after register event
    this.lifecycleManager.emitSync(LifecycleEvent.AfterRegister, { 
      token, 
      metadata: { provider }
    });

    return this;
  }

  /**
   * Register multiple providers for a multi-token
   */
  private registerMulti<T>(
    token: InjectionToken<T>,
    provider: Provider<T>,
    options: RegistrationOptions
  ): this {
    const existing = this.registrations.get(token);
    const registration = this.createRegistration(token, provider, options);

    if (Array.isArray(existing)) {
      existing.push(registration);
    } else if (existing) {
      this.registrations.set(token, [existing, registration]);
    } else {
      this.registrations.set(token, [registration]);
    }

    // Emit after register event
    this.lifecycleManager.emitSync(LifecycleEvent.AfterRegister, { 
      token, 
      metadata: { provider }
    });

    return this;
  }

  /**
   * Create a registration from a provider
   */
  private createRegistration(
    token: InjectionToken<any>,
    provider: Provider<any>,
    options: RegistrationOptions
  ): Registration {
    // Handle class constructor as provider
    if (typeof provider === 'function' && provider.prototype) {
      provider = { useClass: provider as Constructor } as ClassProvider;
    }

    // Validate provider
    if (!this.isValidProvider(provider)) {
      throw new InvalidProviderError(token, 'Invalid provider format');
    }

    // Determine scope
    let scope = options.scope || Scope.Transient;
    if ('useValue' in provider) {
      scope = Scope.Singleton; // Values are always singleton
    } else if ('scope' in provider && provider.scope) {
      scope = provider.scope;
    }

    // Extract dependencies
    let dependencies: InjectionToken<any>[] | undefined;
    if ('inject' in provider && provider.inject) {
      dependencies = provider.inject;
    }

    // Create factory function
    const factory = this.createFactory(token, provider);

    return {
      token,
      provider,
      options,
      scope,
      factory,
      dependencies,
      isAsync: 'useFactory' in provider && provider.useFactory?.constructor.name === 'AsyncFunction'
    };
  }

  /**
   * Create a factory function from a provider
   */
  private createFactory(token: InjectionToken<any>, provider: Provider<any>): (...args: any[]) => any {
    if ('useValue' in provider) {
      return () => provider.useValue;
    }

    if ('useClass' in provider) {
      return (...args: any[]) => new provider.useClass(...args);
    }

    if ('when' in provider && 'useFactory' in provider) {
      const conditionalProvider = provider as ConditionalProvider;
      return () => {
        const context = this.context;
        try {
          const conditionResult = conditionalProvider.when(context);
          if (conditionResult) {
            // ConditionalProvider always expects context
            return conditionalProvider.useFactory(context);
          }
        } catch (error) {
          // If condition evaluation fails, try fallback
          if (conditionalProvider.fallback) {
            const fallbackFactory = this.createFactory(token, conditionalProvider.fallback);
            return fallbackFactory();
          }
          throw error;
        }
        
        if (conditionalProvider.fallback) {
          const fallbackFactory = this.createFactory(token, conditionalProvider.fallback);
          return fallbackFactory();
        }
        throw new DependencyNotFoundError(token);
      };
    }

    if ('useFactory' in provider) {
      return provider.useFactory;
    }

    if ('useToken' in provider) {
      return () => this.resolve(provider.useToken);
    }

    throw new InvalidProviderError(token, 'Unable to create factory from provider');
  }

  /**
   * Validate provider
   */
  private isValidProvider(provider: any): boolean {
    if (!provider || typeof provider !== 'object') {
      return typeof provider === 'function';
    }

    return 'useValue' in provider ||
           'useClass' in provider ||
           'useFactory' in provider ||
           'useToken' in provider ||
           ('when' in provider && 'useFactory' in provider);
  }

  /**
   * Resolve a dependency
   */
  resolve<T>(token: InjectionToken<T>): T {
    this.checkDisposed();

    // Initialize resolution state if needed
    if (!this.resolutionState) {
      this.resolutionState = {
        chain: [],
        resolved: new Map()
      };
    }

    try {
      // Emit before resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.BeforeResolve, { 
        token, 
        context: this.context 
      });
      
      // Execute plugin hooks
      this.pluginManager.executeHooksSync('beforeResolve', token, this.context);

      // Check for circular dependency
      if (this.resolutionState.chain.includes(token)) {
        throw new CircularDependencyError([...this.resolutionState.chain, token]);
      }

      // Check resolution cache
      if (this.resolutionState.resolved.has(token)) {
        const cached = this.resolutionState.resolved.get(token);
        this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { token });
        return cached;
      }

      // Add to resolution chain
      this.resolutionState.chain.push(token);

      // Create middleware context
      const middlewareContext: MiddlewareContext = {
        ...this.context,
        token,
        startTime: Date.now()
      };

      // Resolve through middleware pipeline
      const result = this.middlewarePipeline.executeSync(
        middlewareContext,
        () => this.resolveInternal(token)
      );

      // Cache the result
      this.resolutionState.resolved.set(token, result);
      
      // Emit after resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.AfterResolve, { 
        token, 
        instance: result,
        context: this.context 
      });

      return result;
    } catch (error: any) {
      // Emit resolve failed event
      this.lifecycleManager.emitSync(LifecycleEvent.ResolveFailed, { 
        token, 
        error,
        context: this.context 
      });
      
      // Execute plugin error hooks
      this.pluginManager.executeHooksSync('onError', error, token, this.context);
      
      throw error;
    } finally {
      // Remove from resolution chain (check if resolutionState exists in case of early error)
      if (this.resolutionState && this.resolutionState.chain.length > 0) {
        this.resolutionState.chain.pop();
      }
      
      // Clean up resolution state if we're back at the top level
      if (this.resolutionState && this.resolutionState.chain.length === 0) {
        this.resolutionState = undefined;
      }
    }
  }

  /**
   * Internal resolution logic
   */
  private resolveInternal<T>(token: InjectionToken<T>): T {
    // Check for cached instance
    if (this.instances.has(token)) {
      // Emit cache hit event for cached singletons
      this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { token });
      return this.instances.get(token);
    }

    // Check for registration
    const registration = this.getRegistration(token);
    if (!registration) {
      // Check parent container
      if (this.parent) {
        // Check if parent has a conditional or scoped provider
        const parentRegistration = (this.parent as Container).getRegistration(token);
        if (parentRegistration) {
          if ('when' in parentRegistration.provider) {
            // For conditional providers, re-evaluate with current context
            const factory = this.createFactory(token, parentRegistration.provider);
            return factory();
          }
          if (parentRegistration.scope === Scope.Scoped || parentRegistration.scope === Scope.Request) {
            // For scoped/request providers, resolve with current context
            return this.resolveWithScope(parentRegistration);
          }
        }
        return this.parent.resolve(token);
      }

      // Check if optional
      if (isOptionalToken(token as any)) {
        return undefined as any;
      }

      throw new DependencyNotFoundError(token);
    }

    // Check for async provider
    if (registration.isAsync) {
      throw new AsyncResolutionError(token);
    }

    // Resolve based on scope
    return this.resolveWithScope(registration);
  }

  /**
   * Resolve with scope management
   */
  private resolveWithScope<T>(registration: Registration): T {
    switch (registration.scope) {
      case Scope.Singleton:
        return this.resolveSingleton(registration);
      case Scope.Transient:
        return this.resolveTransient(registration);
      case Scope.Scoped:
        return this.resolveScoped(registration);
      case Scope.Request:
        return this.resolveRequest(registration);
      default:
        return this.resolveTransient(registration);
    }
  }

  /**
   * Resolve singleton
   */
  private resolveSingleton<T>(registration: Registration): T {
    // Check if instance already exists in registration
    if (registration.instance !== undefined) {
      // Emit cache hit for singleton reuse
      this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { 
        token: registration.token 
      });
      return registration.instance;
    }
    
    // For individual registrations (not multi-token), check if already resolved
    if (!isMultiToken(registration.token)) {
      if (this.instances.has(registration.token)) {
        // Emit cache hit for singleton reuse
        this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { 
          token: registration.token 
        });
        return this.instances.get(registration.token);
      }
    }

    const instance = this.createInstance(registration);
    registration.instance = instance;
    
    // Only cache in instances map for non-multi-tokens
    if (!isMultiToken(registration.token)) {
      this.instances.set(registration.token, instance);
    }

    return instance;
  }

  /**
   * Resolve transient
   */
  private resolveTransient<T>(registration: Registration): T {
    return this.createInstance(registration);
  }

  /**
   * Resolve scoped
   */
  private resolveScoped<T>(registration: Registration): T {
    const scopeId = this.context.metadata?.scopeId || 'default';
    
    // Check if parent has this scoped instance (for shared request scope)
    if (this.parent && (this.parent as any).scopedInstances) {
      const parentScoped = (this.parent as any).scopedInstances.get(scopeId);
      if (parentScoped && parentScoped.has(registration.token)) {
        return parentScoped.get(registration.token);
      }
    }
    
    if (!this.scopedInstances.has(scopeId)) {
      this.scopedInstances.set(scopeId, new Map());
    }

    const scopeCache = this.scopedInstances.get(scopeId)!;
    
    if (scopeCache.has(registration.token)) {
      return scopeCache.get(registration.token);
    }

    const instance = this.createInstance(registration);
    scopeCache.set(registration.token, instance);
    
    // Also store in parent's scoped instances if it exists (for sharing across child scopes)
    if (this.parent && (this.parent as any).scopedInstances) {
      if (!(this.parent as any).scopedInstances.has(scopeId)) {
        (this.parent as any).scopedInstances.set(scopeId, new Map());
      }
      const parentCache = (this.parent as any).scopedInstances.get(scopeId);
      parentCache.set(registration.token, instance);
    }

    return instance;
  }

  /**
   * Resolve request-scoped
   */
  private resolveRequest<T>(registration: Registration): T {
    // For request scope, use scopeId or requestId to identify the request context
    const requestContext = this.context.metadata?.scopeId || this.context.metadata?.requestId;
    
    if (!requestContext) {
      // Fallback to transient if no request context
      return this.resolveTransient(registration);
    }

    return this.resolveScoped(registration);
  }

  /**
   * Create an instance from registration
   */
  private createInstance(registration: Registration): any {
    if (!registration.factory) {
      throw new InvalidProviderError(registration.token, 'No factory function');
    }

    try {
      // Resolve dependencies
      const dependencies = this.resolveDependencies(registration);
      
      // Create instance
      const instance = registration.factory(...dependencies);

      // Emit instance created event
      this.lifecycleManager.emitSync(LifecycleEvent.InstanceCreated, {
        token: registration.token,
        instance,
        context: this.context
      });

      // Initialize if needed
      if (this.isInitializable(instance)) {
        this.lifecycleManager.emitSync(LifecycleEvent.InstanceInitializing, {
          token: registration.token,
          instance,
          context: this.context
        });
        
        const result = instance.initialize();
        if (result instanceof Promise) {
          throw new AsyncResolutionError(registration.token);
        }
        
        this.lifecycleManager.emitSync(LifecycleEvent.InstanceInitialized, {
          token: registration.token,
          instance,
          context: this.context
        });
      }

      return instance;
    } catch (error: any) {
      if (error instanceof ResolutionError || 
          error instanceof AsyncResolutionError ||
          error instanceof CircularDependencyError ||
          error instanceof DependencyNotFoundError ||
          error instanceof ContainerDisposedError ||
          error instanceof InvalidProviderError ||
          error instanceof DuplicateRegistrationError ||
          error instanceof DisposalError) {
        throw error;
      }
      throw new InitializationError(registration.token, error);
    }
  }

  /**
   * Resolve dependencies
   */
  private resolveDependencies(registration: Registration): any[] {
    if (!registration.dependencies || registration.dependencies.length === 0) {
      return [];
    }

    return registration.dependencies.map(dep => this.resolve(dep));
  }

  /**
   * Resolve dependencies for a fallback provider
   */
  private resolveFallbackDependencies(provider: Provider<any>): any[] {
    if ('inject' in provider && provider.inject) {
      return provider.inject.map(dep => this.resolve(dep));
    }
    return [];
  }

  /**
   * Resolve async
   */
  async resolveAsync<T>(token: InjectionToken<T>): Promise<T> {
    this.checkDisposed();

    // Initialize resolution state if needed
    if (!this.resolutionState) {
      this.resolutionState = {
        chain: [],
        resolved: new Map()
      };
    }

    try {
      // Emit before resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.BeforeResolve, { 
        token, 
        context: this.context 
      });

      // Check for circular dependency
      if (this.resolutionState.chain.includes(token)) {
        throw new CircularDependencyError([...this.resolutionState.chain, token]);
      }

      // Check resolution cache
      if (this.resolutionState.resolved.has(token)) {
        const cached = this.resolutionState.resolved.get(token);
        this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { token });
        return cached;
      }

      // Add to resolution chain
      this.resolutionState.chain.push(token);

      // Create middleware context
      const middlewareContext: MiddlewareContext = {
        ...this.context,
        token,
        startTime: Date.now()
      };

      // Resolve through async middleware pipeline
      const result = await this.middlewarePipeline.execute(
        middlewareContext,
        () => this.resolveAsyncInternal(token)
      );

      // Cache the result
      this.resolutionState.resolved.set(token, result);
      
      // Emit after resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.AfterResolve, { 
        token, 
        instance: result,
        context: this.context 
      });

      return result;
    } catch (error: any) {
      // Emit resolve failed event
      this.lifecycleManager.emitSync(LifecycleEvent.ResolveFailed, { 
        token, 
        error,
        context: this.context 
      });
      
      throw error;
    } finally {
      // Remove from resolution chain
      if (this.resolutionState && this.resolutionState.chain.length > 0) {
        this.resolutionState.chain.pop();
      }
      
      // Clean up resolution state
      if (this.resolutionState && this.resolutionState.chain.length === 0) {
        this.resolutionState = undefined;
      }
    }
  }

  private async resolveAsyncInternal<T>(token: InjectionToken<T>): Promise<T> {
    // Check for cached instance
    if (this.instances.has(token)) {
      return this.instances.get(token);
    }

    // Get registration
    const registration = this.getRegistration(token);
    if (!registration) {
      if (this.parent) {
        return this.parent.resolveAsync(token);
      }
      throw new DependencyNotFoundError(token);
    }

    // Resolve dependencies
    const dependencies = await this.resolveAsyncDependencies(registration);

    // Create instance
    const instance = await registration.factory!(...dependencies);

    // Initialize if needed
    if (this.isInitializable(instance)) {
      await instance.initialize();
    }

    // Cache if singleton
    if (registration.scope === Scope.Singleton) {
      registration.instance = instance;
      this.instances.set(token, instance);
    }

    return instance;
  }

  /**
   * Resolve async dependencies
   */
  private async resolveAsyncDependencies(registration: Registration): Promise<any[]> {
    if (!registration.dependencies || registration.dependencies.length === 0) {
      return [];
    }

    return Promise.all(
      registration.dependencies.map(dep => {
        const depReg = this.getRegistration(dep);
        if (depReg?.isAsync) {
          return this.resolveAsync(dep);
        }
        return this.resolve(dep);
      })
    );
  }

  /**
   * Resolve many for multi-token
   */
  resolveMany<T>(token: InjectionToken<T>): T[] {
    this.checkDisposed();

    const registrations = this.registrations.get(token);
    
    if (!registrations) {
      if (this.parent) {
        return this.parent.resolveMany(token);
      }
      return [];
    }

    const regs = Array.isArray(registrations) ? registrations : [registrations];
    return regs.map(reg => this.resolveWithScope(reg));
  }

  /**
   * Resolve optional
   */
  resolveOptional<T>(token: InjectionToken<T>): T | undefined {
    try {
      return this.resolve(token);
    } catch (error) {
      if (error instanceof DependencyNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Check if token is registered
   */
  has(token: InjectionToken<any>): boolean {
    if (this.registrations.has(token)) {
      return true;
    }
    return this.parent ? this.parent.has(token) : false;
  }

  /**
   * Get registration
   */
  private getRegistration(token: InjectionToken<any>): Registration | undefined {
    const reg = this.registrations.get(token);
    if (reg) {
      return Array.isArray(reg) ? reg[0] : reg;
    }
    return undefined;
  }

  /**
   * Create a child scope
   */
  createScope(context: Partial<ResolutionContext> = {}): IContainer {
    this.checkDisposed();
    
const newContext = {
      ...this.context,
      ...context,
      metadata: {
        ...(this.context.metadata || {}),
        ...(context.metadata || {}),
        scopeId: context.metadata?.scopeId || `scope-${Date.now()}`
      }
    };
    
    return new Container(this, newContext);
  }

  /**
   * Load a module
   */
  loadModule(module: IModule): this {
    this.checkDisposed();

    // Check if already loaded
    if (this.modules.has(module.name)) {
      return this;
    }

    // Load imports first
    if (module.imports) {
      for (const imported of module.imports) {
        this.loadModule(imported);
      }
    }

    // Register providers
    if (module.providers) {
      for (const provider of module.providers) {
        if (Array.isArray(provider)) {
          this.register(provider[0], provider[1]);
        } else {
          // Auto-register class providers
          if (typeof provider === 'function') {
            this.register(provider, { useClass: provider });
          } else {
            // Assume it's already a provider object with a token
            throw new Error('Module provider must be either [token, provider] tuple or a class constructor');
          }
        }
      }
    }

    // Store module
    this.modules.set(module.name, module);

    // Initialize module
    if (module.onModuleInit) {
      const result = module.onModuleInit();
      if (result instanceof Promise) {
        result.catch(error => {
          console.error(`Failed to initialize module ${module.name}:`, error);
        });
      }
    }

    return this;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.checkDisposed();
    
    // Clear singleton instances except values
    for (const [token, registration] of this.registrations) {
      if (Array.isArray(registration)) {
        for (const reg of registration) {
          if (!('useValue' in reg.provider)) {
            delete reg.instance;
          }
        }
      } else {
        if (!('useValue' in registration.provider)) {
          delete registration.instance;
        }
      }
    }
    
    // Clear instance cache
    this.instances.clear();
    
    // Clear scoped instances (including parent's scoped instances if it's a child container)
    this.scopedInstances.clear();
    
    // If this is a child container, also clear its scopeId from parent's scoped instances
    if (this.parent && (this.parent as any).scopedInstances) {
      const scopeId = this.context.metadata?.scopeId;
      if (scopeId) {
        (this.parent as any).scopedInstances.delete(scopeId);
      }
    }
  }

  /**
   * Dispose container
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    // Dispose modules
    for (const module of this.modules.values()) {
      if (module.onModuleDestroy) {
        try {
          await module.onModuleDestroy();
        } catch (error: any) {
          console.error(`Failed to destroy module ${module.name}:`, error);
        }
      }
    }

    // Dispose instances
    for (const [token, instance] of this.instances) {
      if (this.isDisposable(instance)) {
        try {
          await instance.dispose();
        } catch (error: any) {
          console.error(`Failed to dispose ${getTokenName(token)}:`, error);
        }
      }
    }

    // Dispose scoped instances
    for (const scopeCache of this.scopedInstances.values()) {
      for (const [token, instance] of scopeCache) {
        if (this.isDisposable(instance)) {
          try {
            await instance.dispose();
          } catch (error: any) {
            console.error(`Failed to dispose scoped ${getTokenName(token)}:`, error);
          }
        }
      }
    }

    // Clear all caches
    this.registrations.clear();
    this.instances.clear();
    this.scopedInstances.clear();
    this.modules.clear();

    this.disposed = true;
  }

  /**
   * Get metadata
   */
  getMetadata(): ContainerMetadata {
    return {
      registrations: this.registrations.size,
      cached: this.instances.size,
      scopes: this.scopedInstances.size,
      parent: this.parent as IContainer | undefined
    };
  }

  /**
   * Check if disposed
   */
  private checkDisposed(): void {
    if (this.disposed) {
      throw new ContainerDisposedError();
    }
  }

  /**
   * Check if disposable
   */
  private isDisposable(instance: any): instance is Disposable {
    return instance && typeof instance.dispose === 'function';
  }

  /**
   * Check if initializable
   */
  private isInitializable(instance: any): instance is Initializable {
    return instance && typeof instance.initialize === 'function';
  }
  
  /**
   * Install a plugin
   */
  use(plugin: Plugin): this {
    this.pluginManager.install(plugin);
    
    // Register plugin hooks with container lifecycle
    if (plugin.hooks) {
      // Connect plugin hooks to lifecycle manager
      if (plugin.hooks.beforeResolve) {
        this.lifecycleManager.on(LifecycleEvent.BeforeResolve, async (data) => {
          if (data.token) {
            await plugin.hooks!.beforeResolve!(data.token, data.context!);
          }
        });
      }
      
      if (plugin.hooks.afterResolve) {
        this.lifecycleManager.on(LifecycleEvent.AfterResolve, async (data) => {
          if (data.token && data.instance) {
            await plugin.hooks!.afterResolve!(data.token, data.instance, data.context!);
          }
        });
      }
      
      if (plugin.hooks.onError) {
        this.lifecycleManager.on(LifecycleEvent.ResolveFailed, async (data) => {
          if (data.error) {
            await plugin.hooks!.onError!(data.error, data.token, data.context);
          }
        });
      }
      
      if (plugin.hooks.beforeRegister) {
        this.lifecycleManager.on(LifecycleEvent.BeforeRegister, async (data) => {
          if (data.token) {
            await plugin.hooks!.beforeRegister!(data.token, data.metadata?.provider);
          }
        });
      }
      
      if (plugin.hooks.afterRegister) {
        this.lifecycleManager.on(LifecycleEvent.AfterRegister, async (data) => {
          if (data.token) {
            await plugin.hooks!.afterRegister!(data.token);
          }
        });
      }
      
      if (plugin.hooks.onDispose) {
        this.lifecycleManager.on(LifecycleEvent.ContainerDisposing, async () => {
          await plugin.hooks!.onDispose!();
        });
      }
      
      if (plugin.hooks.onCacheClear) {
        this.lifecycleManager.on(LifecycleEvent.CacheClearing, async () => {
          await plugin.hooks!.onCacheClear!();
        });
      }
    }
    
    return this;
  }
  
  /**
   * Add middleware
   */
  addMiddleware(middleware: Middleware): this {
    this.middlewarePipeline.use(middleware);
    
    // Emit middleware added event
    this.lifecycleManager.emitSync(LifecycleEvent.MiddlewareAdded, {
      metadata: { middlewareName: middleware.name }
    });
    
    return this;
  }
  
  /**
   * Remove middleware
   */
  removeMiddleware(name: string): this {
    this.middlewarePipeline.remove(name);
    return this;
  }
  
  /**
   * Add lifecycle hook
   */
  on(event: LifecycleEvent, hook: (data: any) => void | Promise<void>): this {
    this.lifecycleManager.on(event, hook);
    return this;
  }
  
  /**
   * Remove lifecycle hook
   */
  off(event: LifecycleEvent, hook: (data: any) => void | Promise<void>): this {
    this.lifecycleManager.off(event, hook);
    return this;
  }
  
  /**
   * Get context provider
   */
  getContext(): ContextProvider {
    return this.contextProvider;
  }
  
  /**
   * With context
   */
  withContext<T>(fn: () => T): T {
    return this.contextManager.runWithContext(this.contextProvider, fn);
  }
  
  /**
   * Add a lifecycle hook
   */
  addHook(event: string, handler: (...args: any[]) => void | Promise<void>): this {
    // Map common plugin hook names to lifecycle events
    const eventMap: { [key: string]: LifecycleEvent } = {
      'beforeResolve': LifecycleEvent.BeforeResolve,
      'afterResolve': LifecycleEvent.AfterResolve,
      'beforeRegister': LifecycleEvent.BeforeRegister,
      'afterRegister': LifecycleEvent.AfterRegister,
      'onError': LifecycleEvent.ResolveFailed,
      'onDispose': LifecycleEvent.ContainerDisposing
    };
    
    const lifecycleEvent = eventMap[event];
    if (lifecycleEvent) {
      this.lifecycleManager.on(lifecycleEvent, handler);
    } else {
      console.warn(`Unknown hook event: ${event}`);
    }
    
    return this;
  }
  
  /**
   * Load enhanced module
   */
  loadEnhancedModule(module: any): this {
    const moduleRef = this.moduleCompiler.compile(module);
    
    // Emit module loading event
    this.lifecycleManager.emitSync(LifecycleEvent.ModuleLoading, { 
      metadata: { moduleName: moduleRef.name } 
    });
    
    // Register providers from the module
    for (const [token, provider] of moduleRef.providers) {
      this.register(token, provider);
    }
    
    // Store module reference
    (moduleRef as any).container = this;
    
    // Emit module loaded event
    this.lifecycleManager.emitSync(LifecycleEvent.ModuleLoaded, {
      metadata: { moduleName: moduleRef.name }
    });
    
    return this;
  }
}