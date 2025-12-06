/**
 * Core container implementation for Nexus DI
 *
 * This is the main facade that delegates to internal services for:
 * - Registration (registration.ts)
 * - Factory creation (factory.ts)
 * - Resolution (resolution.ts)
 * - Scoping (scoping.ts)
 * - Async resolution (async-resolution.ts)
 * - Module loading (module-loader.ts)
 * - Lifecycle management (lifecycle.ts)
 *
 * @stable
 * @since 0.1.0
 */

import { ModuleCompiler } from './module.js';
import { Plugin, PluginManager } from './plugin.js';
import { ContextManager, ContextProvider } from './context.js';
import { LifecycleEvent, LifecycleManager } from './lifecycle.js';
import { isToken, isMultiToken, getTokenName, isOptionalToken, createToken } from './token.js';
import { Middleware, MiddlewareContext, MiddlewarePipeline } from './middleware.js';
import { isConstructor } from './provider-utils.js';
import {
  DisposalError,
  ResolutionError,
  AsyncResolutionError,
  InvalidProviderError,
  ContainerDisposedError,
  CircularDependencyError,
  DependencyNotFoundError,
  DuplicateRegistrationError,
} from './errors.js';
import { Errors, toTitanError } from '../errors/factories.js';
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
  ResolutionState,
  ContainerMetadata,
  RegistrationOptions,
  FactoryProvider,
  ConfigToken,
  isConfigToken,
  ResolutionContextInternal,
  DependencyDescriptor,
  isDependencyDescriptor,
  ConditionalProviderWithWhen,
  StreamProviderOptions,
  hasStreamOptions,
} from './types.js';

// Import internal services
import {
  Registration,
  ModuleProviderInfo,
  RegistrationService,
  FactoryService,
  ResolutionService,
  ScopingService,
  AsyncResolutionService,
  ModuleLoaderService,
  LifecycleService,
  generateResolutionId,
} from './container/index.js';

