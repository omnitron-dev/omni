/**
 * Configuration Utilities
 *
 * Helper functions for configuration management
 */

import { z, ZodError, ZodType } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigValidationResult, ConfigChangeEvent } from './config.types.js';

/**
 * Configuration path utilities
 */
export class ConfigPath {
  /**
   * Convert dot-notation path to array
   */
  static toArray(path: string): string[] {
    return path.split('.');
  }

  /**
   * Convert array path to dot-notation
   */
  static fromArray(path: string[]): string {
    return path.join('.');
  }

  /**
   * Get value from object using path
   */
  static getValue(obj: any, path: string): any {
    const keys = this.toArray(path);
    let current = obj;

    for (const key of keys) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Set value in object using path
   */
  static setValue(obj: any, path: string, value: any): void {
    const keys = this.toArray(path);
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

  /**
   * Delete value from object using path
   */
  static deleteValue(obj: any, path: string): boolean {
    const keys = this.toArray(path);
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!key || !(key in current) || typeof current[key] !== 'object') {
        return false;
      }
      current = current[key];
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey && lastKey in current) {
      delete current[lastKey];
      return true;
    }

    return false;
  }

  /**
   * Check if path exists in object
   */
  static hasValue(obj: any, path: string): boolean {
    return this.getValue(obj, path) !== undefined;
  }

  /**
   * Get all paths in object
   */
  static getAllPaths(obj: any, prefix = ''): string[] {
    const paths: string[] = [];

    for (const key in obj) {
      const fullPath = prefix ? `${prefix}.${key}` : key;

      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        paths.push(...this.getAllPaths(obj[key], fullPath));
      } else {
        paths.push(fullPath);
      }
    }

    return paths;
  }
}

/**
 * Configuration validation utilities
 */
export class ConfigValidator {
  /**
   * Validate configuration with schema
   */
  static validate<T>(data: any, schema: ZodType<T>): ConfigValidationResult<T> {
    try {
      const result = schema.safeParse(data);

      if (result.success) {
        return {
          success: true,
          data: result.data,
        };
      }

      return {
        success: false,
        errors: result.error.issues,
        warnings: this.extractWarnings(result.error),
      };
    } catch (error) {
      return {
        success: false,
        errors: [],
        warnings: [`Validation error: ${error}`],
      };
    }
  }

  /**
   * Validate partial configuration
   */
  static validatePartial<T>(data: any, schema: ZodType<T>): ConfigValidationResult<Partial<T>> {
    // Use z.partial() if schema is z.object, otherwise use the schema as-is
    const partialSchema = (schema as any).partial ? (schema as any).partial() : schema;
    return this.validate(data, partialSchema as ZodType<Partial<T>>);
  }

  /**
   * Format validation errors
   */
  static formatErrors(errors: z.ZodIssue[]): string[] {
    return errors.map(error => {
      const path = error.path.join('.');
      return `${path}: ${error.message}`;
    });
  }

  /**
   * Extract warnings from validation error
   */
  private static extractWarnings(error: ZodError): string[] {
    const warnings: string[] = [];

    for (const issue of error.issues) {
      if (issue.code === 'unrecognized_keys') {
        warnings.push(`Unknown configuration keys: ${issue.message}`);
      }
    }

    return warnings;
  }
}

/**
 * Configuration encryption utilities
 */
export class ConfigEncryption {
  private static readonly algorithm = 'aes-256-gcm';
  private static readonly ivLength = 16;
  private static readonly saltLength = 32;
  private static readonly tagLength = 16;
  private static readonly iterations = 100000;

