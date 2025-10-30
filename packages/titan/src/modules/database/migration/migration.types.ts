/**
 * Migration Types
 *
 * Type definitions for database migration system
 */

import type { Kysely, Transaction } from 'kysely';

/**
 * Migration interface
 */
export interface IMigration {
  /**
   * Run the migration forward
   */
  up(db: Kysely<any> | Transaction<any>): Promise<void>;

  /**
   * Rollback the migration
   */
  down(db: Kysely<any> | Transaction<any>): Promise<void>;

  /**
   * Optional: Get SQL statements without executing
   */
  getSql?(): {
    up: string[];
    down: string[];
  };
}

/**
 * Migration metadata
 */
export interface MigrationMetadata {
  /**
   * Migration version (e.g., '20250103_001' or '001')
   */
  version: string;

  /**
   * Migration name/description
   */
  description?: string;

  /**
   * Migration file or class name
   */
  name: string;

  /**
   * Timestamp when migration was created
   */
  createdAt?: Date;

  /**
   * Dependencies (other migrations that must run first)
   */
  dependencies?: string[];

  /**
   * Connection name to run migration on
   */
  connection?: string;

  /**
   * Whether to run in transaction
   */
  transactional?: boolean;

  /**
   * Migration timeout in milliseconds
   */
  timeout?: number;
}

/**
 * Applied migration record
 */
export interface AppliedMigration {
  /**
   * Unique identifier
   */
  id: number;

  /**
   * Migration version
   */
  version: string;

  /**
   * Migration name
   */
  name: string;

  /**
   * Migration description
   */
  description?: string;

  /**
   * When migration was applied
   */
  appliedAt: Date;

  /**
   * How long migration took in milliseconds
   */
  executionTime: number;

  /**
   * Checksum to verify migration hasn't changed
   */
  checksum?: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Migration status
 */
export interface MigrationStatus {
  /**
   * Applied migrations
   */
  applied: AppliedMigration[];

  /**
   * Pending migrations
   */
  pending: MigrationMetadata[];

  /**
   * Current version
   */
  currentVersion?: string;

  /**
   * Latest available version
   */
  latestVersion?: string;

  /**
   * Whether database is up to date
   */
  isUpToDate: boolean;

  /**
   * Any conflicts or issues
   */
  issues?: string[];
}

/**
 * Migration options
 */
export interface MigrationRunOptions {
  /**
   * Connection name to use
   */
  connection?: string;

  /**
   * Whether to use transactions
   */
  transactional?: boolean;

  /**
   * Whether to do a dry run (don't actually run migrations)
   */
  dryRun?: boolean;

  /**
   * Whether to force run (ignore checksums)
   */
  force?: boolean;

  /**
   * Specific versions to run
   */
  versions?: string[];

  /**
   * Timeout for each migration in milliseconds
   */
  timeout?: number;

  /**
   * Whether to continue on error
   */
  continueOnError?: boolean;

  /**
   * Whether to log SQL statements
   */
  logSql?: boolean;
}

/**
 * Migration down options
 */
export interface MigrationDownOptions extends MigrationRunOptions {
  /**
   * Number of migrations to rollback
   */
  steps?: number;

  /**
   * Target version to rollback to
   */
  targetVersion?: string;
}

/**
 * Migration result
 */
export interface MigrationResult {
  /**
   * Whether migration was successful
   */
  success: boolean;

  /**
   * Migrations that were run
   */
  migrations: {
    version: string;
    name: string;
    direction: 'up' | 'down';
    executionTime: number;
    status: 'success' | 'failed' | 'skipped';
    error?: string;
  }[];

  /**
   * Total execution time
   */
  totalTime: number;

  /**
   * Any errors that occurred
   */
  errors?: string[];

  /**
   * Whether it was a dry run
   */
  dryRun?: boolean;
}

/**
 * Migration provider interface
 */
export interface IMigrationProvider {
  /**
   * Get all available migrations
   */
  getMigrations(): Promise<Map<string, IMigration>>;

  /**
   * Get migration by version
   */
  getMigration(version: string): Promise<IMigration | null>;

  /**
   * Get migration metadata
   */
  getMetadata(version: string): Promise<MigrationMetadata | null>;

  /**
   * Get all migration metadata
   */
  getAllMetadata(): Promise<MigrationMetadata[]>;
}

/**
 * Migration lock interface
 */
export interface IMigrationLock {
  /**
   * Acquire migration lock
   */
  acquire(timeout?: number): Promise<boolean>;

  /**
   * Release migration lock
   */
  release(): Promise<void>;

  /**
   * Check if lock is held
   */
  isLocked(): Promise<boolean>;

  /**
   * Force release lock
   */
  forceRelease(): Promise<void>;
}

/**
 * Migration configuration
 */
export interface MigrationConfig {
  /**
   * Table name for migration history
   */
  tableName?: string;

  /**
   * Lock table name
   */
  lockTableName?: string;

  /**
   * Directory containing migration files
   */
  directory?: string;

  /**
   * File pattern for migrations (e.g., '*.migration.ts')
   */
  pattern?: string;

  /**
   * Whether to use timestamps in version
   */
  useTimestamp?: boolean;

  /**
   * Default timeout for migrations
   */
  defaultTimeout?: number;

  /**
   * Whether to validate checksums
   */
  validateChecksums?: boolean;

  /**
   * Whether to use transactions by default
   */
  transactional?: boolean;

  /**
   * Custom migration providers
   */
  providers?: IMigrationProvider[];

  /**
   * Lock timeout in milliseconds
   */
  lockTimeout?: number;

  /**
   * Whether to create migration table automatically
   */
  autoCreateTable?: boolean;

  /**
   * Whether to enable debug logging
   */
  debug?: boolean;
}

/**
 * Migration events
 */
export enum MigrationEventType {
  MIGRATION_STARTING = 'migration.starting',
  MIGRATION_COMPLETED = 'migration.completed',
  MIGRATION_FAILED = 'migration.failed',
  MIGRATION_SKIPPED = 'migration.skipped',
  ROLLBACK_STARTING = 'rollback.starting',
  ROLLBACK_COMPLETED = 'rollback.completed',
  ROLLBACK_FAILED = 'rollback.failed',
  LOCK_ACQUIRED = 'lock.acquired',
  LOCK_RELEASED = 'lock.released',
}

/**
 * Migration event
 */
export interface MigrationEvent {
  type: MigrationEventType;
  version: string;
  name: string;
  direction?: 'up' | 'down';
  executionTime?: number;
  error?: Error;
  metadata?: Record<string, any>;
}
