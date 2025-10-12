/**
 * Configuration Loader Service
 *
 * Handles loading configuration from various sources
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Injectable } from '../../decorators/index.js';
import { Errors } from '../../errors/index.js';

import type {
  ConfigSource,
  IConfigLoader,
  IFileConfigSource,
  IEnvironmentConfigSource,
  IArgvConfigSource,
  IObjectConfigSource,
  IRemoteConfigSource,
} from './types.js';

@Injectable()
export class ConfigLoaderService implements IConfigLoader {
  /**
   * Load configuration from multiple sources
   */
  async load(sources: ConfigSource[] | ConfigSource): Promise<Record<string, any>> {
    const configs: Record<string, any>[] = [];

    // Ensure sources is an array
    const sourcesArray = Array.isArray(sources) ? sources : [sources];

    // Sort sources by priority (lower priority first, undefined = 0)
    const sortedSources = [...sourcesArray].sort((a, b) => {
      const aPriority = (a as any).priority || 0;
      const bPriority = (b as any).priority || 0;
      return aPriority - bPriority;
    });

    // Load from sources in order (first = lowest priority)
    for (const source of sortedSources) {
      try {
        const config = await this.loadSource(source);
        if (config && Object.keys(config).length > 0) {
          configs.push(config);
        }
      } catch (error) {
        if (!source.optional) {
          throw Errors.badRequest(`Failed to load required config source ${source.name || source.type}`, {
            source: source.name || source.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        // Skip optional sources that fail
      }
    }

    // Merge configurations (later sources override earlier ones)
    return this.mergeConfigs(configs);
  }

  /**
   * Load configuration from a single source
   */
  async loadSource(source: ConfigSource): Promise<Record<string, any>> {
    switch (source.type) {
      case 'file':
        return this.loadFile(source);
      case 'env':
        return this.loadEnvironment(source);
      case 'argv':
        return this.loadArgv(source);
      case 'object':
        return this.loadObject(source);
      case 'remote':
        return this.loadRemote(source);
      default:
        throw Errors.badRequest(`Unsupported configuration source type: ${(source as any).type}`, {
          type: (source as any).type,
        });
    }
  }

  /**
   * Load configuration from a file
   */
  private async loadFile(source: IFileConfigSource): Promise<Record<string, any>> {
    const filePath = path.resolve(source.path);

    // Check if file exists
    if (!existsSync(filePath)) {
      if (source.optional) {
        return {};
      }
      throw Errors.notFound('Config file', filePath);
    }

    // Read file content
    const content = await fs.readFile(filePath, source.encoding || 'utf-8');

    // Detect format if not specified
    const format = source.format || this.detectFormat(filePath);

    // Parse based on format
    let data: Record<string, any>;
    switch (format) {
      case 'json':
        data = JSON.parse(content);
        break;

      case 'yaml':
        data = parseYaml(content) || {};
        break;

      case 'env':
        data = this.parseEnvFile(content);
        break;

      case 'properties':
        data = this.parsePropertiesFile(content);
        break;

      default:
        throw Errors.badRequest(`Unsupported config file format: ${format}`, {
          format,
          filePath,
        });
    }

    // Apply transformation if specified
    if (source.transform) {
      if (typeof source.transform === 'function') {
        data = source.transform(data);
      }
    }

    return data;
  }

  /**
   * Load configuration from environment variables
   */
  private loadEnvironment(source: IEnvironmentConfigSource): Record<string, any> {
    const config: Record<string, any> = {};
    const prefix = source.prefix || '';
    const separator = source.separator || '__';

    for (const [key, value] of Object.entries(process.env)) {
      if (!prefix || key.startsWith(prefix)) {
        // Remove prefix if present
        const configKey = prefix ? key.slice(prefix.length) : key;

        // Convert separator to dots for nested paths and make lowercase
        const configPath = configKey.toLowerCase().replace(new RegExp(separator, 'g'), '.');

        // Parse value (handle booleans and numbers)
        let parsedValue = this.parseEnvValue(value!);

        // Apply transformation if it's a function that takes key and value
        if (typeof source.transform === 'function') {
          const transformed = source.transform(configKey, parsedValue);
          if (transformed !== undefined) {
            parsedValue = transformed;
          }
        }

        // Set nested value
        this.setNestedValue(config, configPath, parsedValue);
      }
    }

    return config;
  }

  /**
   * Load configuration from command line arguments
   */
  private loadArgv(source: IArgvConfigSource): Record<string, any> {
    const config: Record<string, any> = {};
    const prefix = source.prefix || '--';
    const args = process.argv.slice(2);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg && arg.startsWith(prefix)) {
        const key = arg.slice(prefix.length);
        let value: any = true;

        // Check for value
        const nextArg = args[i + 1];
        if (i + 1 < args.length && nextArg && !nextArg.startsWith(prefix)) {
          i++;
          value = this.parseEnvValue(nextArg);
        }

        // Convert dashes to dots for nested paths
        const configPath = key.replace(/-/g, '.');
        this.setNestedValue(config, configPath, value);
      }
    }

    return config;
  }

  /**
   * Load configuration from an object
   */
  private loadObject(source: IObjectConfigSource): Record<string, any> {
    return source.data || {};
  }

  /**
   * Load configuration from a remote source
   */
  private async loadRemote(source: IRemoteConfigSource): Promise<Record<string, any>> {
    const controller = new AbortController();
    const timeout = source.timeout || 5000;

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(source.url, {
        headers: source.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw Errors.badRequest(`Failed to fetch remote config: HTTP ${response.status}`, {
          url: source.url,
          status: response.status,
          statusText: response.statusText,
        });
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        return await response.json();
      } else if (contentType.includes('text/yaml') || contentType.includes('application/yaml')) {
        const text = await response.text();
        return parseYaml(text) || {};
      } else {
        const text = await response.text();
        return JSON.parse(text); // Try JSON by default
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse .env file content
   */
  private parseEnvFile(content: string): Record<string, any> {
    const config: Record<string, any> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        config[key.trim()] = this.parseEnvValue(value);
      }
    }

    return config;
  }

  /**
   * Parse .properties file content
   */
  private parsePropertiesFile(content: string): Record<string, any> {
    const config: Record<string, any> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;

      // Handle line continuation (simple implementation)
      if (trimmed.endsWith('\\')) {
        continue; // In production should concatenate lines
      }

      const separatorIndex = trimmed.indexOf('=') !== -1 ? trimmed.indexOf('=') : trimmed.indexOf(':');
      if (separatorIndex === -1) continue;

      const key = trimmed.substring(0, separatorIndex).trim();
      const value = trimmed.substring(separatorIndex + 1).trim();

      // Convert property path to nested object
      const configPath = key.replace(/\./g, '.');
      this.setNestedValue(config, configPath, this.parseEnvValue(value));
    }

    return config;
  }

  /**
   * Parse environment variable value
   */
  private parseEnvValue(value: string): any {
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    // Parse booleans
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Parse numbers
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^-?\d*\.\d+$/.test(value)) {
      return parseFloat(value);
    }

    // Parse null
    if (value === 'null' || value === 'undefined') {
      return null;
    }

    // Parse JSON arrays and objects
    if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
      try {
        return JSON.parse(value);
      } catch {
        // If JSON parsing fails, return as string
      }
    }

    return value;
  }

  /**
   * Detect file format from extension
   */
  private detectFormat(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.json':
        return 'json';
      case '.yaml':
      case '.yml':
        return 'yaml';
      case '.env':
        return 'env';
      case '.properties':
        return 'properties';
      default:
        return 'json'; // Default to JSON
    }
  }

  /**
   * Transform configuration key
   */
  private transformKey(key: string, transform?: string): string {
    if (!transform) return key;

    switch (transform) {
      case 'lowercase':
        return key.toLowerCase();
      case 'uppercase':
        return key.toUpperCase();
      case 'camelCase':
        return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      default:
        return key;
    }
  }

  /**
   * Set a nested value in an object using dot notation
   */
  private setNestedValue(obj: any, configPath: string, value: any): void {
    const keys = configPath.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!key) continue;
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey) {
      current[lastKey] = value;
    }
  }

  /**
   * Merge multiple configuration objects
   */
  private mergeConfigs(configs: Record<string, any>[]): Record<string, any> {
    return configs.reduce((merged, config) => this.deepMerge(merged, config), {});
  }

  /**
   * Transform configuration data
   */
  private transformData(data: any, transform: string | ((value: any) => any)): any {
    if (typeof transform === 'function') {
      return transform(data);
    }

    // Apply string transformation to all string values
    if (typeof transform === 'string') {
      return this.transformObject(data, (value) => {
        if (typeof value === 'string') {
          return this.transformKey(value, transform);
        }
        return value;
      });
    }

    return data;
  }

  /**
   * Recursively transform all values in an object
   */
  private transformObject(obj: any, transformer: (value: any) => any): any {
    if (typeof obj !== 'object' || obj === null) {
      return transformer(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.transformObject(item, transformer));
    }

    const result: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = this.transformObject(obj[key], transformer);
      }
    }
    return result;
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    if (typeof source !== 'object' || source === null) {
      return source;
    }

    if (Array.isArray(source)) {
      return source;
    }

    const result = { ...target };

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }
}
