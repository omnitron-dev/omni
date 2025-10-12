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
 */

// Module
export { ConfigModule } from './config.module.js';

// Services
export { ConfigService } from './config.service.js';
export { ConfigLoaderService } from './config-loader.service.js';
export { ConfigValidatorService } from './config-validator.service.js';
export { ConfigWatcherService } from './config-watcher.service.js';

// Tokens
export {
  CONFIG_SERVICE_TOKEN,
  CONFIG_LOADER_SERVICE_TOKEN,
  CONFIG_VALIDATOR_SERVICE_TOKEN,
  CONFIG_WATCHER_SERVICE_TOKEN,
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  CONFIG_LOGGER_TOKEN,
} from './config.tokens.js';

// Types
export type {
  IConfigModuleOptions,
  IConfigProvider,
  IConfigLoader,
  IConfigValidator,
  IConfigWatcher,
  IConfigSource,
  IFileConfigSource,
  IEnvironmentConfigSource,
  IArgvConfigSource,
  IObjectConfigSource,
  IRemoteConfigSource,
  ConfigSource,
  ConfigSourceType,
  IConfigChangeEvent,
  IConfigValidationResult,
  IConfigMetadata,
  IConfigFeatureOptions,
  IConfigAsyncOptions,
} from './types.js';

// Decorator exports
export * from './config.decorator.js';
