/**
 * Built-in Health Indicators
 *
 * Pre-configured health indicators for common system metrics.
 *
 * @module @omnitron-dev/titan/module/health/indicators
 */

// ============================================================================
// Memory Indicator
// ============================================================================

export { MemoryHealthIndicator } from './memory.indicator.js';

// ============================================================================
// Event Loop Indicators
// ============================================================================

export { EventLoopHealthIndicator, HighResEventLoopIndicator } from './event-loop.indicator.js';

// ============================================================================
// Disk Indicator
// ============================================================================

export { DiskHealthIndicator } from './disk.indicator.js';

// ============================================================================
// Database Indicator
// ============================================================================

export { DatabaseHealthIndicator, type DatabaseHealthOptions, type IDatabaseConnection } from './database.indicator.js';

// ============================================================================
// Redis Indicator
// ============================================================================

export { RedisHealthIndicator, type RedisHealthOptions, type IRedisClient } from './redis.indicator.js';
