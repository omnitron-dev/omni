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

import { AsyncLocalStorage } from 'node:async_hooks';
import { ModuleCompiler } from './module.js';
import { ContextManager, ContextProvider, resetContextManager } from './context.js';
import { LifecycleEvent, LifecycleManager } from './lifecycle.js';
import { isMultiToken, getTokenName, isOptionalToken, createToken, TokenRegistry, clearTokenCache } from './token.js';
import { Middleware, MiddlewarePipeline } from './middleware.js';
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
  Constructor,
  InjectionToken,
  ResolutionContext,
  ResolutionState,
  ContainerMetadata,
  RegistrationOptions,
  FactoryProvider,
  ResolutionContextInternal,
  hasStreamOptions,
  MiddlewareContext,
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

import type { ILogger } from '../types/logger.js';

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
  private registrations = new Map<InjectionToken<unknown>, Registration | Registration[]>();
  private instances = new Map<InjectionToken<unknown>, unknown>();
  private scopedInstances = new Map<string, Map<InjectionToken<unknown>, unknown>>();
  private parent?: IContainer;
  private disposed = false;
  private initialized = false;
  private initializableInstances = new Set<unknown>();
  private disposableInstances = new Set<unknown>();
  private modules = new Map<string, IModule>();
  private moduleProviders?: Map<string, Map<string, ModuleProviderInfo>>;
  private _pendingEagerInit?: Array<{ moduleName: string; tokens: InjectionToken<unknown>[] }>;
  private moduleImports = new Map<string, Set<string>>();
  private context: ResolutionContext;
  private pendingPromises = new Map<InjectionToken<unknown>, Promise<unknown>>();

  // AsyncLocalStorage for proper async context isolation (fixes race condition)
  private asyncLocalStorage = new AsyncLocalStorage<ResolutionContext>();

  // Phase 2 features
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

  // Optional logger (can be set after construction when DI is ready)
  private logger?: ILogger;

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

    // Self-register the Container class so providers can use @Inject(Container)
    // This is standard DI container practice (NestJS, Angular, etc.)
    this.register(Container, { useValue: this } as any);

    // Emit container created event
    this.lifecycleManager.emitSync(LifecycleEvent.ContainerCreated, { context: this.context });
  }

  /**
   * Register a provider - supports multiple formats
   *
   * @template T - The type of the service being registered
   * @param tokenOrProvider - The token, provider, or constructor to register
   * @param providerOrOptions - The provider definition or registration options
   * @param optionsArg - Additional registration options
   * @returns this container for chaining
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
        throw new InvalidProviderError(tokenOrProvider as Constructor<T>, 'Single argument must be a constructor');
      }
    } else if (arguments.length >= 2) {
      // Multiple arguments - standard format: register(token, provider, options)
      token = tokenOrProvider as InjectionToken<T>;
      provider = providerOrOptions as ProviderDefinition<T>;
      options = optionsArg || {};
    } else {
      throw new InvalidProviderError(Object as Constructor<unknown>, 'Invalid arguments to register');
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
  private createFactory(
    token: InjectionToken<unknown>,
    provider: ProviderDefinition<unknown>
  ): (...args: unknown[]) => unknown {
    return this.factoryService.createFactory(token, provider, this.getCurrentContext(), (t) => this.resolve(t));
  }

  /**
   * Resolve a dependency
   * Uses AsyncLocalStorage for proper async context isolation in concurrent calls
   *
   * @template T - The type of the service being resolved
   * @param token - The token identifying the dependency
   * @param context - Optional context to pass to the resolution
   * @returns The resolved instance
   * @throws {DependencyNotFoundError} If the token is not registered
   * @throws {CircularDependencyError} If a circular dependency is detected
   * @throws {AsyncResolutionError} If an async provider is resolved synchronously
   */
  resolve<T>(token: InjectionToken<T>, context?: unknown): T {
    this.checkDisposed();

    // Get current context from AsyncLocalStorage or use default
    const currentContext = this.getCurrentContext();

    // Check if we're in a nested resolution (resolutionState already exists in context)
    const isTopLevel = !currentContext.resolutionState;

    // Create isolated resolution state for top-level calls
    // Nested calls reuse the parent's resolution state
    const resolutionState: ResolutionState = isTopLevel
      ? { chain: [], chainSet: new Set(), resolved: new Map(), id: generateResolutionId() }
      : currentContext.resolutionState!;

    // Create isolated context for this resolution
    const localContext: ResolutionContext = {
      ...currentContext,
      resolutionState,
      ...(context ? { resolveContext: context } : {}),
    };

    // Use AsyncLocalStorage.run() for proper context isolation
    // This ensures concurrent resolutions don't interfere with each other
    return this.asyncLocalStorage.run(localContext, () => {
      try {
        // Emit before resolve event
        this.lifecycleManager.emitSync(LifecycleEvent.BeforeResolve, {
          token,
          context: localContext,
        });

        // Check for circular dependency using O(1) Set lookup (performance optimization)
        if (resolutionState.chainSet.has(token)) {
          throw new CircularDependencyError([...resolutionState.chain, token]);
        }

        // Check resolution cache within this resolution tree
        if (resolutionState.resolved.has(token)) {
          const cached = resolutionState.resolved.get(token);
          this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { token });
          return cached;
        }

        // Add to resolution chain (both array for error reporting and Set for O(1) lookup)
        resolutionState.chain.push(token);
        resolutionState.chainSet.add(token);

        // Create middleware context
        const middlewareContext: MiddlewareContext<T> = {
          ...localContext,
          token,
          container: this,
          metadata: localContext.metadata || {},
          startTime: Date.now(),
        };

        // Resolve through middleware pipeline
        const result = this.middlewarePipeline.executeSync(middlewareContext, () => this.resolveInternal(token));

        // Cache the result in this resolution tree
        resolutionState.resolved.set(token, result);

        // Emit after resolve event
        this.lifecycleManager.emitSync(LifecycleEvent.AfterResolve, {
          token,
          instance: result,
          context: localContext,
        });

        return result;
      } catch (error: any) {
        // Emit resolve failed event
        this.lifecycleManager.emitSync(LifecycleEvent.ResolveFailed, {
          token,
          error,
          context: localContext,
        });

        throw error;
      } finally {
        // Remove from resolution chain (both array and Set)
        if (resolutionState.chain.length > 0) {
          const removed = resolutionState.chain.pop();
          if (removed) {
            resolutionState.chainSet.delete(removed);
          }
        }
      }
    });
  }

  /**
   * Internal resolution logic
   */
  private resolveInternal<T>(token: InjectionToken<T>): T {
    // Check for cached instance
    if (this.instances.has(token)) {
      // Emit cache hit event for cached singletons
      this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { token });
      return this.instances.get(token) as T;
    }

    // Get current context from AsyncLocalStorage
    const currentContext = this.getCurrentContext();

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
            return factory() as T;
          }
          if (parentRegistration.scope === Scope.Scoped || parentRegistration.scope === Scope.Request) {
            // For scoped/request providers, resolve with current context
            return this.scopingService.resolveWithScope(
              parentRegistration,
              currentContext,
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
      if (isOptionalToken(token)) {
        return undefined as T;
      }

      // Provide resolution chain in error - use specific error for simple cases
      const chain = currentContext.resolutionState?.chain || [];
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
      currentContext,
      this.moduleProviders,
      this.moduleImports,
      (t) => this.getTokenKey(t),
      (tokenKey) => this.moduleLoaderService.getTokenModuleInfo(tokenKey)
    );

    // Check for async provider
    if (registration.isAsync) {
      const error = new AsyncResolutionError(token);
      (error as any).message = this.resolutionService.buildAsyncErrorMessage(token, registration, this.registrations);
      throw error;
    }

    // Resolve based on scope
    return this.scopingService.resolveWithScope(
      registration,
      currentContext,
      this.instances,
      this.scopedInstances,
      this.lifecycleManager,
      (reg) => this.createInstance(reg)
    );
  }

  /**
   * Create an instance from registration
   */
  private createInstance(registration: Registration): unknown {
    if (!registration.factory) {
      throw new InvalidProviderError(registration.token, 'No factory function');
    }

    // Get current context from AsyncLocalStorage
    const currentContext = this.getCurrentContext();

    try {
      // Resolve dependencies
      const dependencies = this.resolutionService.resolveDependencies(
        registration,
        currentContext,
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

      // Skip lifecycle tracking and initialization for useValue providers.
      // These are pre-constructed values — calling lifecycle methods on them
      // could cause errors (e.g., Container self-registration has initialize()
      // that returns a Promise, triggering AsyncResolutionError).
      const isUseValue = registration.provider && 'useValue' in registration.provider;

      // Track instances for lifecycle management
      // Only track singleton and scoped instances to prevent memory leak for transient instances
      // Transient instances are created fresh each time and cannot be centrally disposed
      const shouldTrackLifecycle = registration.scope !== Scope.Transient && !isUseValue;

      // Check for onInit method OR @PostConstruct decorator
      if (
        shouldTrackLifecycle &&
        instance &&
        (this.lifecycleService.hasRealMethod(instance, 'onInit') || this.lifecycleService.hasPostConstruct(instance))
      ) {
        this.initializableInstances.add(instance);
      }

      // Track for disposal: onDestroy, dispose(), or @PreDestroy
      if (
        shouldTrackLifecycle &&
        instance &&
        (this.lifecycleService.hasRealMethod(instance, 'onDestroy') ||
          this.lifecycleService.isDisposable(instance) ||
          this.lifecycleService.hasPreDestroy(instance))
      ) {
        this.disposableInstances.add(instance);
      }

      // Emit instance created event
      this.lifecycleManager.emitSync(LifecycleEvent.InstanceCreated, {
        token: registration.token,
        instance,
        context: currentContext,
      });

      // Initialize if needed (synchronous only - async init should be done via initialize() method)
      // Skip for useValue providers — they are pre-constructed
      if (!isUseValue && this.lifecycleService.isInitializable(instance)) {
        this.lifecycleManager.emitSync(LifecycleEvent.InstanceInitializing, {
          token: registration.token,
          instance,
          context: currentContext,
        });

        const result = instance.initialize();
        if (result instanceof Promise) {
          throw new AsyncResolutionError(registration.token);
        }

        this.lifecycleManager.emitSync(LifecycleEvent.InstanceInitialized, {
          token: registration.token,
          instance,
          context: currentContext,
        });
      }

      return instance;
    } catch (error: unknown) {
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
      const chain = currentContext.resolutionState?.chain || [];
      throw new ResolutionError(registration.token, [...chain], error instanceof Error ? error : undefined);
    }
  }

  /**
   * Apply property injections to an instance
   */
  private applyPropertyInjections(instance: unknown, classConstructor: Constructor | undefined): void {
    if (!classConstructor) return;

    const METADATA_KEYS = {
      PROPERTY_INJECTIONS: 'nexus:property:injections',
    };

    const propertyInjections = Reflect.getMetadata(METADATA_KEYS.PROPERTY_INJECTIONS, classConstructor);

    if (propertyInjections) {
      type InstanceWithIndex = { [key: string]: unknown };
      const instanceWithIndex = instance as InstanceWithIndex;
      for (const [propertyKey, token] of Object.entries(propertyInjections)) {
        try {
          instanceWithIndex[propertyKey] = this.resolve(token as InjectionToken<unknown>);
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
   * Resolve a dependency asynchronously
   * Uses AsyncLocalStorage for proper async context isolation in concurrent calls
   *
   * @template T - The type of the service being resolved
   * @param token - The token identifying the dependency
   * @returns Promise that resolves to the instance
   * @throws {DependencyNotFoundError} If the token is not registered
   * @throws {CircularDependencyError} If a circular dependency is detected
   * @throws {AsyncResolutionError} If resolution fails
   */
  async resolveAsync<T>(token: InjectionToken<T>): Promise<T> {
    this.checkDisposed();

    // Get current context from AsyncLocalStorage or use default
    const currentContext = this.getCurrentContext();

    // Check if we're in a nested resolution (resolutionState already exists in context)
    const isTopLevel = !currentContext.resolutionState;

    // Create isolated resolution state for top-level calls
    const resolutionState: ResolutionState = isTopLevel
      ? { chain: [], chainSet: new Set(), resolved: new Map(), id: generateResolutionId() }
      : currentContext.resolutionState!;

    // Create isolated context for this resolution
    const localContext: ResolutionContext = {
      ...currentContext,
      resolutionState,
    };

    // Create middleware context early so it's available in catch blocks
    const middlewareContext: MiddlewareContext<T> = {
      ...localContext,
      token,
      container: this,
      metadata: localContext.metadata || {},
      startTime: Date.now(),
    };

    // Use AsyncLocalStorage.run() for proper context isolation
    // This ensures concurrent async resolutions don't interfere with each other
    return this.asyncLocalStorage.run(localContext, async () => {
      try {
        // Emit before resolve event
        this.lifecycleManager.emitSync(LifecycleEvent.BeforeResolve, {
          token,
          context: localContext,
        });

        // Check for pending promise (handles concurrent async resolutions of same token)
        // Only use cached pending promise for Singleton and Scoped scopes
        // Transient scope must always create a new instance
        const registration = this.getRegistration(token);
        if (registration?.scope !== Scope.Transient && this.pendingPromises.has(token)) {
          return this.pendingPromises.get(token)!;
        }

        // Check for circular dependency using O(1) Set lookup (performance optimization)
        if (resolutionState.chainSet.has(token)) {
          throw new CircularDependencyError([...resolutionState.chain, token]);
        }

        // Check resolution cache within this resolution tree
        if (resolutionState.resolved.has(token)) {
          const cached = resolutionState.resolved.get(token);
          this.lifecycleManager.emitSync(LifecycleEvent.CacheHit, { token });
          return cached;
        }

        // Add to resolution chain (both array for error reporting and Set for O(1) lookup)
        resolutionState.chain.push(token);
        resolutionState.chainSet.add(token);

        // Create and store the promise
        const resolutionPromise = this.middlewarePipeline.execute(middlewareContext, () =>
          this.resolveAsyncInternal(token)
        );

        // Only cache pending promise for non-transient scopes
        // Transient scope creates new instances for each concurrent call
        if (registration?.scope !== Scope.Transient) {
          this.pendingPromises.set(token, resolutionPromise);
        }

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

        // Always delete pending promise after successful resolution
        // For singletons, the instance is cached in this.instances so we don't need the promise anymore
        // This prevents memory leak from accumulating stale promises
        this.pendingPromises.delete(token);

        return result;
      } catch (error: unknown) {
        // Emit resolve failed event
        this.lifecycleManager.emitSync(LifecycleEvent.ResolveFailed, {
          token,
          error: error instanceof Error ? error : undefined,
          context: middlewareContext,
        });

        // On error, always delete the pending promise
        this.pendingPromises.delete(token);

        throw error;
      } finally {
        // Remove from resolution chain (both array and Set)
        if (resolutionState.chain.length > 0) {
          const removed = resolutionState.chain.pop();
          if (removed) {
            resolutionState.chainSet.delete(removed);
          }
        }
      }
    });
  }

  private async resolveAsyncInternal<T>(token: InjectionToken<T>): Promise<T> {
    // Get current context from AsyncLocalStorage
    const currentContext = this.getCurrentContext();

    // Get registration
    let registration = this.getRegistration(token);
    if (!registration) {
      if (this.parent) {
        // For Scoped/Request registrations in parent, resolve locally with child's scope context
        // to ensure proper per-scope instance isolation
        const parentReg = (this.parent as Container).getRegistration?.(token);
        if (parentReg && (parentReg.scope === Scope.Scoped || parentReg.scope === Scope.Request)) {
          registration = parentReg;
        } else {
          return this.parent.resolveAsync(token);
        }
      } else {
        const tokenName = getTokenName(token);
        const chain = currentContext.resolutionState?.chain?.map((t) => getTokenName(t)).join(' → ');
        this.logger?.error(
          { token: tokenName, chain, registeredTokens: this.registrations.size },
          `DI: Cannot resolve "${tokenName}" — not registered. Resolution chain: ${chain || '(root)'}`
        );
        throw new DependencyNotFoundError(token);
      }
    }

    // Check scope-specific caches before creating new instances
    switch (registration.scope) {
      case Scope.Singleton:
        // Check for cached singleton instance
        if (this.instances.has(token)) {
          return this.instances.get(token) as T;
        }
        // Check if already instantiated in registration (for singletons)
        if (registration.instance !== undefined) {
          return registration.instance as T;
        }
        // Check for pending singleton resolution to prevent race conditions
        // when multiple concurrent async resolutions depend on the same singleton.
        // This handles the case where resolveAsyncInternal is called directly
        // (not through the outer resolveAsync) from dependency resolution.
        if (this.pendingPromises.has(token)) {
          return this.pendingPromises.get(token) as Promise<T>;
        }
        break;

      case Scope.Scoped:
      case Scope.Request: {
        // Check for scoped instance in current scope
        const scopeId = currentContext.metadata?.['scopeId'] || 'default';
        const scopeCache = this.scopedInstances.get(scopeId);
        if (scopeCache?.has(token)) {
          return scopeCache.get(token) as T;
        }
        break;
      }

      case Scope.Transient:
        // Transient always creates a new instance
        break;

      default:
        // Unknown scope, proceed to instance creation
        break;
    }

    // For Singleton, wrap the creation in a pending promise to prevent
    // concurrent async resolutions from creating duplicate instances (race condition fix).
    if (registration.scope === Scope.Singleton) {
      const creationPromise = this.resolveAsyncInternalCreate<T>(token, registration, currentContext);
      this.pendingPromises.set(token, creationPromise);
      try {
        const result = await creationPromise;
        // Clean up pending promise after singleton is cached in this.instances
        this.pendingPromises.delete(token);
        return result;
      } catch (error) {
        this.pendingPromises.delete(token);
        throw error;
      }
    }

    return this.resolveAsyncInternalCreate<T>(token, registration, currentContext);
  }

  private async resolveAsyncInternalCreate<T>(
    token: InjectionToken<T>,
    registration: Registration,
    currentContext: ResolutionContext
  ): Promise<T> {
    // Resolve dependencies
    const dependencies = await this.asyncResolutionService.resolveAsyncDependencies(
      registration,
      currentContext,
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
              currentContext,
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
    } catch (error: unknown) {
      const tokenName = getTokenName(token);
      const depNames = registration.dependencies?.map((d) => getTokenName(d)).join(', ');
      this.logger?.error(
        { err: error, token: tokenName, dependencies: depNames },
        `DI: Failed to create instance of "${tokenName}". Dependencies: [${depNames || 'none'}]`
      );
      const wrappedError = new AsyncResolutionError(token);
      type ErrorWithCauseAndMessage = Error & { cause?: unknown };
      const extendedError = wrappedError as ErrorWithCauseAndMessage;
      extendedError.cause = error;
      extendedError.message = error instanceof Error ? error.message : String(error);
      throw wrappedError;
    }

    // Handle lifecycle hooks: @PostConstruct > onInit > initialize
    //
    // Lifecycle detection uses prototype-based method checking (hasRealMethod)
    // via Object.getOwnPropertyDescriptor, which bypasses JS Proxy get traps.
    // This means:
    // - Class instances (useClass): lifecycle methods detected and called correctly
    // - useValue with real class instances (e.g., ConfigService): lifecycle methods called
    // - useValue with JS Proxy (e.g., TopologyProxy): safely skipped (no real methods)
    const postConstructMethod = this.lifecycleService.getPostConstructMethod(instance);
    if (postConstructMethod) {
      try {
        type InstanceWithMethod = { [key: string]: (() => unknown) | undefined };
        const instanceWithMethod = instance as InstanceWithMethod;
        const method = instanceWithMethod[postConstructMethod];
        if (typeof method === 'function') {
          const result = method.call(instance);
          if (result instanceof Promise) {
            await result;
          }
        }
      } catch (error: unknown) {
        const wrappedError = new AsyncResolutionError(token);
        type ErrorWithCauseAndMessage = Error & { cause?: unknown };
        const extendedError = wrappedError as ErrorWithCauseAndMessage;
        extendedError.cause = error;
        extendedError.message =
          "Failed to call @PostConstruct '" +
          postConstructMethod +
          "' on '" +
          getTokenName(token) +
          "': " +
          (error instanceof Error ? error.message : String(error));
        throw wrappedError;
      }
    } else if (this.lifecycleService.isAsyncInitializable(instance)) {
      try {
        await instance.onInit();
      } catch (error: unknown) {
        const wrappedError = new AsyncResolutionError(token);
        type ErrorWithCauseAndMessage = Error & { cause?: unknown };
        const extendedError = wrappedError as ErrorWithCauseAndMessage;
        extendedError.cause = error;
        extendedError.message =
          "Failed to initialize async instance '" +
          getTokenName(token) +
          "': " +
          (error instanceof Error ? error.message : String(error));
        throw wrappedError;
      }
    }

    // Initialize if needed (sync initialization)
    // Skip if @PostConstruct already called the same method (e.g., @PostConstruct on initialize())
    if (this.lifecycleService.isInitializable(instance) && postConstructMethod !== 'initialize') {
      await instance.initialize();
    }

    // Track instances for lifecycle management
    // Only track singleton and scoped instances to prevent memory leak for transient instances
    const shouldTrackLifecycle = registration.scope !== Scope.Transient;

    // NOTE: Do NOT add to initializableInstances here — lifecycle methods
    // (@PostConstruct / onInit) were already called above during async resolution.
    // Adding to initializableInstances would cause container.initialize() to call
    // onInit() a second time, leading to duplicate job registration, duplicate
    // subscriptions, and other double-initialization bugs.

    // Track for disposal: onDestroy, dispose(), or @PreDestroy
    if (
      shouldTrackLifecycle &&
      instance &&
      (this.lifecycleService.hasRealMethod(instance, 'onDestroy') ||
        this.lifecycleService.isDisposable(instance) ||
        this.lifecycleService.hasPreDestroy(instance))
    ) {
      this.disposableInstances.add(instance);
    }

    // Cache based on scope
    switch (registration.scope) {
      case Scope.Singleton:
        registration.instance = instance;
        this.instances.set(token, instance);
        break;

      case Scope.Scoped:
      case Scope.Request: {
        // Cache in scoped instances map
        const scopeId = currentContext.metadata?.['scopeId'] || 'default';
        if (!this.scopedInstances.has(scopeId)) {
          this.scopedInstances.set(scopeId, new Map());
        }
        this.scopedInstances.get(scopeId)!.set(token, instance);
        break;
      }

      case Scope.Transient:
        // Don't cache transient instances
        break;

      default:
        // Unknown scope, no caching
        break;
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
    return regs.map((reg) =>
      this.scopingService.resolveWithScope(
        reg,
        this.getCurrentContext(),
        this.instances,
        this.scopedInstances,
        this.lifecycleManager,
        (r) => this.createInstance(r)
      )
    );
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
      type ProviderWithStreamOptions = ProviderDefinition<AsyncIterable<T>> & {
        filter?: (value: T) => boolean;
        batch?: number | { size: number };
        useFactory?: (...args: unknown[]) => AsyncIterable<T>;
      };
      const originalProvider = provider;
      const providerWithOptions = provider as ProviderWithStreamOptions;
      const batchOption = providerWithOptions.batch;
      const streamOptions = {
        filter: providerWithOptions.filter,
        batch: typeof batchOption === 'number' ? { size: batchOption } : batchOption,
      };

      // Create a new provider that applies filtering and batching
      const wrappedProvider = {
        ...originalProvider,
        useFactory: (...args: unknown[]): AsyncIterable<T> => {
          const originalProviderWithFactory = originalProvider as ProviderWithStreamOptions;
          const originalStream = originalProviderWithFactory.useFactory!(...args);
          return this.applyStreamProcessing(originalStream, streamOptions) as AsyncIterable<T>;
        },
      } as ProviderWithStreamOptions;

      // Remove the streaming options from the provider before registering
      delete wrappedProvider.filter;
      delete wrappedProvider.batch;

      return this.register(token, wrappedProvider as ProviderDefinition<AsyncIterable<T>>, options);
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
  ): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }>> {
    const promises = tokens.map(async (token) => {
      try {
        const value = await this.resolveAsync(token);
        return { status: 'fulfilled' as const, value };
      } catch (reason: unknown) {
        return { status: 'rejected' as const, reason };
      }
    });
    return Promise.all(promises);
  }

  /**
   * Resolve multiple tokens in batch with timeout
   */
  async resolveBatch<T extends Record<string, InjectionToken<unknown>> | InjectionToken<unknown>[]>(
    tokens: T,
    options: { timeout?: number; failFast?: boolean } = {}
  ): Promise<
    T extends InjectionToken<unknown>[]
      ? unknown[]
      : { [K in keyof T]: T[K] extends InjectionToken<infer V> ? V | undefined : never }
  > {
    const { timeout = 5000, failFast = false } = options;

    // Handle object map format
    if (!Array.isArray(tokens)) {
      const keys = Object.keys(tokens);
      type TokenMap = Record<string, InjectionToken<unknown>>;
      const tokensAsMap = tokens as TokenMap;
      const tokenArray = keys.map((key) => tokensAsMap[key]!);

      const resolvePromise = Promise.allSettled(
        tokenArray.map((token) =>
          timeout > 0
            ? Promise.race([
                this.resolveAsync(token!),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(Errors.timeout('operation', timeout)), timeout)
                ),
              ])
            : this.resolveAsync(token!)
        )
      ).then((results) => {
        type ResultMap = Record<string, unknown>;
        const resultObj: ResultMap = {};
        keys.forEach((key, index) => {
          const result = results[index];
          resultObj[key] =
            result && result.status === 'fulfilled' ? (result as PromiseFulfilledResult<unknown>).value : undefined;
        });
        return resultObj;
      });

      type ObjectBatchResult = T extends InjectionToken<unknown>[]
        ? unknown[]
        : { [K in keyof T]: T[K] extends InjectionToken<infer V> ? V | undefined : never };
      return resolvePromise as unknown as ObjectBatchResult;
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

    type BatchResult = T extends InjectionToken<unknown>[]
      ? unknown[]
      : { [K in keyof T]: T[K] extends InjectionToken<infer V> ? V | undefined : never };

    if (timeout > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(Errors.timeout('batch resolution', timeout)), timeout);
      });

      return Promise.race([resolvePromise, timeoutPromise]) as unknown as BatchResult;
    }

    return resolvePromise as unknown as BatchResult;
  }

  /**
   * Check if token is registered
   */
  has(token: InjectionToken<unknown>): boolean {
    if (this.registrations.has(token)) {
      return true;
    }
    return this.parent ? this.parent.has(token) : false;
  }

  /**
   * Get registration
   */
  private getRegistration(token: InjectionToken<unknown>): Registration | undefined {
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
    const currentContext = this.getCurrentContext();

    if (registration) {
      if (Array.isArray(registration)) {
        // Multiple registrations - resolve each one
        for (const reg of registration) {
          try {
            const instance = this.scopingService.resolveRegistration(
              reg,
              currentContext,
              this.instances,
              this.scopedInstances,
              (r) => this.createInstance(r)
            );
            if (instance !== undefined) {
              results.push(instance);
            }
          } catch (error) {
            // Skip failed resolutions for multi-injection
            this.logger?.warn(
              { err: error, token: String(token) },
              'Failed to resolve one instance in multi-injection'
            );
          }
        }
      } else if (registration.options?.multi) {
        // Single registration marked as multi
        const instance = this.scopingService.resolveRegistration(
          registration,
          currentContext,
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
          currentContext,
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

    // Get current context (may be from AsyncLocalStorage during resolution)
    const currentContext = this.getCurrentContext();

    // Generate unique scope ID with a counter to ensure uniqueness
    const uniqueId = 'scope-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    const newContext = {
      ...currentContext,
      ...context,
      metadata: {
        ...(currentContext.metadata || {}),
        ...(context.metadata || {}),
        scopeId: context.metadata?.['scopeId'] || uniqueId,
        requestId:
          context.metadata?.['requestId'] ||
          ((context as { request?: { id?: string } }).request?.id as string | undefined),
      },
    };

    return new Container(this, newContext);
  }

  /**
   * Load a module (synchronous registration only).
   * Providers are registered but singletons are NOT eagerly instantiated.
   * Use `loadModuleAsync()` for full NestJS-style eager initialization.
   */
  loadModule(module: IModule): this {
    return this.loadModuleInternal(module, new Set(), false);
  }

  /**
   * Load a module with eager singleton initialization.
   *
   * After registering all providers, resolves every singleton provider in the module.
   * This ensures side-effect providers (event listeners, subscribers, schedulers)
   * are instantiated at module load time — matching NestJS behavior.
   *
   * Errors during eager resolution are thrown immediately with full context,
   * enabling fast diagnosis of DI misconfiguration.
   *
   * @throws {DependencyNotFoundError} If a singleton dependency cannot be resolved
   * @throws {CircularDependencyError} If circular dependencies are detected
   * @throws {AsyncResolutionError} If an async provider fails during initialization
   */
  async loadModuleAsync(module: IModule): Promise<this> {
    this.loadModuleInternal(module, new Set(), false);

    // Collect eager tokens for deferred initialization — don't resolve yet.
    // The Application calls eagerlyInitialize() after ALL modules are registered,
    // ensuring cross-module dependencies are available.
    const eagerTokens = (module as any).__eagerTokens as InjectionToken<unknown>[] | undefined;
    if (eagerTokens && eagerTokens.length > 0) {
      delete (module as any).__eagerTokens;
      if (!this._pendingEagerInit) {
        this._pendingEagerInit = [];
      }
      this._pendingEagerInit.push({ moduleName: module.name, tokens: eagerTokens });
    }

    return this;
  }

  /**
   * Eagerly initialize all pending singleton providers collected during loadModuleAsync().
   *
   * Must be called AFTER all modules are loaded so cross-module dependencies
   * are available. This matches NestJS behavior where all providers are compiled
   * first, then instantiated.
   *
   * @throws {Error} If any singleton fails to initialize (with full diagnostics)
   */
  async eagerlyInitialize(): Promise<void> {
    if (!this._pendingEagerInit || this._pendingEagerInit.length === 0) {
      return;
    }

    const pending = this._pendingEagerInit;
    this._pendingEagerInit = [];

    const allErrors: Array<{ module: string; token: string; error: Error }> = [];

    for (const { moduleName, tokens } of pending) {
      for (const token of tokens) {
        try {
          await this.resolveAsync(token);
        } catch (error) {
          const tokenName = getTokenName(token);
          const err = error instanceof Error ? error : new Error(String(error));
          allErrors.push({ module: moduleName, token: tokenName, error: err });
          this.logger?.error(
            { err, token: tokenName, module: moduleName },
            `Failed to eagerly initialize provider "${tokenName}" in module "${moduleName}"`
          );
        }
      }
    }

    if (allErrors.length > 0) {
      const summary = allErrors.map((e) => `  - ${e.token}: ${e.error.message}`).join('\n');
      const moduleNames = [...new Set(allErrors.map((e) => e.module))].join(', ');
      throw Errors.internal(
        `Module "${moduleNames}" failed to initialize ${allErrors.length} provider(s):\n${summary}`
      );
    }

    const totalCount = pending.reduce((sum, p) => sum + p.tokens.length, 0);
    if (totalCount > 0) {
      this.logger?.info(
        { count: totalCount, modules: pending.map((p) => p.moduleName) },
        `${totalCount} singleton(s) eagerly initialized across ${pending.length} module(s)`
      );
    }
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
          throw Errors.badRequest(
            'Circular module dependency detected: ' +
              Array.from(loadingStack).join(' -> ') +
              ' -> ' +
              resolvedImport.name
          );
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
      type ConditionalProvider = {
        token: InjectionToken<unknown>;
        providerObj: ProviderDefinition<unknown>;
        options?: RegistrationOptions;
      };
      const conditionalProviders: ConditionalProvider[] = [];

      // First pass: non-conditional providers
      for (const provider of module.providers) {
        let token: InjectionToken<unknown>;
        let providerObj: ProviderDefinition<unknown>;
        let options: RegistrationOptions = {};

        if (Array.isArray(provider) && provider.length === 3) {
          // Handle [token, provider, options] tuple
          token = provider[0];
          providerObj = provider[1];
          options = provider[2] || {};
        } else if (Array.isArray(provider) && provider.length === 2) {
          token = provider[0];
          providerObj = provider[1];
        } else if (typeof provider === 'function') {
          token = provider;
          providerObj = { useClass: provider };
        } else if (provider && typeof provider === 'object' && 'provide' in provider) {
          const providerWithProvide = provider as Record<string, unknown> & { provide: InjectionToken<unknown> };
          token = providerWithProvide.provide;
          // Extract all properties except 'provide' — preserves useValue, useClass,
          // useFactory, useToken, useExisting, inject, scope, and any future keys.
          // Also extract registration options (override, multi) into the options object.
          const { provide: _, override, multi, ...rest } = providerWithProvide;
          providerObj = rest as ProviderDefinition<unknown>;
          if (override !== undefined) options.override = override as boolean;
          if (multi !== undefined) options.multi = multi as boolean;
        } else {
          throw Errors.badRequest(
            'Module provider must be either [token, provider] tuple, [token, provider, options] tuple, a class constructor, or a provider object with "provide" property'
          );
        }

        // Check if it's conditional
        type ConditionalProviderCheck = ProviderDefinition<unknown> & {
          condition?: (ctx: ResolutionContext) => boolean;
        };
        const providerWithCondition = providerObj as ConditionalProviderCheck;
        if (providerWithCondition && typeof providerWithCondition === 'object' && providerWithCondition.condition) {
          conditionalProviders.push({ token, providerObj, options });
        } else {
          // Register immediately with module context
          type ProviderWithFactory = ProviderDefinition<unknown> & {
            useFactory?: (...args: unknown[]) => unknown;
            inject?: InjectionToken<unknown>[];
          };
          const providerWithFactory = providerObj as ProviderWithFactory;
          if (providerWithFactory.useFactory && providerWithFactory.inject) {
            const originalFactory = providerWithFactory.useFactory;
            const moduleName = module.name;
            providerWithFactory.useFactory = (...args: unknown[]) => {
              const currentCtx = this.getCurrentContext();
              const prevModule = (currentCtx as ResolutionContextInternal).__resolvingModule;
              try {
                (currentCtx as ResolutionContextInternal).__resolvingModule = moduleName;
                return originalFactory(...args);
              } finally {
                (currentCtx as ResolutionContextInternal).__resolvingModule = prevModule;
              }
            };
          }
          this.register(token, providerObj, options);
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

        if (Array.isArray(provider) && provider.length === 3) {
          // Handle [token, provider, options] tuple
          token = provider[0];
          isConditional = provider[1] && typeof provider[1] === 'object' && (provider[1] as any).conditional;
        } else if (Array.isArray(provider) && provider.length === 2) {
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
      for (const { token, providerObj, options } of conditionalProviders) {
        type ConditionalProviderWithOriginal = {
          condition?: (ctx: unknown) => boolean;
          originalProvider?: ProviderDefinition<unknown>;
        };
        const conditionalProviderObj = providerObj as ConditionalProviderWithOriginal;
        const condition = conditionalProviderObj.condition;
        const originalProvider = conditionalProviderObj.originalProvider;

        const isExported = this.moduleLoaderService.isTokenExported(module, token);
        this.moduleLoaderService.trackModuleProvider(
          module.name,
          token,
          isExported,
          module.global || false,
          this.moduleProviders
        );

        // Temporarily mark we're resolving from this module
        const currentCtx = this.getCurrentContext();
        const previousModule = (currentCtx as ResolutionContextInternal).__resolvingModule;
        (currentCtx as ResolutionContextInternal).__resolvingModule = module.name;

        try {
          if (condition && condition(this)) {
            this.register(token, originalProvider, options);
          }
        } finally {
          (currentCtx as ResolutionContextInternal).__resolvingModule = previousModule;
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
          this.logger?.error({ err: error, module: module.name }, 'Failed to initialize module');
        });
      }
    }

    // Eager singleton initialization — resolve all singleton providers in this module.
    // This ensures side-effect providers (event listeners, subscribers) are instantiated
    // at module load time, matching NestJS behavior. Without this, providers are only
    // created lazily when first requested, meaning standalone handlers never initialize.
    if (this.moduleProviders?.has(module.name)) {
      const moduleProviderMap = this.moduleProviders.get(module.name)!;
      const eagerTokens: InjectionToken<unknown>[] = [];

      for (const [, info] of moduleProviderMap) {
        const reg = this.registrations.get(info.token);
        if (!reg || Array.isArray(reg)) continue;

        // Only eagerly init singletons with useClass or useFactory (not useValue — already resolved)
        if (reg.scope === Scope.Singleton && !('useValue' in reg.provider)) {
          // Skip if already instantiated
          if (!this.instances.has(info.token) && reg.instance === undefined) {
            eagerTokens.push(info.token);
          }
        }
      }

      if (eagerTokens.length > 0) {
        this.logger?.debug(
          { module: module.name, count: eagerTokens.length },
          'Eagerly initializing singleton providers'
        );

        // Store pending init for async resolution in loadModuleAsync
        (module as any).__eagerTokens = eagerTokens;
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

    // Dispose instances (lifecycle detection uses prototype-based checks, safe for Proxy values)
    await this.lifecycleService.disposeInstances(this.instances, this.scopedInstances);

    // Clear all caches
    this.registrations.clear();
    this.instances.clear();
    this.scopedInstances.clear();
    this.modules.clear();
    this.moduleLoaderService.clear();

    // Clean up global singletons to prevent memory leaks
    // Reset global context manager
    resetContextManager();

    // Clear module-level token cache
    clearTokenCache();

    // Reset token registry singleton
    TokenRegistry.reset();

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
   * Get the current resolution context from AsyncLocalStorage or fall back to default.
   * This provides proper async context isolation for concurrent resolutions.
   */
  private getCurrentContext(): ResolutionContext {
    return this.asyncLocalStorage.getStore() || this.context;
  }

  /**
   * Get a consistent key for a token to use in Maps
   */
  private getTokenKey(token: InjectionToken<any>): string {
    return this.moduleLoaderService.getTokenKey(token);
  }

  /**
   * Install an extension into the container.
   *
   * Extensions are objects with an `install(container)` method.
   * This provides a simple extensibility point without the full plugin system.
   * Use middleware for resolution interception instead.
   *
   * @param extension - Object with install(container) method
   * @returns this container for chaining
   *
   * @example
   * ```typescript
   * const devTools = new DevToolsPlugin();
   * container.use(devTools);
   * ```
   */
  use(extension: { install(container: IContainer): void }): this {
    extension.install(this);
    return this;
  }

  /**
   * Set logger instance for container operations.
   * Can be called after construction once the logger is available through DI.
   * Also propagates logger to internal services that support it.
   */
  setLogger(logger: ILogger): this {
    this.logger = logger;
    // Propagate to lifecycle components
    this.lifecycleManager.setLogger(logger);
    this.lifecycleService.setLogger(logger);
    return this;
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
   * Add a lifecycle hook.
   *
   * Maps common hook names to lifecycle events. Use middleware for
   * resolution interception with value modification capabilities.
   *
   * @param event - Hook event name (beforeResolve, afterResolve, onError, etc.)
   * @param handler - Handler function to call when event fires
   * @returns this container for chaining
   */
  addHook(event: string, handler: (...args: any[]) => void | Promise<void>): this {
    // Map common hook names to lifecycle events with parameter mapping
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
      this.lifecycleManager.on(mapping.event, (data) => {
        const args = mapping.wrapper(data);
        return handler(...args);
      });
    } else {
      this.logger?.warn({ event }, 'Unknown hook event');
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
