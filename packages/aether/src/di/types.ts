/**
 * Dependency Injection - Type Definitions
 *
 * Core types for the Aether DI system
 */

/**
 * Provider scope types
 */
export type ProviderScope = 'singleton' | 'transient' | 'module' | 'request';

/**
 * Type that can be instantiated
 */
export type Type<T = any> = new (...args: any[]) => T;

/**
 * Abstract type (class without constructor)
 */
export type AbstractType<T = any> = abstract new (...args: any[]) => T;

/**
 * Injectable token - class, abstract class, or injection token
 */
export type InjectableToken<T = any> = Type<T> | AbstractType<T> | InjectionTokenType<T>;

/**
 * Injection token for primitives and interfaces
 */
export interface InjectionTokenType<T = any> {
  readonly _type: T;
  readonly _desc: string;
  toString(): string;
}

/**
 * Provider definition
 */
export type Provider<T = any> =
  | Type<T>
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>
  | ExistingProvider<T>;

/**
 * Class provider
 */
export interface ClassProvider<T = any> {
  provide: InjectableToken<T>;
  useClass: Type<T>;
  scope?: ProviderScope;
  multi?: boolean;
}

/**
 * Value provider
 */
export interface ValueProvider<T = any> {
  provide: InjectableToken<T>;
  useValue: T;
  multi?: boolean;
}

/**
 * Factory provider
 */
export interface FactoryProvider<T = any> {
  provide: InjectableToken<T>;
  useFactory: (...deps: any[]) => T | Promise<T>;
  deps?: InjectableToken[];
  scope?: ProviderScope;
  multi?: boolean;
  async?: boolean;
}

/**
 * Existing provider (alias)
 */
export interface ExistingProvider<T = any> {
  provide: InjectableToken<T>;
  useExisting: InjectableToken<T>;
  multi?: boolean;
}

/**
 * Injectable options
 */
export interface InjectableOptions {
  scope?: ProviderScope;
  providedIn?: 'root' | 'module' | Type<any>;
}

/**
 * Inject options
 */
export interface InjectOptions {
  optional?: boolean;
  self?: boolean;
  skipSelf?: boolean;
}

/**
 * Module definition
 */
export interface ModuleDefinition<T extends ModuleMetadata = ModuleMetadata> {
  // Identity
  id: string;
  version?: string;

  // Dependencies
  imports?: Module[];

  // Services & Stores
  providers?: Provider[];
  stores?: StoreFactory[];

  // Routes
  routes?: RouteDefinition[];

  // Assets
  styles?: string[] | (() => Promise<string[]>);
  assets?: AssetDefinition[];

  // Islands & Hydration
  islands?: IslandDefinition[];

  // Exports
  exports?: any[];
  exportProviders?: (Provider | Type)[];
  exportStores?: string[];

  // Lifecycle
  setup?: ModuleSetup<T>;
  teardown?: ModuleTeardown;

  // Legacy (keep for backwards compatibility)
  bootstrap?: any;

  // Metadata
  metadata?: T;

  // Optimization hints
  optimization?: OptimizationHints;
}

/**
 * Module metadata
 */
export interface ModuleMetadata {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  [key: string]: any;
}

/**
 * Store factory type
 */
export type StoreFactory = () => any | Promise<any>;

/**
 * Route definition (simplified reference)
 */
export interface RouteDefinition {
  path: string;
  component?: any;
  loader?: (context: any) => any | Promise<any>;
  action?: (context: any) => any | Promise<any>;
  guards?: Array<(context: any) => boolean | Promise<boolean> | { redirect: string }>;
  children?: RouteDefinition[];
  meta?: Record<string, any>;
  rendering?: 'static' | 'server' | 'client';
  lazy?: () => Promise<any>;
}

/**
 * Island definition
 */
export interface IslandDefinition {
  id: string;
  component: () => Promise<any>;
  strategy?: 'interaction' | 'visible' | 'idle' | 'immediate';
  props?: Record<string, any>;
  rootMargin?: string;
  timeout?: number;
}

/**
 * Asset definition
 */
export interface AssetDefinition {
  type: 'font' | 'image' | 'style' | 'script';
  src: string;
  preload?: boolean;
  eager?: boolean;
  async?: boolean;
  defer?: boolean;
}

/**
 * Module setup context
 */
export interface SetupContext {
  container: Container;
  router?: any;
  stores?: any;
  config?: Record<string, any>;
  parent?: ModuleContext;
}

/**
 * Module context (returned from setup)
 */
export interface ModuleContext {
  [key: string]: any;
}

/**
 * Module setup function
 */
export type ModuleSetup<_T extends ModuleMetadata = ModuleMetadata> = (
  context: SetupContext
) => ModuleContext | Promise<ModuleContext>;

/**
 * Module teardown function
 */
export type ModuleTeardown = (context: TeardownContext) => void | Promise<void>;

/**
 * Module teardown context
 */
export interface TeardownContext {
  container: Container;
  stores?: any;
}

/**
 * Optimization hints
 */
export interface OptimizationHints {
  preloadModules?: string[];
  prefetchModules?: string[];
  lazyBoundary?: boolean;
  splitChunk?: boolean;
  inline?: boolean;
  sideEffects?: boolean;
  pure?: boolean;
  priority?: 'high' | 'normal' | 'low';
  budget?: {
    maxSize?: number;
    maxAsyncRequests?: number;
  };
}

/**
 * Loaded module
 */
export interface LoadedModule {
  id: string;
  definition: ModuleDefinition;
  container: Container;
  context: ModuleContext;
  status: 'loading' | 'loaded' | 'error';
  error?: Error;
}

/**
 * Module node (for graph)
 */
export interface ModuleNode {
  id: string;
  data: ModuleDefinition;
}

/**
 * Split point (for code splitting)
 */
export interface SplitPoint {
  module: string;
  strategy: 'preload' | 'prefetch' | 'lazy';
  size: number;
}

/**
 * Module with providers
 */
export interface ModuleWithProviders {
  module: Module;
  providers?: Provider[];
}

/**
 * Module interface
 */
export interface Module {
  id: string;
  definition: ModuleDefinition;
}

/**
 * Container interface
 */
export interface Container {
  register<T>(token: InjectableToken<T>, provider: Provider<T>): void;
  resolve<T>(token: InjectableToken<T>): T;
  has(token: InjectableToken): boolean;
  clear(): void;
  dispose(): void;
}

/**
 * Injector interface
 */
export interface Injector extends Container {
  get<T>(token: InjectableToken<T>, options?: InjectOptions): T;
  createChild(providers?: Provider[]): Injector;
}
