/**
 * Configuration Module for Titan Framework
 *
 * Provides comprehensive configuration management with:
 * - Type-safe configuration schemas
 * - Multiple configuration sources (files, environment, objects)
 * - Automatic environment-based loading
 * - Hot-reload capabilities
 * - Dependency injection support
 * - Built-in validation with Zod
 *
 * @module @omnitron-dev/titan/module/config
 *
 * @example
 * ```typescript
 * import {
 *   ConfigModule,
 *   ConfigService,
 *   InjectConfig,
 *   CONFIG_SERVICE_TOKEN
 * } from '@omnitron-dev/titan/module/config';
 *
 * // Configure module
 * @Module({
 *   imports: [ConfigModule.forRoot({ sources: [{ type: 'env' }] })]
 * })
 * class AppModule {}
 *
 * // Inject config service
 * @Injectable()
 * class MyService {
 *   constructor(@Inject(CONFIG_SERVICE_TOKEN) private config: ConfigService) {}
 * }
 * ```
 */

// ============================================================================
// Module
// ============================================================================

export { ConfigModule } from './config.module.js';

// ============================================================================
// Services
// ============================================================================

export { ConfigService } from './config.service.js';
export { ConfigLoaderService } from './config-loader.service.js';
export { ConfigValidatorService } from './config-validator.service.js';
export { ConfigWatcherService } from './config-watcher.service.js';

// ============================================================================
// Decorators
// ============================================================================

export {
  Config,
  InjectConfig,
  ConfigSchema,
  Configuration,
  ConfigWatch,
  ConfigDefaults,
  ConfigProvider,
} from './config.decorator.js';

// ============================================================================
// Tokens (for DI)
// ============================================================================

export {
  CONFIG_SERVICE_TOKEN,
  CONFIG_LOADER_SERVICE_TOKEN,
  CONFIG_VALIDATOR_SERVICE_TOKEN,
  CONFIG_WATCHER_SERVICE_TOKEN,
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  LOGGER_TOKEN, // Re-exported from logger module for convenience
} from './config.tokens.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  // Module options
  IConfigModuleOptions,
  IConfigAsyncOptions,
  IConfigFeatureOptions,

  // Interfaces
  IConfigProvider,
  IConfigLoader,
  IConfigValidator,
  IConfigWatcher,

  // Source types
  IConfigSource,
  IFileConfigSource,
  IEnvironmentConfigSource,
  IArgvConfigSource,
  IObjectConfigSource,
  IRemoteConfigSource,
  ConfigSource,
  ConfigSourceType,

  // Events and results
  IConfigChangeEvent,
  IConfigValidationResult,
  IConfigMetadata,

  // Zod schema type
  AnyZodSchema,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

export { CONFIG_INJECT_METADATA_KEY, CONFIG_SCHEMA_METADATA_KEY } from './types.js';