  /**
   * Encrypt configuration value
   */
  static encrypt(value: string, password: string): string {
    const salt = crypto.randomBytes(this.saltLength);
    const key = crypto.pbkdf2Sync(password, salt, this.iterations, 32, 'sha256');
    const iv = crypto.randomBytes(this.ivLength);

    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    let encrypted = cipher.update(value, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const tag = cipher.getAuthTag();

    // Combine salt, iv, tag, and encrypted data
    const combined = Buffer.concat([salt, iv, tag, encrypted]);

    return combined.toString('base64');
  }

  /**
   * Decrypt configuration value
   */
  static decrypt(encryptedValue: string, password: string): string {
    const combined = Buffer.from(encryptedValue, 'base64');

    // Extract components
    const salt = combined.subarray(0, this.saltLength);
    const iv = combined.subarray(this.saltLength, this.saltLength + this.ivLength);
    const tag = combined.subarray(this.saltLength + this.ivLength, this.saltLength + this.ivLength + this.tagLength);
    const encrypted = combined.subarray(this.saltLength + this.ivLength + this.tagLength);

    // Derive key
    const key = crypto.pbkdf2Sync(password, salt, this.iterations, 32, 'sha256');

    // Decrypt
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }

  /**
   * Encrypt object with specific paths
   */
  static encryptPaths(obj: any, paths: string[], password: string): any {
    const result = JSON.parse(JSON.stringify(obj)); // Deep clone

    for (const path of paths) {
      const value = ConfigPath.getValue(result, path);
      if (value !== undefined && typeof value === 'string') {
        const encrypted = this.encrypt(value, password);
        ConfigPath.setValue(result, path, `encrypted:${encrypted}`);
      }
    }

    return result;
  }

  /**
   * Decrypt object with encrypted values
   */
  static decryptPaths(obj: any, password: string): any {
    const result = JSON.parse(JSON.stringify(obj)); // Deep clone
    const paths = ConfigPath.getAllPaths(result);

    for (const path of paths) {
      const value = ConfigPath.getValue(result, path);
      if (typeof value === 'string' && value.startsWith('encrypted:')) {
        try {
          const encrypted = value.slice('encrypted:'.length);
          const decrypted = this.decrypt(encrypted, password);
          ConfigPath.setValue(result, path, decrypted);
        } catch (error) {
          console.warn(`Failed to decrypt value at path: ${path}`);
        }
      }
    }

    return result;
  }
}

/**
 * Configuration interpolation utilities
 */
export class ConfigInterpolation {
  private static readonly pattern = /\${([^}]+)}/g;
  private static readonly envPattern = /\${env:([^}]+)}/g;
  private static readonly filePattern = /\${file:([^}]+)}/g;

  /**
   * Interpolate configuration values
   */
  static interpolate(value: any, context: Record<string, any>): any {
    if (typeof value === 'string') {
      return this.interpolateString(value, context);
    }

    if (Array.isArray(value)) {
      return value.map(item => this.interpolate(item, context));
    }

    if (value && typeof value === 'object') {
      const result: Record<string, any> = {};
      for (const key in value) {
        result[key] = this.interpolate(value[key], context);
      }
      return result;
    }

    return value;
  }

  /**
   * Interpolate string value
   */
  private static interpolateString(value: string, context: Record<string, any>): string {
    // Replace ${path} with context values
    value = value.replace(this.pattern, (match, path) => {
      const contextValue = ConfigPath.getValue(context, path);
      return contextValue !== undefined ? String(contextValue) : match;
    });

    // Replace ${env:VAR} with environment variables
    value = value.replace(this.envPattern, (match, envVar) => process.env[envVar] || match);

    // Replace ${file:path} with file content
    value = value.replace(this.filePattern, (match, filePath) => {
      try {
        const fs = require('fs');
        return fs.readFileSync(filePath, 'utf-8').trim();
      } catch {
        return match;
      }
    });

    return value;
  }
}

/**
 * Configuration diff utilities
 */
export class ConfigDiff {
  /**
   * Compare two configuration objects
   */
  static diff(oldConfig: any, newConfig: any): ConfigChangeEvent[] {
    const changes: ConfigChangeEvent[] = [];
    const timestamp = new Date();

    // Get all paths from both configs
    const oldPaths = new Set(ConfigPath.getAllPaths(oldConfig));
    const newPaths = new Set(ConfigPath.getAllPaths(newConfig));
    const allPaths = new Set([...oldPaths, ...newPaths]);

    for (const path of allPaths) {
      const oldValue = ConfigPath.getValue(oldConfig, path);
      const newValue = ConfigPath.getValue(newConfig, path);

      if (!this.isEqual(oldValue, newValue)) {
        changes.push({
          path,
          oldValue,
          newValue,
          source: 'diff',
          timestamp,
        });
      }
    }

    return changes;
  }

  /**
   * Check if two values are equal
   */
  private static isEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object') {
      const aKeys = Object.keys(a).sort();
      const bKeys = Object.keys(b).sort();

      if (aKeys.length !== bKeys.length) return false;

      for (let i = 0; i < aKeys.length; i++) {
        if (aKeys[i] !== bKeys[i]) return false;
        const aKey = aKeys[i];
        const bKey = bKeys[i];
        if (aKey && bKey && !this.isEqual(a[aKey], b[bKey])) return false;
      }

