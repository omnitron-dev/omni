/**
 * Configuration module for Titan
 */

import type { $ZodIssue } from 'zod/v4/core';

import fs from 'node:fs';
import path from 'node:path';
import { z, ZodType, ZodError } from 'zod';
import { createToken } from '@omnitron-dev/nexus';

import { IApplication, HealthStatus, ApplicationModule } from '../types';

/**
 * Configuration source types
 */
export type ConfigSource =
  | FileSource
  | EnvironmentSource
  | ObjectSource;

export interface FileSource {
  type: 'file';
  path: string;
  format?: 'json' | 'env';
  optional?: boolean;
}

export interface EnvironmentSource {
  type: 'env';
  prefix?: string;
  transform?: (key: string) => string;
}

export interface ObjectSource {
  type: 'object';
  data: Record<string, any>;
}

/**
 * Configuration validation result
 */
export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: $ZodIssue[];
  formattedErrors?: string[];
}

/**
 * Configuration module interface
 */
export interface IConfigModule {
  // Load configuration
  load(source: ConfigSource): Promise<void>;
  loadFile(path: string, optional?: boolean): Promise<void>;
  loadEnv(prefix?: string): void;
  loadObject(config: object): void;

  // Get configuration
  get<T = any>(path: string, defaultValue?: T): T;
  require<T = any>(path: string): T;
  has(path: string): boolean;

  // Get with schema validation
  getValidated<T>(path: string, schema: ZodType<T>): T;
  getTyped<T>(path: string, schema: z.ZodType<T>): T | undefined;

  // Set configuration
  set(path: string, value: any): void;
  merge(config: object): void;

  // Validation
  validate<T>(schema: ZodType<T>): T;
  validateAsync<T>(schema: ZodType<T>): Promise<T>;
  validatePath<T = any>(path: string, schema: ZodType<T>): T;
  validateSafe<T>(schema: ZodType<T>): ValidationResult<T>;

  // Schema registration
  registerSchema<T>(path: string, schema: ZodType<T>): void;
  getRegisteredSchema(path: string): ZodType | undefined;

  // Watching and hot-reload
  watch(path: string, handler: (value: any) => void): () => void;
  reload(): Promise<void>;

  // Environment
  setEnvironment(env: string): void;
  getEnvironment(): string;

  // Interpolation
  interpolate(template: string): string;
  resolve<T = any>(path: string): T;

  // Serialization
  toJSON(): object;
  toString(): string;
  toEnv(): Record<string, string>;
}

/**
 * Configuration module token
 */
export const ConfigModuleToken = createToken<ConfigModule>('ConfigModule');

/**
 * Export IConfigModule interface as a value for Bun compatibility
 * This is a workaround for Bun's module resolution
 */
export const IConfigModule = {} as any;

/**
 * Configuration module implementation
 */
export class ConfigModule extends ApplicationModule implements IConfigModule {
  override readonly name = 'config';
  override readonly version = '1.0.0';

  private config: Record<string, any> = {};
  private environment: string = process.env['NODE_ENV'] || 'development';
  private watchers = new Map<string, Set<(value: any) => void>>();
  private schemas = new Map<string, ZodType>();
  private sources: ConfigSource[] = [];

  override async onStart(app: IApplication): Promise<void> {
    // Load default environment variables
    this.loadEnv();

    // Only set defaults if not already present
    if (!this.has('app.name')) {
      this.set('app.name', app.config('name') || 'titan-app');
    }
    if (!this.has('app.version')) {
      this.set('app.version', app.config('version') || '0.0.0');
    }
    if (!this.has('app.environment')) {
      this.set('app.environment', this.environment);
    }
  }

  /**
   * Load configuration from a source
   */
  async load(source: ConfigSource): Promise<void> {
    this.sources.push(source);

    switch (source.type) {
      case 'file':
        await this.loadFile(source.path, source.optional);
        break;
      case 'env':
        this.loadEnv(source.prefix);
        break;
      case 'object':
        this.loadObject(source.data);
        break;
      default:
    }
  }

