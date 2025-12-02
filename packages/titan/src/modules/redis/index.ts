export * from './redis.types.js';
export * from './redis.utils.js';
export * from './redis.module.js';
export * from './redis.health.js';
export * from './redis.service.js';
export * from './redis.manager.js';
export * from './redis.constants.js';
export * from './redis.decorators.js';

// Module alias for consistent naming (preferred)
import { TitanRedisModule } from './redis.module.js';

/**
 * Alias for TitanRedisModule for consistent naming convention.
 * Recommended: Use `RedisModule` for consistency with other modules.
 */
export { TitanRedisModule as RedisModule };
