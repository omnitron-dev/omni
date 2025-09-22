/**
 * Configuration Module Tokens
 *
 * Dependency injection tokens for the configuration module
 */

import { createToken, Token } from '@nexus';
import type { ConfigService } from './config.service.js';
import type { ConfigLoaderService } from './config-loader.service.js';
import type { ConfigValidatorService } from './config-validator.service.js';
import type { ConfigWatcherService } from './config-watcher.service.js';
import type { IConfigModuleOptions } from './types.js';

// Service tokens
export const CONFIG_SERVICE_TOKEN: Token<ConfigService> = createToken<ConfigService>('ConfigService');
export const CONFIG_LOADER_SERVICE_TOKEN: Token<ConfigLoaderService> = createToken<ConfigLoaderService>('ConfigLoaderService');
export const CONFIG_VALIDATOR_SERVICE_TOKEN: Token<ConfigValidatorService> = createToken<ConfigValidatorService>('ConfigValidatorService');
export const CONFIG_WATCHER_SERVICE_TOKEN: Token<ConfigWatcherService> = createToken<ConfigWatcherService>('ConfigWatcherService');

// Options token
export const CONFIG_OPTIONS_TOKEN: Token<IConfigModuleOptions> = createToken<IConfigModuleOptions>('ConfigOptions');

// Schema token
export const CONFIG_SCHEMA_TOKEN: Token<any> = createToken<any>('ConfigSchema');

// Logger token (optional dependency)
export const CONFIG_LOGGER_TOKEN: Token<any> = createToken<any>('ConfigLogger');