  /**
   * Load configuration from a file
   */
  async loadFile(filePath: string, optional = false): Promise<void> {
    try {
      const resolvedPath = path.resolve(filePath);

      if (!fs.existsSync(resolvedPath)) {
        if (optional) {
          return;
        }
        throw new Error(`Configuration file not found: ${resolvedPath}`);
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const ext = path.extname(resolvedPath).toLowerCase();

      let data: Record<string, any>;

      switch (ext) {
        case '.json':
          data = JSON.parse(content);
          break;
        case '.env':
          data = this.parseEnvFile(content);
          break;
        default:
          // Try JSON parsing
          try {
            data = JSON.parse(content);
          } catch {
            throw new Error(`Unsupported configuration file format: ${ext}`);
          }
      }

      this.merge(data);
    } catch (error: any) {
      if (!optional) {
        throw new Error(`Failed to load configuration from ${filePath}: ${error.message}`);
      }
    }
  }

  /**
   * Load configuration from environment variables
   */
  loadEnv(prefix = ''): void {
    const env = process.env;
    const prefixUpper = prefix.toUpperCase();

    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith(prefixUpper)) {
        const configPath = this.envKeyToPath(key, prefixUpper);
        this.set(configPath, this.parseEnvValue(value || ''));
      }
    }
  }

  /**
   * Load configuration from an object
   */
  loadObject(config: object): void {
    this.merge(config);
  }

  /**
   * Get a configuration value
   */
  get<T = any>(path: string, defaultValue?: T): T {
    const value = this.getByPath(path);
    return value !== undefined ? value : defaultValue as T;
  }

  /**
   * Get a required configuration value
   */
  require<T = any>(path: string): T {
    const value = this.getByPath(path);
    if (value === undefined) {
      throw new Error(`Required configuration not found: ${path}`);
    }
    return value;
  }

  /**
   * Check if a configuration path exists
   */
  has(path: string): boolean {
    return this.getByPath(path) !== undefined;
  }

  /**
   * Set a configuration value
   */
  set(path: string, value: any): void {
    this.setByPath(path, value);
    this.notifyWatchers(path, value);
  }

  /**
   * Merge configuration
   */
  merge(config: object): void {
    this.deepMerge(this.config, config);

    // Notify watchers for changed paths
    this.notifyAllWatchers();
  }

  /**
   * Get configuration with validation
   */
  getValidated<T>(path: string, schema: ZodType<T>): T {
    const value = this.getByPath(path);
    return schema.parse(value);
  }

  /**
   * Get typed configuration value
   */
  getTyped<T>(path: string, schema: z.ZodType<T>): T | undefined {
    const value = this.getByPath(path);
    if (value === undefined) return undefined;

    const result = schema.safeParse(value);
    return result.success ? result.data : undefined;
  }

  /**
   * Validate configuration against a schema
   */
  validate<T>(schema: ZodType<T>): T {
    try {
      return schema.parse(this.config);
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = this.formatZodErrors(error);
        throw new Error(`Configuration validation failed:\n${formattedErrors.join('\n')}`);
      }
      throw error;
    }
  }

  /**
   * Validate configuration asynchronously
   */
  async validateAsync<T>(schema: ZodType<T>): Promise<T> {
    try {
      return await schema.parseAsync(this.config);
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = this.formatZodErrors(error);
        throw new Error(`Configuration validation failed:\n${formattedErrors.join('\n')}`);
      }
      throw error;
    }
  }

  /**
   * Validate a specific path against a schema
   */
  validatePath<T = any>(path: string, schema: ZodType<T>): T {
    const value = this.getByPath(path);
    try {
      const validated = schema.parse(value);
      this.schemas.set(path, schema);
      return validated;
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = this.formatZodErrors(error);
        throw new Error(`Configuration validation failed for ${path}:\n${formattedErrors.join('\n')}`);
      }
      throw error;
    }
  }

  /**
   * Safe validation that returns a result object
   */
  validateSafe<T>(schema: ZodType<T>): ValidationResult<T> {
    const result = schema.safeParse(this.config);

    if (result.success) {
      return {
        success: true,
        data: result.data
      };
    }

    return {
      success: false,
      errors: result.error.issues,
      formattedErrors: this.formatZodErrors(result.error)
    };
  }

  /**
   * Register a schema for a configuration path
   */
  registerSchema<T>(path: string, schema: ZodType<T>): void {
    this.schemas.set(path, schema);

    // Validate immediately if value exists
    if (this.has(path)) {
      this.validatePath(path, schema);
    }
  }

  /**
   * Get a registered schema
   */
  getRegisteredSchema(path: string): ZodType | undefined {
    return this.schemas.get(path);
  }

  /**
   * Watch a configuration path for changes
   */
  watch(path: string, handler: (value: any) => void): () => void {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, new Set());
    }

    const handlers = this.watchers.get(path)!;
    handlers.add(handler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.watchers.delete(path);
      }
    };
  }

  /**
   * Reload configuration from sources
   */
  async reload(): Promise<void> {
    this.config = {};

    for (const source of this.sources) {
      await this.load(source);
    }

    this.notifyAllWatchers();
  }

  /**
   * Set the environment
   */
  setEnvironment(env: string): void {
    this.environment = env;
    this.set('app.environment', env);
  }

  /**
   * Get the environment
   */
  getEnvironment(): string {
    return this.environment;
  }

  /**
   * Interpolate a template string
   */
  interpolate(template: string): string {
    return template.replace(/\${([^}]+)}/g, (match, path) => {
      const value = this.getByPath(path);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Resolve a configuration value with interpolation
   */
  resolve<T = any>(path: string): T {
    const value = this.getByPath(path);

    if (typeof value === 'string') {
      return this.interpolate(value) as T;
    }

    return value;
  }

  /**
   * Convert to JSON
   */
  toJSON(): object {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Convert to string
   */
  override toString(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Convert to environment variables
   */
  toEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    this.flattenObject(this.config, '', env);
    return env;
  }

  /**
   * Health check
   */
  override async health(): Promise<HealthStatus> {
    try {
      // Validate all registered schemas
      for (const [path, schema] of this.schemas) {
        const value = this.getByPath(path);
        schema.parse(value);
      }

      return {
        status: 'healthy',
        details: {
          environment: this.environment,
          sourceCount: this.sources.length,
          watcherCount: this.watchers.size
        }
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: error.message
      };
    }
  }

  // Private helper methods

  private getByPath(path: string): any {
    const parts = path.split('.');
    let current = this.config;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  private setByPath(configPath: string, value: any): void {
    const parts = configPath.split('.');
    const last = parts.pop()!;
    let current = this.config;

    for (const part of parts) {
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }

    current[last] = value;
  }

  private deepMerge(target: any, source: any): void {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
          if (!(key in target) || typeof target[key] !== 'object') {
            target[key] = {};
          }
          this.deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    }
  }

  private parseEnvFile(content: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const index = trimmed.indexOf('=');
      if (index === -1) {
        continue;
      }

      const key = trimmed.substring(0, index).trim();
      const value = trimmed.substring(index + 1).trim();

      result[key] = this.parseEnvValue(value);
    }

    return result;
  }

  private parseEnvValue(value: string): any {
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Try to parse as JSON
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;

    // Try to parse as number
    const num = Number(value);
    if (!isNaN(num) && value !== '') {
      return num;
    }

    return value;
  }

  private envKeyToPath(key: string, prefix: string): string {
    let path = key;

    if (prefix) {
      path = path.substring(prefix.length);
      if (path.startsWith('_')) {
        path = path.substring(1);
      }
    }

    return path.toLowerCase().replace(/_/g, '.');
  }

  private flattenObject(obj: any, prefix: string, result: Record<string, string>): void {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const newKey = prefix ? `${prefix}_${key}` : key;

        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          this.flattenObject(obj[key], newKey, result);
        } else {
          result[newKey.toUpperCase()] = String(obj[key]);
        }
      }
    }
  }

  private notifyWatchers(path: string, value: any): void {
    const handlers = this.watchers.get(path);
    if (handlers) {
      for (const handler of handlers) {
        handler(value);
      }
    }
  }

  private notifyAllWatchers(): void {
    for (const [path, handlers] of this.watchers) {
      const value = this.getByPath(path);
      for (const handler of handlers) {
        handler(value);
      }
    }
  }

  /**
   * Format Zod errors for better readability
   */
  private formatZodErrors(error: ZodError): string[] {
    return error.issues.map((issue: $ZodIssue) => {
      const path = issue.path.length > 0 ? `[${issue.path.join('.')}]` : '';
      const message = issue.message;

      // Add additional context based on error type
      let context = '';

      switch (issue.code) {
        case 'invalid_type': {
          const typedIssue = issue as any;
          if (typedIssue.expected) {
            context = ` (expected ${typedIssue.expected}, received ${typeof typedIssue.input})`;
          }
          break;
        }
        case 'too_small': {
          const typedIssue = issue as any;
          if (typedIssue.minimum !== undefined) {
            const inclusiveStr = typedIssue.inclusive === false ? ' exclusive' : '';
            const exactStr = typedIssue.exact ? ' (exact)' : '';
            context = ` (minimum: ${typedIssue.minimum}${inclusiveStr}${exactStr})`;
          }
          break;
        }
        case 'too_big': {
          const typedIssue = issue as any;
          if (typedIssue.maximum !== undefined) {
            const inclusiveStr = typedIssue.inclusive === false ? ' exclusive' : '';
            const exactStr = typedIssue.exact ? ' (exact)' : '';
            context = ` (maximum: ${typedIssue.maximum}${inclusiveStr}${exactStr})`;
          }
          break;
        }
        case 'invalid_union': {
          const typedIssue = issue as any;
          if (typedIssue.discriminator) {
            context = ` (discriminator: ${typedIssue.discriminator})`;
          } else {
            context = ` (no matching union member)`;
          }
          break;
        }
        case 'invalid_value': {
          const typedIssue = issue as any;
          if (typedIssue.values && typedIssue.values.length > 0) {
            const validValues = typedIssue.values.map((v: any) => JSON.stringify(v)).join(', ');
            context = ` (valid values: ${validValues})`;
          }
          break;
        }
        case 'invalid_format': {
          const typedIssue = issue as any;
          if (typedIssue.format) {
            context = ` (format: ${typedIssue.format})`;
            if (typedIssue.pattern) {
              context += ` pattern: ${typedIssue.pattern}`;
            }
          }
          break;
        }
        case 'unrecognized_keys': {
          const typedIssue = issue as any;
          if (typedIssue.keys && typedIssue.keys.length > 0) {
            context = ` (unrecognized: ${typedIssue.keys.join(', ')})`;
          }
          break;
        }
        case 'not_multiple_of': {
          const typedIssue = issue as any;
          if (typedIssue.divisor !== undefined) {
            context = ` (must be multiple of ${typedIssue.divisor})`;
          }
          break;
        }
        case 'custom': {
          const typedIssue = issue as any;
          if (typedIssue.params) {
            const paramStr = Object.entries(typedIssue.params)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            if (paramStr) {
              context = ` (${paramStr})`;
            }
          }
          break;
        }
        default:
          // For any unknown error codes, check if there's additional info
          const anyIssue = issue as any;
          if (anyIssue.expected) {
            context = ` (expected: ${anyIssue.expected})`;
          }
      }

      return `  • ${path} ${message}${context}`;
    });
  }
}

