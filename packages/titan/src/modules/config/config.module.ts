/**
 * Configuration Module for Titan Framework
 *
 * This module provides zero-config, automatic configuration management
 * with smart defaults, auto-discovery, and type safety.
 *
 * @module ConfigModule
 * @description First-class configuration system that eliminates boilerplate
 */

import { Module, DynamicModule, Provider, ProviderDefinition, createToken, InjectionToken } from '@omnitron-dev/nexus';
import { ZodType } from 'zod';

import { IApplication, IModule } from '../../types.js';
import {
  ConfigModuleOptions,
  ConfigModuleAsyncOptions,
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  CONFIG_LOADER_TOKEN,
  ConfigServiceToken,
} from './config.types.js';
import { ConfigService } from './config.service.js';
import { ConfigLoader } from './config.loader.js';
import { createConfigToken, detectEnvironment, findConfigFiles } from './config.utils.js';

/**
 * Smart Configuration Module
 *
 * Features:
 * - Zero-config initialization with smart defaults
 * - Automatic config file discovery
 * - Environment-based configuration cascade
 * - Type-safe configuration with Zod schemas
 * - Module-specific configuration via forFeature
 * - Hot-reload in development
 * - Built-in caching and optimization
 *
 * @example
 * ```typescript
 * // Automatic usage - no configuration needed!
 * // ConfigModule is automatically registered by Application
 *
 * // Optional: Define schema for type safety
 * const AppConfig = z.object({
 *   port: z.number().default(3000),
 *   database: z.object({
 *     host: z.string(),
 *     port: z.number(),
 *   }),
 * });
 *
 * // Set schema before creating app
 * ConfigModule.setGlobalSchema(AppConfig);
 *
 * // Optional: Module-specific config
 * @Module({
 *   imports: [
 *     ConfigModule.forFeature('database', DatabaseSchema),
 *   ],
 * })
 * class DatabaseModule {}
 * ```
 */

@Module({})
export class ConfigModule implements IModule {
  private static instance: ConfigService;
  private static initialized = false;
  private static globalSchema?: ZodType;

  // Module metadata for Titan
  readonly name = 'ConfigModule';
  readonly version = '2.0.0';

  /**
   * Create the ConfigModule with automatic configuration
   * This is called automatically by Application.registerCoreModules()
   *
   * @internal
   */
  static async createAutomatic(options?: Partial<ConfigModuleOptions>): Promise<ConfigModule> {
    if (ConfigModule.initialized) {
      return new ConfigModule();
    }

    const environment = detectEnvironment();
    const configFiles = await findConfigFiles(process.cwd());

    // Build smart default sources
    const sources = [
      // 1. Default configuration file (if exists)
      ...configFiles.defaults.map(file => ({
        type: 'file' as const,
        path: file,
        optional: true,
      })),

      // 2. Environment-specific configuration
      ...configFiles.environment.map(file => ({
        type: 'file' as const,
        path: file,
        optional: true,
      })),

      // 3. .env files (in priority order)
      ...configFiles.dotenv.map(file => ({
        type: 'dotenv' as const,
        path: file,
        optional: true,
      })),

      // 4. Environment variables with smart prefixes
      {
        type: 'env' as const,
        prefix: process.env['CONFIG_PREFIX'] || 'APP_',
        separator: process.env['CONFIG_SEPARATOR'] || '__',
      },

      // 5. Command line arguments (highest priority)
      {
        type: 'argv' as const,
        prefix: '--',
      },

      // 6. User-provided sources (if any)
      ...(options?.sources || []),
    ];

    // Create optimized options
    const optimizedOptions: ConfigModuleOptions = {
      ...options,
      sources,
      environment,
      autoLoad: true,
      validateOnStartup: environment === 'production',
      watchForChanges: environment === 'development',
      cache: {
        enabled: true,
        ttl: environment === 'production' ? 300000 : 60000, // 5min in prod, 1min in dev
        ...options?.cache,
      },
    };

    // Create and initialize the service
    const service = new ConfigService(optimizedOptions, ConfigModule.globalSchema);
    await service.initialize();

    ConfigModule.instance = service;
    ConfigModule.initialized = true;

    return new ConfigModule();
  }

  /**
   * Set global schema for type validation
   * Call this before Application.create() for type safety
   *
   * @param schema - Zod schema for configuration validation
   */
  static setGlobalSchema<T>(schema: ZodType<T>): void {
    ConfigModule.globalSchema = schema;
  }

