/**
 * Core types and interfaces for Nexus DI Container
 */

import { ContextProvider } from '../context/context.js';

/**
 * Constructor type for creating instances
 */
export type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * Abstract constructor type for interfaces and abstract classes
 */
export type AbstractConstructor<T = {}> = abstract new (...args: any[]) => T;

/**
 * Service identifier that can be a constructor, string, or symbol
 */
export type ServiceIdentifier<T = any> =
  | Constructor<T>
  | AbstractConstructor<T>
  | string
  | symbol
  | Token<T>;

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
  Request = 'request'
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
 */
export type Factory<T = any> = (...args: any[]) => T;

/**
 * Async factory function
 */
export type AsyncFactory<T = any> = (...args: any[]) => Promise<T>;

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
 * Provider types
 */
export interface ClassProvider<T = any> {
  useClass: Constructor<T>;
  scope?: Scope;
  inject?: InjectionToken[];
}

export interface ValueProvider<T = any> {
  useValue: T;
  validate?: string | ((value: T) => void);
}

export interface FactoryProvider<T = any> {
  useFactory: Factory<T>;
  inject?: InjectionToken[];
  scope?: Scope;
}

export interface AsyncFactoryProvider<T = any> {
  useFactory: AsyncFactory<T>;
  inject?: InjectionToken[];
  scope?: Scope;
  timeout?: number;
  retry?: {
    maxAttempts: number;
    delay: number;
  };
  async?: boolean;
}

export interface TokenProvider<T = any> {
  useToken: InjectionToken<T>;
}

export interface ConditionalProvider<T = any> {
  useFactory: (context: ResolutionContext) => T;
  when: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
}

export interface StreamProvider<T = any> {
  useFactory: Factory<AsyncIterable<T>>;
  inject?: InjectionToken[];
  scope?: Scope;
  filter?: (value: T) => boolean;
  batch?: { size: number };
}

/**
 * Provider union type
 */
export type Provider<T = any> =
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>
  | AsyncFactoryProvider<T>
  | TokenProvider<T>
  | ConditionalProvider<T>
  | Constructor<T>;

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
   * Register a provider
   */
  register<T>(token: InjectionToken<T>, provider: Provider<T>, options?: RegistrationOptions): this;

  /**
   * Register an async provider
   */
  registerAsync<T>(token: InjectionToken<T>, provider: AsyncFactoryProvider<T>, options?: RegistrationOptions): this;

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
  registerStream<T>(token: InjectionToken<AsyncIterable<T>>, provider: Provider<AsyncIterable<T>>, options?: RegistrationOptions): this;

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
  resolveParallelSettled<T>(tokens: InjectionToken<T>[]): Promise<Array<{ status: 'fulfilled', value: T } | { status: 'rejected', reason: any }>>;

  /**
   * Resolve multiple tokens in batch with options
   * Supports both array and object map formats
   */
  resolveBatch<T extends Record<string, InjectionToken<any>> | InjectionToken<any>[]>(
    tokens: T,
    options?: { timeout?: number; failFast?: boolean }
  ): Promise<T extends InjectionToken<any>[] ? any[] : { [K in keyof T]: T[K] extends InjectionToken<infer V> ? V | undefined : never }>;

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
 */
export interface IModule {
  name: string;
  imports?: IModule[];
  providers?: Array<Provider<any> | [InjectionToken<any>, Provider<any>]>;
  exports?: InjectionToken<any>[];
  global?: boolean;
  requires?: string[];
  metadata?: {
    version?: string;
    description?: string;
    author?: string;
    tags?: string[];
  };
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