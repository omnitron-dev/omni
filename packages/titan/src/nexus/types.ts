/**
 * Core types and interfaces for Nexus DI Container
 *
 * @packageDocumentation
 *
 * ## API Stability Markers
 *
 * - `@stable` - Part of the public API, follows semantic versioning
 * - `@experimental` - API may change in minor versions
 * - `@internal` - Not intended for public use
 * - `@deprecated` - Will be removed in a future version
 *
 * @since 0.1.0
 */

import { ContextProvider } from './context.js';

// Forward declarations for circular dependency resolution
export interface Middleware<T = unknown> {
  name: string;
  execute: (context: MiddlewareContext<T>, next: () => T | Promise<T>) => T | Promise<T>;
  priority?: number;
  condition?: (context: MiddlewareContext<T>) => boolean;
  onError?: (error: Error, context: MiddlewareContext<T>) => void;
}

export interface Plugin {
  name: string;
  version: string;
  description?: string;
  install(container: IContainer): void;
  uninstall?(container: IContainer): void;
}

/**
 * Constructor type for creating instances.
 * Note: Uses any[] for args to maintain DI container flexibility.
 *
 * @stable
 * @since 0.1.0
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = {}, Args extends any[] = any[]> = new (...args: Args) => T;

/**
 * Abstract constructor type for interfaces and abstract classes.
 * Note: Uses any[] for args to maintain DI container flexibility.
 *
 * @stable
 * @since 0.1.0
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AbstractConstructor<T = {}, Args extends any[] = any[]> = abstract new (...args: Args) => T;

/**
 * Service identifier that can be a constructor, string, or symbol.
 *
 * @stable
 * @since 0.1.0
 */
export type ServiceIdentifier<T = any> = Constructor<T> | AbstractConstructor<T> | string | symbol | Token<T>;

/**
 * Lifecycle scopes for dependency management.
 *
 * @stable
 * @since 0.1.0
 */
export enum Scope {
  /** New instance each time */
  Transient = 'transient',
  /** One instance per container */
  Singleton = 'singleton',
  /** One instance per scope */
  Scoped = 'scoped',
  /** One instance per request */
  Request = 'request',
}

/**
 * Union type of scope values for backward compatibility with string literals.
 * Allows using both Scope.Singleton and 'singleton'.
 *
 * @stable
 * @since 0.1.0
 */
export type ScopeValue = `${Scope}`;

/**
 * Token metadata for enhanced type safety and debugging.
 *
 * @stable
 * @since 0.1.0
 */
export interface TokenMetadata {
  name?: string;
  description?: string;
  scope?: Scope;
  tags?: string[];
  multi?: boolean;
  optional?: boolean;
}

/**
 * Type-safe token for dependency identification.
 * Tokens provide a way to identify dependencies without coupling to concrete implementations.
 *
 * @stable
 * @since 0.1.0
 */
export interface Token<T = any> {
  readonly id: symbol;
  readonly name: string;
  readonly metadata: TokenMetadata;
  readonly type?: T;
  toString(): string;
}

/**
 * Multi-token for registering multiple providers under a single token.
 *
 * @stable
 * @since 0.1.0
 */
export interface MultiToken<T = any> extends Token<T> {
  readonly multi: true;
}

/**
 * Factory function for creating instances.
 * Note: Uses any[] for args to maintain DI container flexibility.
 *
 * @stable
 * @since 0.1.0
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Factory<T = unknown, Args extends any[] = any[]> = (...args: Args) => T;

/**
 * Async factory function for creating instances asynchronously.
 * Note: Uses any[] for args to maintain DI container flexibility.
 *
 * @stable
 * @since 0.1.0
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AsyncFactory<T = unknown, Args extends any[] = any[]> = (...args: Args) => Promise<T>;

/**
 * Injection token for dependencies.
 * Can be a Token, constructor, string, or symbol.
 *
 * @stable
 * @since 0.1.0
 */
export type InjectionToken<T = any> = Token<T> | ServiceIdentifier<T>;

/**
 * Resolution state for circular dependency detection.
 * Isolated per top-level resolution call to prevent race conditions.
 *
 * @internal
 * @since 0.1.0
 */
export interface ResolutionState {
  /** Chain of tokens being resolved (for circular dependency detection) */
  chain: InjectionToken<any>[];
  /** Cache of resolved instances within this resolution tree */
  resolved: Map<InjectionToken<any>, any>;
  /** Unique ID for this resolution tree */
  id: string;
}

/**
 * Resolution context for contextual injection.
 *
 * @stable
 * @since 0.1.0
 */
