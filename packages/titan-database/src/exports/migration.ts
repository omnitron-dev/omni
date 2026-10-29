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
  MigrationHookError,
  createMigrationHistory,
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
  MigrationHistory,
  MigrationHistoryOptions,
  MigrationRecord,
  MigrationInspection,
  MigrationLockProvider,
} from '@kysera/migrations';

/**
 * @deprecated Use Migration from @kysera/migrations
 */
export type IMigration = import('@kysera/migrations').Migration;

// Compatibility API; execution and storage are delegated to Kysera.
export {
  HardenedMigrationRunner,
  createHardenedRunner,
  MigrationLockError,
  MigrationChecksumError,
  runMigrationCli,
  loadMigrationFiles,
  migrationLockKey,
} from '../migration/index.js';
export { createPostgresMigrationDatabase, migrationSqlClient, defineSqlMigration } from '../migration/postgres.js';
export type { MigrationSqlClient } from '../migration/postgres.js';
export { MigrationLockError as MigrationEngineLockError, MigrationChecksumError as MigrationEngineChecksumError } from '@kysera/migrations';
export type {
  HardenedMigration,
  HardenedLogger,
  HardenedRunnerOptions,
  HardenedUpResult,
  HardenedDownResult,
  HardenedStatus,
  MigrationCliOptions,
} from '../migration/index.js';
