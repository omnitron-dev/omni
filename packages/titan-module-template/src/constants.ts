/**
 * Constants for the Template Module
 */

import { createToken, Token } from '@omnitron-dev/titan/nexus';
import type { TemplateModuleOptions } from './types.js';

// Token for module options
export const TEMPLATE_MODULE_OPTIONS: Token<TemplateModuleOptions> = createToken<TemplateModuleOptions>('TEMPLATE_MODULE_OPTIONS');

// Token for the main service
export const TEMPLATE_SERVICE: Token = createToken('TEMPLATE_SERVICE');

// Token for the cache service
export const TEMPLATE_CACHE_SERVICE: Token = createToken('TEMPLATE_CACHE_SERVICE');

// Token for the event emitter
export const TEMPLATE_EVENT_EMITTER: Token = createToken('TEMPLATE_EVENT_EMITTER');

// Token for the logger
export const TEMPLATE_LOGGER: Token = createToken('TEMPLATE_LOGGER');

// Metadata keys for decorators
export const TEMPLATE_METADATA = {
  CACHED_METHOD: 'template:cached_method',
  VALIDATED_METHOD: 'template:validated_method',
  TIMED_METHOD: 'template:timed_method',
  CUSTOM_DECORATOR: 'template:custom_decorator',
} as const;

// Default configuration values
export const DEFAULT_OPTIONS: Partial<TemplateModuleOptions> = {
  debug: false,
  prefix: 'template',
  timeout: 30000, // 30 seconds
  enableCache: true,
  cacheTTL: 300, // 5 minutes
};

// Event names
export const TEMPLATE_EVENTS = {
  INITIALIZED: 'template:initialized',
  DATA_CREATED: 'template:data:created',
  DATA_UPDATED: 'template:data:updated',
  DATA_DELETED: 'template:data:deleted',
  ERROR_OCCURRED: 'template:error:occurred',
  CACHE_HIT: 'template:cache:hit',
  CACHE_MISS: 'template:cache:miss',
} as const;

// Error messages
export const ERROR_MESSAGES = {
  NOT_INITIALIZED: 'Template module is not initialized',
  INVALID_CONFIG: 'Invalid configuration provided',
  OPERATION_TIMEOUT: 'Operation timed out',
  CACHE_ERROR: 'Cache operation failed',
  VALIDATION_ERROR: 'Validation failed',
} as const;

// Cache keys prefix
export const CACHE_PREFIX = 'template:cache:';

// Health check keys
export const HEALTH_CHECK_KEYS = {
  SERVICE: 'service',
  CACHE: 'cache',
  DATABASE: 'database',
} as const;