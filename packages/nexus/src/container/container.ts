/**
 * Core container implementation for Nexus DI
 */

import { ModuleCompiler } from '../modules/module.js';
import { Plugin, PluginManager } from '../plugins/plugin.js';
import { ContextManager, ContextProvider } from '../context/context.js';
import { LifecycleEvent, LifecycleManager } from '../lifecycle/lifecycle.js';
import { isToken, isMultiToken, getTokenName, isOptionalToken } from '../token/token.js';
import { Middleware, MiddlewareContext, MiddlewarePipeline } from '../middleware/middleware.js';
import { isConstructor } from '../utils/provider-utils.js';
import {
  DisposalError,
  ResolutionError,
  AsyncResolutionError,
  InvalidProviderError,
  ContainerDisposedError,
  CircularDependencyError,
  DependencyNotFoundError,
  DuplicateRegistrationError
} from '../errors/errors.js';
import {
  Scope,
  IModule,
  Provider,
  ProviderDefinition,
  IContainer,
  Disposable,
  Constructor,
  ClassProvider,
  Initializable,
  InjectionToken,
  ResolutionContext,
  ContainerMetadata,
  RegistrationOptions,
  FactoryProvider
} from '../types/core.js';

/**
 * Registration metadata
 */
interface Registration {
  token: InjectionToken<any>;
  provider: ProviderDefinition<any>;
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
  private initialized = false;
  private initializableInstances = new Set<any>();
  private disposableInstances = new Set<any>();
  private modules = new Map<string, IModule>();
  private moduleProviders?: Map<string, Map<string, { token: InjectionToken<any>; exported: boolean; global: boolean }>>;
  private resolutionState?: ResolutionState;
  private moduleImports = new Map<string, Set<string>>();
  private context: ResolutionContext;
  private pendingPromises = new Map<InjectionToken<any>, Promise<any>>();

  // Phase 2 features
  private pluginManager: PluginManager;
  private middlewarePipeline: MiddlewarePipeline;
  private lifecycleManager: LifecycleManager;
  private contextManager: ContextManager;
  private moduleCompiler: ModuleCompiler;
  private contextProvider: ContextProvider;

  constructor(parentOrOptions?: IContainer | { environment?: string }, context: Partial<ResolutionContext> = {}) {
    // Handle different constructor signatures
    if (parentOrOptions && typeof parentOrOptions === 'object' && 'environment' in parentOrOptions) {
      // Called with options { environment: 'production' }
      this.parent = undefined;
      this.context = {
        container: this,
        scope: Scope.Singleton,
        environment: parentOrOptions.environment,
        ...context
      };
    } else {
      // Called with parent container
      const parent = parentOrOptions as IContainer | undefined;
      this.parent = parent;
      this.context = {
        container: this,
        scope: Scope.Singleton,
        parent: parent ? { container: parent } as ResolutionContext : undefined,
        ...context
      };
    }


    // Initialize Phase 2 features
    this.pluginManager = new PluginManager(this);
    this.middlewarePipeline = new MiddlewarePipeline();
    this.lifecycleManager = new LifecycleManager();
    this.contextManager = new ContextManager();
    this.moduleCompiler = new ModuleCompiler();

    // Create context provider (child contexts inherit from parent)
    if (this.parent && 'getContext' in this.parent && typeof this.parent.getContext === 'function') {
      this.contextProvider = this.contextManager.createScopedContext(this.parent.getContext());
    } else {
      this.contextProvider = this.contextManager.createScopedContext();
    }

    // Emit container created event
    this.lifecycleManager.emitSync(LifecycleEvent.ContainerCreated, { context: this.context });
  }

  /**
   * Register a provider - supports multiple formats
   */
  register<T>(
    tokenOrProvider: InjectionToken<T> | Provider<T> | Constructor<T>,
    providerOrOptions?: ProviderDefinition<T> | RegistrationOptions,
    optionsArg?: RegistrationOptions
  ): this {
    this.checkDisposed();

    let token: InjectionToken<T>;
    let provider: ProviderDefinition<T>;
    let options: RegistrationOptions;

    // Normalize arguments based on input format
    if (arguments.length === 1) {
      // Single argument - should be a Constructor
      if (isConstructor(tokenOrProvider)) {
        // Direct constructor registration
        token = tokenOrProvider as InjectionToken<T>;
        provider = { useClass: tokenOrProvider as Constructor<T> };
        options = {};
      } else {
        throw new InvalidProviderError(tokenOrProvider as any, 'Single argument must be a constructor');
      }
    } else if (arguments.length >= 2) {
      // Multiple arguments - standard format: register(token, provider, options)
      token = tokenOrProvider as InjectionToken<T>;
      provider = providerOrOptions as ProviderDefinition<T>;
      options = optionsArg || {};
    } else {
      throw new InvalidProviderError(undefined as any, 'Invalid arguments to register');
    }

    // Handle config token validation and defaults
    if (isToken(token) && (token as any).isConfig) {
      const configToken = token as any;
      if ('useValue' in provider) {
        let value = provider.useValue;

        // Apply defaults if available
        if (configToken.defaults) {
          value = { ...configToken.defaults, ...value };
        }

        // Validate the config value if validator exists
        if (configToken.validate) {
          configToken.validate(value);
        }

        // Update the provider with merged value
        provider = { useValue: value } as any;
      }
    }

    // Handle multi-token registration
    if (isMultiToken(token) || options.multi) {
      return this.registerMulti(token, provider, options);
    }

    // Check for duplicate registration (allow multi-registration if multi option is set)
    if (this.registrations.has(token) && !options.override && !options.multi) {
      throw new DuplicateRegistrationError(token);
    }

    const registration = this.createRegistration(token, provider, options);

    // Handle multi-registration
    if (options.multi) {
      const existing = this.registrations.get(token);
      if (existing) {
        if (Array.isArray(existing)) {
          existing.push(registration);
        } else {
          // Convert single registration to array
          this.registrations.set(token, [existing, registration]);
        }
      } else {
        // First registration with multi flag
        this.registrations.set(token, [registration]);
      }
    } else {
      this.registrations.set(token, registration);
    }

    // Emit after register event
    this.lifecycleManager.emitSync(LifecycleEvent.AfterRegister, {
      token,
      metadata: { provider, registration }
    });

    return this;
  }

