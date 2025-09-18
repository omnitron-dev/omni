/**
 * Configuration Loader
 *
 * Handles loading configuration from various sources
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  ConfigSource,
  FileConfigSource,
  DotenvConfigSource,
  EnvironmentConfigSource,
  ArgvConfigSource,
  ObjectConfigSource,
  RemoteConfigSource,
  IConfigProvider,
} from './config.types.js';

const readFile = promisify(fs.readFile);

/**
 * Configuration loader that handles multiple sources
 */
export class ConfigLoader {
  private providers = new Map<string, IConfigProvider>();

  /**
   * Register a configuration provider
   */
  registerProvider(name: string, provider: IConfigProvider): void {
    this.providers.set(name, provider);
  }

  /**
   * Load configuration from a source
   */
  async load(source: ConfigSource): Promise<Record<string, any>> {
    switch (source.type) {
      case 'file':
        return this.loadFile(source);
      case 'dotenv':
        return this.loadDotenv(source);
      case 'env':
        return this.loadEnvironment(source);
      case 'argv':
        return this.loadArgv(source);
      case 'object':
        return this.loadObject(source);
      case 'remote':
        return this.loadRemote(source);
      default:
        throw new Error(`Unsupported configuration source type: ${(source as any).type}`);
    }
  }

  /**
   * Load configuration from multiple sources
   */
  async loadAll(sources: ConfigSource[]): Promise<Record<string, any>> {
    const configs: Array<Record<string, any>> = [];

    // Sort sources by priority if available
    const sortedSources = [...sources].sort((a, b) => {
      const aPriority = (a as any).priority || 0;
      const bPriority = (b as any).priority || 0;
      return aPriority - bPriority;
    });

    // Load all configurations
    for (const source of sortedSources) {
      try {
        const config = await this.load(source);
        configs.push(config);
      } catch (error) {
        // Handle optional sources
        if ((source as any).optional) {
          continue;
        }
        throw error;
      }
    }

    // Merge configurations (later sources override earlier ones)
    return this.deepMerge({}, ...configs);
  }

  /**
   * Load configuration from a file
   */
  private async loadFile(source: FileConfigSource): Promise<Record<string, any>> {
    const filePath = path.resolve(source.path);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      if (source.optional) {
        return {};
      }
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    const content = await readFile(filePath, 'utf-8');
    const format = source.format || this.detectFormat(filePath);

    let data: Record<string, any>;

    switch (format) {
      case 'json':
        data = JSON.parse(content);
        break;

      case 'yaml':
        // Lazy load yaml parser
        try {
          const yaml = await import('yaml' as any).catch(() => null);
          if (!yaml) {
            throw new Error('YAML support requires "yaml" package to be installed');
          }
          data = yaml.parse(content);
        } catch (error) {
          throw new Error('YAML support requires "yaml" package to be installed');
        }
        break;

      case 'toml':
        // Lazy load toml parser
        try {
          const toml = await import('toml' as any).catch(() => null);
          if (!toml) {
            throw new Error('TOML support requires "toml" package to be installed');
          }
          data = toml.parse(content);
        } catch (error) {
          throw new Error('TOML support requires "toml" package to be installed');
        }
        break;

      case 'env':
        data = this.parseEnvFile(content);
        break;

      case 'properties':
        data = this.parsePropertiesFile(content);
        break;

      default:
        throw new Error(`Unsupported file format: ${format}`);
    }

    // Apply transformation if provided
    if (source.transform) {
      data = source.transform(data);
    }

    return data;
  }

  /**
   * Load configuration from .env file
   */
  private async loadDotenv(source: DotenvConfigSource): Promise<Record<string, any>> {
    const filePath = path.resolve(source.path);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      if (source.optional) {
        return {};
      }
      throw new Error(`Dotenv file not found: ${filePath}`);
    }

    const content = await readFile(filePath, source.encoding || 'utf-8');
    const parsed = this.parseEnvFile(content);

