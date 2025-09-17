export const REDIS_MODULE_OPTIONS = Symbol('REDIS_MODULE_OPTIONS');
export const REDIS_MANAGER = Symbol('REDIS_MANAGER');
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const DEFAULT_REDIS_NAMESPACE = 'default';

export const getRedisToken = (namespace?: string): string | symbol => {
  return namespace ? `${REDIS_CLIENT.toString()}_${namespace}` : REDIS_CLIENT;
};

export const getRedisOptionsToken = (namespace?: string): string => {
  return namespace ? `${REDIS_MODULE_OPTIONS.toString()}_${namespace}` : REDIS_MODULE_OPTIONS.toString();
};