export interface ResolutionContext {
  container: IContainer;
  scope?: Scope;
  parent?: ResolutionContext;
  metadata?: Record<string, any>;
  /** Isolated resolution state for this resolution tree (prevents race conditions) */
  resolutionState?: ResolutionState;
  [key: string]: any;
}

/**
 * Middleware context
 * Extends ResolutionContext with middleware-specific properties
 *
 * @stable
 * @since 0.1.0
 */
export interface MiddlewareContext<T = unknown> extends ResolutionContext {
  /** Token being resolved */
  token: InjectionToken<T>;
  /** Container instance */
  container: IContainer;
  /** Current attempt number (for retry middleware) */
  attempt?: number;
  /** Start time of resolution (milliseconds since epoch) */
  startTime?: number;
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Additional context properties */
  [key: string]: unknown;
}

/**
 * Class provider - provides a class constructor to instantiate.
 *
 * @stable
 * @since 0.1.0
 */
export type ClassProvider<T = any> = {
  useClass: Constructor<T>;
  scope?: Scope;
  inject?: InjectionToken[];
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
};

/**
 * Value provider - provides a pre-existing value.
 *
 * @stable
 * @since 0.1.0
 */
export type ValueProvider<T = any> = {
  useValue: T;
  validate?: string | ((value: T) => void);
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
};

/**
 * Factory provider - provides a factory function to create instances.
 *
 * @stable
 * @since 0.1.0
 */
export type FactoryProvider<T = any> = {
  useFactory: Factory<T> | AsyncFactory<T>;
  inject?: InjectionToken[];
  scope?: Scope;
  async?: boolean;
  timeout?: number;
  retry?: {
    maxAttempts: number;
    delay: number;
  };
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
};

/**
 * Token provider - aliases one token to another.
 *
 * @stable
 * @since 0.1.0
 */
export type TokenProvider<T = any> = {
  useToken: InjectionToken<T>;
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
};

/**
 * Provider - the actual provider configuration without token.
 * Token is passed separately in register(token, provider).
 *
 * @stable
 * @since 0.1.0
 */
export type Provider<T = any> =
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>
  | TokenProvider<T>
  | Constructor<T>;

/**
 * Provider input - what users can provide when registering.
 *
 * @stable
 * @since 0.1.0
 */
export type ProviderInput<T = any> =
  | Provider<T> // Provider without 'provide' field
  | [ServiceIdentifier<T>, Provider<T>] // Tuple format [token, provider]
  | [ServiceIdentifier<T>, Provider<T>, RegistrationOptions] // Tuple format with options [token, provider, options]
  | Constructor<T>; // Direct constructor

/**
 * Provider definition type alias.
 *
 * @stable
 * @since 0.1.0
 */
export type ProviderDefinition<T = any> = Provider<T>;

/**
 * Async factory provider type alias.
 *
 * @stable
 * @since 0.1.0
 */
export type AsyncFactoryProvider<T = any> = FactoryProvider<T>;

/**
 * Conditional provider type alias.
 *
 * @stable
 * @since 0.1.0
 */
export type ConditionalProvider<T = any> = Provider<T>;

/**
 * Stream provider type alias.
 *
 * @stable
 * @since 0.1.0
 */
export type StreamProvider<T = any> = Provider<T>;

/**
 * Stream options for streaming providers.
 *
 * @stable
 * @since 0.1.0
 */
export interface StreamOptions<T = any> {
  filter?: (value: T) => boolean;
  batch?: { size: number };
}

/**
 * Registration options for customizing provider behavior.
 *
 * @stable
 * @since 0.1.0
 */
export interface RegistrationOptions {
  scope?: Scope;
  tags?: string[];
  condition?: (context: ResolutionContext) => boolean;
  dispose?: (instance: any) => void | Promise<void>;
  validate?: (instance: any) => void;
  override?: boolean;
  multi?: boolean;
}

/**
 * Container interface defining the public API for dependency injection.
 *
 * @stable
 * @since 0.1.0
 */
export interface IContainer {
  /**
   * Register a provider - supports multiple formats.
   *
   * @template T - The type of the service being registered
   * @param token - The token or constructor to register
   * @param provider - The provider definition
   * @param options - Optional registration options
   * @returns this container for chaining
   */
  register<T>(token: InjectionToken<T>, provider: ProviderDefinition<T>, options?: RegistrationOptions): this;
  register<T>(provider: Provider<T>, options?: RegistrationOptions): this;
  register<T>(token: Constructor<T>): this;


  /**
   * Resolve a dependency.
   *
   * @template T - The type of the service being resolved
   * @param token - The token identifying the dependency
   * @param context - Optional context to pass to the resolution
   * @returns The resolved instance
   */
  resolve<T>(token: InjectionToken<T>, context?: unknown): T;

