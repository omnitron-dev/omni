/**
 * Configuration Service
 *
 * Core configuration management service for Titan Framework
 * Provides comprehensive configuration management with multiple sources,
 * validation, hot-reload, and dependency injection support.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { ZodType } from 'zod';
import { Injectable, Inject, Optional } from '@omnitron-dev/nexus';
import { Logger } from 'pino';

import {
  ConfigModuleOptions,
  ConfigSource,
  ConfigValidationResult,
  ConfigChangeEvent,
  ConfigMetadata,
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  CONFIG_DEFAULTS,
} from './config.types.js';
import { ConfigLoader } from './config.loader.js';
import { getValueByPath, setValueByPath, flattenObject } from './config.utils.js';

/**
 * Main configuration service
 */
@Injectable()
export class ConfigService<T = any> extends EventEmitter {
  private config: Record<string, any> = {};
  private schema?: ZodType;
  private loader: ConfigLoader;
  private metadata: ConfigMetadata;
  private watchers = new Map<string, any>();
  private cache = new Map<string, { value: any; timestamp: number }>();
  private logger?: Logger;
  private initialized = false;

  constructor(
    @Inject(CONFIG_OPTIONS_TOKEN) private readonly options: ConfigModuleOptions = {},
    @Optional() @Inject(CONFIG_SCHEMA_TOKEN) schema?: ZodType,
    @Optional() @Inject('Logger') logger?: Logger
  ) {
    super();
    this.schema = schema || options?.schema;
    this.loader = new ConfigLoader();
    this.logger = logger || options?.logger;
    this.metadata = {
      source: 'titan-config',
      loadedAt: new Date(),
      environment: options?.environment || CONFIG_DEFAULTS.environment,
    };
  }

  /**
   * Initialize the configuration service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Load configuration from all sources
      await this.loadConfiguration();

      // Validate if required
      if (this.options.validateOnStartup) {
        const result = this.validate();
        if (!result.success) {
          throw new Error(`Configuration validation failed: ${JSON.stringify(result.errors)}`);
        }
      }

      // Setup file watchers if enabled
      if (this.options.watchForChanges) {
        await this.setupWatchers();
      }

      this.initialized = true;
      this.logger?.info('Configuration service initialized');
      this.emit('initialized', this.config);
    } catch (error) {
      this.logger?.error({ error }, 'Failed to initialize configuration service');
      throw error;
    }
  }

  /**
   * Load configuration from all sources
   */
  private async loadConfiguration(): Promise<void> {
    const sources: ConfigSource[] = [...(this.options.sources || [])];

    // Add automatic environment-based loading
    if (this.options.autoLoad) {
      const environment = this.options.environment || process.env['NODE_ENV'] || 'development';
      const configPath = this.options.configPath || CONFIG_DEFAULTS.configPath;

      // Add default config file
      sources.unshift({
        type: 'file',
        path: path.join(configPath, 'config.default.json'),
        optional: true,
      });

      // Add environment-specific config file
      sources.push({
        type: 'file',
        path: path.join(configPath, `config.${environment}.json`),
        optional: true,
      });

      // Add local override config file
      sources.push({
        type: 'file',
        path: path.join(configPath, 'config.local.json'),
        optional: true,
      });
    }

    // Add environment variables source if enabled (defaults to true unless explicitly disabled)
    if (this.options.loadEnvironment !== false) {
      sources.push({
        type: 'env',
        prefix: process.env['CONFIG_PREFIX'] || '',
        separator: process.env['CONFIG_SEPARATOR'] || '__',
      });
    }

    // Add defaults as the lowest priority source
    if (this.options.defaults) {
      sources.unshift({
        type: 'object',
        data: this.options.defaults,
      });
    }

    // Load all configurations
    this.config = await this.loader.loadAll(sources);

    // Update metadata
    this.metadata.loadedAt = new Date();
    this.metadata.checksum = this.calculateChecksum(this.config);

    this.logger?.debug({ sources: sources.length }, 'Configuration loaded from sources');
  }

  /**
   * Setup file watchers for configuration files
   */
  private async setupWatchers(): Promise<void> {
    const sources = this.options.sources?.filter(s => s.type === 'file' && s.watch) || [];

    for (const source of sources) {
      if (source.type === 'file' && fs.existsSync(source.path)) {
        const watcher = fs.watch(source.path, async (eventType) => {
          if (eventType === 'change') {
            this.logger?.debug({ path: source.path }, 'Configuration file changed');
            await this.reload();
          }
        });

        this.watchers.set(source.path, watcher);
      }
    }
  }

  /**
   * Reload configuration from all sources
   */
  async reload(): Promise<void> {
    const oldConfig = { ...this.config };

    try {
      await this.loadConfiguration();

      // Validate new configuration
      if (this.options.validateOnStartup) {
        const result = this.validate();
        if (!result.success) {
          // Rollback to old configuration
          this.config = oldConfig;
          throw new Error(`Configuration validation failed after reload: ${JSON.stringify(result.errors)}`);
        }
      }

      // Detect changes and emit events
      const changes = this.detectChanges(oldConfig, this.config);
      for (const change of changes) {
        this.emit('change', change);
        this.emit(`change:${change.path}`, change);
      }

      // Clear cache
      this.cache.clear();

      this.logger?.info('Configuration reloaded successfully');
      this.emit('reload', this.config);
    } catch (error) {
      this.logger?.error({ error }, 'Failed to reload configuration');
      this.emit('reload:error', error);
      throw error;
    }
  }

