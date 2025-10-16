import { ChangeCallback, Disposable, EnvironmentId, SemVer, WatchCallback } from './common.js';
import { EnvironmentMetadata } from './metadata.js';
import { EnvironmentDiff, MergeStrategy } from './operations.js';
import { Infer, Schema } from './schema.js';
import { ValidationResult } from './validation.js';

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

  // Configuration access
  get<K extends keyof Infer<TSchema>>(key: K): Infer<TSchema>[K] | undefined;
  get(key: string): any;
  set<K extends keyof Infer<TSchema>>(key: K, value: Infer<TSchema>[K]): IEnvironment<TSchema>;
  set(key: string, value: any): IEnvironment<TSchema>;
  has(key: string): boolean;
  delete(key: string): IEnvironment<TSchema>;

  // Bulk operations
  merge<T extends Schema>(
    other: IEnvironment<T>,
    strategy?: MergeStrategy
  ): IEnvironment<TSchema>;
  diff<T extends Schema>(other: IEnvironment<T>): EnvironmentDiff;
  patch(diff: EnvironmentDiff): IEnvironment<TSchema>;

  // Composition
  clone(): IEnvironment<TSchema>;

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
}
