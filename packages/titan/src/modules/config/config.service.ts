/**
 * Configuration Service
 *
 * Main service for accessing and managing configuration
 */

import { Injectable, Inject, Optional } from '../../decorators/index.js';
import { Errors } from '../../errors/index.js';

import {
  CONFIG_OPTIONS_TOKEN,
  CONFIG_LOADER_SERVICE_TOKEN,
  CONFIG_VALIDATOR_SERVICE_TOKEN,
  CONFIG_WATCHER_SERVICE_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  LOGGER_TOKEN,
} from './config.tokens.js';

import type {
  IConfigProvider,
  IConfigModuleOptions,
  IConfigMetadata,
  IConfigValidationResult,
  IConfigChangeEvent,
  AnyZodSchema,
} from './types.js';

import type { ConfigLoaderService } from './config-loader.service.js';
import type { ConfigValidatorService } from './config-validator.service.js';
import type { ConfigWatcherService } from './config-watcher.service.js';
import type { ILogger } from '../logger/index.js';
import type { ILifecycle } from '../../types/lifecycle.js';

@Injectable()
export class ConfigService implements IConfigProvider, ILifecycle {
  private config: Record<string, any> = {};
  private metadata: IConfigMetadata;
  private cache = new Map<string, { value: any; timestamp: number }>();
  private initialized = false;
  private changeListeners = new Set<(event: IConfigChangeEvent) => void>();

  constructor(
    @Inject(CONFIG_OPTIONS_TOKEN) private readonly options: IConfigModuleOptions,
    @Inject(CONFIG_LOADER_SERVICE_TOKEN) private readonly loader: ConfigLoaderService,
    @Inject(CONFIG_VALIDATOR_SERVICE_TOKEN) private readonly validator: ConfigValidatorService,
    @Optional() @Inject(CONFIG_WATCHER_SERVICE_TOKEN) private readonly watcher?: ConfigWatcherService,
    @Optional() @Inject(CONFIG_SCHEMA_TOKEN) private readonly schema?: AnyZodSchema,
    @Optional() @Inject(LOGGER_TOKEN) private readonly logger?: ILogger
  ) {
    this.metadata = {
      source: 'titan-config',
      loadedAt: new Date(),
      environment: options.environment || process.env['NODE_ENV'] || 'development',
      sources: [],
      validated: false,
      cached: options.cache?.enabled || false,
    };

    // Set initial config from sources if they are object type
    // This allows synchronous access before full initialization
    if (options.sources) {
      for (const source of options.sources) {
        if (source.type === 'object' && source.data) {
          this.config = { ...this.config, ...source.data };
        }
      }
    }
  }

