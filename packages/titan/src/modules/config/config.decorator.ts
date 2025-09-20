/**
 * Configuration Decorators
 *
 * Provides decorators for dependency injection and configuration management
 */

import 'reflect-metadata';
import { Token, createToken, Inject } from '@omnitron-dev/nexus';
import { ZodType } from 'zod';
import { CONFIG_INJECT_METADATA_KEY, CONFIG_SCHEMA_METADATA_KEY } from './types.js';

/**
 * Decorator to inject configuration values into class properties or constructor parameters
 *
 * @example
 * ```typescript
 * class MyService {
 *   @Config('database.host')
 *   private dbHost: string;
 *
 *   constructor(
 *     @Config('app.port') private port: number,
 *     @Config('redis.url', 'redis://localhost:6379') private redisUrl: string
 *   ) {}
 * }
 * ```
 */
export function Config(path?: string, defaultValue?: any): any {
  return function (target: any, propertyKey?: string | symbol, parameterIndex?: number) {
    if (parameterIndex !== undefined) {
      // Constructor parameter decorator
      const existingTokens = Reflect.getMetadata('design:paramtokens', target, propertyKey!) || [];
      existingTokens[parameterIndex] = createConfigToken(path || (propertyKey ? propertyKey.toString() : `param_${parameterIndex}`));
      Reflect.defineMetadata('design:paramtokens', existingTokens, target, propertyKey!);

      // Store config metadata
      const metadata = { path, defaultValue, index: parameterIndex };
      const existingMetadata = Reflect.getMetadata(CONFIG_INJECT_METADATA_KEY, target) || [];
      existingMetadata.push(metadata);
      Reflect.defineMetadata(CONFIG_INJECT_METADATA_KEY, existingMetadata, target);
    } else if (propertyKey) {
      // Property decorator
      const metadata = { path: path || propertyKey.toString(), defaultValue };
      Reflect.defineMetadata(CONFIG_INJECT_METADATA_KEY, metadata, target, propertyKey);

      // Create getter/setter for lazy injection
      const configKey = Symbol(`__config_${String(propertyKey)}`);
      Object.defineProperty(target, propertyKey, {
        get() {
          if (!this[configKey]) {
            // This will be resolved by the DI container
            const configService = this.__configService;
            if (configService) {
              this[configKey] = configService.get(metadata.path, defaultValue);
            }
          }
          return this[configKey];
        },
        set(value) {
          this[configKey] = value;
        },
        enumerable: true,
        configurable: true
      });
    }
  };
}

/**
 * Decorator to inject the entire configuration object
 *
 * @example
 * ```typescript
 * class MyService {
 *   constructor(@InjectConfig() private config: ConfigService) {}
 * }
 * ```
 */
export function InjectConfig(): any {
  return Inject(createToken('ConfigService'));
}

/**
 * Decorator to define configuration schema for a class
 *
 * @example
 * ```typescript
 * const AppConfigSchema = z.object({
 *   port: z.number(),
 *   host: z.string(),
 * });
 *
 * @ConfigSchema(AppConfigSchema)
 * class AppConfig {
 *   port: number;
 *   host: string;
 * }
 * ```
 */
export function ConfigSchema<T>(schema: ZodType<T>) {
  return function (target: any) {
    Reflect.defineMetadata(CONFIG_SCHEMA_METADATA_KEY, schema, target);

    // Add validation method
    target.prototype.validate = function() {
      return schema.safeParse(this);
    };

    // Add static validation method
    target.validate = function(data: any) {
      return schema.safeParse(data);
    };

    return target;
  };
}

/**
 * Decorator to mark a class as a configuration class
 * This will automatically load and validate the configuration
 *
 * @example
 * ```typescript
 * @Configuration('database')
 * @ConfigSchema(DatabaseSchema)
 * class DatabaseConfig {
 *   host: string;
 *   port: number;
 * }
 * ```
 */
export function Configuration(prefix?: string) {
  return function (target: any) {
    // Mark as configuration class
    Reflect.defineMetadata('titan:configuration', true, target);
    Reflect.defineMetadata('titan:configuration:prefix', prefix || '', target);

    // Auto-register with DI container
    const token = createToken(`${target.name}Config`);
    Reflect.defineMetadata('titan:token', token, target);

    return target;
  };
}

