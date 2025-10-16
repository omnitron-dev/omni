import * as yaml from 'js-yaml';
import * as TOML from '@iarna/toml';
import { nanoid } from 'nanoid';
import { ConfigLayer } from '../config/config-layer.js';
import { SecretsLayer } from '../secrets/secrets-layer.js';
import { FileSystemStorage } from '../storage/filesystem.js';
import { TasksLayer } from '../tasks/tasks-layer.js';
import { TargetsLayer } from '../targets/targets-layer.js';
import {
  ChangeCallback,
  ChangeEvent,
  Disposable,
  EnvironmentId,
  ErrorCallback,
  ErrorContext,
  LifecycleCallback,
  SemVer,
  WatchCallback,
  WatchEvent,
} from '../types/common.js';
import { EnvironmentOptions, IEnvironment, ResolveOptions } from '../types/environment.js';
import { ISecretsProvider } from '../types/layers.js';
import { createDefaultMetadata, EnvironmentMetadata } from '../types/metadata.js';
import { EnvironmentDiff, MergeStrategy } from '../types/operations.js';
import { Infer, Schema } from '../types/schema.js';
import { IStorageBackend } from '../types/storage.js';
import {
  ContractResult,
  ContractViolation,
  EnvironmentContract,
  ValidatorFunction,
  ValidationContext,
  ValidationResult,
  VerificationFailure,
  VerificationResult,
  VerifyOptions,
} from '../types/validation.js';
import { computeChecksum } from '../utils/checksum.js';
import { deepDiff } from '../utils/deep-diff.js';
import { deepMerge } from '../utils/deep-merge.js';
import { VariablesLayer } from '../variables/variables-layer.js';
import { queryJSONPath, queryWildcard, queryXPath } from '../utils/query.js';
/**
 * Extended environment options with layers
 */
export interface ExtendedEnvironmentOptions<TSchema extends Schema = any> extends EnvironmentOptions<TSchema> {
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

  // Hierarchy support
  readonly parent?: IEnvironment<TSchema>;
  private _children: Set<IEnvironment<TSchema>> = new Set();

  private config: ConfigLayer<TSchema>;
  private storage?: IStorageBackend;
  private active = false;
  private changeCallbacks: Map<string, Set<ChangeCallback>> = new Map();
  private watchCallbacks: Set<WatchCallback> = new Set();

  // Lifecycle hooks
  private beforeActivateCallbacks: Set<LifecycleCallback> = new Set();
  private afterActivateCallbacks: Set<LifecycleCallback> = new Set();
  private beforeDeactivateCallbacks: Set<LifecycleCallback> = new Set();
  private errorCallbacks: Set<ErrorCallback> = new Set();

  // Phase 2 layers
  public secrets?: SecretsLayer;
  public variables: VariablesLayer;
  public tasks: TasksLayer;
  public targets: TargetsLayer;

  // Custom validators
  private validators: Map<string, ValidatorFunction> = new Map();

  constructor(options: ExtendedEnvironmentOptions<TSchema>) {
    this.id = nanoid();
    this.name = options.name;
    this.version = options.version || '1.0.0';
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.createdBy = 'system';

    // Set parent relationship
    this.parent = options.parent;
    if (this.parent && this.parent instanceof Environment) {
      this.parent._children.add(this);
    }

    this.metadata = createDefaultMetadata({
      ...options.metadata,
      checksum: computeChecksum(options.config || {}),
    });

    // Initialize config with inheritance
    let initialConfig = options.config || {};
    if (options.inherit && this.parent) {
      // Merge parent config with child config
      const parentConfig = this.parent.toObject();
      initialConfig = deepMerge(parentConfig, initialConfig, { conflicts: 'prefer-right' });
    }

    this.config = new ConfigLayer(options.schema, initialConfig);

    // Initialize Phase 2 layers
    if (options.secretsProvider) {
      this.secrets = new SecretsLayer(options.secretsProvider);
    }

    this.variables = new VariablesLayer({ secrets: this.secrets });
    this.targets = new TargetsLayer();
    this.tasks = new TasksLayer({
      variables: this.variables,
      targets: this.targets,
    });
  }

