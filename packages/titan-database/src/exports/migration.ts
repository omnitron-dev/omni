/**
 * Migration System Exports
 *
 * Re-exports from @kysera/migrations.
 * Apps can also import @kysera/migrations directly.
 *
 * @module @omnitron-dev/titan/module/database/migration
 */

export {
  MigrationRunner,
  createMigrationRunner,
  runMigrations,
  rollbackMigrations,
  getMigrationStatus,
  setupMigrations,
  defineMigrations,
  createMigration,
  createMigrationWithMeta,
  MigrationRunnerWithPlugins,
  createMigrationRunnerWithPlugins,
  createLoggingPlugin,
  createMetricsPlugin,
  MigrationError,
} from '@kysera/migrations';

export type {
  Migration,
  MigrationWithMeta,
  MigrationStatus,
  MigrationResult,
  MigrationRunnerOptions,
  MigrationDefinition,
  MigrationDefinitions,
  MigrationPlugin,
  MigrationRunnerWithPluginsOptions,
} from '@kysera/migrations';

/**
 * @deprecated Use Migration from @kysera/migrations
 */
export type IMigration = import('@kysera/migrations').Migration;

// Hardened wrapper — adds advisory locking, checksum integrity, atomic
// (migration+bookkeeping) transactions, and a turnkey CLI on top of the
// vanilla kysera runner. New code should prefer these over the raw kysera
// primitives. See ../migration/hardened-runner.ts for design notes.
export {
  HardenedMigrationRunner,
  createHardenedRunner,
  MigrationLockError,
  MigrationChecksumError,
  runMigrationCli,
} from '../migration/index.js';
export type {
  HardenedMigration,
  HardenedLogger,
  HardenedRunnerOptions,
  HardenedUpResult,
  HardenedDownResult,
  HardenedStatus,
  MigrationCliOptions,
} from '../migration/index.js';
