/** Public, standalone migration API. Importing it does not start the daemon or load its DI graph. */
import {
  createMigrationRunner as createEngine,
  createMigrationRunnerWithPlugins as createPluginEngine,
  createMigrationHistory,
  type Migration,
  type MigrationRunner,
  type MigrationRunnerOptions,
  type MigrationRunnerWithPluginsOptions,
} from '@omnitron-dev/titan-database/migration';
import type { Kysely } from 'kysely';

export {
  createMigrationHistory, defineMigrations, createMigration, createMigrationWithMeta,
  createPostgresMigrationDatabase, migrationSqlClient, defineSqlMigration,
  createHardenedRunner, HardenedMigrationRunner, runMigrationCli,
  MigrationError, MigrationHookError,
  MigrationEngineLockError as MigrationLockError, MigrationEngineChecksumError as MigrationChecksumError,
  MigrationLockError as LegacyMigrationLockError, MigrationChecksumError as LegacyMigrationChecksumError,
  createLoggingPlugin, createMetricsPlugin,
} from '@omnitron-dev/titan-database/migration';
export type {
  Migration, MigrationWithMeta, MigrationResult, MigrationStatus, MigrationInspection,
  MigrationHistory, MigrationHistoryOptions, MigrationRecord, MigrationSqlClient,
  MigrationRunnerOptions, HardenedMigration, HardenedRunnerOptions, MigrationCliOptions,
  MigrationRunner, MigrationPlugin, MigrationRunnerWithPluginsOptions, MigrationLockProvider,
} from '@omnitron-dev/titan-database/migration';
export { sql } from 'kysely';
export type { Kysely } from 'kysely';

/** Safe defaults for new Omnitron applications. Pass history explicitly when adopting an existing journal. */
function defaults(): MigrationRunnerOptions {
  return {
    useTransactions: true,
    stopOnError: true,
    enforceChecksums: true,
    strictRollback: true,
    missingMigrationPolicy: 'error',
    history: createMigrationHistory({ checksumColumn: 'checksum', orderColumn: 'execution_order' }),
  };
}

export function createMigrationRunner<DB = unknown>(db: Kysely<DB>, migrations: Migration<DB>[], options: MigrationRunnerOptions = {}): MigrationRunner<DB> {
  return createEngine(db, migrations, { ...defaults(), ...options });
}

export function createMigrationRunnerWithPlugins<DB = unknown>(db: Kysely<DB>, migrations: Migration<DB>[], options: MigrationRunnerWithPluginsOptions<DB> = {}) {
  return createPluginEngine(db, migrations, { ...defaults(), ...options });
}

export async function runMigrations<DB = unknown>(db: Kysely<DB>, migrations: Migration<DB>[], options?: MigrationRunnerOptions) {
  return createMigrationRunner(db, migrations, options).up();
}

/** Explicit connection ownership for commands. The factory runs only after configuration validation. */
export interface MigrationConnection<DB = unknown> {
  db: Kysely<DB>;
  close: () => Promise<void>;
}
export interface MigrationConfig<DB = unknown> {
  name?: string;
  connect: () => Promise<MigrationConnection<DB>>;
  migrations: Migration<DB>[] | (() => Promise<Migration<DB>[]>);
  options?: MigrationRunnerOptions;
}
export function defineMigrationConfig<DB>(config: MigrationConfig<DB>): MigrationConfig<DB> { return config; }

export { executeMigrationOperation, diagnoseMigrationFailure, migrationIntegrity } from './operation.js';
export type { MigrationOperationOptions, MigrationAction } from './operation.js';
