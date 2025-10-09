/**
 * Configuration Module for Titan Framework
 *
 * Provides comprehensive configuration management with:
 * - Multiple configuration sources (files, env, argv, remote)
 * - Schema validation with Zod
 * - Hot reload support
 * - Caching and optimization
 * - Type-safe access
 *
 * @module titan/modules/config
 */

import { createToken } from '../../nexus/index.js';
import { ZodType } from 'zod';
import { Errors } from '../../errors/index.js';

import { ConfigService } from './config.service.js';
import { ConfigLoaderService } from './config-loader.service.js';
import { ConfigValidatorService } from './config-validator.service.js';
import { ConfigWatcherService } from './config-watcher.service.js';
import { Module } from '../../decorators/index.js';

import {
  CONFIG_SERVICE_TOKEN,
  CONFIG_LOADER_SERVICE_TOKEN,
  CONFIG_VALIDATOR_SERVICE_TOKEN,
  CONFIG_WATCHER_SERVICE_TOKEN,
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN
} from './config.tokens.js';

import type { IConfigModuleOptions, IConfigAsyncOptions } from './types.js';

/**
 * Global Configuration Module
 *
 * Provides configuration capabilities to the entire application
 */
@Module()
export class ConfigModule {

  /**
   * Configure the Config module with options
   */
  static forRoot(options: IConfigModuleOptions & { defaults?: Record<string, any> } = {}): any {
    // Create service instances directly
    const loader = new ConfigLoaderService();
    const validator = new ConfigValidatorService();
    const watcher = options.watchForChanges ? new ConfigWatcherService() : undefined;

    // Convert defaults to sources if provided and no sources are specified
    const normalizedOptions = { ...options };
    if (!normalizedOptions.sources && (options as any).defaults) {
      normalizedOptions.sources = [{
        type: 'object' as const,
        data: (options as any).defaults
      }];
    }

    // Create ConfigService instance directly
    const configService = new ConfigService(
      normalizedOptions,
      loader,
      validator,
      watcher,
      options.schema,
      undefined // Logger will be injected separately if needed
    );

    return {
      module: ConfigModule,
      providers: [
        // Provide normalized options
        [CONFIG_OPTIONS_TOKEN, {
          useValue: normalizedOptions
        }] as any,

        // Provide global schema if specified
        ...(options.schema ? [
          [CONFIG_SCHEMA_TOKEN, {
            useValue: options.schema
          }] as any
        ] : []),

        // Config Loader Service - use value instead of class
        [CONFIG_LOADER_SERVICE_TOKEN, {
          useValue: loader
        }] as any,

        // Config Validator Service - use value instead of class
        [CONFIG_VALIDATOR_SERVICE_TOKEN, {
          useValue: validator
        }] as any,

        // Config Watcher Service (only if watching is enabled)
        ...(watcher ? [
          [CONFIG_WATCHER_SERVICE_TOKEN, {
            useValue: watcher
          }] as any
        ] : []),

        // Main Config Service - use value instead of factory
        [CONFIG_SERVICE_TOKEN, {
          useValue: configService
        }] as any
      ],
      exports: [
        CONFIG_SERVICE_TOKEN,
        CONFIG_LOADER_SERVICE_TOKEN,
        CONFIG_VALIDATOR_SERVICE_TOKEN,
        ...(watcher ? [CONFIG_WATCHER_SERVICE_TOKEN] : [])
      ],
      global: options.global // Propagate global option
    };
  }

  /**
   * Configure the Config module for a specific feature
   */
  static forFeature(name: string, schema?: ZodType): any {
    const featureToken = createToken(`Config:${name}`);

    return {
      module: ConfigModule,
      providers: [
        // Feature-specific configuration provider
        [featureToken, {
          useFactory: async (configService: ConfigService) => {
            const value = configService.get(name);

            // Validate if schema provided
            if (schema) {
              const result = schema.safeParse(value);
              if (!result.success) {
                throw Errors.badRequest(`Configuration validation failed for ${name}`, {
                  errors: result.error.issues
                });
              }
              return result.data;
            }

            return value;
          },
          inject: [CONFIG_SERVICE_TOKEN]
        }] as any
      ],
      exports: [featureToken]
    };
  }

  /**
   * Configure the Config module asynchronously
   */
  static forRootAsync(options: IConfigAsyncOptions): any {
    // Create service instances directly
    const loader = new ConfigLoaderService();
    const validator = new ConfigValidatorService();
    const watcher = new ConfigWatcherService();

    return {
      module: ConfigModule,
      providers: [
        // Provide async options
        [CONFIG_OPTIONS_TOKEN, {
          useFactory: options.useFactory,
          inject: options.inject || []
        }] as any,

        // Config Loader Service - use value instead of class
        [CONFIG_LOADER_SERVICE_TOKEN, {
          useValue: loader
        }] as any,

        // Config Validator Service - use value instead of class
        [CONFIG_VALIDATOR_SERVICE_TOKEN, {
          useValue: validator
        }] as any,

        // Config Watcher Service - use value instead of class
        [CONFIG_WATCHER_SERVICE_TOKEN, {
          useValue: watcher
        }] as any,

        // Main Config Service with async initialization
        [CONFIG_SERVICE_TOKEN, {
          useFactory: async (opts: IConfigModuleOptions & { defaults?: Record<string, any> }) => {
            // Normalize options to handle defaults
            const normalizedOpts = { ...opts };
            if (!normalizedOpts.sources && (opts as any).defaults) {
              normalizedOpts.sources = [{
                type: 'object' as const,
                data: (opts as any).defaults
              }];
            }

            // Provide schema if available in options
            const schema = opts.schema;

            const service = new ConfigService(
              normalizedOpts,
              loader,
              validator,
              opts.watchForChanges ? watcher : undefined,
              schema,
              undefined // Logger will be injected separately if needed
            );
            return service;
          },
          inject: [CONFIG_OPTIONS_TOKEN],
          scope: 'singleton'
        }] as any
      ],
      exports: [
        CONFIG_SERVICE_TOKEN,
        CONFIG_LOADER_SERVICE_TOKEN,
        CONFIG_VALIDATOR_SERVICE_TOKEN,
        CONFIG_WATCHER_SERVICE_TOKEN
      ],
      global: options.global // Propagate global option
    };
  }

  /**
   * Lifecycle hooks
   */
  async onStart?(app: any): Promise<void> {
    // Config service initialization is now handled by the service itself
  }

  async onStop?(app: any): Promise<void> {
    // Config service disposal is now handled by the service itself
  }
}

/**
 * Re-export types and services
 */
export * from './types.js';
export * from './config.tokens.js';
export * from './config.service.js';
export * from './config-loader.service.js';
export * from './config-validator.service.js';
export * from './config-watcher.service.js';