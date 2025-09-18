/**
 * Configuration Module Types
 */

import { z, ZodType } from 'zod';
import { Token, createToken } from '@omnitron-dev/nexus';
import type { ConfigModule } from './config.module.js';
import type { ConfigService } from './config.service.js';

/**
 * Configuration source types
 */
export type ConfigSource =
  | FileConfigSource
  | DotenvConfigSource
  | EnvironmentConfigSource
  | ArgvConfigSource
  | ObjectConfigSource
  | RemoteConfigSource
  | VaultConfigSource;

export interface FileConfigSource {
  type: 'file';
  path: string;
  format?: 'json' | 'yaml' | 'toml' | 'env' | 'properties';
  optional?: boolean;
  watch?: boolean;
  transform?: (data: any) => any;
}

export interface DotenvConfigSource {
  type: 'dotenv';
  path: string;
  optional?: boolean;
  encoding?: BufferEncoding;
  override?: boolean;
}

export interface ArgvConfigSource {
  type: 'argv';
  prefix?: string;
  separator?: string;
}

export interface EnvironmentConfigSource {
  type: 'env';
  prefix?: string;
  separator?: string; // For nested keys (e.g., '__' for DB__HOST)
  transform?: (key: string, value: string) => any;
  schema?: ZodType;
}

export interface ObjectConfigSource {
  type: 'object';
  data: Record<string, any>;
  priority?: number; // Higher priority overrides lower
}

export interface RemoteConfigSource {
  type: 'remote';
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  interval?: number; // Polling interval in ms
  timeout?: number;
  transform?: (data: any) => any;
}

export interface VaultConfigSource {
  type: 'vault';
  endpoint: string;
  token: string;
  path: string;
  namespace?: string;
  renewable?: boolean;
}

/**
 * Configuration options for the module
 */
export interface ConfigModuleOptions {
  /**
   * Configuration schema for validation
   */
  schema?: ZodType;

  /**
   * Configuration sources to load
   */
  sources?: ConfigSource[];

  /**
   * Enable automatic environment-based configuration loading
   * Will look for config.{env}.json files
   */
  autoLoad?: boolean;

  /**
   * Base path for configuration files
   */
  configPath?: string;

  /**
   * Current environment (defaults to NODE_ENV)
   */
  environment?: string;

  /**
   * Global configuration defaults
   */
  defaults?: Record<string, any>;

  /**
   * Enable configuration validation on startup
   */
  validateOnStartup?: boolean;

  /**
   * Enable configuration hot-reload
   */
  watchForChanges?: boolean;

  /**
   * Custom logger for configuration module
   */
  logger?: any;

  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Configuration cache settings
   */
  cache?: {
    enabled: boolean;
    ttl?: number; // Time to live in ms
    maxSize?: number; // Max cache entries
  };

  /**
   * Encryption settings for sensitive configuration
   */
  encryption?: {
    enabled: boolean;
    key?: string;
    algorithm?: string;
    fields?: string[]; // Paths to encrypt (e.g., ['database.password'])
  };
}

/**
 * Async configuration factory
 */
export interface ConfigModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => Promise<ConfigModuleOptions> | ConfigModuleOptions;
  global?: boolean;
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: z.ZodIssue[];
  warnings?: string[];
}

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  path: string;
  oldValue: any;
  newValue: any;
  source: string;
  timestamp: Date;
}

/**
 * Configuration provider interface
 */
export interface IConfigProvider {
  load(): Promise<Record<string, any>>;
  watch?(callback: (data: Record<string, any>) => void): void;
  dispose?(): Promise<void>;
}

/**
 * Configuration transformer interface
 */
export interface IConfigTransformer {
  transform(data: any, context?: any): any;
}

/**
 * Configuration validator interface
 */
export interface IConfigValidator {
  validate(data: any): ConfigValidationResult;
}

/**
 * Configuration metadata
 */
export interface ConfigMetadata {
  source: string;
  loadedAt: Date;
  version?: string;
  checksum?: string;
  environment?: string;
  sources?: Array<{
    type: string;
    loaded: boolean;
    path?: string;
    error?: string;
  }>;
  cached?: boolean;
}

/**
 * Typed configuration access
 */
export interface TypedConfigAccessor<T> {
  get<K extends keyof T>(key: K): T[K];
  get<K extends keyof T, D>(key: K, defaultValue: D): T[K] | D;
  require<K extends keyof T>(key: K): T[K];
  has<K extends keyof T>(key: K): boolean;
}

/**
 * Configuration tokens for dependency injection
 */
// Internal symbols for configuration module
export const CONFIG_OPTIONS_TOKEN = Symbol('CONFIG_OPTIONS');
export const CONFIG_SCHEMA_TOKEN = Symbol('CONFIG_SCHEMA');
export const CONFIG_LOADER_TOKEN = Symbol('CONFIG_LOADER');
export const CONFIG_VALIDATOR_TOKEN = Symbol('CONFIG_VALIDATOR');

/**
 * Token for ConfigModule dependency injection
 * Use this when you need to inject the ConfigModule itself
 */
export const ConfigModuleToken: Token<ConfigModule> = createToken<ConfigModule>('ConfigModule');

/**
 * Token for ConfigService dependency injection
 * Use this when you need to inject the ConfigService for reading configuration
 */
export const ConfigServiceToken: Token<ConfigService> = createToken<ConfigService>('ConfigService');

/**
 * Configuration decorators metadata
 */
export const CONFIG_METADATA_KEY = Symbol('titan:config');
export const CONFIG_SCHEMA_METADATA_KEY = Symbol('titan:config:schema');
export const CONFIG_INJECT_METADATA_KEY = Symbol('titan:config:inject');

/**
 * Default configuration values
 */
export const CONFIG_DEFAULTS = {
  configPath: process.cwd() + '/config',
  environment: process.env['NODE_ENV'] || 'development',
  autoLoad: true,
  validateOnStartup: true,
  watchForChanges: false,
  debug: false,
} as const;