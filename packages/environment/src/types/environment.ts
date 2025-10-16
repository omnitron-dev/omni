import {
  ChangeCallback,
  Disposable,
  EnvironmentId,
  ErrorCallback,
  LifecycleCallback,
  SemVer,
  WatchCallback,
} from './common.js';
import { EnvironmentMetadata } from './metadata.js';
import { EnvironmentDiff, MergeStrategy } from './operations.js';
import { Infer, Schema } from './schema.js';
import { ValidationResult } from './validation.js';

/**
 * Scope for value resolution
 */
export type ResolveScope = 'self' | 'nearest' | 'parent' | 'global';

/**
 * Options for resolving values with hierarchy support
 */
export interface ResolveOptions {
  /**
   * Scope to search for the value
   * - 'self': Only search in current environment
   * - 'nearest': Search current and parent chain (default)
   * - 'parent': Search only in parent chain, skip current
   * - 'global': Search up to root parent
   */
  scope?: ResolveScope;

  /**
   * Default value if key is not found
   */
  default?: any;

  /**
   * Whether to throw if key not found (overrides default)
   */
  throwIfNotFound?: boolean;
}

/**
 * Core Environment interface
 * All environment implementations must satisfy this contract
 */
export interface IEnvironment<TSchema extends Schema = any> {
  // Identity
  readonly id: EnvironmentId;
  readonly name: string;
  readonly version: SemVer;

  // Metadata
  readonly metadata: EnvironmentMetadata;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;

  // Hierarchy
  readonly parent?: IEnvironment<TSchema>;
  readonly children: ReadonlySet<IEnvironment<TSchema>>;

  // Configuration access
  get<K extends keyof Infer<TSchema>>(key: K): Infer<TSchema>[K] | undefined;
  get(key: string): any;
  set<K extends keyof Infer<TSchema>>(key: K, value: Infer<TSchema>[K]): IEnvironment<TSchema>;
  set(key: string, value: any): IEnvironment<TSchema>;
  has(key: string): boolean;
  delete(key: string): IEnvironment<TSchema>;

  // Hierarchical access
  resolve(key: string, options?: ResolveOptions): any;
  createChild(options?: Partial<EnvironmentOptions<TSchema>>): IEnvironment<TSchema>;
  createContext(contextData: Record<string, any>): IEnvironment<TSchema>;

  // Bulk operations
  merge<T extends Schema>(other: IEnvironment<T>, strategy?: MergeStrategy): IEnvironment<TSchema>;
  diff<T extends Schema>(other: IEnvironment<T>): EnvironmentDiff;
  patch(diff: EnvironmentDiff): IEnvironment<TSchema>;

  // Composition
  clone(): IEnvironment<TSchema>;

  // Algebraic operations
  union<T extends Schema>(other: IEnvironment<T>): IEnvironment<TSchema>;
  intersect<T extends Schema>(other: IEnvironment<T>): IEnvironment<TSchema>;
  subtract<T extends Schema>(other: IEnvironment<T>): IEnvironment<TSchema>;
  symmetricDifference<T extends Schema>(other: IEnvironment<T>): IEnvironment<TSchema>;

  // Functional transformations
  map(fn: (value: any, key: string) => any): IEnvironment<TSchema>;
  filter(predicate: (value: any, key: string) => boolean): IEnvironment<TSchema>;
  reduce<T>(fn: (acc: T, value: any, key: string) => T, initial: T): T;
  flatMap(fn: (value: any, key: string) => [string, any][]): IEnvironment<TSchema>;

  // Validation
  validate(): Promise<ValidationResult>;
  validateKey(key: string): Promise<ValidationResult>;

  // Serialization
  toJSON(): Record<string, any>;
  toYAML(): string;
  toObject(): Infer<TSchema>;

  // State management
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  isActive(): boolean;

  // Persistence
  save(path?: string): Promise<void>;
  load(path: string): Promise<void>;

  // Observation
  watch(callback: WatchCallback): Disposable;
  onChange(key: string, callback: ChangeCallback): Disposable;

  // Lifecycle hooks
  onBeforeActivate(callback: LifecycleCallback): Disposable;
  onAfterActivate(callback: LifecycleCallback): Disposable;
  onBeforeDeactivate(callback: LifecycleCallback): Disposable;
  onError(callback: ErrorCallback): Disposable;
}

/**
 * Environment creation options
 */
export interface EnvironmentOptions<TSchema extends Schema = any> {
  name: string;
  schema?: TSchema;
  config?: Record<string, any>;
  metadata?: Partial<EnvironmentMetadata>;
  version?: SemVer;

  /**
   * Parent environment for hierarchy
   */
  parent?: IEnvironment<TSchema>;

  /**
   * Whether to inherit parent configuration
   */
  inherit?: boolean;
}