  /**
   * Resolve a dependency asynchronously.
   */
  resolveAsync<T>(token: InjectionToken<T>): Promise<T>;

  /**
   * Resolve multiple instances for a multi-token.
   */
  resolveMany<T>(token: InjectionToken<T>): T[];

  /**
   * Resolve all instances for a token (including from parent containers).
   * Similar to resolveMany but explicitly resolves from parent containers as well.
   */
  resolveAll<T>(token: InjectionToken<T>): T[];

  /**
   * Resolve an optional dependency.
   */
  resolveOptional<T>(token: InjectionToken<T>): T | undefined;

  /**
   * Register a stream provider.
   */
  registerStream<T>(
    token: InjectionToken<AsyncIterable<T>>,
    provider: ProviderDefinition<AsyncIterable<T>>,
    options?: RegistrationOptions
  ): this;

  /**
   * Resolve a stream dependency.
   */
  resolveStream<T>(token: InjectionToken<AsyncIterable<T>>): AsyncIterable<T>;

  /**
   * Resolve multiple tokens in parallel.
   */
  resolveParallel<T>(tokens: InjectionToken<T>[]): Promise<T[]>;

  /**
   * Resolve multiple tokens with settled results.
   */
  resolveParallelSettled<T>(
    tokens: InjectionToken<T>[]
  ): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: any }>>;

  /**
   * Resolve multiple tokens in batch with options.
   * Supports both array and object map formats.
   */
  resolveBatch<T extends Record<string, InjectionToken<any>> | InjectionToken<any>[]>(
    tokens: T,
    options?: { timeout?: number; failFast?: boolean }
  ): Promise<
    T extends InjectionToken<any>[]
      ? any[]
      : { [K in keyof T]: T[K] extends InjectionToken<infer V> ? V | undefined : never }
  >;

  /**
   * Check if a token is registered.
   */
  has(token: InjectionToken<any>): boolean;

  /**
   * Create a child scope.
   */
  createScope(context?: Partial<ResolutionContext>): IContainer;

  /**
   * Initialize the container and call onInit on all resolved instances.
   */
  initialize(): Promise<void>;

  /**
   * Dispose of the container and its resources.
   */
  dispose(): Promise<void>;

  /**
   * Clear cached instances.
   */
  clearCache(): void;

  /**
   * Get container metadata.
   */
  getMetadata(): ContainerMetadata;

  /**
   * Get context provider.
   */
  getContext(): ContextProvider;

  /**
   * Create a lazy proxy for a dependency.
   */
  resolveLazy<T>(token: InjectionToken<T>): T;

  /**
   * Create an async lazy proxy for a dependency.
   */
  resolveLazyAsync<T>(token: InjectionToken<T>): Promise<T>;

  /**
   * Add middleware to the container.
   *
   * @param middleware - The middleware to add
   * @returns this container for chaining
   */
  addMiddleware(middleware: Middleware<unknown>): this;

  /**
   * Install a plugin.
   *
   * @param plugin - The plugin to install
   * @returns this container for chaining
   */
  use(plugin: Plugin): this;
}

/**
 * Container metadata providing information about container state.
 *
 * @stable
 * @since 0.1.0
 */
export interface ContainerMetadata {
  registrations: number;
  cached: number;
  scopes: number;
  parent?: IContainer;
}

/**
 * Module interface for organizing providers.
 * Unified interface for both DI and Application-level modules.
 *
 * @stable
 * @since 0.1.0
 */
export interface IModule {
  // Core module properties
  name: string;
  version?: string;
  dependencies?: (InjectionToken<any> | string)[];

  // DI configuration
  imports?: IModule[];
  providers?: Array<Provider<any> | ProviderInput<any>>;
  exports?: InjectionToken<any>[];
  global?: boolean;
  requires?: string[];

  // Module metadata
  metadata?: {
    version?: string;
    description?: string;
    author?: string;
    tags?: string[];
    priority?: number;
  };

  // Application lifecycle hooks (compatible with Application.ts)
  configure?(config: any): void | Promise<void>;
  health?(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message?: string; details?: any }>;
  onRegister?(app: any): void | Promise<void>; // app is IApplication but we avoid circular deps
  onStart?(app: any): void | Promise<void>;
  onStop?(app: any): void | Promise<void>;
  onDestroy?(): void | Promise<void>;

  // Original DI lifecycle hooks (kept for compatibility)
  onModuleInit?(): Promise<void> | void;
  onModuleDestroy?(): Promise<void> | void;
}

/**
 * Dynamic module interface for runtime module configuration.
 *
 * @stable
 * @since 0.1.0
 */
export interface DynamicModule extends Omit<IModule, 'name'> {
  module: Constructor<IModule> | IModule;
  global?: boolean;
}

