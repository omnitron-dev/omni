/**
 * Configuration Module Types
 *
 * Type definitions for the configuration module
 */

import { ZodType } from 'zod';

/**
 * Metadata keys for configuration decorators
 */
export const CONFIG_INJECT_METADATA_KEY = Symbol('config:inject');
export const CONFIG_SCHEMA_METADATA_KEY = Symbol('config:schema');

/**
 * Configuration source types
 */
export type ConfigSourceType = 'file' | 'env' | 'argv' | 'object' | 'remote';

/**
 * Base configuration source
 */
export interface IConfigSource {
  type: ConfigSourceType;
  name?: string;
  optional?: boolean;
  priority?: number;
}

/**
 * File configuration source
 */
export interface IFileConfigSource extends IConfigSource {
  type: 'file';
  path: string;
  format?: 'json' | 'yaml' | 'toml' | 'ini' | 'env';
  encoding?: BufferEncoding;
  transform?: (data: any) => any;
}

/**
 * Environment variables configuration source
 */
export interface IEnvironmentConfigSource extends IConfigSource {
  type: 'env';
  prefix?: string;
  separator?: string;
  transform?: 'lowercase' | 'uppercase' | 'camelCase' | ((key: string, value: any) => any);
}

/**
 * Command line arguments configuration source
 */
export interface IArgvConfigSource extends IConfigSource {
  type: 'argv';
  prefix?: string;
}

/**
 * Object configuration source
 */
export interface IObjectConfigSource extends IConfigSource {
  type: 'object';
  data: Record<string, any>;
}

/**
 * Remote configuration source
 */
export interface IRemoteConfigSource extends IConfigSource {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: number;
}

/**
 * Union type for all configuration sources
 */
export type ConfigSource =
  | IFileConfigSource
  | IEnvironmentConfigSource
  | IArgvConfigSource
  | IObjectConfigSource
  | IRemoteConfigSource;

/**
 * Configuration module options
 */
export interface IConfigModuleOptions {
  /**
   * Configuration sources in priority order (first = lowest priority)
   */
  sources?: ConfigSource[];

  /**
   * Global configuration schema for validation
   */
  schema?: ZodType;

  /**
   * Environment name (development, production, test, etc.)
   */
  environment?: string;

  /**
   * Enable configuration validation on startup
   */
  validateOnStartup?: boolean;

  /**
   * Enable watching configuration files for changes
   */
  watchForChanges?: boolean;

  /**
   * Cache configuration
   */
  cache?: {
    enabled: boolean;
    ttl?: number; // milliseconds
  };

  /**
   * Strict mode - throw on missing required values
   */
  strict?: boolean;

  /**
   * Global configuration prefix
   */
  prefix?: string;

  /**
   * Logger instance
   */
  logger?: any;

  /**
   * Whether this module should be registered globally
   */
  global?: boolean;
}

/**
 * Configuration change event
 */
export interface IConfigChangeEvent {
  path: string;
  oldValue: any;
  newValue: any;
  source: string;
  timestamp: Date;
}

/**
 * Configuration validation result
 */
export interface IConfigValidationResult {
  success: boolean;
  errors?: Array<{
    path: string;
    message: string;
    expected?: string;
    received?: string;
  }>;
  warnings?: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Configuration metadata
 */
export interface IConfigMetadata {
  source: string;
  loadedAt: Date;
  environment: string;
  sources?: Array<{
    type: string;
    name?: string;
    loaded: boolean;
    error?: string;
  }>;
  validated?: boolean;
  cached?: boolean;
}

/**
 * Configuration provider interface
 */
export interface IConfigProvider {
  /**
   * Get configuration value by path
   */
  get<T = any>(path: string, defaultValue?: T): T;

  /**
   * Get all configuration values
   */
  getAll(): Record<string, any>;

  /**
   * Check if configuration path exists
   */
  has(path: string): boolean;

  /**
   * Set configuration value
   */
  set(path: string, value: any): void;

  /**
   * Get configuration metadata
   */
  getMetadata(): IConfigMetadata;
}

/**
 * Configuration loader interface
 */
export interface IConfigLoader {
  /**
   * Load configuration from sources
   */
  load(sources: ConfigSource[]): Promise<Record<string, any>>;

  /**
   * Load configuration from a single source
   */
  loadSource(source: ConfigSource): Promise<Record<string, any>>;
}

/**
 * Configuration validator interface
 */
export interface IConfigValidator {
  /**
   * Validate configuration against schema
   */
  validate(config: Record<string, any>, schema?: ZodType): IConfigValidationResult;

  /**
   * Validate a specific path
   */
  validatePath(path: string, value: any, schema?: ZodType): IConfigValidationResult;
}

/**
 * Configuration watcher interface
 */
export interface IConfigWatcher {
  /**
   * Watch configuration sources for changes
   */
  watch(sources: ConfigSource[], onChange: (event: IConfigChangeEvent) => void): void;

  /**
   * Stop watching
   */
  unwatch(): void;
}

/**
 * Feature configuration options
 */
export interface IConfigFeatureOptions {
  /**
   * Feature name
   */
  name: string;

  /**
   * Configuration path
   */
  path?: string;

  /**
   * Feature schema
   */
  schema?: ZodType;

  /**
   * Default values
   */
  defaults?: Record<string, any>;
}

/**
 * Configuration async options
 */
export interface IConfigAsyncOptions {
  useFactory: (...args: any[]) => Promise<IConfigModuleOptions> | IConfigModuleOptions;
  inject?: any[];
  global?: boolean;
}