/**
 * Configuration module options
 */
export interface ConfigModuleOptions<T = any> {
  sources?: ConfigSource[];
  schema?: ZodType<T>;
  schemas?: Record<string, ZodType>;
  environment?: string;
  defaults?: Partial<T>;
  validateOnLoad?: boolean;
}

/**
 * Create a configuration module
 */
export function createConfigModule<T = any>(
  options?: ConfigModuleOptions<T>
): ConfigModule {
  const module = new ConfigModule();

  if (options?.environment) {
    module.setEnvironment(options.environment);
  }

  if (options?.defaults) {
    module.merge(options.defaults as object);
  }

  if (options?.sources) {
    // Sources will be loaded during onStart
    for (const source of options.sources) {
      module.load(source);
    }
  }

  if (options?.schemas) {
    for (const [path, schema] of Object.entries(options.schemas)) {
      module.registerSchema(path, schema);
    }
  }

  if (options?.schema) {
    if (options?.validateOnLoad) {
      module.validate(options.schema);
    } else {
      // Register for later validation
      module.registerSchema('', options.schema);
    }
  }

  return module;
}

/**
 * Create typed configuration getter
 */
export function createTypedConfig<T>(
  module: ConfigModule,
  schema: ZodType<T>
): () => T {
  return () => module.validate(schema);
}