  /**
   * Register a configuration subset for a specific module
   * This provides type-safe, isolated configuration for feature modules
   *
   * @param name - Name of the configuration section
   * @param schema - Zod schema for validation
   * @param path - Optional path to the configuration section
   */
  static forFeature<T>(
    name: string,
    schema: ZodType<T>,
    path?: string
  ): DynamicModule {
    const token = createConfigToken(name);

    const featureProvider: [InjectionToken<any>, ProviderDefinition] = [
      token,
      {
      useFactory: async () => {
        // Ensure ConfigModule is initialized
        if (!ConfigModule.instance) {
          throw new Error('ConfigModule not initialized. Ensure Application is created properly.');
        }

        // Get configuration section
        const configPath = path || name;
        const data = ConfigModule.instance.get(configPath);

        // Validate with schema
        const result = schema.safeParse(data);
        if (!result.success) {
          const errors = (result.error as any).issues || (result.error as any).errors || [];
          throw new Error(
            `Invalid configuration for ${name}: ${JSON.stringify(errors)}`
          );
        }

        return result.data;
        },
      },
    ];

    return {
      module: ConfigModule,
      providers: [featureProvider],
      exports: [token],
    };
  }

  /**
   * Create a typed configuration provider
   */
  static createProvider<T>(name: string, schema: ZodType<T>, path?: string): [symbol, ProviderDefinition] {
    const token = createConfigToken(name);

    const provider: ProviderDefinition = {
      useFactory: async (configService: ConfigService) => {
        const data = path ? configService.get(path) : configService.getAll();
        return configService.getTyped(schema, path);
      },
      inject: [ConfigService],
    };

    return [token, provider];
  }

  /**
   * Get the global ConfigService instance
   */
  static getService(): ConfigService | undefined {
    return ConfigModule.instance;
  }

  /**
   * Get the instance for internal use
   * @internal
   */
  static getInstance(): ConfigService | undefined {
    return ConfigModule.instance;
  }

  /**
   * Get a configuration value directly (static helper)
   */
  static get<T = any>(path: string, defaultValue?: T): T | undefined {
    return ConfigModule.instance?.get(path, defaultValue);
  }

  /**
   * Get the entire configuration object
   */
  static getAll(): Record<string, any> {
    return ConfigModule.instance?.getAll() || {};
  }

  /**
   * Check if a configuration path exists
   */
  static has(path: string): boolean {
    return ConfigModule.instance?.has(path) || false;
  }

  /**
   * Instance methods for backward compatibility
   */
  get<T = any>(path: string, defaultValue?: T): T | undefined {
    return ConfigModule.get(path, defaultValue);
  }

  has(path: string): boolean {
    return ConfigModule.has(path);
  }

  getAll(): Record<string, any> {
    return ConfigModule.getAll();
  }

  get environment(): string {
    return ConfigModule.instance?.environment || 'development';
  }

  get info(): any {
    return this.onInfo ? this.onInfo() : {};
  }

  /**
   * Module lifecycle hooks
   */
  async onRegister?(app: IApplication): Promise<void> {
    // ConfigService registration is handled in Application.registerCoreModules
    // to avoid duplicate registration errors
  }

  async onStart?(app: IApplication): Promise<void> {
    if (!ConfigModule.instance) {
      throw new Error('ConfigModule not properly initialized');
    }

    // Log configuration status
    try {
      const logger = app.get(createToken('Logger')) as any;
      if (logger?.info) {
        const metadata = ConfigModule.instance.getMetadata();
        logger.info(
          {
            environment: ConfigModule.instance.environment,
            sources: metadata.sources?.length || 0,
            cached: metadata.cached || false,
          },
          'Configuration module started'
        );
      }
    } catch (error) {
      // Logger not available, skip logging
      console.log('[ConfigModule] Started successfully');
    }
  }

  async onStop?(app: IApplication): Promise<void> {
    if (ConfigModule.instance && typeof ConfigModule.instance.dispose === 'function') {
      await ConfigModule.instance.dispose();
    }
  }

  async onHealthCheck?(): Promise<any> {
    if (!ConfigModule.instance) {
      return {
        status: 'unhealthy',
        message: 'ConfigService not initialized',
      };
    }

    return {
      status: 'healthy',
      environment: ConfigModule.instance.environment,
      uptime: Date.now() - ConfigModule.instance.getMetadata().loadedAt.getTime(),
    };
  }

  async onInfo?(): Promise<any> {
    if (!ConfigModule.instance) {
      return { initialized: false };
    }

    const metadata = ConfigModule.instance.getMetadata();
    return {
      initialized: true,
      environment: ConfigModule.instance.environment,
      sources: metadata.sources?.map(s => ({
        type: s.type,
        loaded: s.loaded,
      })),
      loadedAt: metadata.loadedAt,
      cached: metadata.cached,
    };
  }
}

/**
 * Export a singleton instance for direct usage
 * This allows users to import and use the config directly
 *
 * @example
 * ```typescript
 * import { config } from '@omnitron-dev/titan/config';
 *
 * const port = config.get('server.port', 3000);
 * ```
 */
export const config = new Proxy({} as ConfigService, {
  get(target, prop) {
    const instance = ConfigModule.getInstance();
    if (!instance) {
      throw new Error(
        'ConfigModule not initialized. Ensure Application is created before accessing config.'
      );
    }
    return Reflect.get(instance, prop);
  },
});