/**
 * Disposable interface for resources that need cleanup.
 *
 * @stable
 * @since 0.1.0
 */
export interface Disposable {
  dispose(): Promise<void> | void;
}

/**
 * Initializable interface for resources that need initialization.
 *
 * @stable
 * @since 0.1.0
 */
export interface Initializable {
  initialize(): Promise<void> | void;
}

/**
 * Module metadata decorator options.
 *
 * @stable
 * @since 0.1.0
 */
export interface ModuleMetadata {
  name?: string;
  imports?: Array<Constructor<any> | IModule | DynamicModule>;
  providers?: Array<Provider<any> | Constructor<any> | [InjectionToken<any>, ProviderDefinition<any>]>;
  exports?: Array<InjectionToken<any> | Provider<any>>;
  controllers?: Constructor<any>[];
  global?: boolean;
}

/**
 * Extended module metadata from decorators with additional module info.
 * Contains optional properties that can be specified via @Module decorator.
 * @internal
 */
export interface ModuleMetadataExtended extends ModuleMetadata {
  requires?: string[];
  version?: string;
  description?: string;
  author?: string;
  tags?: string[];
  onModuleInit?: () => void | Promise<void>;
  onModuleDestroy?: () => void | Promise<void>;
}

// ============================================================================
// Internal Types for Type Safety
// ============================================================================

/**
 * Config token interface - extends Token with config-specific properties.
 * Used for configuration providers that support validation and defaults.
 *
 * @internal
 * @since 0.1.0
 */
export interface ConfigToken<T = unknown> extends Token<T> {
  /** Marks this token as a config token */
  readonly isConfig: true;
  /** Default values for the configuration */
  readonly defaults?: Partial<T>;
  /** Validation function for the configuration value */
  validate?(value: T): void;
}

/**
 * Extended resolution context with internal module tracking.
 *
 * @internal
 * @since 0.1.0
 */
export interface ResolutionContextInternal extends ResolutionContext {
  /** Currently resolving module name - used for access control */
  __resolvingModule?: string;
  /** Context passed via resolve(token, context) call */
  resolveContext?: unknown;
}

/**
 * Dependency object with optional flag and type information.
 * Used when parsing dependency metadata from decorators.
 *
 * @internal
 * @since 0.1.0
 */
export interface DependencyDescriptor {
  /** The dependency token */
  token: InjectionToken<unknown>;
  /** Whether this dependency is optional */
  optional?: boolean;
  /** Type of dependency (context, token, etc.) */
  type?: 'context' | 'token';
}

/**
 * Check if a value is a dependency descriptor.
 *
 * @internal
 * @since 0.1.0
 */
export function isDependencyDescriptor(value: unknown): value is DependencyDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value
  );
}

/**
 * Check if a token is a config token.
 *
 * @internal
 * @since 0.1.0
 */
export function isConfigToken<T>(token: Token<T>): token is ConfigToken<T> {
  return (token as ConfigToken<T>).isConfig === true;
}

/**
 * Stream provider options for filtering and batching.
 * Combined with ProviderDefinition for stream providers.
 *
 * @internal
 * @since 0.1.0
 */
export interface StreamProviderOptions<T = unknown> {
  /** Filter function to apply to stream items */
  filter?: (value: T) => boolean;
  /** Batch configuration */
  batch?: { size: number };
  /** The underlying provider */
  provider?: ProviderDefinition<AsyncIterable<T>>;
}

/**
 * Check if a provider has stream options.
 *
 * @internal
 * @since 0.1.0
 */
export function hasStreamOptions<T>(provider: ProviderDefinition<T> | StreamProviderOptions<T>): provider is StreamProviderOptions<T> {
  const p = provider as StreamProviderOptions<T>;
  return p.filter !== undefined || p.batch !== undefined;
}

/**
 * Conditional provider with when clause.
 *
 * @internal
 * @since 0.1.0
 */
export interface ConditionalProviderWithWhen<T = unknown> {
  when: (context: ResolutionContext) => boolean;
  useFactory: (context: ResolutionContext) => T;
  fallback?: ProviderDefinition<T>;
}

/**
 * Check if a provider is a conditional provider with when clause.
 *
 * @internal
 * @since 0.1.0
 */
export function isConditionalProviderWithWhen<T>(provider: ProviderDefinition<T>): provider is ConditionalProviderWithWhen<T> {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'when' in provider &&
    'useFactory' in provider
  );
}

/**
 * Internal interface for Container that exposes private properties for application use.
 * This interface should only be used by Application and other internal modules.
 * @internal
 */
export interface IContainerInternal extends IContainer {
  /** Internal registrations map - read-only access for introspection */
  readonly registrations?: Map<InjectionToken<unknown>, unknown>;
}
