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