      return true;
    }

    return false;
  }
}

/**
 * Configuration environment utilities
 */
export class ConfigEnvironment {
  /**
   * Get current environment
   */
  static getCurrent(): string {
    return process.env['NODE_ENV'] || 'development';
  }

  /**
   * Check if running in production
   */
  static isProduction(): boolean {
    return this.getCurrent() === 'production';
  }

  /**
   * Check if running in development
   */
  static isDevelopment(): boolean {
    return this.getCurrent() === 'development';
  }

  /**
   * Check if running in test
   */
  static isTest(): boolean {
    return this.getCurrent() === 'test';
  }

  /**
   * Check if running in staging
   */
  static isStaging(): boolean {
    return this.getCurrent() === 'staging';
  }

  /**
   * Get environment-specific config file
   */
  static getConfigFile(basePath: string, environment?: string): string {
    const env = environment || this.getCurrent();
    return `${basePath}/config.${env}.json`;
  }
}

/**
 * Create a configuration token for dependency injection
 */
export function createConfigToken(name: string): symbol {
  return Symbol(`config:${name}`);
}

/**
 * Get value from object by dot-notation path
 */
export function getValueByPath(obj: any, path: string): any {
  return ConfigPath.getValue(obj, path);
}

/**
 * Set value in object by dot-notation path
 */
export function setValueByPath(obj: any, path: string, value: any): void {
  ConfigPath.setValue(obj, path, value);
}

/**
 * Flatten nested object to dot-notation
 */
export function flattenObject(obj: any, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {};

  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const newKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

/**
 * Expand dot-notation object to nested structure
 */
export function expandObject(flat: Record<string, any>): any {
  const result: any = {};

  for (const key in flat) {
    if (!flat.hasOwnProperty(key)) continue;
    setValueByPath(result, key, flat[key]);
  }

  return result;
}

/**
 * Detect the current environment with smart defaults
 */
export function detectEnvironment(): string {
  // Priority order for environment detection
  const envKeys = [
    'NODE_ENV',
    'TITAN_ENV',
    'APP_ENV',
    'ENVIRONMENT'
  ];

  for (const key of envKeys) {
    const value = process.env[key];
    if (value) {
      return value.toLowerCase();
    }
  }

  // Detect based on common indicators
  if (process.env['CI']) {
    return 'test';
  }

  if (process.env['VERCEL'] || process.env['NETLIFY']) {
    return 'production';
  }

  if (process.env['PORT'] && parseInt(process.env['PORT']) === 80) {
    return 'production';
  }

  // Default to development
  return 'development';
}

/**
 * Find configuration files with smart discovery
 */
export async function findConfigFiles(baseDir: string): Promise<{
  defaults: string[];
  environment: string[];
  dotenv: string[];
}> {
  const environment = detectEnvironment();
  const result = {
    defaults: [] as string[],
    environment: [] as string[],
    dotenv: [] as string[]
  };

  // Common config directories
  const configDirs = [
    path.join(baseDir, 'config'),
    path.join(baseDir, 'configs'),
    baseDir
  ];

  // Config file extensions in priority order
  const extensions = ['.json', '.yaml', '.yml', '.toml'];

  // Search for default config files
  const defaultNames = ['config.default', 'config.base', 'default', 'base'];
  for (const dir of configDirs) {
    for (const name of defaultNames) {
      for (const ext of extensions) {
        const filePath = path.join(dir, name + ext);
        if (fs.existsSync(filePath)) {
          result.defaults.push(filePath);
        }
      }
    }
  }

  // Search for environment-specific config files
  const envNames = [
    `config.${environment}`,
    `${environment}`,
    environment === 'development' ? 'config.dev' : null,
    environment === 'production' ? 'config.prod' : null
  ].filter(Boolean);

  for (const dir of configDirs) {
    for (const name of envNames) {
      if (!name) continue;
      for (const ext of extensions) {
        const filePath = path.join(dir, name + ext);
        if (fs.existsSync(filePath)) {
          result.environment.push(filePath);
        }
      }
    }
  }

  // Search for .env files (in priority order)
  const dotenvFiles = [
    '.env.defaults',
    '.env',
    `.env.${environment}.local`,
    `.env.local`,
    `.env.${environment}`
  ];

  for (const fileName of dotenvFiles) {
    const filePath = path.join(baseDir, fileName);
    if (fs.existsSync(filePath)) {
      result.dotenv.push(filePath);
    }
  }

  return result;
}