    // If override is false, don't override existing env vars
    if (source.override === false) {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in process.env)) {
          result[key] = value;
          process.env[key] = String(value);
        }
      }
      return result;
    }

    // Set environment variables and return parsed values
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] = String(value);
    }

    return parsed;
  }

  /**
   * Load configuration from command line arguments
   */
  private loadArgv(source: ArgvConfigSource): Promise<Record<string, any>> {
    const config: Record<string, any> = {};
    const prefix = source.prefix || '--';
    const separator = source.separator || '.';
    const args = process.argv.slice(2);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg.startsWith(prefix)) {
        const key = arg.slice(prefix.length);
        let value: any = true; // Default for flags

        // Check if next arg is the value (not another flag)
        const nextArg = args[i + 1];
        if (i + 1 < args.length && nextArg && !nextArg.startsWith(prefix)) {
          value = nextArg;
          i++; // Skip the value in next iteration
        }

        // Convert key to nested path
        const path = key.split(separator);
        this.setNestedValue(config, path, this.parseEnvValue(String(value)));
      }
    }

    return Promise.resolve(config);
  }

  /**
   * Load configuration from environment variables
   */
  private loadEnvironment(source: EnvironmentConfigSource): Promise<Record<string, any>> {
    const config: Record<string, any> = {};
    const prefix = source.prefix || '';
    const separator = source.separator || '__';

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix)) {
        // Remove prefix and convert to nested object
        const configKey = key.slice(prefix.length);
        const path = configKey.split(separator).map(k => k.toLowerCase());

        // Set nested value
        this.setNestedValue(config, path, this.parseEnvValue(value || ''));

        // Apply transformation if provided
        if (source.transform) {
          const transformedValue = source.transform(key, value || '');
          if (transformedValue !== undefined) {
            this.setNestedValue(config, path, transformedValue);
          }
        }
      }
    }

    return Promise.resolve(config);
  }

  /**
   * Load configuration from an object
   */
  private loadObject(source: ObjectConfigSource): Promise<Record<string, any>> {
    return Promise.resolve(source.data);
  }

  /**
   * Load configuration from a remote source
   */
  private async loadRemote(source: RemoteConfigSource): Promise<Record<string, any>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), source.timeout || 5000);

    try {
      const response = await fetch(source.url, {
        method: source.method || 'GET',
        headers: source.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch configuration: ${response.statusText}`);
      }

      let data = await response.json();

      // Apply transformation if provided
      if (source.transform) {
        data = source.transform(data);
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Detect file format from extension
   */
  private detectFormat(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    switch (ext) {
      case 'json':
      case 'yaml':
      case 'yml':
      case 'toml':
      case 'env':
      case 'properties':
        return ext === 'yml' ? 'yaml' : ext;
      default:
        return 'json'; // Default to JSON
    }
  }

  /**
   * Parse .env file content
   */
  private parseEnvFile(content: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        const value = valueParts.join('=').trim();
        result[key.trim()] = this.parseEnvValue(value);
      }
    }

    return result;
  }

  /**
   * Parse .properties file content
   */
  private parsePropertiesFile(content: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex > 0) {
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();

        // Convert dotted keys to nested objects
        const path = key.split('.');
        this.setNestedValue(result, path, this.parseEnvValue(value));
      }
    }

    return result;
  }

  /**
   * Parse environment variable value
   */
  private parseEnvValue(value: string): any {
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Try to parse as JSON
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch {
        // Not valid JSON, return as string
      }
    }

    // Parse booleans
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Parse numbers
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^-?\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }

    // Return as string
    return value;
  }

  /**
   * Set nested value in an object
   */
  private setNestedValue(obj: any, path: string[], value: any): void {
    let current = obj;

    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!key) continue; // Skip empty keys

      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = path[path.length - 1];
    if (lastKey) {
      current[lastKey] = value;
    }
  }

  /**
   * Deep merge objects
   */
  private deepMerge(target: any, ...sources: any[]): any {
    if (!sources.length) return target;

    for (const source of sources) {
      if (this.isObject(source)) {
        for (const key in source) {
          if (this.isObject(source[key])) {
            if (!target[key]) {
              target[key] = {};
            }
            this.deepMerge(target[key], source[key]);
          } else {
            target[key] = source[key];
          }
        }
      }
    }

    return target;
  }

  /**
   * Check if value is an object
   */
  private isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}