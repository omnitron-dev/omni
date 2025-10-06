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
export type InjectableToken<T = any> = Type<T> | AbstractType<T> | InjectionToken<T>;

/**
 * Injection token for primitives and interfaces
 */
export interface InjectionToken<T = any> {
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
export interface ModuleDefinition {
  id: string;
  imports?: Module[];
  components?: any[];
  directives?: any[];
  pipes?: any[];
  providers?: Provider[];
  exports?: any[];
  exportProviders?: (Provider | Type)[];
  bootstrap?: any;
  metadata?: ModuleMetadata;
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
 * Injector interface
 */
export interface Injector {
  get<T>(token: InjectableToken<T>, options?: InjectOptions): T;
  has(token: InjectableToken): boolean;
  createChild(providers?: Provider[]): Injector;
  dispose(): void;
}

/**
 * Container interface
 */
export interface Container {
  register<T>(token: InjectableToken<T>, provider: Provider<T>): void;
  resolve<T>(token: InjectableToken<T>): T;
  has(token: InjectableToken): boolean;
  clear(): void;
}