  /**
   * Register an async provider
   */
  registerAsync<T>(
    token: InjectionToken<T>,
    provider: FactoryProvider<T>,
    options: RegistrationOptions = {}
  ): this {
    this.checkDisposed();

    const registration = this.createRegistration(token, provider, options);
    registration.isAsync = true;
    this.registrations.set(token, registration);

    // Emit after register event
    this.lifecycleManager.emitSync(LifecycleEvent.AfterRegister, {
      token,
      metadata: { provider, registration }
    });

    return this;
  }

  /**
   * Register multiple providers for a multi-token
   */
  private registerMulti<T>(
    token: InjectionToken<T>,
    provider: ProviderDefinition<T>,
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
      metadata: { provider, registration }
    });

    return this;
  }

  /**
   * Create a registration from a provider
   */
  private createRegistration(
    token: InjectionToken<any>,
    provider: ProviderDefinition<any>,
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
    } else if ('useClass' in provider) {
      // Extract dependencies from class metadata
      const METADATA_KEYS = {
        INJECT: 'nexus:inject',
        INJECT_PARAMS: 'nexus:inject:params',
        OPTIONAL: 'nexus:optional',
        PROPERTY_INJECTIONS: 'nexus:property:injections'
      };

      const classConstructor = provider.useClass;
      if (classConstructor) {
        const injectedDependencies = Reflect.getMetadata(METADATA_KEYS.INJECT, classConstructor);
        const optionalMetadata = Reflect.getMetadata(METADATA_KEYS.OPTIONAL, classConstructor) || {};

      if (injectedDependencies) {
        // Transform dependencies to include optional flag
        dependencies = injectedDependencies.map((dep: any, index: number) => {
          if (optionalMetadata[index]) {
            return { token: dep, optional: true };
          }
          return dep;
        });
      }
      }
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
  private createFactory(token: InjectionToken<any>, provider: ProviderDefinition<any>): (...args: any[]) => any {
    if ('useValue' in provider) {
      return () => provider.useValue;
    }

    if ('useClass' in provider && provider.useClass) {
      const ClassConstructor = provider.useClass;
      return (...args: any[]) => new ClassConstructor(...args);
    }

    if ('when' in provider && 'useFactory' in provider) {
      const conditionalProvider = provider as any;
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

    if ('useFactory' in provider && provider.useFactory) {
      return provider.useFactory;
    }

    if ('useToken' in provider && provider.useToken) {
      const aliasToken = provider.useToken;
      return () => this.resolve(aliasToken);
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
  resolve<T>(token: InjectionToken<T>, context?: any): T {
    this.checkDisposed();

    // Initialize resolution state if needed
    if (!this.resolutionState) {
      this.resolutionState = {
        chain: [],
        resolved: new Map()
      };
    }

    // Store resolution context temporarily
    const previousContext = this.context;
    if (context) {
      this.context = { ...this.context, resolveContext: context };
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
        container: this,
        metadata: this.context.metadata || {},
        startTime: Date.now()
      };

      // Resolve through middleware pipeline
      let result = this.middlewarePipeline.executeSync(
        middlewareContext,
        () => this.resolveInternal(token)
      );

      // Execute afterResolve hooks which may modify the result
      result = this.pluginManager.executeHooksSync('afterResolve', token, result, this.context);

      // Cache the result if resolutionState still exists
      if (this.resolutionState) {
        this.resolutionState.resolved.set(token, result);
      }

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

      // Restore previous context
      if (context) {
        this.context = previousContext;
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

      // Provide resolution chain in error - use specific error for simple cases  
      const chain = this.resolutionState?.chain || [];
      if (chain.length <= 1) {
        // Simple case - just token not found (chain length 1 means only current token)
        throw new DependencyNotFoundError(token);
      }
      // Complex case - resolution chain with dependency not found
      throw new ResolutionError(token, [...chain]);
    }

    // Check module exports
    if (this.moduleProviders) {
      let foundInModule = false;
      let tokenModule: string | undefined;
      let isGlobal = false;
      let isExported = false;

      for (const [moduleName, providerMap] of this.moduleProviders) {
        const tokenKey = this.getTokenKey(token);
        if (providerMap.has(tokenKey)) {
          foundInModule = true;
          tokenModule = moduleName;
          const providerInfo = providerMap.get(tokenKey)!;
          isGlobal = providerInfo.global;
          isExported = providerInfo.exported;
          break;
        }
      }

      if (foundInModule && tokenModule) {
        // Check if we're resolving from within the same module
        const resolvingModule = (this.context as any).__resolvingModule;
        const isSameModule = resolvingModule && resolvingModule === tokenModule;

        // Check if resolving module imports the token's module
        let canAccessFromImport = false;
        if (resolvingModule && this.moduleImports.has(resolvingModule)) {
          canAccessFromImport = this.moduleImports.get(resolvingModule)!.has(tokenModule) && isExported;
        }

        // If no resolving module (resolving from main container), allow if exported or global
        const isFromMainContainer = !resolvingModule;
        const canAccessFromMain = isFromMainContainer && (isExported || isGlobal);

        // Access rules:
        // 1. Global providers are accessible everywhere
        // 2. Exported providers are accessible to importing modules and main container
        // 3. Non-exported providers are only accessible within the same module
        const hasAccess = isGlobal || isSameModule || canAccessFromImport || canAccessFromMain;

        if (!hasAccess) {
          const tokenName = getTokenName(token);
          throw new Error(`Token "${tokenName}" from module "${tokenModule}" is not exported and cannot be accessed from outside the module`);
        }
      }
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
    // For multi-tokens with useValue, always return the value directly
    if (registration.options?.multi && 'useValue' in registration.provider) {
      return (registration.provider as any).useValue;
    }

    // Check if instance already exists in registration
    if (registration.instance !== undefined) {
      // Emit cache hit for singleton reuse
      this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, {
        token: registration.token
      });
      return registration.instance;
    }

    // For individual registrations (not multi-token), check if already resolved
    if (!isMultiToken(registration.token) && !registration.options?.multi) {
      if (this.instances.has(registration.token)) {
        // Emit cache hit for singleton reuse
        this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, {
          token: registration.token
        });
        return this.instances.get(registration.token);
      }
    }

    const instance = this.createInstance(registration);

    // Don't cache instance for multi-tokens
    if (!registration.options?.multi) {
      registration.instance = instance;
    }

    // Only cache in instances map for non-multi-tokens
    if (!isMultiToken(registration.token) && !registration.options?.multi) {
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
    const scopeId = this.context.metadata?.['scopeId'] || 'default';

    // Each scope maintains its own instances - don't share with parent
    if (!this.scopedInstances.has(scopeId)) {
      this.scopedInstances.set(scopeId, new Map());
    }

    const scopeCache = this.scopedInstances.get(scopeId)!;

    if (scopeCache.has(registration.token)) {
      return scopeCache.get(registration.token);
    }

    const instance = this.createInstance(registration);
    scopeCache.set(registration.token, instance);

    return instance;
  }

  /**
   * Resolve request-scoped
   */
  private resolveRequest<T>(registration: Registration): T {
    // For request scope, use scopeId or requestId to identify the request context
    const requestContext = this.context.metadata?.['scopeId'] || this.context.metadata?.['requestId'];

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

      // Apply property injections if it's a class instance
      if (instance && registration.provider && 'useClass' in registration.provider) {
        const METADATA_KEYS = {
          PROPERTY_INJECTIONS: 'nexus:property:injections'
        };

        const classConstructor = registration.provider.useClass;
        if (classConstructor) {
          const propertyInjections = Reflect.getMetadata(METADATA_KEYS.PROPERTY_INJECTIONS, classConstructor);

          if (propertyInjections) {
          for (const [propertyKey, token] of Object.entries(propertyInjections)) {
            try {
              instance[propertyKey] = this.resolve(token as InjectionToken<any>);
            } catch (error) {
              // Ignore optional property injection errors
              if (!(error instanceof DependencyNotFoundError)) {
                throw error;
              }
            }
          }
        }
        }
      }

      // Track instances for lifecycle management
      if (instance && typeof instance.onInit === 'function') {
        this.initializableInstances.add(instance);
      }

      if (instance && (typeof instance.onDestroy === 'function' || this.isDisposable(instance))) {
        this.disposableInstances.add(instance);
      }

      // Emit instance created event
      this.lifecycleManager.emitSync(LifecycleEvent.InstanceCreated, {
        token: registration.token,
        instance,
        context: this.context
      });

      // Initialize if needed (synchronous only - async init should be done via initialize() method)
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
      // Factory errors should be wrapped as ResolutionError with chain
      const chain = this.resolutionState?.chain || [];
      throw new ResolutionError(registration.token, [...chain], error);
    }
  }

  /**
   * Resolve dependencies
   */
  private resolveDependencies(registration: Registration): any[] {
    if (!registration.dependencies || registration.dependencies.length === 0) {
      return [];
    }

    // Find which module this registration belongs to
    let currentModule: string | undefined;
    if (this.moduleProviders) {
      const tokenKey = this.getTokenKey(registration.token);
      for (const [moduleName, providerMap] of this.moduleProviders) {
        if (providerMap.has(tokenKey)) {
          currentModule = moduleName;
          break;
        }
      }
    }

    return registration.dependencies.map(dep => {
      // Handle optional dependencies and context injection
      if (typeof dep === 'object' && dep !== null && 'token' in dep) {
        const depObj = dep as any;

        // Handle context injection
        if (depObj.token === 'CONTEXT' && depObj.type === 'context') {
          return this.context['resolveContext'] || this.context;
        }

        if (depObj.optional) {
          return this.resolveOptional(depObj.token);
        }

        // Set module context and resolve
        const prevModule = (this.context as any).__resolvingModule;
        try {
          (this.context as any).__resolvingModule = currentModule;
          return this.resolve(depObj.token);
        } finally {
          (this.context as any).__resolvingModule = prevModule;
        }
      }

      // Handle string context token directly
      if (dep === 'CONTEXT') {
        return this.context['resolveContext'] || this.context;
      }

      // Regular token - set module context and resolve
      const prevModule = (this.context as any).__resolvingModule;
      try {
        (this.context as any).__resolvingModule = currentModule;
        return this.resolve(dep);
      } finally {
        (this.context as any).__resolvingModule = prevModule;
      }
    });
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

    // Create middleware context early so it's available in catch blocks
    const middlewareContext: MiddlewareContext = {
      ...this.context,
      token,
      container: this,
      metadata: this.context.metadata || {},
      startTime: Date.now()
    };

    try {
      // Emit before resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.BeforeResolve, {
        token,
        context: this.context
      });

      // Execute plugin hooks (async for async resolution)
      await this.pluginManager.executeHooks('beforeResolve', token, middlewareContext);

      // Check for pending promise (handles concurrent async resolutions)
      if (this.pendingPromises.has(token)) {
        return this.pendingPromises.get(token)!;
      }

      // Check for circular dependency AFTER checking pending promises
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

      // Create and store the promise
      const resolutionPromise = this.middlewarePipeline.execute(
        middlewareContext,
        () => this.resolveAsyncInternal(token)
      );

      this.pendingPromises.set(token, resolutionPromise);

      // Resolve through async middleware pipeline
      const result = await resolutionPromise;

      // Cache the result
      if (this.resolutionState) {
        this.resolutionState.resolved.set(token, result);
      }

      // Emit after resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.AfterResolve, {
        token,
        instance: result,
        context: middlewareContext
      });

      // Execute afterResolve hooks (async for async resolution)
      await this.pluginManager.executeHooks('afterResolve', token, result, middlewareContext);

      // For successful resolution, only delete promise for non-singletons
      // Singletons keep the promise to return the same result for concurrent calls
      const registration = this.getRegistration(token);
      if (!registration || registration.scope !== Scope.Singleton) {
        this.pendingPromises.delete(token);
      }

      return result;
    } catch (error: any) {
      // Emit resolve failed event
      this.lifecycleManager.emitSync(LifecycleEvent.ResolveFailed, {
        token,
        error,
        context: middlewareContext
      });

      // Execute onError hooks (async for async resolution)
      await this.pluginManager.executeHooks('onError', error, token, middlewareContext);

      // On error, always delete the pending promise
      this.pendingPromises.delete(token);

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

    // Check if already instantiated in registration (for singletons)
    if (registration.scope === Scope.Singleton && registration.instance !== undefined) {
      return registration.instance;
    }

    // Resolve dependencies
    const dependencies = await this.resolveAsyncDependencies(registration);

    // Create instance with timeout and retry support
    let instance: T;
    try {
      // Check if this is an async provider before calling factory
      const asyncProvider = registration.provider as FactoryProvider<T>;
      const isAsync = registration.isAsync || (asyncProvider.useFactory && asyncProvider.useFactory.constructor.name === 'AsyncFunction');

      if (isAsync) {
        // Apply retry logic if specified
        if (asyncProvider.retry) {
          const operationWithTimeout = async () => {
            // Re-resolve dependencies on each retry attempt (in case they have changed)
            const freshDependencies = await this.resolveAsyncDependencies(registration);
            let result = registration.factory!(...freshDependencies);

            // Apply timeout to individual attempts if specified
            if (asyncProvider.timeout && asyncProvider.timeout > 0) {
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Async resolution timeout')), asyncProvider.timeout);
              });
              result = Promise.race([result, timeoutPromise]);
            }

            return await result;
          };

          instance = await this.applyRetryLogic(
            operationWithTimeout,
            asyncProvider.retry.maxAttempts,
            asyncProvider.retry.delay
          );
        } else {
          // Single attempt with optional timeout
          let factoryResult = registration.factory!(...dependencies);

          // Apply timeout if specified (no retry)
          if (asyncProvider.timeout && asyncProvider.timeout > 0) {
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Async resolution timeout')), asyncProvider.timeout);
            });
            factoryResult = Promise.race([factoryResult, timeoutPromise]);
          }

          instance = await factoryResult;
        }
      } else {
        // Synchronous factory
        instance = registration.factory!(...dependencies);
      }
    } catch (error: any) {
      // Use AsyncResolutionError for async context
      const wrappedError = new AsyncResolutionError(token);
      (wrappedError as any).cause = error;
      (wrappedError as any).message = error.message; // Preserve original message for test compatibility
      throw wrappedError;
    }

    // Handle async class providers with onInit lifecycle
    if (this.isAsyncInitializable(instance)) {
      try {
        await instance.onInit();
      } catch (error: any) {
        const wrappedError = new AsyncResolutionError(token);
        (wrappedError as any).cause = error;
        (wrappedError as any).message = `Failed to initialize async instance '${getTokenName(token)}': ${error.message}`;
        throw wrappedError;
      }
    }

    // Initialize if needed (sync initialization)
    if (this.isInitializable(instance)) {
      await instance.initialize();
    }

    // Track instances for lifecycle management
    if (instance && typeof (instance as any).onInit === 'function') {
      this.initializableInstances.add(instance);
    }

    if (instance && (typeof (instance as any).onDestroy === 'function' || this.isDisposable(instance))) {
      this.disposableInstances.add(instance);
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
        // Check for circular dependency in async context too
        if (this.resolutionState?.chain.includes(dep)) {
          throw new CircularDependencyError([...this.resolutionState.chain, dep]);
        }

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
      if (error instanceof DependencyNotFoundError || error instanceof ResolutionError) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Register stream provider
   */
  registerStream<T>(token: InjectionToken<AsyncIterable<T>>, provider: ProviderDefinition<AsyncIterable<T>>, options: RegistrationOptions = {}): this {
    // If streaming options are provided, wrap the provider with stream processing
    if ((provider as any).filter || (provider as any).batch) {
      const originalProvider = provider;
      const streamOptions = {
        filter: (provider as any).filter,
        batch: (provider as any).batch
      };

      // Create a new provider that applies filtering and batching
      const wrappedProvider: ProviderDefinition<AsyncIterable<T>> = {
        ...originalProvider,
        useFactory: (...args: any[]): AsyncIterable<T> => {
          const originalStream = (originalProvider as any).useFactory(...args);
          return this.applyStreamProcessing(originalStream, streamOptions) as AsyncIterable<T>;
        }
      } as ProviderDefinition<AsyncIterable<T>>;

      // Remove the streaming options from the provider before registering
      delete (wrappedProvider as any).filter;
      delete (wrappedProvider as any).batch;

      return this.register(token, wrappedProvider, options);
    }

    return this.register(token, provider, options);
  }

  /**
   * Resolve stream
   */
  resolveStream<T>(token: InjectionToken<AsyncIterable<T>>): AsyncIterable<T> {
    return this.resolve(token);
  }

  /**
   * Resolve multiple tokens in parallel
   */
  async resolveParallel<T>(tokens: InjectionToken<T>[]): Promise<T[]> {
    const promises = tokens.map(token => this.resolveAsync(token));
    return Promise.all(promises);
  }

  /**
   * Resolve multiple tokens in parallel with settled results
   */
  async resolveParallelSettled<T>(tokens: InjectionToken<T>[]): Promise<Array<{ status: 'fulfilled', value: T } | { status: 'rejected', reason: any }>> {
    const promises = tokens.map(async (token) => {
      try {
        const value = await this.resolveAsync(token);
        return { status: 'fulfilled' as const, value };
      } catch (reason: any) {
        return { status: 'rejected' as const, reason };
      }
    });
    return Promise.all(promises);
  }

  /**
   * Resolve multiple tokens in batch with timeout
   * Supports both array and object map formats
   */
  async resolveBatch<T extends Record<string, InjectionToken<any>> | InjectionToken<any>[]>(
    tokens: T,
    options: { timeout?: number; failFast?: boolean } = {}
  ): Promise<T extends InjectionToken<any>[] ? any[] : { [K in keyof T]: T[K] extends InjectionToken<infer V> ? V | undefined : never }> {
    const { timeout = 5000, failFast = false } = options;

    // Handle object map format
    if (!Array.isArray(tokens)) {
      const keys = Object.keys(tokens);
      const tokenArray = keys.map(key => (tokens as any)[key]);

      const resolvePromise = Promise.allSettled(
        tokenArray.map(token =>
          timeout > 0 ?
            Promise.race([
              this.resolveAsync(token),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), timeout)
              )
            ]) :
            this.resolveAsync(token)
        )
      ).then(results => {
        const resultObj: any = {};
        keys.forEach((key, index) => {
          const result = results[index];
          resultObj[key] = result && result.status === 'fulfilled' ? (result as PromiseFulfilledResult<any>).value : undefined;
        });
        return resultObj;
      });

      return resolvePromise as any;
    }

    // Handle array format
    const resolvePromise = failFast ?
      this.resolveParallel(tokens) :
      this.resolveParallelSettled(tokens).then(results =>
        results.map(result => {
          if (result.status === 'rejected') {
            throw result.reason;
          }
          return result.value;
        })
      );

    if (timeout > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Batch resolution timed out after ${timeout}ms`)), timeout);
      });

      return Promise.race([resolvePromise, timeoutPromise]) as any;
    }

    return resolvePromise as any;
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
   * Create a child container (alias for createScope)
   */
  createChildContainer(context: Partial<ResolutionContext> = {}): IContainer {
    return this.createScope(context);
  }

  /**
   * Resolve all instances of a multi-registered token
   */
  resolveAll<T>(token: InjectionToken<T>): T[] {
    this.checkDisposed();

    const results: T[] = [];

    // Get all registrations for this token
    const registration = this.registrations.get(token);

    if (registration) {
      if (Array.isArray(registration)) {
        // Multiple registrations - resolve each one
        for (const reg of registration) {
          try {
            const instance = this.resolveRegistration(reg);
            if (instance !== undefined) {
              results.push(instance);
            }
          } catch (error) {
            // Skip failed resolutions for multi-injection
            console.warn(`Failed to resolve one instance of ${String(token)}:`, error);
          }
        }
      } else if (registration.options?.multi) {
        // Single registration marked as multi
        const instance = this.resolveRegistration(registration);
        if (instance !== undefined) {
          results.push(instance);
        }
      } else {
        // Regular single registration
        const instance = this.resolveRegistration(registration);
        if (instance !== undefined) {
          results.push(instance);
        }
      }
    }

    // Also check parent container
    if (this.parent && 'resolveAll' in this.parent && typeof this.parent.resolveAll === 'function') {
      const parentResults = this.parent.resolveAll(token);
      results.push(...parentResults);
    }

    return results;
  }

  /**
   * Resolve a single registration
   */
  private resolveRegistration(registration: Registration): any {
    // Handle different scopes
    if (registration.scope === Scope.Singleton) {
      // For multi-injection with useValue, don't use the shared instances cache
      // Each registration should return its own value
      if (registration.options?.multi && 'useValue' in registration.provider) {
        return (registration.provider as any).useValue;
      }

      if (this.instances.has(registration.token)) {
        return this.instances.get(registration.token);
      }
      const instance = this.createInstance(registration);
      this.instances.set(registration.token, instance);
      return instance;
    } else if (registration.scope === Scope.Transient) {
      return this.createInstance(registration);
    } else if (registration.scope === Scope.Scoped || registration.scope === Scope.Request) {
      const scopeKey = this.context.scope || 'default';
      let scopedMap = this.scopedInstances.get(scopeKey);
      if (!scopedMap) {
        scopedMap = new Map();
        this.scopedInstances.set(scopeKey, scopedMap);
      }
      if (scopedMap.has(registration.token)) {
        return scopedMap.get(registration.token);
      }
      const instance = this.createInstance(registration);
      scopedMap.set(registration.token, instance);
      return instance;
    }
    return this.createInstance(registration);
  }

  /**
   * Create a child scope
   */
  createScope(context: Partial<ResolutionContext> = {}): IContainer {
    this.checkDisposed();

    // Generate unique scope ID with a counter to ensure uniqueness even within same millisecond
    const uniqueId = `scope-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newContext = {
      ...this.context,
      ...context,
      metadata: {
        ...(this.context.metadata || {}),
        ...(context.metadata || {}),
        scopeId: context.metadata?.['scopeId'] || uniqueId,
        requestId: context.metadata?.['requestId'] || context['request']?.id
      }
    };

    return new Container(this, newContext);
  }

  /**
   * Load a module
   */
  loadModule(module: IModule): this {
    return this.loadModuleInternal(module, new Set(), false);
  }

  /**
   * Internal module loading with circular dependency detection
   */
  private loadModuleInternal(module: IModule, loadingStack: Set<string>, hasForwardRefs = false): this {
    this.checkDisposed();

    // Check if already loaded
    if (this.modules.has(module.name)) {
      return this;
    }

    // Note: Circular dependency detection is now done in the imports processing loop
    // to better handle forward references

    // Add to loading stack
    loadingStack.add(module.name);

    // Validate required modules
    if (module.requires) {
      for (const requiredModule of module.requires) {
        if (!this.modules.has(requiredModule)) {
          throw new Error(`Required module not found: ${requiredModule}`);
        }
      }
    }

    // Load imports first and track import relationships
    if (module.imports) {
      if (!this.moduleImports.has(module.name)) {
        this.moduleImports.set(module.name, new Set());
      }

      for (const imported of module.imports) {
        const { module: resolvedImport, isForwardRef } = this.resolveModule(imported);
        const newHasForwardRefs = hasForwardRefs || isForwardRef;

        // Check if this creates a circular dependency (but allow if any forward refs are involved)
        if (!newHasForwardRefs && loadingStack.has(resolvedImport.name)) {
          throw new Error(`Circular module dependency detected: ${Array.from(loadingStack).join(' -> ')} -> ${resolvedImport.name}`);
        }

        // Skip loading if already in the loading stack (forward reference cycle)
        if (!loadingStack.has(resolvedImport.name)) {
          this.loadModuleInternal(resolvedImport, loadingStack, newHasForwardRefs);
        }

        // Track that this module imports the other module
        this.moduleImports.get(module.name)!.add(resolvedImport.name);
      }
    }

    // Register providers in two passes:
    // First pass: register all non-conditional providers
    // Second pass: evaluate and register conditional providers
    if (module.providers) {
      const conditionalProviders: Array<{ token: any; providerObj: any }> = [];

      // First pass: non-conditional providers
      for (const provider of module.providers) {
        let token: any;
        let providerObj: any;

        if (Array.isArray(provider) && provider.length === 2) {
          // Handle [token, provider] tuples
          token = provider[0];
          providerObj = provider[1];
        } else if (typeof provider === 'function') {
          // Auto-register class providers
          token = provider;
          providerObj = { useClass: provider };
        } else if (provider && typeof provider === 'object' && 'provide' in provider) {
          // Handle provider objects with 'provide' property (NestJS style)
          token = provider.provide;
          // Extract the actual provider configuration (without the 'provide' field)
          providerObj = {};
          if ('useValue' in provider) providerObj.useValue = provider.useValue;
          if ('useClass' in provider) providerObj.useClass = provider.useClass;
          if ('useFactory' in provider) providerObj.useFactory = provider.useFactory;
          if ('useToken' in provider) providerObj.useToken = provider.useToken;
          if ('inject' in provider) providerObj.inject = provider.inject;
          if ('scope' in provider) providerObj.scope = provider.scope;
        } else {
          // Try to handle it as a provider object that might be converted from the test format
          throw new Error('Module provider must be either [token, provider] tuple, a class constructor, or a provider object with "provide" property');
        }

        // Check if it's conditional
        if (providerObj && typeof providerObj === 'object' && providerObj.conditional) {
          // Save for second pass
          conditionalProviders.push({ token, providerObj });
        } else {
          // Register immediately with module context
          // If provider has inject dependencies, wrap factory to set module context
          if (providerObj.useFactory && providerObj.inject) {
            const originalFactory = providerObj.useFactory;
            const moduleName = module.name;
            providerObj.useFactory = (...args: any[]) => {
              const prevModule = (this.context as any).__resolvingModule;
              try {
                (this.context as any).__resolvingModule = moduleName;
                return originalFactory(...args);
              } finally {
                (this.context as any).__resolvingModule = prevModule;
              }
            };
          }
          this.register(token, providerObj);
        }
      }

      // Track all providers (both conditional and non-conditional) for export filtering
      if (!this.moduleProviders) {
        this.moduleProviders = new Map();
      }
      if (!this.moduleProviders.has(module.name)) {
        this.moduleProviders.set(module.name, new Map());
      }

      // Track all non-conditional providers
      for (const provider of module.providers) {
        let token: any;
        let isConditional = false;

        // Extract token from different provider formats
        if (Array.isArray(provider) && provider.length === 2) {
          // Handle [token, provider] tuples
          token = provider[0];
          isConditional = provider[1] && typeof provider[1] === 'object' && (provider[1] as any).conditional;
        } else if (typeof provider === 'function') {
          // Class constructor
          token = provider;
        } else if (provider && typeof provider === 'object' && 'provide' in provider) {
          // Provider object with 'provide' property (NestJS style)
          token = provider.provide;
          isConditional = (provider as any).conditional;
        } else {
          continue; // Skip unknown provider format
        }

        // Skip if it's a conditional provider (will be tracked separately)
        if (isConditional) {
          continue;
        }

        // Check if token is exported
        // If exports is undefined, all providers are exported by default
        // If exports is defined (even as empty array), only specified tokens are exported
        const isExported = module.exports === undefined || module.exports.some(exportedToken => this.getTokenKey(exportedToken) === this.getTokenKey(token));

        const tokenKey = this.getTokenKey(token);
        this.moduleProviders.get(module.name)!.set(tokenKey, {
          token,
          exported: isExported,
          global: module.global || false
        });
      }

      // Second pass: conditional providers
      for (const { token, providerObj } of conditionalProviders) {
        const condition = providerObj.condition;
        const originalProvider = providerObj.originalProvider;

        // Check if token is exported
        // If exports is undefined, all providers are exported by default
        // If exports is defined (even as empty array), only specified tokens are exported
        const isExported = module.exports === undefined || module.exports.some(exportedToken => this.getTokenKey(exportedToken) === this.getTokenKey(token));

        const tokenKey = this.getTokenKey(token);

        // Track the provider even if condition is not met
        this.moduleProviders.get(module.name)!.set(tokenKey, {
          token,
          exported: isExported,
          global: module.global || false
        });

        // Temporarily mark we're resolving from this module to allow internal access
        const previousModule = (this.context as any).__resolvingModule;
        (this.context as any).__resolvingModule = module.name;

        try {
          // Evaluate condition
          if (condition && condition(this)) {
            // Condition met, use the original provider
            this.register(token, originalProvider);
          }
          // If condition not met, don't register
        } finally {
          // Restore previous module context
          (this.context as any).__resolvingModule = previousModule;
        }
      }
    }

    // Handle re-exports: if module exports a token it doesn't provide but imports from another module
    if (module.exports) {
      for (const exportedToken of module.exports) {
        const tokenKey = this.getTokenKey(exportedToken);

        // Check if this module provides the token
        const providesToken = this.moduleProviders?.get(module.name)?.has(tokenKey);

        if (!providesToken) {
          // This is a re-export, find which imported module provides it
          for (const importedModuleName of this.moduleImports.get(module.name) || []) {
            const importedProviders = this.moduleProviders?.get(importedModuleName);

            if (importedProviders?.has(tokenKey)) {
              const providerInfo = importedProviders.get(tokenKey)!;

              if (providerInfo.exported || providerInfo.global) {
                // Re-export: mark this token as exported from the current module too
                if (!this.moduleProviders!.get(module.name)!.has(tokenKey)) {
                  this.moduleProviders!.get(module.name)!.set(tokenKey, {
                    token: exportedToken,
                    exported: true,
                    global: false
                  });
                }
              }
            }
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

    // Remove from loading stack
    loadingStack.delete(module.name);

    return this;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.checkDisposed();

    // Clear singleton instances except values
    for (const [, registration] of this.registrations) {
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
      const scopeId = this.context.metadata?.['scopeId'];
      if (scopeId) {
        (this.parent as any).scopedInstances.delete(scopeId);
      }
    }
  }

  /**
   * Initialize container and call onInit on all resolved instances
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.initialized = true;

    // Initialize all initializable instances that have been resolved
    const initPromises: Promise<void>[] = [];

    for (const instance of this.initializableInstances) {
      if (instance && typeof instance.onInit === 'function') {
        try {
          const result = instance.onInit();
          if (result instanceof Promise) {
            initPromises.push(result);
          }
        } catch (error: any) {
          console.error(`Failed to initialize instance:`, error);
          throw error;
        }
      }
    }

    // Wait for all async initializations
    if (initPromises.length > 0) {
      const results = await Promise.allSettled(initPromises);
      // Check for any rejected promises
      const rejected = results.find(r => r.status === 'rejected');
      if (rejected && rejected.status === 'rejected') {
        throw rejected.reason;
      }
    }

    // Emit container initialized event
    this.lifecycleManager.emitSync(LifecycleEvent.ContainerInitialized, { context: this.context });
  }

  /**
   * Dispose container
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    // Dispose modules in reverse dependency order
    const moduleDisposeOrder = this.getModuleDisposeOrder();
    for (const moduleName of moduleDisposeOrder) {
      const module = this.modules.get(moduleName);
      if (module?.onModuleDestroy) {
        try {
          await module.onModuleDestroy();
        } catch (error: any) {
          console.error(`Failed to destroy module ${module.name}:`, error);
        }
      }
    }

    // Dispose instances in reverse order (dispose dependents before dependencies)
    const disposableEntries = Array.from(this.instances.entries()).reverse();

    for (const [token, instance] of disposableEntries) {
      // Call onDestroy lifecycle hook first
      if (instance && typeof instance.onDestroy === 'function') {
        try {
          const result = instance.onDestroy();
          if (result instanceof Promise) {
            await result;
          }
        } catch (error: any) {
          console.error(`Failed to call onDestroy for ${getTokenName(token)}:`, error);
        }
      }

      // Then call dispose if available
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
      const scopedEntries = Array.from(scopeCache.entries()).reverse();

      for (const [token, instance] of scopedEntries) {
        // Call onDestroy lifecycle hook first
        if (instance && typeof instance.onDestroy === 'function') {
          try {
            const result = instance.onDestroy();
            if (result instanceof Promise) {
              await result;
            }
          } catch (error: any) {
            console.error(`Failed to call onDestroy for scoped ${getTokenName(token)}:`, error);
          }
        }

        // Then call dispose if available
        if (this.isDisposable(instance)) {
          try {
            await instance.dispose();
          } catch (error: any) {
            console.error(`Failed to dispose scoped ${getTokenName(token)}:`, error);
          }
        }
      }
    }

    // Dispose plugins (will uninstall them and clear intervals)
    await this.pluginManager.dispose();

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
   * Resolve a forward reference or return the module as-is
   */
  private resolveModule(moduleOrRef: any): { module: IModule; isForwardRef: boolean } {
    // Check if it's a forward reference (function that returns a module)
    if (typeof moduleOrRef === 'function' && !moduleOrRef.name) {
      return { module: moduleOrRef(), isForwardRef: true };
    }
    return { module: moduleOrRef, isForwardRef: false };
  }

  /**
   * Get module dispose order (reverse dependency order)
   */
  private getModuleDisposeOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (moduleName: string) => {
      if (visited.has(moduleName)) return;
      visited.add(moduleName);

      // Visit all modules that depend on this module first
      for (const [otherModuleName, imports] of this.moduleImports.entries()) {
        if (imports.has(moduleName)) {
          visit(otherModuleName);
        }
      }

      // Add this module to the order (dependents are added first)
      order.push(moduleName);
    };

    // Visit all modules
    for (const moduleName of this.modules.keys()) {
      visit(moduleName);
    }

    return order;
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
   * Check if async initializable (has onInit method)
   */
  private isAsyncInitializable(instance: any): instance is { onInit(): Promise<void> } {
    return instance && typeof instance.onInit === 'function';
  }

  /**
   * Apply retry logic to async operations
   */
  private async applyRetryLogic<T>(
    operation: () => Promise<T>,
    maxAttempts: number,
    delay: number
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxAttempts) {
          break;
        }

        // Wait before retrying
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Install a plugin
   */
  use(plugin: Plugin): this {
    this.pluginManager.install(plugin);

    // Note: Plugin hooks are now handled entirely via the plugin manager's executeHooks system
    // to avoid conflicts and double execution. The lifecycle events are separate from plugin hooks.

    return this;
  }

  /**
   * Check if a plugin is installed
   */
  hasPlugin(pluginName: string): boolean {
    return this.pluginManager.hasPlugin(pluginName);
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
    // For plugin manager hooks that can modify values
    if (event === 'afterResolve') {
      this.pluginManager.addHook('afterResolve', handler as any);
      return this;
    }

    // Map common plugin hook names to lifecycle events with parameter mapping
    const eventMap: { [key: string]: { event: LifecycleEvent; wrapper: (data: any) => any[] } } = {
      'beforeResolve': {
        event: LifecycleEvent.BeforeResolve,
        wrapper: (data) => [data.token, data.context]
      },
      'afterResolve': {
        event: LifecycleEvent.AfterResolve,
        wrapper: (data) => [data.token, data.instance, data.context]
      },
      'beforeRegister': {
        event: LifecycleEvent.BeforeRegister,
        wrapper: (data) => [data.token, data.metadata?.provider]
      },
      'afterRegister': {
        event: LifecycleEvent.AfterRegister,
        wrapper: (data) => [data.token]
      },
      'onError': {
        event: LifecycleEvent.ResolveFailed,
        wrapper: (data) => [data.error, data.token, data.context]
      },
      'onDispose': {
        event: LifecycleEvent.ContainerDisposing,
        wrapper: () => []
      }
    };

    const mapping = eventMap[event];
    if (mapping) {
      // Still add to lifecycle manager for non-modifying hooks
      if (event !== 'afterResolve') {
        this.lifecycleManager.on(mapping.event, (data) => {
          const args = mapping.wrapper(data);
          return handler(...args);
        });
      }

      // Add to plugin manager for all hooks
      this.pluginManager.addHook(event as any, handler as any);
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
      // Extract provider definition (without 'provide' field) from Provider
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { provide, ...providerDefinition } = provider as any;
      this.register(token, providerDefinition as ProviderDefinition<any>);
    }

    // Store module reference
    (moduleRef as any).container = this;

    // Emit module loaded event
    this.lifecycleManager.emitSync(LifecycleEvent.ModuleLoaded, {
      metadata: { moduleName: moduleRef.name }
    });

    return this;
  }

  /**
   * Create a lazy proxy that only resolves the dependency when accessed
   */
  resolveLazy<T>(token: InjectionToken<T>): T {
    let instance: T | undefined;
    let error: Error | undefined;

    const handler: ProxyHandler<any> = {
      get: (target, prop) => {
        if (error) {
          throw error;
        }

        if (instance === undefined) {
          try {
            instance = this.resolve(token);
          } catch (e) {
            error = e instanceof Error ? e : new Error(String(e));
            throw error;
          }
        }

        if (instance && typeof instance === 'object') {
          const value = (instance as any)[prop];
          return typeof value === 'function' ? value.bind(instance) : value;
        }

        return (instance as any)[prop];
      }
    };

    return new Proxy({}, handler) as T;
  }

  /**
   * Create an async lazy proxy that only resolves the dependency when accessed
   */
  async resolveLazyAsync<T>(token: InjectionToken<T>): Promise<T> {
    let instance: T | undefined;
    let error: Error | undefined;

    const handler: ProxyHandler<any> = {
      get: (target, prop) => {
        if (error) {
          throw error;
        }

        if (instance === undefined) {
          // For async lazy, we need to return a promise
          return this.resolveAsync(token).then(resolved => {
            instance = resolved;
            if (instance && typeof instance === 'object') {
              const value = (instance as any)[prop];
              return typeof value === 'function' ? value.bind(instance) : value;
            }
            return (instance as any)[prop];
          }).catch(e => {
            error = e instanceof Error ? e : new Error(String(e));
            throw error;
          });
        }

        if (instance && typeof instance === 'object') {
          const value = (instance as any)[prop];
          return typeof value === 'function' ? value.bind(instance) : value;
        }

        return (instance as any)[prop];
      }
    };

    return new Proxy({}, handler) as T;
  }

  /**
   * Apply stream processing options like filtering and batching
   */
  private async* applyStreamProcessing<T>(
    stream: AsyncIterable<T>,
    options: { filter?: (value: T) => boolean; batch?: { size: number } }
  ): AsyncIterable<T | T[]> {
    const { filter, batch } = options;

    if (batch) {
      // Apply batching
      let currentBatch: T[] = [];

      for await (const item of stream) {
        if (!filter || filter(item)) {
          currentBatch.push(item);

          if (currentBatch.length >= batch.size) {
            yield currentBatch as any;
            currentBatch = [];
          }
        }
      }

      // Yield remaining items in batch
      if (currentBatch.length > 0) {
        yield currentBatch as any;
      }
    } else if (filter) {
      // Apply filtering only
      for await (const item of stream) {
        if (filter(item)) {
          yield item;
        }
      }
    } else {
      // No processing, just pass through
      for await (const item of stream) {
        yield item;
      }
    }
  }

  /**
   * Get a consistent key for a token to use in Maps
   */
  private getTokenKey(token: InjectionToken<any>): string {
    if (typeof token === 'string') {
      return token;
    } else if (typeof token === 'symbol') {
      return token.toString();
    } else if (typeof token === 'function') {
      // For constructors, use the constructor name
      return token.name || token.toString();
    } else if (token && typeof token === 'object') {
      // For token objects, use the name property
      if ('name' in token) {
        return (token as any).name;
      }
    }
    // Fallback to string representation
    return String(token);
  }
}