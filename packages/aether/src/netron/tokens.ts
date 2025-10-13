/**
 * @fileoverview Injection tokens for Netron integration
 * @module @omnitron-dev/aether/netron
 */

import { createInjectionToken } from '../di/tokens.js';
import type { BackendConfig } from './types.js';
import type { HttpCacheManager, RetryManager, HttpRemotePeer } from '@omnitron-dev/netron-browser';

/**
 * Injection token for backend configuration
 */
export const BACKEND_CONFIG = createInjectionToken<BackendConfig>('netron.backend-config');

/**
 * Injection token for cache manager
 */
export const CACHE_MANAGER = createInjectionToken<HttpCacheManager>('netron.cache-manager');

/**
 * Injection token for retry manager
 */
export const RETRY_MANAGER = createInjectionToken<RetryManager>('netron.retry-manager');

/**
 * Injection token for backend registry
 */
export const BACKEND_REGISTRY = createInjectionToken<Map<string, HttpRemotePeer>>('netron.backend-registry');

/**
 * Injection token for default backend name
 */
export const DEFAULT_BACKEND = createInjectionToken<string>('netron.default-backend');

/**
 * Metadata keys for decorators
 */
export const NETRON_METADATA = {
  BACKEND: 'netron:backend',
  SERVICE: 'netron:service',
  QUERY: 'netron:query',
  MUTATION: 'netron:mutation',
} as const;
