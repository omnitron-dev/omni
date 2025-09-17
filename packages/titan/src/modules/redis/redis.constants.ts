export const REDIS_MODULE_OPTIONS = Symbol('REDIS_MODULE_OPTIONS');
export const REDIS_MANAGER = Symbol('REDIS_MANAGER');
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_DEFAULT_NAMESPACE = 'default';

// Deprecated, use DEFAULT_REDIS_NAMESPACE
export const DEFAULT_REDIS_NAMESPACE = REDIS_DEFAULT_NAMESPACE;

/**
 * Get injection token for a Redis client
 * @param namespace - The namespace of the client
 * @returns The injection token
 */
export const getRedisClientToken = (namespace?: string): string => namespace && namespace !== REDIS_DEFAULT_NAMESPACE
  ? `REDIS_CLIENT:${namespace}`
  : `REDIS_CLIENT:${REDIS_DEFAULT_NAMESPACE}`;

/**
 * Get injection token for Redis options
 * @param namespace - The namespace of the options
 * @returns The injection token
 */
export const getRedisOptionsToken = (namespace?: string): string => namespace && namespace !== REDIS_DEFAULT_NAMESPACE
  ? `REDIS_OPTIONS:${namespace}`
  : `REDIS_OPTIONS:${REDIS_DEFAULT_NAMESPACE}`;

// Legacy support
export const getRedisToken = getRedisClientToken;