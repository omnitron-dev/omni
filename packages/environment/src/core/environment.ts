import * as yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import { ConfigLayer } from '../config/config-layer.js';
import { SecretsLayer } from '../secrets/secrets-layer.js';
import { FileSystemStorage } from '../storage/filesystem.js';
import { TasksLayer } from '../tasks/tasks-layer.js';
import { TargetsLayer } from '../targets/targets-layer.js';
import {
  ChangeCallback,
  Disposable,
  EnvironmentId,
  SemVer,
  WatchCallback
} from '../types/common.js';
import { EnvironmentOptions, IEnvironment } from '../types/environment.js';
import { ISecretsProvider } from '../types/layers.js';
import { createDefaultMetadata, EnvironmentMetadata } from '../types/metadata.js';
import { EnvironmentDiff, MergeStrategy } from '../types/operations.js';
import { Infer, Schema } from '../types/schema.js';
import { IStorageBackend } from '../types/storage.js';
import { ValidationResult } from '../types/validation.js';
import { computeChecksum } from '../utils/checksum.js';
import { deepDiff } from '../utils/deep-diff.js';
import { deepMerge } from '../utils/deep-merge.js';
import { VariablesLayer } from '../variables/variables-layer.js';

/**
 * Extended environment options with layers
 */
export interface ExtendedEnvironmentOptions<TSchema extends Schema = any>
  extends EnvironmentOptions<TSchema> {
  secretsProvider?: ISecretsProvider;
}

/**
 * Core Environment implementation
 */
export class Environment<TSchema extends Schema = any> implements IEnvironment<TSchema> {
  readonly id: EnvironmentId;
  readonly name: string;
  readonly version: SemVer;
  readonly metadata: EnvironmentMetadata;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;

  private config: ConfigLayer<TSchema>;
  private storage?: IStorageBackend;
  private active = false;
  private changeCallbacks: Map<string, Set<ChangeCallback>> = new Map();
  private watchCallbacks: Set<WatchCallback> = new Set();

  // Phase 2 layers
  public secrets?: SecretsLayer;
  public variables: VariablesLayer;
  public tasks: TasksLayer;
  public targets: TargetsLayer;

  constructor(options: ExtendedEnvironmentOptions<TSchema>) {
    this.id = nanoid();
    this.name = options.name;
    this.version = options.version || '1.0.0';
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.createdBy = 'system';

    this.metadata = createDefaultMetadata({
      ...options.metadata,
      checksum: computeChecksum(options.config || {})
    });

    this.config = new ConfigLayer(options.schema, options.config);

    // Initialize Phase 2 layers
    if (options.secretsProvider) {
      this.secrets = new SecretsLayer(options.secretsProvider);
    }

    this.variables = new VariablesLayer({ secrets: this.secrets });
    this.targets = new TargetsLayer();
    this.tasks = new TasksLayer({
      variables: this.variables,
      targets: this.targets
    });
  }

  /**
   * Get value at path
   */
  get(key: string): any {
    return this.config.get(key);
  }

  /**
   * Set value at path
   */
  set(key: string, value: any): IEnvironment<TSchema> {
    const oldValue = this.config.get(key);
    this.config.set(key, value);

    // Update metadata
    (this.metadata as any).changeCount++;
    (this.metadata as any).checksum = computeChecksum(this.config.getAll());
    (this as any).updatedAt = new Date();

    // Notify callbacks
    this.notifyChange(key, value, oldValue);

    return this;
  }

  /**
   * Check if path exists
   */
  has(key: string): boolean {
    return this.config.has(key);
  }

  /**
   * Delete path
   */
  delete(key: string): IEnvironment<TSchema> {
    const oldValue = this.config.get(key);
    this.config.delete(key);

    // Update metadata
    (this.metadata as any).changeCount++;
    (this.metadata as any).checksum = computeChecksum(this.config.getAll());
    (this as any).updatedAt = new Date();

    // Notify callbacks
    this.notifyChange(key, undefined, oldValue);

    return this;
  }

  /**
   * Merge with another environment
   */
  merge<T extends Schema>(
    other: IEnvironment<T>,
    strategy?: MergeStrategy
  ): IEnvironment<TSchema> {
    const thisData = this.config.getAll();
    const otherData = other.toObject();

    const merged = deepMerge(thisData, otherData, strategy);

    const newEnv = new Environment<TSchema>({
      name: this.name,
      schema: this.config.getSchema(),
      config: merged,
      metadata: { ...this.metadata }
    });

    return newEnv;
  }

  /**
   * Compute diff with another environment
   */
  diff<T extends Schema>(other: IEnvironment<T>): EnvironmentDiff {
    const thisData = this.config.getAll();
    const otherData = other.toObject();

    const diffResult = deepDiff(thisData, otherData);

    return {
      added: diffResult.added || {},
      modified: diffResult.modified || {},
      deleted: diffResult.deleted || [],
      metadata: {
        timestamp: new Date(),
        env1Id: this.id,
        env2Id: other.id
      }
    };
  }

