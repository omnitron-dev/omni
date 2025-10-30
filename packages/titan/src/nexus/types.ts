/**
 * Core types and interfaces for Nexus DI Container
 */

import { ContextProvider } from './context.js';

/**
 * Constructor type for creating instances
 * Note: Uses any[] for args to maintain DI container flexibility
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = {}, Args extends any[] = any[]> = new (...args: Args) => T;

/**
 * Abstract constructor type for interfaces and abstract classes
 * Note: Uses any[] for args to maintain DI container flexibility
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AbstractConstructor<T = {}, Args extends any[] = any[]> = abstract new (...args: Args) => T;

/**
 * Service identifier that can be a constructor, string, or symbol
 */
export type ServiceIdentifier<T = any> = Constructor<T> | AbstractConstructor<T> | string | symbol | Token<T>;

/**
 * Lifecycle scopes for dependency management
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
 * Token metadata for enhanced type safety and debugging
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
 * Type-safe token for dependency identification
 */
export interface Token<T = any> {
  readonly id: symbol;
  readonly name: string;
  readonly metadata: TokenMetadata;
  readonly type?: T;
  toString(): string;
}

/**
 * Multi-token for registering multiple providers
 */
export interface MultiToken<T = any> extends Token<T> {
  readonly multi: true;
}

/**
 * Factory function for creating instances
 * Note: Uses any[] for args to maintain DI container flexibility
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Factory<T = unknown, Args extends any[] = any[]> = (...args: Args) => T;

/**
 * Async factory function
 * Note: Uses any[] for args to maintain DI container flexibility
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AsyncFactory<T = unknown, Args extends any[] = any[]> = (...args: Args) => Promise<T>;

/**
 * Injection token for dependencies
 */
export type InjectionToken<T = any> = Token<T> | ServiceIdentifier<T>;

/**
 * Resolution context for contextual injection
 */
export interface ResolutionContext {
  container: IContainer;
  scope?: Scope;
  parent?: ResolutionContext;
  metadata?: Record<string, any>;
  [key: string]: any;
}

/**
 * Simplified provider types for specific use cases without 'provide' field
 * These are used when token is provided separately (e.g., in register method)
 */
export type ClassProvider<T = any> = {
  useClass: Constructor<T>;
  scope?: Scope;
  inject?: InjectionToken[];
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
};

export type ValueProvider<T = any> = {
  useValue: T;
  validate?: string | ((value: T) => void);
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
};

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

export type TokenProvider<T = any> = {
  useToken: InjectionToken<T>;
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
};

/**
 * Provider - the actual provider configuration without token
 * Token is passed separately in register(token, provider)
 */
export type Provider<T = any> =
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>
  | TokenProvider<T>
  | Constructor<T>;

/**
 * Provider input - what users can provide when registering
 */
export type ProviderInput<T = any> =
  | Provider<T> // Provider without 'provide' field
  | [ServiceIdentifier<T>, Provider<T>] // Tuple format [token, provider]
  | [ServiceIdentifier<T>, Provider<T>, RegistrationOptions] // Tuple format with options [token, provider, options]
  | Constructor<T>; // Direct constructor

/**
 * Type aliases
 */
export type ProviderDefinition<T = any> = Provider<T>;
export type AsyncFactoryProvider<T = any> = FactoryProvider<T>;
export type ConditionalProvider<T = any> = Provider<T>;
export type StreamProvider<T = any> = Provider<T>;

/**
 * Stream options for streaming providers
 */
export interface StreamOptions<T = any> {
  filter?: (value: T) => boolean;
  batch?: { size: number };
}

/**
 * Registration options
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
 * Container interface
 */
export interface IContainer {
  /**
   * Register a provider - supports multiple formats
   */
  register<T>(token: InjectionToken<T>, provider: ProviderDefinition<T>, options?: RegistrationOptions): this;
  register<T>(provider: Provider<T>, options?: RegistrationOptions): this;
  register<T>(token: Constructor<T>): this;


  /**
   * Resolve a dependency
   */
  resolve<T>(token: InjectionToken<T>, context?: any): T;

  /**
   * Resolve a dependency asynchronously
   */
  resolveAsync<T>(token: InjectionToken<T>): Promise<T>;

  /**
   * Resolve multiple instances for a multi-token
   */
  resolveMany<T>(token: InjectionToken<T>): T[];

  /**
   * Resolve an optional dependency
   */
  resolveOptional<T>(token: InjectionToken<T>): T | undefined;

  /**
   * Register a stream provider
   */
  registerStream<T>(
    token: InjectionToken<AsyncIterable<T>>,
    provider: ProviderDefinition<AsyncIterable<T>>,
    options?: RegistrationOptions
  ): this;

  /**
   * Resolve a stream dependency
   */
  resolveStream<T>(token: InjectionToken<AsyncIterable<T>>): AsyncIterable<T>;

  /**
   * Resolve multiple tokens in parallel
   */
  resolveParallel<T>(tokens: InjectionToken<T>[]): Promise<T[]>;

  /**
   * Resolve multiple tokens with settled results
   */
  resolveParallelSettled<T>(
    tokens: InjectionToken<T>[]
  ): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: any }>>;

  /**
   * Resolve multiple tokens in batch with options
   * Supports both array and object map formats
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
   * Check if a token is registered
   */
  has(token: InjectionToken<any>): boolean;

  /**
   * Create a child scope
   */
  createScope(context?: Partial<ResolutionContext>): IContainer;

  /**
   * Initialize the container and call onInit on all resolved instances
   */
  initialize(): Promise<void>;

  /**
   * Dispose of the container and its resources
   */
  dispose(): Promise<void>;

  /**
   * Clear cached instances
   */
  clearCache(): void;

  /**
   * Get container metadata
   */
  getMetadata(): ContainerMetadata;

  /**
   * Get context provider
   */
  getContext(): ContextProvider;

  /**
   * Create a lazy proxy for a dependency
   */
  resolveLazy<T>(token: InjectionToken<T>): T;

  /**
   * Create an async lazy proxy for a dependency
   */
  resolveLazyAsync<T>(token: InjectionToken<T>): Promise<T>;

  /**
   * Add middleware to the container
   */
  addMiddleware(middleware: any): this;

  /**
   * Install a plugin
   */
  use(plugin: any): this;
}

/**
 * Container metadata
 */
export interface ContainerMetadata {
  registrations: number;
  cached: number;
  scopes: number;
  parent?: IContainer;
}

/**
 * Module interface for organizing providers
 * Unified interface for both DI and Application-level modules
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
 * Dynamic module interface
 */
export interface DynamicModule extends Omit<IModule, 'name'> {
  module: Constructor<IModule> | IModule;
  global?: boolean;
}

/**
 * Disposable interface for resources
 */
export interface Disposable {
  dispose(): Promise<void> | void;
}

/**
 * Initializable interface for resources
 */
export interface Initializable {
  initialize(): Promise<void> | void;
}

/**
 * Module metadata decorator options
 */
export interface ModuleMetadata {
  name?: string;
  imports?: Array<Constructor<any> | IModule | DynamicModule>;
  providers?: Array<Provider<any> | Constructor<any> | [InjectionToken<any>, ProviderDefinition<any>]>;
  exports?: Array<InjectionToken<any> | Provider<any>>;
  controllers?: Constructor<any>[];
  global?: boolean;
}