/**
 * The main dependency injection container for Nexus DI.
 * Manages registration, resolution, and lifecycle of dependencies.
 *
 * @stable
 * @since 0.1.0
 *
 * @example
 * ```typescript
 * const container = new Container();
 * container.register(MyService, { useClass: MyServiceImpl });
 * const service = container.resolve(MyService);
 * ```
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
  private moduleProviders?: Map<string, Map<string, ModuleProviderInfo>>;
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

  // Internal services
  private registrationService: RegistrationService;
  private factoryService: FactoryService;
  private resolutionService: ResolutionService;
  private scopingService: ScopingService;
  private asyncResolutionService: AsyncResolutionService;
  private moduleLoaderService: ModuleLoaderService;
  private lifecycleService: LifecycleService;

  constructor(parentOrOptions?: IContainer | { environment?: string }, context: Partial<ResolutionContext> = {}) {
    // Initialize internal services
    this.registrationService = new RegistrationService();
    this.factoryService = new FactoryService();
    this.resolutionService = new ResolutionService();
    this.scopingService = new ScopingService();
    this.asyncResolutionService = new AsyncResolutionService();
    this.moduleLoaderService = new ModuleLoaderService();
    this.lifecycleService = new LifecycleService();

    // Handle different constructor signatures
    if (parentOrOptions && typeof parentOrOptions === 'object' && 'environment' in parentOrOptions) {
      // Called with options { environment: 'production' }
      this.parent = undefined;
      this.context = {
        container: this,
        scope: Scope.Singleton,
        environment: parentOrOptions.environment,
        ...context,
      };
    } else {
      // Called with parent container
      const parent = parentOrOptions as IContainer | undefined;
      this.parent = parent;
      this.context = {
        container: this,
        scope: Scope.Singleton,
        parent: parent ? ({ container: parent } as ResolutionContext) : undefined,
        ...context,
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

    // Process config token validation and defaults
    provider = this.registrationService.processConfigToken(token, provider);

    // Handle multi-token registration
    if (isMultiToken(token) || options.multi) {
      return this.registerMulti(token, provider, options);
    }

    // Check for duplicate registration (allow multi-registration if multi option is set)
    if (this.registrations.has(token) && !options.override && !options.multi) {
      throw new DuplicateRegistrationError(token);
    }

    const registration = this.registrationService.createRegistration(
      token,
      provider,
      options,
      this.registrations,
      (t, p) => this.createFactory(t, p)
    );

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
      metadata: { provider, registration },
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
    const registration = this.registrationService.createRegistration(
      token,
      provider,
      options,
      this.registrations,
      (t, p) => this.createFactory(t, p)
    );

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
      metadata: { provider, registration },
    });

    return this;
  }

  /**
   * Create a factory function from a provider
   */
  private createFactory(token: InjectionToken<any>, provider: ProviderDefinition<any>): (...args: any[]) => any {
    return this.factoryService.createFactory(
      token,
      provider,
      this.context,
      (t) => this.resolve(t)
    );
  }

  /**
   * Resolve a dependency
   * Uses isolated resolution state to prevent race conditions in concurrent calls
   */
  resolve<T>(token: InjectionToken<T>, context?: any): T {
    this.checkDisposed();

    // Check if we're in a nested resolution (resolutionState already exists in context)
    const isTopLevel = !this.context.resolutionState;

    // Create isolated resolution state for top-level calls
    // Nested calls reuse the parent's resolution state
    const resolutionState: ResolutionState = isTopLevel
      ? { chain: [], resolved: new Map(), id: generateResolutionId() }
      : this.context.resolutionState!;

    // Store previous context and create new one with resolution state
    const previousContext = this.context;
    this.context = {
      ...this.context,
      resolutionState,
      ...(context ? { resolveContext: context } : {}),
    };

    try {
      // Emit before resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.BeforeResolve, {
        token,
        context: this.context,
      });

      // Execute plugin hooks
      this.pluginManager.executeHooksSync('beforeResolve', token, this.context);

      // Check for circular dependency using isolated state
      if (resolutionState.chain.includes(token)) {
        throw new CircularDependencyError([...resolutionState.chain, token]);
      }

      // Check resolution cache within this resolution tree
      if (resolutionState.resolved.has(token)) {
        const cached = resolutionState.resolved.get(token);
        this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { token });
        return cached;
      }

      // Add to resolution chain
      resolutionState.chain.push(token);

      // Create middleware context
      const middlewareContext: MiddlewareContext = {
        ...this.context,
        token,
        container: this,
        metadata: this.context.metadata || {},
        startTime: Date.now(),
      };

      // Resolve through middleware pipeline
      let result = this.middlewarePipeline.executeSync(middlewareContext, () => this.resolveInternal(token));

      // Execute afterResolve hooks which may modify the result
      result = this.pluginManager.executeHooksSync('afterResolve', token, result, this.context);

      // Cache the result in this resolution tree
      resolutionState.resolved.set(token, result);

      // Emit after resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.AfterResolve, {
        token,
        instance: result,
        context: this.context,
      });

      return result;
    } catch (error: any) {
      // Emit resolve failed event
      this.lifecycleManager.emitSync(LifecycleEvent.ResolveFailed, {
        token,
        error,
        context: this.context,
      });

      // Execute plugin error hooks
      this.pluginManager.executeHooksSync('onError', error, token, this.context);

      throw error;
    } finally {
      // Remove from resolution chain
      if (resolutionState.chain.length > 0) {
        resolutionState.chain.pop();
      }

      // Restore previous context (removes resolutionState for top-level calls)
      this.context = previousContext;
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
            return this.scopingService.resolveWithScope(
              parentRegistration,
              this.context,
              this.instances,
              this.scopedInstances,
              this.lifecycleManager,
              (reg) => this.createInstance(reg)
            );
          }
        }
        return this.parent.resolve(token);
      }

      // Check if optional
      if (isOptionalToken(token as any)) {
        return undefined as any;
      }

      // Provide resolution chain in error - use specific error for simple cases
      const chain = this.context.resolutionState?.chain || [];
      if (chain.length <= 1) {
        // Simple case - just token not found (chain length 1 means only current token)
        throw new DependencyNotFoundError(token);
      }
      // Complex case - resolution chain with dependency not found
      throw new ResolutionError(token, [...chain]);
    }

    // Check module exports
    this.resolutionService.checkModuleAccess(
      token,
      this.context,
      this.moduleProviders,
      this.moduleImports,
      (t) => this.getTokenKey(t),
      (tokenKey) => this.moduleLoaderService.getTokenModuleInfo(tokenKey)
    );

    // Check for async provider
    if (registration.isAsync) {
      const error = new AsyncResolutionError(token);
      (error as any).message = this.resolutionService.buildAsyncErrorMessage(
        token,
        registration,
        this.registrations
      );
      throw error;
    }

    // Resolve based on scope
    return this.scopingService.resolveWithScope(
      registration,
      this.context,
      this.instances,
      this.scopedInstances,
      this.lifecycleManager,
      (reg) => this.createInstance(reg)
    );
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
      const dependencies = this.resolutionService.resolveDependencies(
        registration,
        this.context,
        this.moduleProviders,
        (t) => this.getTokenKey(t),
        (t) => this.resolve(t),
        (t) => this.resolveOptional(t),
        (tokenKey) => this.moduleLoaderService.getTokenModuleInfo(tokenKey)
      );

      // Create instance
      const instance = registration.factory(...dependencies);

      // Apply property injections if it's a class instance
      if (instance && registration.provider && 'useClass' in registration.provider) {
        this.applyPropertyInjections(instance, registration.provider.useClass);
      }

      // Track instances for lifecycle management
      if (instance && typeof instance.onInit === 'function') {
        this.initializableInstances.add(instance);
      }

      if (instance && (typeof instance.onDestroy === 'function' || this.lifecycleService.isDisposable(instance))) {
        this.disposableInstances.add(instance);
      }

      // Emit instance created event
      this.lifecycleManager.emitSync(LifecycleEvent.InstanceCreated, {
        token: registration.token,
        instance,
        context: this.context,
      });

      // Initialize if needed (synchronous only - async init should be done via initialize() method)
      if (this.lifecycleService.isInitializable(instance)) {
        this.lifecycleManager.emitSync(LifecycleEvent.InstanceInitializing, {
          token: registration.token,
          instance,
          context: this.context,
        });

        const result = instance.initialize();
        if (result instanceof Promise) {
          throw new AsyncResolutionError(registration.token);
        }

        this.lifecycleManager.emitSync(LifecycleEvent.InstanceInitialized, {
          token: registration.token,
          instance,
          context: this.context,
        });
      }

      return instance;
    } catch (error: any) {
      if (
        error instanceof ResolutionError ||
        error instanceof AsyncResolutionError ||
        error instanceof CircularDependencyError ||
        error instanceof DependencyNotFoundError ||
        error instanceof ContainerDisposedError ||
        error instanceof InvalidProviderError ||
        error instanceof DuplicateRegistrationError ||
        error instanceof DisposalError
      ) {
        throw error;
      }
      // Factory errors should be wrapped as ResolutionError with chain
      const chain = this.context.resolutionState?.chain || [];
      throw new ResolutionError(registration.token, [...chain], error);
    }
  }

  /**
   * Apply property injections to an instance
   */
  private applyPropertyInjections(instance: any, classConstructor: Constructor | undefined): void {
    if (!classConstructor) return;

    const METADATA_KEYS = {
      PROPERTY_INJECTIONS: 'nexus:property:injections',
    };

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

  /**
   * Resolve async
   */
  async resolveAsync<T>(token: InjectionToken<T>): Promise<T> {
    this.checkDisposed();

    // Check if we're in a nested resolution (resolutionState already exists in context)
    const isTopLevel = !this.context.resolutionState;

    // Create isolated resolution state for top-level calls
    const resolutionState: ResolutionState = isTopLevel
      ? { chain: [], resolved: new Map(), id: generateResolutionId() }
      : this.context.resolutionState!;

    // Store previous context and create new one with resolution state
    const previousContext = this.context;
    this.context = {
      ...this.context,
      resolutionState,
    };

    // Create middleware context early so it's available in catch blocks
    const middlewareContext: MiddlewareContext = {
      ...this.context,
      token,
      container: this,
      metadata: this.context.metadata || {},
      startTime: Date.now(),
    };

    try {
      // Emit before resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.BeforeResolve, {
        token,
        context: this.context,
      });

      // Execute plugin hooks (async for async resolution)
      await this.pluginManager.executeHooks('beforeResolve', token, middlewareContext);

      // Check for pending promise (handles concurrent async resolutions of same token)
      if (this.pendingPromises.has(token)) {
        return this.pendingPromises.get(token)!;
      }

      // Check for circular dependency using isolated state
      if (resolutionState.chain.includes(token)) {
        throw new CircularDependencyError([...resolutionState.chain, token]);
      }

      // Check resolution cache within this resolution tree
      if (resolutionState.resolved.has(token)) {
        const cached = resolutionState.resolved.get(token);
        this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { token });
        return cached;
      }

      // Add to resolution chain
      resolutionState.chain.push(token);

      // Create and store the promise
      const resolutionPromise = this.middlewarePipeline.execute(middlewareContext, () =>
        this.resolveAsyncInternal(token)
      );

      this.pendingPromises.set(token, resolutionPromise);

      // Resolve through async middleware pipeline
      const result = await resolutionPromise;

      // Cache the result in this resolution tree
      resolutionState.resolved.set(token, result);

      // Emit after resolve event
      this.lifecycleManager.emitSync(LifecycleEvent.AfterResolve, {
        token,
        instance: result,
        context: middlewareContext,
      });

      // Execute afterResolve hooks (async for async resolution)
      await this.pluginManager.executeHooks('afterResolve', token, result, middlewareContext);

      // For successful resolution, only delete promise for non-singletons
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
        context: middlewareContext,
      });

      // Execute onError hooks (async for async resolution)
      await this.pluginManager.executeHooks('onError', error, token, middlewareContext);

      // On error, always delete the pending promise
      this.pendingPromises.delete(token);

      throw error;
    } finally {
      // Remove from resolution chain
      if (resolutionState.chain.length > 0) {
        resolutionState.chain.pop();
      }

      // Restore previous context
      this.context = previousContext;
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
    const dependencies = await this.asyncResolutionService.resolveAsyncDependencies(
      registration,
      this.context,
      this.moduleProviders,
      this.pendingPromises,
      this.registrations,
      (t) => this.getTokenKey(t),
      (t) => this.getRegistration(t),
      (t) => this.resolveAsyncInternal(t),
      (t) => this.parent?.has(t) ?? false,
      (tokenKey) => this.moduleLoaderService.getTokenModuleInfo(tokenKey)
    );

    // Create instance with timeout and retry support
    let instance: T;
    try {
      const asyncProvider = registration.provider as FactoryProvider<T>;
      const isAsync =
        registration.isAsync ||
        (asyncProvider.useFactory && asyncProvider.useFactory.constructor.name === 'AsyncFunction');

      if (isAsync) {
        // Apply retry logic if specified
        if (asyncProvider.retry) {
          const operationWithTimeout = async () => {
            // Re-resolve dependencies on each retry attempt
            const freshDependencies = await this.asyncResolutionService.resolveAsyncDependencies(
              registration,
              this.context,
              this.moduleProviders,
              this.pendingPromises,
              this.registrations,
              (t) => this.getTokenKey(t),
              (t) => this.getRegistration(t),
              (t) => this.resolveAsyncInternal(t),
              (t) => this.parent?.has(t) ?? false,
              (tokenKey) => this.moduleLoaderService.getTokenModuleInfo(tokenKey)
            );
            let result = registration.factory!(...freshDependencies);

            // Apply timeout to individual attempts if specified
            if (asyncProvider.timeout && asyncProvider.timeout > 0) {
              result = this.asyncResolutionService.applyTimeout(result, asyncProvider.timeout);
            }

            return await result;
          };

          instance = await this.asyncResolutionService.applyRetryLogic(
            operationWithTimeout,
            asyncProvider.retry.maxAttempts,
            asyncProvider.retry.delay
          );
        } else {
          // Single attempt with optional timeout
          let factoryResult = registration.factory!(...dependencies);

          if (asyncProvider.timeout && asyncProvider.timeout > 0) {
            factoryResult = this.asyncResolutionService.applyTimeout(factoryResult, asyncProvider.timeout);
          }

          instance = await factoryResult;
        }
      } else {
        // Synchronous factory
        instance = registration.factory!(...dependencies);
      }
    } catch (error: any) {
      const wrappedError = new AsyncResolutionError(token);
      (wrappedError as any).cause = error;
      (wrappedError as any).message = error.message;
      throw wrappedError;
    }

    // Handle async class providers with onInit lifecycle
    if (this.lifecycleService.isAsyncInitializable(instance)) {
      try {
        await instance.onInit();
      } catch (error: any) {
        const wrappedError = new AsyncResolutionError(token);
        (wrappedError as any).cause = error;
        (wrappedError as any).message =
          'Failed to initialize async instance \'' + getTokenName(token) + '\': ' + error.message;
        throw wrappedError;
      }
    }

    // Initialize if needed (sync initialization)
    if (this.lifecycleService.isInitializable(instance)) {
      await instance.initialize();
    }

    // Track instances for lifecycle management
    if (instance && typeof (instance as any).onInit === 'function') {
      this.initializableInstances.add(instance);
    }

    if (instance && (typeof (instance as any).onDestroy === 'function' || this.lifecycleService.isDisposable(instance))) {
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
    return regs.map((reg) => this.scopingService.resolveWithScope(
      reg,
      this.context,
      this.instances,
      this.scopedInstances,
      this.lifecycleManager,
      (r) => this.createInstance(r)
    ));
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
  registerStream<T>(
    token: InjectionToken<AsyncIterable<T>>,
    provider: ProviderDefinition<AsyncIterable<T>>,
    options: RegistrationOptions = {}
  ): this {
    // If streaming options are provided, wrap the provider with stream processing
    if (hasStreamOptions(provider)) {
      const originalProvider = provider;
      const streamOptions = {
        filter: (provider as any).filter,
        batch: (provider as any).batch,
      };

      // Create a new provider that applies filtering and batching
      const wrappedProvider: ProviderDefinition<AsyncIterable<T>> = {
        ...originalProvider,
        useFactory: (...args: any[]): AsyncIterable<T> => {
          const originalStream = (originalProvider as any).useFactory(...args);
          return this.applyStreamProcessing(originalStream, streamOptions) as AsyncIterable<T>;
        },
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
    const promises = tokens.map((token) => this.resolveAsync(token));
    return Promise.all(promises);
  }

  /**
   * Resolve multiple tokens in parallel with settled results
   */
  async resolveParallelSettled<T>(
    tokens: InjectionToken<T>[]
  ): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: any }>> {
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
   */
  async resolveBatch<T extends Record<string, InjectionToken<any>> | InjectionToken<any>[]>(
    tokens: T,
    options: { timeout?: number; failFast?: boolean } = {}
  ): Promise<
    T extends InjectionToken<any>[]
      ? any[]
      : { [K in keyof T]: T[K] extends InjectionToken<infer V> ? V | undefined : never }
  > {
    const { timeout = 5000, failFast = false } = options;

    // Handle object map format
    if (!Array.isArray(tokens)) {
      const keys = Object.keys(tokens);
      const tokenArray = keys.map((key) => (tokens as any)[key]);

      const resolvePromise = Promise.allSettled(
        tokenArray.map((token) =>
          timeout > 0
            ? Promise.race([
                this.resolveAsync(token),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(Errors.timeout('operation', timeout)), timeout)
                ),
              ])
            : this.resolveAsync(token)
        )
      ).then((results) => {
        const resultObj: any = {};
        keys.forEach((key, index) => {
          const result = results[index];
          resultObj[key] =
            result && result.status === 'fulfilled' ? (result as PromiseFulfilledResult<any>).value : undefined;
        });
        return resultObj;
      });

      return resolvePromise as any;
    }

    // Handle array format
    const resolvePromise = failFast
      ? this.resolveParallel(tokens)
      : this.resolveParallelSettled(tokens).then((results) =>
          results.map((result) => {
            if (result.status === 'rejected') {
              throw result.reason;
            }
            return result.value;
          })
        );

    if (timeout > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(Errors.timeout('batch resolution', timeout)), timeout);
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
    const registration = this.registrations.get(token);

    if (registration) {
      if (Array.isArray(registration)) {
        // Multiple registrations - resolve each one
        for (const reg of registration) {
          try {
            const instance = this.scopingService.resolveRegistration(
              reg,
              this.context,
              this.instances,
              this.scopedInstances,
              (r) => this.createInstance(r)
            );
            if (instance !== undefined) {
              results.push(instance);
            }
          } catch (error) {
            // Skip failed resolutions for multi-injection
            console.warn('Failed to resolve one instance of ' + String(token) + ':', error);
          }
        }
      } else if (registration.options?.multi) {
        // Single registration marked as multi
        const instance = this.scopingService.resolveRegistration(
          registration,
          this.context,
          this.instances,
          this.scopedInstances,
          (r) => this.createInstance(r)
        );
        if (instance !== undefined) {
          results.push(instance);
        }
      } else {
        // Regular single registration
        const instance = this.scopingService.resolveRegistration(
          registration,
          this.context,
          this.instances,
          this.scopedInstances,
          (r) => this.createInstance(r)
        );
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
   * Create a child scope
   */
  createScope(context: Partial<ResolutionContext> = {}): IContainer {
    this.checkDisposed();

    // Generate unique scope ID with a counter to ensure uniqueness
    const uniqueId = 'scope-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    const newContext = {
      ...this.context,
      ...context,
      metadata: {
        ...(this.context.metadata || {}),
        ...(context.metadata || {}),
        scopeId: context.metadata?.['scopeId'] || uniqueId,
        requestId: context.metadata?.['requestId'] || (context as any)['request']?.id,
      },
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

    // Add to loading stack
    loadingStack.add(module.name);

    // Validate required modules
    if (module.requires) {
      for (const requiredModule of module.requires) {
        if (!this.modules.has(requiredModule)) {
          throw Errors.notFound('Module', requiredModule);
        }
      }
    }

    // Load imports first and track import relationships
    if (module.imports) {
      if (!this.moduleImports.has(module.name)) {
        this.moduleImports.set(module.name, new Set());
      }

      for (const imported of module.imports) {
        const { module: resolvedImport, isForwardRef } = this.moduleLoaderService.resolveModule(imported);
        const newHasForwardRefs = hasForwardRefs || isForwardRef;

        // Check if this creates a circular dependency (but allow if any forward refs are involved)
        if (!newHasForwardRefs && loadingStack.has(resolvedImport.name)) {
          throw Errors.badRequest('Circular module dependency detected: ' + Array.from(loadingStack).join(' -> ') + ' -> ' + resolvedImport.name);
        }

        // Skip loading if already in the loading stack (forward reference cycle)
        if (!loadingStack.has(resolvedImport.name)) {
          this.loadModuleInternal(resolvedImport, loadingStack, newHasForwardRefs);
        }

        // Track that this module imports the other module
        this.moduleImports.get(module.name)!.add(resolvedImport.name);
      }
    }

    // Register providers in two passes
    if (module.providers) {
      const conditionalProviders: Array<{ token: any; providerObj: any }> = [];

      // First pass: non-conditional providers
      for (const provider of module.providers) {
        let token: any;
        let providerObj: any;

        if (Array.isArray(provider) && provider.length === 2) {
          token = provider[0];
          providerObj = provider[1];
        } else if (typeof provider === 'function') {
          token = provider;
          providerObj = { useClass: provider };
        } else if (provider && typeof provider === 'object' && 'provide' in provider) {
          token = provider.provide;
          providerObj = {};
          if ('useValue' in provider) providerObj.useValue = provider.useValue;
          if ('useClass' in provider) providerObj.useClass = provider.useClass;
          if ('useFactory' in provider) providerObj.useFactory = provider.useFactory;
          if ('useToken' in provider) providerObj.useToken = provider.useToken;
          if ('inject' in provider) providerObj.inject = provider.inject;
          if ('scope' in provider) providerObj.scope = provider.scope;
        } else {
          throw Errors.badRequest('Module provider must be either [token, provider] tuple, a class constructor, or a provider object with "provide" property');
        }

        // Check if it's conditional
        if (providerObj && typeof providerObj === 'object' && providerObj.conditional) {
          conditionalProviders.push({ token, providerObj });
        } else {
          // Register immediately with module context
          if (providerObj.useFactory && providerObj.inject) {
            const originalFactory = providerObj.useFactory;
            const moduleName = module.name;
            providerObj.useFactory = (...args: any[]) => {
              const prevModule = (this.context as ResolutionContextInternal).__resolvingModule;
              try {
                (this.context as ResolutionContextInternal).__resolvingModule = moduleName;
                return originalFactory(...args);
              } finally {
                (this.context as ResolutionContextInternal).__resolvingModule = prevModule;
              }
            };
          }
          this.register(token, providerObj);
        }
      }

      // Track all providers for export filtering
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

        if (Array.isArray(provider) && provider.length === 2) {
          token = provider[0];
          isConditional = provider[1] && typeof provider[1] === 'object' && (provider[1] as any).conditional;
        } else if (typeof provider === 'function') {
          token = provider;
        } else if (provider && typeof provider === 'object' && 'provide' in provider) {
          token = provider.provide;
          isConditional = (provider as any).conditional;
        } else {
          continue;
        }

        if (isConditional) {
          continue;
        }

        const isExported = this.moduleLoaderService.isTokenExported(module, token);
        this.moduleLoaderService.trackModuleProvider(
          module.name,
          token,
          isExported,
          module.global || false,
          this.moduleProviders
        );
      }

      // Second pass: conditional providers
      for (const { token, providerObj } of conditionalProviders) {
        const condition = providerObj.condition;
        const originalProvider = providerObj.originalProvider;

        const isExported = this.moduleLoaderService.isTokenExported(module, token);
        this.moduleLoaderService.trackModuleProvider(
          module.name,
          token,
          isExported,
          module.global || false,
          this.moduleProviders
        );

        // Temporarily mark we're resolving from this module
        const previousModule = (this.context as ResolutionContextInternal).__resolvingModule;
        (this.context as ResolutionContextInternal).__resolvingModule = module.name;

        try {
          if (condition && condition(this)) {
            this.register(token, originalProvider);
          }
        } finally {
          (this.context as ResolutionContextInternal).__resolvingModule = previousModule;
        }
      }
    }

    // Handle re-exports
    if (module.exports) {
      for (const exportedToken of module.exports) {
        const tokenKey = this.getTokenKey(exportedToken);
        const providesToken = this.moduleProviders?.get(module.name)?.has(tokenKey);

        if (!providesToken) {
          for (const importedModuleName of this.moduleImports.get(module.name) || []) {
            const importedProviders = this.moduleProviders?.get(importedModuleName);

            if (importedProviders?.has(tokenKey)) {
              const providerInfo = importedProviders.get(tokenKey)!;

              if (providerInfo.exported || providerInfo.global) {
                if (!this.moduleProviders!.get(module.name)!.has(tokenKey)) {
                  this.moduleProviders!.get(module.name)!.set(tokenKey, {
                    token: exportedToken,
                    exported: true,
                    global: false,
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
        result.catch((error) => {
          console.error('Failed to initialize module ' + module.name + ':', error);
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

    // Clear scoped instances
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

    await this.lifecycleService.initializeInstances(this.initializableInstances);

    // Emit container initialized event
    this.lifecycleManager.emitSync(LifecycleEvent.ContainerInitialized, { context: this.context });
  }

  /**
   * Dispose container
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    // Dispose modules in reverse dependency order
    const moduleDisposeOrder = this.moduleLoaderService.getModuleDisposeOrder(this.modules, this.moduleImports);
    await this.lifecycleService.disposeModules(this.modules, moduleDisposeOrder);

    // Dispose instances
    await this.lifecycleService.disposeInstances(this.instances, this.scopedInstances);

    // Dispose plugins
    await this.pluginManager.dispose();

    // Clear all caches
    this.registrations.clear();
    this.instances.clear();
    this.scopedInstances.clear();
    this.modules.clear();
    this.moduleLoaderService.clear();

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
      parent: this.parent as IContainer | undefined,
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
   * Get a consistent key for a token to use in Maps
   */
  private getTokenKey(token: InjectionToken<any>): string {
    return this.moduleLoaderService.getTokenKey(token);
  }

  /**
   * Install a plugin
   */
  use(plugin: Plugin): this {
    this.pluginManager.install(plugin);
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
      metadata: { middlewareName: middleware.name },
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
      beforeResolve: {
        event: LifecycleEvent.BeforeResolve,
        wrapper: (data) => [data.token, data.context],
      },
      afterResolve: {
        event: LifecycleEvent.AfterResolve,
        wrapper: (data) => [data.token, data.instance, data.context],
      },
      beforeRegister: {
        event: LifecycleEvent.BeforeRegister,
        wrapper: (data) => [data.token, data.metadata?.provider],
      },
      afterRegister: {
        event: LifecycleEvent.AfterRegister,
        wrapper: (data) => [data.token],
      },
      onError: {
        event: LifecycleEvent.ResolveFailed,
        wrapper: (data) => [data.error, data.token, data.context],
      },
      onDispose: {
        event: LifecycleEvent.ContainerDisposing,
        wrapper: () => [],
      },
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
      console.warn('Unknown hook event: ' + event);
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
      metadata: { moduleName: moduleRef.name },
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
      metadata: { moduleName: moduleRef.name },
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
            error = toTitanError(e);
            throw error;
          }
        }

        if (instance && typeof instance === 'object') {
          const value = (instance as any)[prop];
          return typeof value === 'function' ? value.bind(instance) : value;
        }

        return (instance as any)[prop];
      },
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
          return this.resolveAsync(token)
            .then((resolved) => {
              instance = resolved;
              if (instance && typeof instance === 'object') {
                const value = (instance as any)[prop];
                return typeof value === 'function' ? value.bind(instance) : value;
              }
              return (instance as any)[prop];
            })
            .catch((e) => {
              error = toTitanError(e);
              throw error;
            });
        }

        if (instance && typeof instance === 'object') {
          const value = (instance as any)[prop];
          return typeof value === 'function' ? value.bind(instance) : value;
        }

        return (instance as any)[prop];
      },
    };

    return new Proxy({}, handler) as T;
  }

  /**
   * Apply stream processing options like filtering and batching
   */
  private async *applyStreamProcessing<T>(
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
   * Auto-register a class based on its decorator metadata
   */
  autoRegister<T>(constructor: Constructor<T>): this {
    // Check for service name metadata
    const serviceName =
      Reflect.getMetadata('nexus:service:name', constructor) ||
      Reflect.getMetadata('service', constructor)?.name ||
      constructor.name;

    // Create a token for the service
    const token = createToken<T>(serviceName);

    // Check for scope metadata
    const scope =
      Reflect.getMetadata('nexus:scope', constructor) || Reflect.getMetadata('scope', constructor) || 'singleton';

    // Extract constructor dependencies
    const METADATA_KEYS = {
      CONSTRUCTOR_PARAMS: 'nexus:constructor-params',
      OPTIONAL: 'nexus:optional',
    };

    const constructorParams = Reflect.getMetadata(METADATA_KEYS.CONSTRUCTOR_PARAMS, constructor);
    const inject = constructorParams && constructorParams.length > 0 ? constructorParams : undefined;

    // Register the class with extracted metadata
    this.register(token, {
      useClass: constructor,
      scope: scope as Scope,
      inject,
    });

    return this;
  }
}