  /**
   * Get readonly set of children
   */
  get children(): ReadonlySet<IEnvironment<TSchema>> {
    return this._children;
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
   * Resolve value with hierarchical scope chain
   */
  resolve(key: string, options?: ResolveOptions): any {
    const scope = options?.scope || 'nearest';

    // Self scope - only check current environment
    if (scope === 'self') {
      const value = this.config.get(key);
      if (value !== undefined) {
        return value;
      }
      if (options?.throwIfNotFound) {
        throw new Error(`Key '${key}' not found in environment '${this.name}'`);
      }
      return options?.default;
    }

    // Parent scope - skip current, check parent chain
    if (scope === 'parent') {
      let current = this.parent;
      while (current) {
        const value = current.get(key);
        if (value !== undefined) {
          return value;
        }
        current = current.parent;
      }
      if (options?.throwIfNotFound) {
        throw new Error(`Key '${key}' not found in parent chain of '${this.name}'`);
      }
      return options?.default;
    }

    // Nearest scope - check current then parent chain (default)
    if (scope === 'nearest') {
      const value = this.config.get(key);
      if (value !== undefined) {
        return value;
      }

      let current = this.parent;
      while (current) {
        const parentValue = current.get(key);
        if (parentValue !== undefined) {
          return parentValue;
        }
        current = current.parent;
      }

      if (options?.throwIfNotFound) {
        throw new Error(`Key '${key}' not found in '${this.name}' or parent chain`);
      }
      return options?.default;
    }

    // Global scope - traverse to root, then search down
    if (scope === 'global') {
      let root: IEnvironment<TSchema> = this;
      while (root.parent) {
        root = root.parent;
      }

      const value = root.get(key);
      if (value !== undefined) {
        return value;
      }

      if (options?.throwIfNotFound) {
        throw new Error(`Key '${key}' not found in global scope`);
      }
      return options?.default;
    }

    return options?.default;
  }

  /**
   * Create child environment that inherits from this one
   */
  createChild(options: Partial<EnvironmentOptions<TSchema>> = {}): IEnvironment<TSchema> {
    return new Environment<TSchema>({
      name: options.name || `${this.name}-child`,
      schema: options.schema || this.config.getSchema(),
      config: options.config || {},
      metadata: options.metadata,
      version: options.version || this.version,
      parent: this,
      inherit: options.inherit !== false, // inherit by default
    });
  }

  /**
   * Create isolated context with shared base config
   */
  createContext(contextData: Record<string, any>): IEnvironment<TSchema> {
    return new Environment<TSchema>({
      name: `${this.name}-context`,
      schema: this.config.getSchema(),
      config: contextData,
      metadata: { ...this.metadata },
      version: this.version,
      parent: this,
      inherit: false, // contexts are isolated, no inheritance
    });
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
  merge<T extends Schema>(other: IEnvironment<T>, strategy?: MergeStrategy): IEnvironment<TSchema> {
    const thisData = this.config.getAll();
    const otherData = other.toObject();

    const merged = deepMerge(thisData, otherData, strategy);

    const newEnv = new Environment<TSchema>({
      name: this.name,
      schema: this.config.getSchema(),
      config: merged,
      metadata: { ...this.metadata },
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
        env2Id: other.id,
      },
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
      metadata: { ...this.metadata },
    });
  }

/**
   * Validate entire configuration
   */
  async validate(): Promise<ValidationResult> {
    // First validate schema
    const schemaResult = await this.config.validate();
    if (!schemaResult.valid) {
      return schemaResult;
    }

    // Then run custom validators
    const customErrors: any[] = [];
    for (const [path, validator] of this.validators.entries()) {
      const value = this.get(path);
      const context: ValidationContext = {
        get: (p: string) => this.get(p),
        has: (p: string) => this.has(p),
        root: this.toObject(),
      };

      try {
        const result = await validator(value, context);
        if (!result.valid) {
          if (result.errors) {
            customErrors.push(...result.errors);
          } else if (result.message) {
            customErrors.push({
              path,
              message: result.message,
              value,
            });
          }
        }
      } catch (error) {
        customErrors.push({
          path,
          message: `Validator error: ${(error as Error).message}`,
          value,
        });
      }
    }

    if (customErrors.length > 0) {
      return {
        valid: false,
        errors: customErrors,
      };
    }

    return { valid: true };
  }

  /**
   * Validate specific key
   */
  async validateKey(key: string): Promise<ValidationResult> {
    // First validate schema
    const schemaResult = await this.config.validatePath(key);
    if (!schemaResult.valid) {
      return schemaResult;
    }

    // Then run custom validator if exists
    const validator = this.validators.get(key);
    if (validator) {
      const value = this.get(key);
      const context: ValidationContext = {
        get: (p: string) => this.get(p),
        has: (p: string) => this.has(p),
        root: this.toObject(),
      };

      try {
        const result = await validator(value, context);
        if (!result.valid) {
          return {
            valid: false,
            errors: result.errors || [
              {
                path: key,
                message: result.message || 'Validation failed',
                value,
              },
            ],
          };
        }
      } catch (error) {
        return {
          valid: false,
          errors: [
            {
              path: key,
              message: `Validator error: ${(error as Error).message}`,
              value,
            },
          ],
        };
      }
    }

    return { valid: true };
  }

  /**
   * Add custom validator for specific path
   */
  addValidator(path: string, validator: ValidatorFunction): void {
    this.validators.set(path, validator);
  }

  /**
   * Remove validator for path
   */
  removeValidator(path: string): void {
    this.validators.delete(path);
  }

  /**
   * Verify environment against running system
   */
  async verify(options: VerifyOptions = {}): Promise<VerificationResult> {
    const failures: VerificationFailure[] = [];
    const targets = options.targets || ['default'];
    const checks = options.checks || ['config', 'schema', 'validators'];

    // Check configuration validity
    if (checks.includes('config')) {
      const configData = this.toObject();
      if (!configData || Object.keys(configData).length === 0) {
        failures.push({
          check: 'config',
          message: 'Configuration is empty',
          remediable: true,
        });
      }
    }

    // Check schema validation
    if (checks.includes('schema')) {
      const validation = await this.config.validate();
      if (!validation.valid) {
        failures.push({
          check: 'schema',
          message: 'Schema validation failed',
          actual: validation.errors,
          remediable: true,
        });
      }
    }

    // Check custom validators
    if (checks.includes('validators')) {
      for (const [path, validator] of this.validators.entries()) {
        const value = this.get(path);
        const context: ValidationContext = {
          get: (p: string) => this.get(p),
          has: (p: string) => this.has(p),
          root: this.toObject(),
        };

        try {
          const result = await validator(value, context);
          if (!result.valid) {
            failures.push({
              check: 'validators',
              target: path,
              message: result.message || 'Custom validator failed',
              actual: value,
              remediable: true,
            });
          }
        } catch (error) {
          failures.push({
            check: 'validators',
            target: path,
            message: `Validator error: ${(error as Error).message}`,
            remediable: false,
          });
        }
      }
    }

    // Check target-specific configurations
    if (checks.includes('targets')) {
      for (const target of targets) {
        const targetConfig = this.targets.get(target);
        if (!targetConfig) {
          failures.push({
            check: 'targets',
            target,
            message: `Target '${target}' not found`,
            remediable: true,
          });
        }
      }
    }

    // Check metadata integrity
    if (checks.includes('metadata')) {
      if (!this.metadata.checksum) {
        failures.push({
          check: 'metadata',
          message: 'Missing checksum in metadata',
          remediable: true,
        });
      }

      const currentChecksum = computeChecksum(this.toObject());
      if (this.metadata.checksum !== currentChecksum) {
        failures.push({
          check: 'metadata',
          message: 'Checksum mismatch - configuration drift detected',
          expected: this.metadata.checksum,
          actual: currentChecksum,
          remediable: true,
        });
      }
    }

    const remediable = failures.every((f) => f.remediable);

    return {
      passed: failures.length === 0,
      failures,
      remediable,
    };
  }

  /**
   * Verify environment satisfies contract
   */
  async verifyContract(contract: EnvironmentContract): Promise<ContractResult> {
    const violations: ContractViolation[] = [];

    // Check required fields
    for (const requiredPath of contract.required) {
      if (!this.has(requiredPath)) {
        violations.push({
          type: 'missing',
          path: requiredPath,
          message: `Required field '${requiredPath}' is missing`,
        });
      }
    }

    // Check types if specified
    if (contract.types) {
      for (const [path, expectedType] of Object.entries(contract.types)) {
        if (!this.has(path)) {
          continue; // Already caught by required check if needed
        }

        const value = this.get(path);
        const actualType = this.getValueType(value);

        if (actualType !== expectedType) {
          violations.push({
            type: 'type-mismatch',
            path,
            message: `Type mismatch for '${path}': expected ${expectedType}, got ${actualType}`,
            expected: expectedType,
            actual: actualType,
          });
        }
      }
    }

    // Check constraints if specified
    if (contract.constraints) {
      for (const [path, constraint] of Object.entries(contract.constraints)) {
        if (!this.has(path)) {
          continue; // Already caught by required check if needed
        }

        const value = this.get(path);
        const violation = this.checkConstraint(path, value, constraint);
        if (violation) {
          violations.push(violation);
        }
      }
    }

    return {
      satisfied: violations.length === 0,
      violations,
    };
  }

  /**
   * Get type of value as string
   */
  private getValueType(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Check constraint on value
   */
  private checkConstraint(path: string, value: any, constraint: any): ContractViolation | null {
    // Numeric constraints
    if (typeof constraint === 'object' && constraint !== null) {
      // Min/max for numbers
      if ('min' in constraint && typeof value === 'number' && value < constraint.min) {
        return {
          type: 'constraint-violation',
          path,
          message: `Value ${value} is less than minimum ${constraint.min}`,
          expected: `>= ${constraint.min}`,
          actual: value,
        };
      }

      if ('max' in constraint && typeof value === 'number' && value > constraint.max) {
        return {
          type: 'constraint-violation',
          path,
          message: `Value ${value} is greater than maximum ${constraint.max}`,
          expected: `<= ${constraint.max}`,
          actual: value,
        };
      }

      // MinLength/maxLength for strings and arrays
      if ('minLength' in constraint) {
        const length = typeof value === 'string' || Array.isArray(value) ? value.length : 0;
        if (length < constraint.minLength) {
          return {
            type: 'constraint-violation',
            path,
            message: `Length ${length} is less than minimum ${constraint.minLength}`,
            expected: `length >= ${constraint.minLength}`,
            actual: length,
          };
        }
      }

      if ('maxLength' in constraint) {
        const length = typeof value === 'string' || Array.isArray(value) ? value.length : 0;
        if (length > constraint.maxLength) {
          return {
            type: 'constraint-violation',
            path,
            message: `Length ${length} is greater than maximum ${constraint.maxLength}`,
            expected: `length <= ${constraint.maxLength}`,
            actual: length,
          };
        }
      }

      // Pattern for strings
      if ('pattern' in constraint && typeof value === 'string') {
        const regex = new RegExp(constraint.pattern);
        if (!regex.test(value)) {
          return {
            type: 'constraint-violation',
            path,
            message: `Value '${value}' does not match pattern ${constraint.pattern}`,
            expected: constraint.pattern,
            actual: value,
          };
        }
      }

      // Enum values
      if ('enum' in constraint && Array.isArray(constraint.enum)) {
        if (!constraint.enum.includes(value)) {
          return {
            type: 'constraint-violation',
            path,
            message: `Value '${value}' is not in allowed enum values`,
            expected: constraint.enum,
            actual: value,
          };
        }
      }
    }

    // Direct value comparison
    if (constraint !== value && typeof constraint !== 'object') {
      return {
        type: 'constraint-violation',
        path,
        message: `Value does not match constraint`,
        expected: constraint,
        actual: value,
      };
    }

    return null;
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
   * Convert to TOML
   * Handles special values (Date, RegExp, undefined) with proper TOML formatting
   */
  toTOML(): string {
    const data = this.config.getAll();

    // Helper function to sanitize data for TOML
    const sanitizeForTOML = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return null;
      }

      if (obj instanceof Date) {
        return obj;
      }

      if (obj instanceof RegExp) {
        return obj.toString();
      }

      if (Array.isArray(obj)) {
        return obj.map(sanitizeForTOML);
      }

      if (typeof obj === 'object') {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
          const sanitized = sanitizeForTOML(value);
          if (sanitized !== null && sanitized !== undefined) {
            result[key] = sanitized;
          }
        }
        return result;
      }

      return obj;
    };

    const sanitized = sanitizeForTOML(data);
    return TOML.stringify(sanitized);
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

    try {
      // Call before activate hooks
      await this.callLifecycleHooks(this.beforeActivateCallbacks, 'activate');

      // Validate before activation
      const validation = await this.validate();
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors?.map((e) => e.message).join(', ')}`);
      }

      this.active = true;

      // Call after activate hooks
      await this.callLifecycleHooks(this.afterActivateCallbacks, 'activate');
    } catch (error) {
      this.notifyError(error as Error, { operation: 'activate', phase: 'activate' });
      throw error;
    }
  }

  /**
   * Deactivate environment
   */
  async deactivate(): Promise<void> {
    if (!this.active) {
      return;
    }

    try {
      // Call before deactivate hooks
      await this.callLifecycleHooks(this.beforeDeactivateCallbacks, 'deactivate');

      this.active = false;
    } catch (error) {
      this.notifyError(error as Error, { operation: 'deactivate', phase: 'deactivate' });
      throw error;
    }
  }

  /**
   * Call lifecycle hooks
   */
  private async callLifecycleHooks(hooks: Set<LifecycleCallback>, phase: string): Promise<void> {
    if (hooks.size === 0) return;

    const promises: Promise<void>[] = [];
    hooks.forEach((hook) => {
      try {
        const result = hook(this);
        if (result instanceof Promise) {
          promises.push(result);
        }
      } catch (error) {
        this.notifyError(error as Error, { operation: 'lifecycle', phase: phase as any });
      }
    });

    if (promises.length > 0) {
      await Promise.all(promises);
    }
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
      createdBy: this.createdBy,
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
      },
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
      },
    };
  }

  /**
   * Register callback to be called before environment activation
   */
  onBeforeActivate(callback: LifecycleCallback): Disposable {
    this.beforeActivateCallbacks.add(callback);

    return {
      dispose: () => {
        this.beforeActivateCallbacks.delete(callback);
      },
    };
  }

  /**
   * Register callback to be called after environment activation
   */
  onAfterActivate(callback: LifecycleCallback): Disposable {
    this.afterActivateCallbacks.add(callback);

    return {
      dispose: () => {
        this.afterActivateCallbacks.delete(callback);
      },
    };
  }

  /**
   * Register callback to be called before environment deactivation
   */
  onBeforeDeactivate(callback: LifecycleCallback): Disposable {
    this.beforeDeactivateCallbacks.add(callback);

    return {
      dispose: () => {
        this.beforeDeactivateCallbacks.delete(callback);
      },
    };
  }

  /**
   * Register callback to be called on errors
   */
  onError(callback: ErrorCallback): Disposable {
    this.errorCallbacks.add(callback);

    return {
      dispose: () => {
        this.errorCallbacks.delete(callback);
      },
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
    // Notify onChange callbacks
    const callbacks = this.changeCallbacks.get(key);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(newValue, oldValue, key);
        } catch (error) {
          this.notifyError(error as Error, { operation: 'onChange', key, phase: 'set' });
        }
      });
    }

    // Notify watch callbacks with ChangeEvent
    if (this.watchCallbacks.size > 0) {
      const changeEvent: ChangeEvent = {
        type: newValue === undefined ? 'delete' : 'set',
        key,
        newValue,
        oldValue,
        timestamp: new Date(),
      };

      // WatchEvent uses 'path' and different 'type' enum
      const watchEvent: WatchEvent = {
        type: newValue === undefined ? 'deleted' : oldValue === undefined ? 'created' : 'modified',
        path: key,
        timestamp: changeEvent.timestamp,
      };

      this.watchCallbacks.forEach((cb) => {
        try {
          cb(watchEvent);
        } catch (error) {
          this.notifyError(error as Error, { operation: 'watch', key, phase: 'set' });
        }
      });
    }
  }

  /**
   * Notify error callbacks
   */
  private notifyError(error: Error, context: ErrorContext): void {
    if (this.errorCallbacks.size > 0) {
      this.errorCallbacks.forEach((cb) => {
        try {
          cb(error, context);
        } catch (cbError) {
          // Prevent infinite loops - log but don't recurse
          console.error('Error in error callback:', cbError);
        }
      });
    }
  }

  /**
   * Create environment from file
   * Auto-detects format from file extension (.yaml, .yml, .json)
   * Supports nested structure with name, config, metadata fields
   */
  static async fromFile<T extends Schema>(
    filePath: string,
    options?: Partial<ExtendedEnvironmentOptions<T>>
  ): Promise<Environment<T>> {
    // Auto-detect format from extension
    const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
    let encoding: 'yaml' | 'json' = 'yaml';

    if (ext === '.json') {
      encoding = 'json';
    } else if (ext === '.yaml' || ext === '.yml') {
      encoding = 'yaml';
    }

    const storage = new FileSystemStorage({ encoding });
    const data = await storage.read(filePath);

    // Support both flat config and nested structure
    const config = data.config !== undefined ? data.config : data;
    const name = data.name || options?.name || filePath.split('/').pop()?.split('.')[0] || 'unnamed';

    const env = new Environment<T>({
      name,
      schema: options?.schema,
      config,
      metadata: {
        ...data.metadata,
        ...options?.metadata,
        sourcePath: filePath,
        source: 'file',
      },
      version: data.version || options?.version,
      secretsProvider: options?.secretsProvider,
    });

    env.setStorage(storage);
    return env;
  }

  /**
   * Create environment from object
   * Supports nested structure with name, config, metadata fields
   * or flat structure with config directly in the object
   */
  static fromObject<T extends Schema>(
    data: Record<string, any>,
    options?: Partial<ExtendedEnvironmentOptions<T>>
  ): Environment<T> {
    // Extract name, config, metadata from nested structure if present
    const name = data.name || options?.name || 'unnamed';
    const config = data.config !== undefined ? data.config : data;
    const metadata = data.metadata || options?.metadata;
    const version = data.version || options?.version;

    return new Environment<T>({
      name,
      schema: options?.schema,
      config,
      metadata,
      version,
      secretsProvider: options?.secretsProvider,
    });
  }

  /**
   * Create new environment
   */
  static create<T extends Schema>(options: ExtendedEnvironmentOptions<T>): Environment<T> {
    return new Environment<T>(options);
  }

  /**
   * Create a builder for fluent environment creation
   */
  static builder<T extends Schema = any>(): import('./environment-builder.js').EnvironmentBuilder<T> {
    // Use lazy loading via dynamic import
    // Note: Users can also import EnvironmentBuilder directly
    const { EnvironmentBuilder } = require('./environment-builder.js');
    return new EnvironmentBuilder();
  }

  /**
   * Create a distributed environment with synchronization
   */
  static async createDistributed<T extends Schema>(
    options: import('../types/distributed.js').DistributedOptions
  ): Promise<Environment<T>> {
    // Import distributed module
    const { createDistributed } = await import('./environment-distributed.js');
    return createDistributed<T>(options);
  }

  /**
   * Wait for environment to sync with all nodes
   */
  async waitForSync(timeout: number = 30000): Promise<void> {
    // Import distributed module
    const { waitForSync } = await import('./environment-distributed.js');
    return waitForSync(this, timeout);
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): import('../types/distributed.js').SyncStatus {
    // Import distributed module synchronously
    const { getSyncStatus } = require('./environment-distributed.js');
    return getSyncStatus(this);
  }

  /**
   * Check if enough nodes are available for quorum
   */
  hasQuorum(): boolean {
    // Import distributed module synchronously
    const { hasQuorum } = require('./environment-distributed.js');
    return hasQuorum(this);
  }

  /**
   * Algebraic Operations
   */

  /**
   * Union operation - Returns new environment with all keys from both environments
   * Values from 'other' override values from this environment for duplicate keys
   */
  union<T extends Schema>(other: IEnvironment<T>): IEnvironment<TSchema> {
    const thisData = this.config.getAll();
    const otherData = other.toObject();

    // Deep merge with 'other' taking precedence
    const merged = deepMerge(thisData, otherData, { conflicts: 'prefer-right' });

    return new Environment<TSchema>({
      name: `${this.name}-union`,
      schema: this.config.getSchema(),
      config: merged,
      metadata: { ...this.metadata },
    });
  }

  /**
   * Intersection operation - Returns new environment with only keys present in both environments
   * Values are taken from this environment
   */
  intersect<T extends Schema>(other: IEnvironment<T>): IEnvironment<TSchema> {
    const thisData = this.config.getAll();
    const otherData = other.toObject();

    const intersection: Record<string, any> = {};

    // Helper function to recursively find common keys
    const findIntersection = (obj1: any, obj2: any, result: any): void => {
      for (const key in obj1) {
        if (key in obj2) {
          if (
            typeof obj1[key] === 'object' &&
            obj1[key] !== null &&
            !Array.isArray(obj1[key]) &&
            typeof obj2[key] === 'object' &&
            obj2[key] !== null &&
            !Array.isArray(obj2[key])
          ) {
            result[key] = {};
            findIntersection(obj1[key], obj2[key], result[key]);
            // Remove empty objects
            if (Object.keys(result[key]).length === 0) {
              delete result[key];
            }
          } else {
            result[key] = obj1[key];
          }
        }
      }
    };

    findIntersection(thisData, otherData, intersection);

    return new Environment<TSchema>({
      name: `${this.name}-intersect`,
      schema: this.config.getSchema(),
      config: intersection,
      metadata: { ...this.metadata },
    });
  }

  /**
   * Subtract operation - Returns new environment with keys in this but not in other
   * Set difference operation
   */
  subtract<T extends Schema>(other: IEnvironment<T>): IEnvironment<TSchema> {
    const thisData = this.config.getAll();
    const otherData = other.toObject();

    const difference: Record<string, any> = {};

    // Helper function to recursively find difference
    const findDifference = (obj1: any, obj2: any, result: any): void => {
      for (const key in obj1) {
        if (!(key in obj2)) {
          result[key] = obj1[key];
        } else if (
          typeof obj1[key] === 'object' &&
          obj1[key] !== null &&
          !Array.isArray(obj1[key]) &&
          typeof obj2[key] === 'object' &&
          obj2[key] !== null &&
          !Array.isArray(obj2[key])
        ) {
          result[key] = {};
          findDifference(obj1[key], obj2[key], result[key]);
          // Remove empty objects
          if (Object.keys(result[key]).length === 0) {
            delete result[key];
          }
        }
      }
    };

    findDifference(thisData, otherData, difference);

    return new Environment<TSchema>({
      name: `${this.name}-subtract`,
      schema: this.config.getSchema(),
      config: difference,
      metadata: { ...this.metadata },
    });
  }

  /**
   * Symmetric difference operation - Returns new environment with keys in either but not both
   * (A ∪ B) - (A ∩ B)
   */
  symmetricDifference<T extends Schema>(other: IEnvironment<T>): IEnvironment<TSchema> {
    const thisData = this.config.getAll();
    const otherData = other.toObject();

    const symDiff: Record<string, any> = {};

    // Helper function to recursively find symmetric difference
    const findSymDiff = (obj1: any, obj2: any, result: any): void => {
      // Keys only in obj1
      for (const key in obj1) {
        if (!(key in obj2)) {
          result[key] = obj1[key];
        } else if (
          typeof obj1[key] === 'object' &&
          obj1[key] !== null &&
          !Array.isArray(obj1[key]) &&
          typeof obj2[key] === 'object' &&
          obj2[key] !== null &&
          !Array.isArray(obj2[key])
        ) {
          result[key] = {};
          findSymDiff(obj1[key], obj2[key], result[key]);
          if (Object.keys(result[key]).length === 0) {
            delete result[key];
          }
        }
      }

      // Keys only in obj2
      for (const key in obj2) {
        if (!(key in obj1)) {
          result[key] = obj2[key];
        }
      }
    };

    findSymDiff(thisData, otherData, symDiff);

    return new Environment<TSchema>({
      name: `${this.name}-symdiff`,
      schema: this.config.getSchema(),
      config: symDiff,
      metadata: { ...this.metadata },
    });
  }

  /**
   * Functional Transformations
   */

  /**
   * Map operation - Transform all values using provided function
   * Creates a new environment with transformed values
   * Function is applied to leaf values (primitives) only
   */
  map(fn: (value: any, key: string) => any): IEnvironment<TSchema> {
    const data = this.config.getAll();

    // Helper function to recursively map over nested objects
    const mapRecursive = (obj: any, path: string = ''): any => {
      if (typeof obj !== 'object' || obj === null) {
        return fn(obj, path);
      }

      if (Array.isArray(obj)) {
        return obj.map((item, index) => mapRecursive(item, `${path}[${index}]`));
      }

      const result: Record<string, any> = {};
      for (const key in obj) {
        const newPath = path ? `${path}.${key}` : key;
        result[key] = mapRecursive(obj[key], newPath);
      }

      return result;
    };

    const mapped = mapRecursive(data);

    return new Environment<TSchema>({
      name: `${this.name}-mapped`,
      schema: this.config.getSchema(),
      config: mapped,
      metadata: { ...this.metadata },
    });
  }

  /**
   * Filter operation - Filter keys based on predicate
   * Creates a new environment with only values that satisfy the predicate
   */
  filter(predicate: (value: any, key: string) => boolean): IEnvironment<TSchema> {
    const data = this.config.getAll();

    // Helper function to recursively filter nested objects
    const filterRecursive = (obj: any, path: string = ''): any => {
      if (typeof obj !== 'object' || obj === null) {
        return predicate(obj, path) ? obj : undefined;
      }

      if (Array.isArray(obj)) {
        const filtered = obj
          .map((item, index) => filterRecursive(item, `${path}[${index}]`))
          .filter((item) => item !== undefined);
        return filtered.length > 0 ? filtered : undefined;
      }

      const result: Record<string, any> = {};
      for (const key in obj) {
        const newPath = path ? `${path}.${key}` : key;
        const filtered = filterRecursive(obj[key], newPath);
        if (filtered !== undefined) {
          result[key] = filtered;
        }
      }

      return Object.keys(result).length > 0 ? result : undefined;
    };

    const filtered = filterRecursive(data) || {};

    return new Environment<TSchema>({
      name: `${this.name}-filtered`,
      schema: this.config.getSchema(),
      config: filtered,
      metadata: { ...this.metadata },
    });
  }

  /**
   * Reduce operation - Reduce all values to a single value
   * Processes values in depth-first order
   */
  reduce<T>(fn: (acc: T, value: any, key: string) => T, initial: T): T {
    const data = this.config.getAll();

    // Helper function to recursively reduce values
    const reduceRecursive = (obj: any, path: string = '', acc: T): T => {
      if (typeof obj !== 'object' || obj === null) {
        return fn(acc, obj, path);
      }

      if (Array.isArray(obj)) {
        return obj.reduce((currentAcc, item, index) => {
          return reduceRecursive(item, `${path}[${index}]`, currentAcc);
        }, acc);
      }

      let currentAcc = acc;
      for (const key in obj) {
        const newPath = path ? `${path}.${key}` : key;
        currentAcc = reduceRecursive(obj[key], newPath, currentAcc);
      }

      return currentAcc;
    };

    return reduceRecursive(data, '', initial);
  }

  /**
   * FlatMap operation - Transform and flatten values
   * Each value can be transformed into multiple key-value pairs
   */
  flatMap(fn: (value: any, key: string) => [string, any][]): IEnvironment<TSchema> {
    const data = this.config.getAll();
    const result: Record<string, any> = {};

    // Helper function to recursively flatMap values
    const flatMapRecursive = (obj: any, path: string = ''): void => {
      if (typeof obj !== 'object' || obj === null) {
        const pairs = fn(obj, path);
        for (const [key, value] of pairs) {
          // Set the value at the new key path
          let target = result;
          const parts = key.split('.');
          for (let i = 0; i < parts.length - 1; i++) {
            if (!(parts[i] in target)) {
              target[parts[i]] = {};
            }
            target = target[parts[i]];
          }
          target[parts[parts.length - 1]] = value;
        }
        return;
      }

      if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          flatMapRecursive(item, `${path}[${index}]`);
        });
        return;
      }

      for (const key in obj) {
        const newPath = path ? `${path}.${key}` : key;
        flatMapRecursive(obj[key], newPath);
      }
    };

    flatMapRecursive(data);

    return new Environment<TSchema>({
      name: `${this.name}-flatmapped`,
      schema: this.config.getSchema(),
      config: result,
      metadata: { ...this.metadata },
    });
  }

  /**
   * Advanced Querying Methods
   */

  /**
   * Query with wildcard support
   * Supports simple paths, wildcards, and array access patterns
   *
   * @param pattern - The wildcard pattern to match
   * @returns Array of matching values (empty array if no matches)
   */
  query(pattern: string): any[] {
    const data = this.config.getAll();
    return queryWildcard(data, pattern);
  }

  /**
   * Query using JSONPath syntax
   * Standard JSONPath syntax with full support via jsonpath-plus
   *
   * @param pattern - The JSONPath pattern
   * @returns Array of matching values (empty array if no matches or errors)
   */
  queryJSONPath(pattern: string): any[] {
    const data = this.config.getAll();
    return queryJSONPath(data, pattern);
  }

  /**
   * Query using XPath-style syntax (simplified)
   * Supports XPath-like patterns for nested data access
   *
   * @param pattern - The XPath-style pattern
   * @returns Array of matching values (empty array if no matches)
   */
  queryXPath(pattern: string): any[] {
    const data = this.config.getAll();
    return queryXPath(data, pattern);
  }
}