  /**
   * Apply diff patch
   */
  patch(diff: EnvironmentDiff): IEnvironment<TSchema> {
    // Clone the current environment
    const newEnv = this.clone();

    // Apply deletions
    for (const path of diff.deleted) {
      newEnv.delete(path);
    }

    // Apply additions and modifications using set method
    // which properly handles nested paths
    for (const [path, value] of Object.entries(diff.added)) {
      newEnv.set(path, value);
    }

    for (const [path, change] of Object.entries(diff.modified)) {
      newEnv.set(path, change.after);
    }

    return newEnv;
  }

  /**
   * Clone environment
   */
  clone(): IEnvironment<TSchema> {
    return new Environment<TSchema>({
      name: `${this.name}-clone`,
      schema: this.config.getSchema(),
      config: this.config.getAll(),
      metadata: { ...this.metadata }
    });
  }

  /**
   * Validate entire configuration
   */
  async validate(): Promise<ValidationResult> {
    return this.config.validate();
  }

  /**
   * Validate specific key
   */
  async validateKey(key: string): Promise<ValidationResult> {
    return this.config.validatePath(key);
  }

  /**
   * Convert to JSON
   */
  toJSON(): Record<string, any> {
    return this.config.getAll();
  }

  /**
   * Convert to YAML
   */
  toYAML(): string {
    return yaml.dump(this.config.getAll());
  }

  /**
   * Convert to object
   */
  toObject(): Infer<TSchema> {
    return this.config.getAll() as Infer<TSchema>;
  }

  /**
   * Activate environment
   */
  async activate(): Promise<void> {
    if (this.active) {
      return;
    }

    // Validate before activation
    const validation = await this.validate();
    if (!validation.valid) {
      throw new Error(
        `Validation failed: ${validation.errors?.map((e) => e.message).join(', ')}`
      );
    }

    this.active = true;
  }

  /**
   * Deactivate environment
   */
  async deactivate(): Promise<void> {
    this.active = false;
  }

  /**
   * Check if environment is active
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Save environment to storage
   */
  async save(path?: string): Promise<void> {
    if (!path && !this.metadata.sourcePath) {
      throw new Error('No path specified for save');
    }

    const savePath = path || this.metadata.sourcePath!;

    // Create storage if not exists
    if (!this.storage) {
      this.storage = new FileSystemStorage({ encoding: 'yaml' });
    }

    const data = {
      id: this.id,
      name: this.name,
      version: this.version,
      metadata: this.metadata,
      config: this.config.getAll(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy
    };

    await this.storage.write(savePath, data);

    // Update metadata
    (this.metadata as any).sourcePath = savePath;
    (this.metadata as any).source = 'file';
  }

  /**
   * Load environment from storage
   */
  async load(path: string): Promise<void> {
    // Create storage if not exists
    if (!this.storage) {
      this.storage = new FileSystemStorage({ encoding: 'yaml' });
    }

    const data = await this.storage.read(path);

    // Update config
    this.config.setAll(data.config || {});

    // Update metadata
    (this.metadata as any).sourcePath = path;
    (this.metadata as any).source = 'file';
    (this as any).updatedAt = new Date();
  }

  /**
   * Watch for changes
   */
  watch(callback: WatchCallback): Disposable {
    this.watchCallbacks.add(callback);

    return {
      dispose: () => {
        this.watchCallbacks.delete(callback);
      }
    };
  }

  /**
   * Watch specific key for changes
   */
  onChange(key: string, callback: ChangeCallback): Disposable {
    if (!this.changeCallbacks.has(key)) {
      this.changeCallbacks.set(key, new Set());
    }
    this.changeCallbacks.get(key)!.add(callback);

    return {
      dispose: () => {
        const callbacks = this.changeCallbacks.get(key);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.changeCallbacks.delete(key);
          }
        }
      }
    };
  }

  /**
   * Set storage backend
   */
  setStorage(storage: IStorageBackend): void {
    this.storage = storage;
  }

  /**
   * Notify change callbacks
   */
  private notifyChange(key: string, newValue: any, oldValue: any): void {
    const callbacks = this.changeCallbacks.get(key);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(newValue, oldValue, key);
        } catch (error) {
          console.error('Error in change callback:', error);
        }
      });
    }
  }

  /**
   * Create environment from file
   */
  static async fromFile<T extends Schema>(
    path: string,
    options?: Partial<ExtendedEnvironmentOptions<T>>
  ): Promise<Environment<T>> {
    const storage = new FileSystemStorage({ encoding: 'yaml' });
    const data = await storage.read(path);

    const env = new Environment<T>({
      name: data.name || options?.name || 'unnamed',
      schema: options?.schema,
      config: data.config || data,
      metadata: {
        ...data.metadata,
        sourcePath: path,
        source: 'file'
      },
      secretsProvider: options?.secretsProvider
    });

    env.setStorage(storage);
    return env;
  }

  /**
   * Create environment from object
   */
  static fromObject<T extends Schema>(
    data: Record<string, any>,
    options?: Partial<ExtendedEnvironmentOptions<T>>
  ): Environment<T> {
    return new Environment<T>({
      name: options?.name || 'unnamed',
      schema: options?.schema,
      config: data,
      metadata: options?.metadata,
      secretsProvider: options?.secretsProvider
    });
  }

  /**
   * Create new environment
   */
  static create<T extends Schema>(options: ExtendedEnvironmentOptions<T>): Environment<T> {
    return new Environment<T>(options);
  }
}
