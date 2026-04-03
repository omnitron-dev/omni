/**
 * Scheduler Persistence Providers
 *
 * Provides persistence implementations for the scheduler.
 * All providers implement the IPersistenceProvider interface for consistency.
 *
 * @module @omnitron-dev/titan/module/scheduler/persistence
 */

// ============================================================================
// Persistence Providers
// ============================================================================

export { RedisPersistenceProvider } from './redis-persistence.provider.js';
export { DatabasePersistenceProvider } from './database-persistence.provider.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Abstraction interface for Redis-compatible storage.
 * This interface allows the scheduler to work with any Redis-compatible client.
 */
export type { IKeyValueStore } from './redis-persistence.provider.js';
