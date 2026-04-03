/**
 * Omnitron Database — Schema & Migration Utilities
 *
 * Exports the typed schema for Omnitron's internal PostgreSQL database
 * and provides migration runner infrastructure.
 */

export type { OmnitronDatabase } from './schema.js';
export * from './schema.js';

// Re-export migration for programmatic use
export * as migration001 from './migrations/001_initial_schema.js';
