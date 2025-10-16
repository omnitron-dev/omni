import * as path from 'path';
import * as yaml from 'js-yaml';
import * as toml from '@iarna/toml';
import * as fs from 'fs/promises';
import { Environment, ExtendedEnvironmentOptions } from './environment.js';
import { Schema } from '../types/schema.js';
import { ISecretsProvider } from '../types/layers.js';
import { EnvironmentMetadata } from '../types/metadata.js';
import { deepMerge } from '../utils/deep-merge.js';

/**
 * Builder for creating Environment instances with a fluent API
 */
export class EnvironmentBuilder<TSchema extends Schema = any> {
  private name?: string;
  private schema?: TSchema;
  private baseConfig: Record<string, any> = {};
  private overrideConfig: Record<string, any> = {};
  private variables: Record<string, any> = {};
  private secretsProvider?: ISecretsProvider;
  private metadata?: Partial<EnvironmentMetadata>;
  private validateOnBuild: boolean = true;

  /**
   * Set the environment name
   */
  withName(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * Set base configuration from file
   * Supports YAML and JSON file formats
   */
  async withBase(filePath: string): Promise<this> {
    const config = await this.loadFile(filePath);
    this.baseConfig = deepMerge(this.baseConfig, config, { conflicts: 'prefer-right' });
    return this;
  }

  /**
   * Set override configuration from file
   * Supports YAML and JSON file formats
   */
  async withOverrides(filePath: string): Promise<this> {
    const config = await this.loadFile(filePath);
    this.overrideConfig = deepMerge(this.overrideConfig, config, { conflicts: 'prefer-right' });
    return this;
  }

  /**
   * Set secrets provider from source
   * Source can be a secrets provider instance or a string identifier
   */
  withSecrets(source: ISecretsProvider | string): this {
    if (typeof source === 'string') {
      // For now, we'll just accept the provider directly
      // In the future, we could support provider factory by string
      throw new Error('String-based secrets providers not yet implemented. Pass ISecretsProvider instance.');
    }
    this.secretsProvider = source;
    return this;
  }

  /**
   * Set variables (merged with config)
   */
  withVariables(vars: Record<string, any>): this {
    this.variables = deepMerge(this.variables, vars, { conflicts: 'prefer-right' });
    return this;
  }

  /**
   * Set schema for validation
   */
  withSchema(schema: TSchema): this {
    this.schema = schema;
    return this;
  }

  /**
   * Set metadata
   */
  withMetadata(metadata: Partial<EnvironmentMetadata>): this {
    this.metadata = metadata;
    return this;
  }

  /**
   * Enable or disable validation on build
   */
  withValidation(enabled: boolean = true): this {
    this.validateOnBuild = enabled;
    return this;
  }

  /**
   * Build the environment instance
   */
  async build(): Promise<Environment<TSchema>> {
    if (!this.name) {
      throw new Error('Environment name is required. Use withName() to set it.');
    }

    // Merge all config sources in order: base -> variables -> overrides
    let finalConfig = { ...this.baseConfig };
    finalConfig = deepMerge(finalConfig, this.variables, { conflicts: 'prefer-right' });
    finalConfig = deepMerge(finalConfig, this.overrideConfig, { conflicts: 'prefer-right' });

    // Create environment options
    const options: ExtendedEnvironmentOptions<TSchema> = {
      name: this.name,
      schema: this.schema,
      config: finalConfig,
      metadata: this.metadata,
      secretsProvider: this.secretsProvider,
    };

    // Create environment
    const env = new Environment<TSchema>(options);

    // Validate if enabled
    if (this.validateOnBuild && this.schema) {
      const validation = await env.validate();
      if (!validation.valid) {
        const errors = validation.errors?.map((e) => e.message).join(', ') || 'Unknown validation errors';
        throw new Error(`Environment validation failed: ${errors}`);
      }
    }

    return env;
  }

  /**
   * Load configuration from file
   * Auto-detects format based on file extension
   */
  private async loadFile(filePath: string): Promise<Record<string, any>> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();

      switch (ext) {
        case '.yaml':
        case '.yml':
          return (yaml.load(content) as Record<string, any>) || {};
        case '.json':
          return JSON.parse(content);
        case '.toml':
          return toml.parse(content) as Record<string, any>;
        default:
          // Try to parse as JSON first, fall back to YAML
          try {
            return JSON.parse(content);
          } catch {
            return (yaml.load(content) as Record<string, any>) || {};
          }
      }
    } catch (error) {
      throw new Error(`Failed to load file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