/**
 * Decorator to validate configuration value
 *
 * @example
 * ```typescript
 * class MyService {
 *   @ConfigValidate(z.number().min(1).max(65535))
 *   @Config('app.port')
 *   private port: number;
 * }
 * ```
 */
export function ConfigValidate(schema: ZodType) {
  return function (target: any, propertyKey: string | symbol) {
    const validationKey = Symbol(`__validation_${String(propertyKey)}`);

    // Store validation schema
    Reflect.defineMetadata(`titan:config:validation:${String(propertyKey)}`, schema, target);

    // Override property with validation
    const originalKey = Symbol(`__original_${String(propertyKey)}`);
    Object.defineProperty(target, propertyKey, {
      get() {
        return this[originalKey];
      },
      set(value) {
        const result = schema.safeParse(value);
        if (!result.success) {
          throw new Error(`Validation failed for ${String(propertyKey)}: ${result.error.message}`);
        }
        this[originalKey] = result.data;
      },
      enumerable: true,
      configurable: true
    });
  };
}

/**
 * Decorator to watch configuration changes
 *
 * @example
 * ```typescript
 * class MyService {
 *   @ConfigWatch('database.connectionString')
 *   onDatabaseConfigChange(newValue: string, oldValue: string) {
 *     console.log(`Database connection changed from ${oldValue} to ${newValue}`);
 *   }
 * }
 * ```
 */
export function ConfigWatch(path: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const watchMetadata = Reflect.getMetadata('titan:config:watch', target) || [];
    watchMetadata.push({
      path,
      method: propertyKey,
      handler: descriptor.value
    });
    Reflect.defineMetadata('titan:config:watch', watchMetadata, target);

    return descriptor;
  };
}

/**
 * Decorator to provide default configuration values
 *
 * @example
 * ```typescript
 * @ConfigDefaults({
 *   host: 'localhost',
 *   port: 5432,
 * })
 * class DatabaseConfig {
 *   host: string;
 *   port: number;
 * }
 * ```
 */
export function ConfigDefaults(defaults: Record<string, any>) {
  return function (target: any) {
    Reflect.defineMetadata('titan:config:defaults', defaults, target);
    return target;
  };
}

/**
 * Decorator to mark a method as configuration provider
 *
 * @example
 * ```typescript
 * class ConfigProviders {
 *   @ConfigProvider('database')
 *   async provideDatabaseConfig(): Promise<DatabaseConfig> {
 *     return {
 *       host: await this.getSecretValue('DB_HOST'),
 *       port: 5432,
 *     };
 *   }
 * }
 * ```
 */
export function ConfigProvider(name: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const providers = Reflect.getMetadata('titan:config:providers', target) || {};
    providers[name] = descriptor.value;
    Reflect.defineMetadata('titan:config:providers', providers, target);
    return descriptor;
  };
}

/**
 * Decorator to transform configuration value
 *
 * @example
 * ```typescript
 * class MyService {
 *   @ConfigTransform((value) => value.toUpperCase())
 *   @Config('app.environment')
 *   private environment: string;
 * }
 * ```
 */
export function ConfigTransform(transformer: (value: any) => any) {
  return function (target: any, propertyKey: string | symbol) {
    const transformKey = Symbol(`__transform_${String(propertyKey)}`);
    Reflect.defineMetadata(`titan:config:transform:${String(propertyKey)}`, transformer, target);

    // Apply transformation when value is set
    const originalKey = Symbol(`__original_${String(propertyKey)}`);
    Object.defineProperty(target, propertyKey, {
      get() {
        return this[originalKey];
      },
      set(value) {
        this[originalKey] = transformer(value);
      },
      enumerable: true,
      configurable: true
    });
  };
}

/**
 * Helper function to create configuration token
 */
function createConfigToken(path: string): Token<any> {
  return createToken(`Config:${path}`);
}

/**
 * Helper function to get configuration metadata
 */
export function getConfigMetadata(target: any): any {
  return {
    schema: Reflect.getMetadata(CONFIG_SCHEMA_METADATA_KEY, target),
    inject: Reflect.getMetadata(CONFIG_INJECT_METADATA_KEY, target),
    defaults: Reflect.getMetadata('titan:config:defaults', target),
    watch: Reflect.getMetadata('titan:config:watch', target),
    providers: Reflect.getMetadata('titan:config:providers', target),
  };
}