  /**
   * Get configuration value by path
   */
  get<K = any>(path: string, defaultValue?: K): K {
    if (!this.initialized) {
      throw new Error('Configuration service not initialized');
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

    const value = getValueByPath(this.config, path);
    const result = value !== undefined ? value : defaultValue;

    // Update cache
    if (this.options.cache?.enabled && result !== undefined) {
      this.cache.set(path, { value: result, timestamp: Date.now() });

      // Limit cache size
      const maxSize = this.options.cache.maxSize || 1000;
      if (this.cache.size > maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }
    }

    return result as K;
  }

  /**
   * Get required configuration value by path
   */
  require<K = any>(path: string): K {
    const value = this.get<K>(path);
    if (value === undefined) {
      throw new Error(`Required configuration not found: ${path}`);
    }
    return value;
  }

  /**
   * Check if configuration path exists
   */
  has(path: string): boolean {
    return getValueByPath(this.config, path) !== undefined;
  }

  /**
   * Set configuration value by path (runtime only)
   */
  set(path: string, value: any): void {
    const oldValue = getValueByPath(this.config, path);
    setValueByPath(this.config, path, value);

    // Clear cache for this path
    this.cache.delete(path);

    // Emit change event
    const event: ConfigChangeEvent = {
      path,
      oldValue,
      newValue: value,
      source: 'runtime',
      timestamp: new Date(),
    };

    this.emit('change', event);
    this.emit(`change:${path}`, event);
  }

  /**
   * Get the entire configuration object
   */
  getAll(): T {
    return this.config as T;
  }

  /**
   * Get typed configuration subset
   */
  getTyped<K>(schema: ZodType<K>, path?: string): K {
    const data = path ? this.get(path) : this.getAll();
    const result = schema.safeParse(data);

    if (!result.success) {
      throw new Error(`Configuration validation failed: ${JSON.stringify(result.error.issues)}`);
    }

    return result.data;
  }

  /**
   * Validate configuration against schema
   */
  validate(data?: any): ConfigValidationResult {
    if (!this.schema) {
      return { success: true, data: data || this.config };
    }

    const result = this.schema.safeParse(data || this.config);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      errors: result.error.issues,
    };
  }

  /**
   * Get configuration metadata
   */
  getMetadata(): ConfigMetadata {
    return { ...this.metadata };
  }

  /**
   * Detect changes between two configurations
   */
  private detectChanges(oldConfig: any, newConfig: any): ConfigChangeEvent[] {
    const changes: ConfigChangeEvent[] = [];
    const oldFlat = flattenObject(oldConfig);
    const newFlat = flattenObject(newConfig);

    const allKeys = new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]);

    for (const key of allKeys) {
      if (oldFlat[key] !== newFlat[key]) {
        changes.push({
          path: key,
          oldValue: oldFlat[key],
          newValue: newFlat[key],
          source: 'reload',
          timestamp: new Date(),
        });
      }
    }

    return changes;
  }

  /**
   * Calculate configuration checksum
   */
  private calculateChecksum(config: any): string {
    const json = JSON.stringify(config, Object.keys(config).sort());
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  /**
   * Watch for configuration changes
   */
  watch(path: string, callback: (event: ConfigChangeEvent) => void): () => void {
    const eventName = `change:${path}`;
    this.on(eventName, callback);

    // Return unsubscribe function
    return () => {
      this.off(eventName, callback);
    };
  }

  /**
   * Get environment
   */
  get environment(): string {
    return this.metadata.environment || 'development';
  }

  /**
   * Check if running in production
   */
  isProduction(): boolean {
    return this.environment === 'production';
  }

  /**
   * Check if running in development
   */
  isDevelopment(): boolean {
    return this.environment === 'development';
  }

  /**
   * Check if running in test
   */
  isTest(): boolean {
    return this.environment === 'test';
  }

  /**
   * Reset configuration to defaults
   */
  reset(): void {
    this.config = this.options.defaults || {};
    this.cache.clear();
    this.emit('reset', this.config);
  }

  /**
   * Delete configuration value by path
   */
  delete(path: string): boolean {
    const parts = path.split('.');
    const lastKey = parts.pop()!;
    let target = this.config;

    for (const part of parts) {
      target = target[part];
      if (!target) return false;
    }

    if (lastKey in target) {
      const oldValue = target[lastKey];
      delete target[lastKey];
      this.cache.delete(path);

      const event: ConfigChangeEvent = {
        path,
        oldValue,
        newValue: undefined,
        source: 'runtime',
        timestamp: new Date(),
      };

      this.emit('change', event);
      this.emit(`change:${path}`, event);
      return true;
    }

    return false;
  }

  /**
   * Get current environment
   */
  getEnvironment(): string {
    return this.environment;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    // Close file watchers
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    // Clear cache
    this.cache.clear();

    // Remove all listeners
    this.removeAllListeners();

    this.initialized = false;
    this.logger?.debug('Configuration service destroyed');
  }

  /**
   * Alias for destroy() for compatibility
   */
  async dispose(): Promise<void> {
    return this.destroy();
  }
}