/**
 * Common configuration schemas for reuse
 */
export const ConfigSchemas = {
  /**
   * Database configuration schema
   */
  database: z.object({
    host: z.string().default('localhost'),
    port: z.number().int().positive().default(5432),
    username: z.string(),
    password: z.string(),
    database: z.string(),
    ssl: z.boolean().optional(),
    pool: z.object({
      min: z.number().int().min(0).default(2),
      max: z.number().int().min(1).default(10),
      idle: z.number().int().positive().default(10000)
    }).optional()
  }),

  /**
   * Redis configuration schema
   */
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().int().positive().default(6379),
    password: z.string().optional(),
    db: z.number().int().min(0).default(0),
    keyPrefix: z.string().optional(),
    retryStrategy: z.function().optional()
  }),

  /**
   * HTTP server configuration schema
   */
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().int().positive().default(3000),
    cors: z.object({
      enabled: z.boolean().default(true),
      origin: z.union([
        z.string(),
        z.array(z.string()),
        z.boolean(),
        z.function()
      ]).optional(),
      credentials: z.boolean().optional()
    }).optional(),
    timeout: z.number().positive().optional(),
    maxBodySize: z.string().optional()
  }),

  /**
   * Logger configuration schema
   */
  logger: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
    format: z.enum(['json', 'pretty', 'simple']).default('json'),
    destination: z.string().optional(),
    redact: z.array(z.string()).optional()
  }),

  /**
   * Application configuration schema
   */
  app: z.object({
    name: z.string(),
    version: z.string().regex(/^\d+\.\d+\.\d+/, 'Version must follow semver format (e.g., 1.0.0)'),
    environment: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    debug: z.boolean().default(false)
  })
};

/**
 * Helper to create environment-based configuration
 */
export function createEnvConfig<T>(
  schema: ZodType<T>,
  prefix = 'APP'
): ConfigModule {
  const module = createConfigModule({
    sources: [
      { type: 'env', prefix },
      { type: 'file', path: '.env', optional: true },
      { type: 'file', path: `.env.${process.env['NODE_ENV']}`, optional: true }
    ],
    schema,
    validateOnLoad: true
  });

  return module;
}