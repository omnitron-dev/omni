import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type { IRateLimitService, IRateLimitModuleOptions, IRateLimitStorage } from './ratelimit.types.js';

/**
 * Injection token for the rate limit service.
 *
 * @public
 */
export const RATE_LIMIT_SERVICE_TOKEN: Token<IRateLimitService> = createToken<IRateLimitService>('RateLimitService');

/**
 * Injection token for rate limit module options.
 *
 * @public
 */
export const RATE_LIMIT_OPTIONS_TOKEN: Token<IRateLimitModuleOptions> =
  createToken<IRateLimitModuleOptions>('RateLimitOptions');

/**
 * Injection token for rate limit storage backend.
 *
 * @public
 */
export const RATE_LIMIT_STORAGE_TOKEN: Token<IRateLimitStorage> = createToken<IRateLimitStorage>('RateLimitStorage');

/**
 * Default key prefix for rate limit keys in storage.
 *
 * @public
 */
export const DEFAULT_RATE_LIMIT_PREFIX = 'ratelimit';