  /**
   * Initialize the configuration service (ILifecycle)
   */
  async onInit(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Load configuration from all sources
      if (this.options.sources && this.options.sources.length > 0) {
        this.config = await this.loader.load(this.options.sources);

        // Update metadata
        this.metadata.sources = this.options.sources.map((s) => ({
          type: s.type,
          name: s.name,
          loaded: true,
        }));
      }

      // Validate if required
      if (this.options.validateOnStartup && this.schema) {
        const result = this.validator.validate(this.config, this.schema);
        if (!result.success) {
          throw Errors.badRequest('Configuration validation failed', {
            errors: result.errors,
          });
        }
        this.metadata.validated = true;
      }

      // Setup file watchers if enabled
      if (this.options.watchForChanges && this.watcher) {
        this.watcher.watch(this.options.sources || [], (event) => {
          this.handleConfigChange(event);
        });
      }

      this.initialized = true;
      this.logger?.info('Configuration service initialized', {
        environment: this.metadata.environment,
        sources: this.metadata.sources?.length || 0,
      });
    } catch (error) {
      this.logger?.error({ error }, 'Failed to initialize configuration service');
      throw error;
    }
  }

  /**
   * Get configuration value by path
   */
  get<T = any>(path: string, defaultValue?: T): T {
    // Auto-initialize if not already done (for synchronous access)
    if (!this.initialized) {
      // For synchronous access, we can't await initialize()
      // Just use the config as-is (it should have been set in constructor)
      // The Application should call initialize() during startup
      this.logger?.debug('ConfigService accessed before initialization, using default config');
    }

    // Check cache if enabled
    if (this.options.cache?.enabled) {
      const cached = this.cache.get(path);
      if (cached) {
        const ttl = this.options.cache.ttl || 60000;
        if (Date.now() - cached.timestamp < ttl) {
          return cached.value;
        }
      }
    }

    // Get value from config
    const value = this.getValueByPath(this.config, path) ?? defaultValue;

    // Cache the value
    if (this.options.cache?.enabled && value !== undefined) {
      this.cache.set(path, { value, timestamp: Date.now() });
    }

    return value;
  }

  /**
   * Get all configuration values
   */
  getAll(): Record<string, any> {
    return { ...this.config };
  }

  /**
   * Check if configuration path exists
   */
  has(path: string): boolean {
    return this.getValueByPath(this.config, path) !== undefined;
  }

  /**
   * Set configuration value (runtime only)
   */
  set(path: string, value: any): void {
    const oldValue = this.getValueByPath(this.config, path);
    this.setValueByPath(this.config, path, value);

    // Clear cache for this path
    this.cache.delete(path);

    // Notify listeners
    const event: IConfigChangeEvent = {
      path,
      oldValue,
      newValue: value,
      source: 'runtime',
      timestamp: new Date(),
    };
    this.notifyChangeListeners(event);
  }

  /**
   * Get typed configuration value
   */
  getTyped<T>(schema: AnyZodSchema, path?: string): T {
    const value = path ? this.get(path) : this.getAll();
    const result = (
      schema as { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } } }
    ).safeParse(value);

    if (!result.success) {
      throw Errors.badRequest(`Configuration validation failed for ${path || 'root'}`, {
        errors: result.error?.issues,
      });
    }

    return result.data as T;
  }

  /**
   * Validate current configuration
   */
  validate(schema?: AnyZodSchema): IConfigValidationResult {
    return this.validator.validate(this.config, schema || this.schema);
  }

  /**
   * Get configuration metadata
   */
  getMetadata(): IConfigMetadata {
    return { ...this.metadata };
  }

  /**
   * Get environment
   */
  get environment(): string {
    return this.metadata.environment;
  }

  /**
   * Subscribe to configuration changes
   */
  onChange(listener: (event: IConfigChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /**
   * Reload configuration from sources
   */
  async reload(): Promise<void> {
    if (!this.options.sources || this.options.sources.length === 0) {
      return;
    }

    const oldConfig = { ...this.config };
    this.config = await this.loader.load(this.options.sources);

    // Clear cache
    this.cache.clear();

    // Validate if required
    if (this.options.validateOnStartup && this.schema) {
      const result = this.validator.validate(this.config, this.schema);
      if (!result.success) {
        // Restore old config on validation failure
        this.config = oldConfig;
        throw Errors.badRequest('Configuration validation failed', {
          errors: result.errors,
        });
      }
    }

    // Update metadata
    this.metadata.loadedAt = new Date();

    // Notify about changes
    this.notifyChangeListeners({
      path: '',
      oldValue: oldConfig,
      newValue: this.config,
      source: 'reload',
      timestamp: new Date(),
    });
  }

  /**
   * Start the configuration service (ILifecycle)
   */
  async onStart(): Promise<void> {
    // Config service is ready after initialization
    this.logger?.debug('ConfigService started');
  }

  /**
   * Stop the configuration service (ILifecycle)
   */
  async onStop(): Promise<void> {
    // Stop watching for changes
    if (this.watcher) {
      this.watcher.unwatch();
    }
    this.logger?.debug('ConfigService stopped');
  }

  /**
   * Destroy the configuration service (ILifecycle)
   */
  async onDestroy(): Promise<void> {
    if (this.watcher) {
      this.watcher.unwatch();
    }
    this.cache.clear();
    this.changeListeners.clear();
    this.logger?.debug('ConfigService destroyed');
  }

  /**
   * Handle configuration file changes
   */
  private async handleConfigChange(event: IConfigChangeEvent): Promise<void> {
    try {
      await this.reload();
      this.logger?.info('Configuration reloaded due to file change', { file: event.path });
    } catch (error) {
      this.logger?.error({ error }, 'Failed to reload configuration');
    }
  }

  /**
   * Notify change listeners
   */
  private notifyChangeListeners(event: IConfigChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger?.error({ error }, 'Error in configuration change listener');
      }
    }
  }

  /**
   * Forbidden keys that could lead to prototype pollution
   */
  private static readonly FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  /**
   * Get value by dot notation path
   * Protected against prototype pollution attacks
   */
  private getValueByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      // Protect against prototype pollution
      if (ConfigService.FORBIDDEN_KEYS.has(key)) {
        this.logger?.warn({ path, key }, 'Attempted access to forbidden config key');
        return undefined;
      }
      if (key) {
        current = current[key];
      }
    }

    return current;
  }

  /**
   * Set value by dot notation path
   */
  private setValueByPath(obj: any, path: string, value: any): void {
    // Handle empty path - replace entire config
    if (!path || path === '') {
      Object.keys(obj).forEach((key) => delete obj[key]);
      Object.assign(obj, value);
      return;
    }

    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key && (!(key in current) || typeof current[key] !== 'object')) {
        current[key] = {};
      }
      if (key) {
        current = current[key];
      }
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey) {
      current[lastKey] = value;
    }
  }
}
