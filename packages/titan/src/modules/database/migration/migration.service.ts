/**
 * Migration Service
 *
 * Handles database migrations
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'events';

import { Injectable, Inject } from '../../../decorators/index.js';
import { Kysely, sql, Transaction } from 'kysely';
import type { IDatabaseManager } from '../database.types.js';
import { DATABASE_MANAGER, MIGRATIONS_TABLE, MIGRATIONS_LOCK_TABLE } from '../database.constants.js';
import { Errors } from '../../../errors/index.js';
import type {
  IMigration,
  MigrationMetadata,
  AppliedMigration,
  MigrationStatus,
  MigrationRunOptions,
  MigrationDownOptions,
  MigrationResult,
  IMigrationProvider,
  IMigrationLock,
  MigrationConfig,
  MigrationEventType,
  MigrationEvent,
} from './migration.types.js';
import { MigrationLock } from './migration.lock.js';
import { MigrationProvider } from './migration.provider.js';
import { createNullLogger, type ILogger } from '../../logger/logger.types.js';

@Injectable()
export class MigrationService extends EventEmitter {
  private config: MigrationConfig;
  private provider: IMigrationProvider;
  private lock: IMigrationLock;
  private logger: ILogger;

  constructor(
    @Inject(DATABASE_MANAGER) private manager: IDatabaseManager,
    config?: MigrationConfig,
    logger?: ILogger
  ) {
    super();

    this.config = {
      tableName: MIGRATIONS_TABLE,
      lockTableName: MIGRATIONS_LOCK_TABLE,
      directory: './migrations',
      pattern: '*.migration.ts',
      useTimestamp: true,
      defaultTimeout: 60000, // 60 seconds
      validateChecksums: true,
      transactional: true,
      lockTimeout: 10000, // 10 seconds
      autoCreateTable: true,
      ...config,
    };

    this.logger = logger ? logger.child({ module: 'MigrationService' }) : createNullLogger();

    // Initialize provider
    this.provider = new MigrationProvider(this.config, this.logger);

    // Initialize lock
    this.lock = new MigrationLock(this.manager, {
      tableName: this.config.lockTableName!,
      timeout: this.config.lockTimeout!,
    }, this.logger);
  }

  /**
   * Initialize migration tables
   */
  async init(connection?: string): Promise<void> {
    const db = await this.manager.getConnection(connection);
    const config = this.manager.getConnectionConfig(connection);

    if (!config) {
      throw Errors.internal('Unable to determine database configuration');
    }

    const dialect = config.dialect;

    // Create migrations table with dialect-specific syntax
    if (dialect === 'sqlite') {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.table(this.config.tableName!)} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          execution_time INTEGER NOT NULL,
          checksum VARCHAR(64),
          metadata TEXT
        )
      `.execute(db);
    } else if (dialect === 'postgres') {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.table(this.config.tableName!)} (
          id SERIAL PRIMARY KEY,
          version VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          execution_time INTEGER NOT NULL,
          checksum VARCHAR(64),
          metadata JSONB
        )
      `.execute(db);
    } else if (dialect === 'mysql') {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.table(this.config.tableName!)} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          version VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          execution_time INT NOT NULL,
          checksum VARCHAR(64),
          metadata JSON
        )
      `.execute(db);
    }

    // Create lock table with dialect-specific syntax
    if (dialect === 'sqlite') {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.table(this.config.lockTableName!)} (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          is_locked INTEGER NOT NULL DEFAULT 0,
          locked_at TEXT,
          locked_by VARCHAR(255)
        )
      `.execute(db);

      // Insert default lock record if not exists (SQLite specific)
      await sql`
        INSERT OR IGNORE INTO ${sql.table(this.config.lockTableName!)} (id, is_locked)
        VALUES (1, 0)
      `.execute(db);
    } else if (dialect === 'postgres') {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.table(this.config.lockTableName!)} (
          id INTEGER PRIMARY KEY DEFAULT 1,
          is_locked BOOLEAN NOT NULL DEFAULT FALSE,
          locked_at TIMESTAMP,
          locked_by VARCHAR(255),
          CHECK (id = 1)
        )
      `.execute(db);

      // Insert default lock record if not exists (PostgreSQL specific)
      await sql`
        INSERT INTO ${sql.table(this.config.lockTableName!)} (id, is_locked)
        VALUES (1, FALSE)
        ON CONFLICT (id) DO NOTHING
      `.execute(db);
    } else if (dialect === 'mysql') {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.table(this.config.lockTableName!)} (
          id INT PRIMARY KEY DEFAULT 1,
          is_locked BOOLEAN NOT NULL DEFAULT FALSE,
          locked_at TIMESTAMP NULL,
          locked_by VARCHAR(255),
          CHECK (id = 1)
        )
      `.execute(db);

      // Insert default lock record if not exists (MySQL specific)
      await sql`
        INSERT IGNORE INTO ${sql.table(this.config.lockTableName!)} (id, is_locked)
        VALUES (1, FALSE)
      `.execute(db);
    }
  }

  /**
   * Run pending migrations
   */
  async up(options?: MigrationRunOptions): Promise<MigrationResult> {
    const opts = {
      transactional: this.config.transactional,
      timeout: this.config.defaultTimeout,
      ...options,
    };

    const result: MigrationResult = {
      success: false,
      migrations: [],
      totalTime: 0,
      dryRun: opts.dryRun,
    };

    const startTime = Date.now();

    let lockAcquired = false;

    try {
      // Acquire lock
      if (!opts.dryRun) {
        const acquired = await this.lock.acquire(this.config.lockTimeout);
        if (!acquired) {
          throw Errors.conflict('Could not acquire migration lock');
        }
        lockAcquired = true;
        this.emit('lock.acquired' as MigrationEventType);
      }

      // Get migration status
      const status = await this.status(opts.connection);

      // Filter migrations to run
      let toRun = status.pending;
      if (opts.versions) {
        toRun = toRun.filter((m) => opts.versions!.includes(m.version));
      }

      if (toRun.length === 0) {
        this.logger.info('No pending migrations');
        result.success = true;
        return result;
      }

      // Run each migration
      for (const metadata of toRun) {
        const migration = await this.provider.getMigration(metadata.version);
        if (!migration) {
          throw Errors.notFound('Migration', metadata.version);
        }

        const migrationResult = await this.runMigration(migration, metadata, 'up', opts);

        result.migrations.push(migrationResult);

        if (migrationResult.status === 'failed' && !opts.continueOnError) {
          throw Errors.internal(`Migration ${metadata.version} failed: ${migrationResult.error}`);
        }
      }

      result.success = result.migrations.every((m) => m.status === 'success');
      result.totalTime = Date.now() - startTime;

      return result;
    } catch (error) {
      result.success = false;
      result.errors = [error instanceof Error ? error.message : String(error)];
      result.totalTime = Date.now() - startTime;
      throw error;
    } finally {
      // Release lock only if we acquired it
      if (lockAcquired && !opts.dryRun) {
        try {
          await this.lock.release();
          this.emit('lock.released' as MigrationEventType);
        } catch (releaseError) {
          this.logger.error({ error: releaseError }, 'Error releasing lock');
        }
      }
    }
  }

  /**
   * Rollback migrations
   */
  async down(options?: MigrationDownOptions): Promise<MigrationResult> {
    const opts = {
      steps: 1,
      transactional: this.config.transactional,
      timeout: this.config.defaultTimeout,
      ...options,
    };

    const result: MigrationResult = {
      success: false,
      migrations: [],
      totalTime: 0,
      dryRun: opts.dryRun,
    };

    const startTime = Date.now();

    let lockAcquired = false;

    try {
      // Acquire lock
      if (!opts.dryRun) {
        const acquired = await this.lock.acquire(this.config.lockTimeout);
        if (!acquired) {
          throw Errors.conflict('Could not acquire migration lock');
        }
        lockAcquired = true;
        this.emit('lock.acquired' as MigrationEventType);
      }

      // Get applied migrations
      const status = await this.status(opts.connection);
      let toRollback = status.applied.slice().reverse();

      // Determine what to rollback
      if (opts.targetVersion) {
        // Find the index of the target version in the applied list (not reversed)
        const targetIndex = status.applied.findIndex((m) => m.version === opts.targetVersion);
        if (targetIndex === -1) {
          throw Errors.notFound('Target version', opts.targetVersion);
        }
        // Rollback all migrations after the target version
        // If we have [001, 002, 003] and target is 002, we rollback [003, 002]
        // So we take all migrations after and including the target, then reverse
        toRollback = status.applied.slice(targetIndex).reverse();
      } else if (opts.steps) {
        toRollback = toRollback.slice(0, opts.steps);
      }

      if (toRollback.length === 0) {
        this.logger.info('No migrations to rollback');
        result.success = true;
        return result;
      }

      // Rollback each migration
      for (const applied of toRollback) {
        const metadata = await this.provider.getMetadata(applied.version);
        if (!metadata) {
          throw Errors.notFound('Migration metadata', applied.version);
        }

        const migration = await this.provider.getMigration(applied.version);
        if (!migration) {
          throw Errors.notFound('Migration', applied.version);
        }

        const migrationResult = await this.runMigration(migration, metadata, 'down', opts);

        result.migrations.push(migrationResult);

        if (migrationResult.status === 'failed' && !opts.continueOnError) {
          throw Errors.internal(`Rollback of ${metadata.version} failed: ${migrationResult.error}`);
        }
      }

      result.success = result.migrations.every((m) => m.status === 'success');
      result.totalTime = Date.now() - startTime;

      return result;
    } catch (error) {
      result.success = false;
      result.errors = [error instanceof Error ? error.message : String(error)];
      result.totalTime = Date.now() - startTime;
      throw error;
    } finally {
      // Release lock only if we acquired it
      if (lockAcquired && !opts.dryRun) {
        try {
          await this.lock.release();
          this.emit('lock.released' as MigrationEventType);
        } catch (releaseError) {
          this.logger.error({ error: releaseError }, 'Error releasing lock');
        }
      }
    }
  }

  /**
   * Get migration status
   */
  async status(connection?: string): Promise<MigrationStatus> {
    const db = await this.manager.getConnection(connection);

    // Get applied migrations
    const appliedRows = await sql`
      SELECT * FROM ${sql.table(this.config.tableName!)}
      ORDER BY version ASC
    `.execute(db);

    const applied: AppliedMigration[] = (appliedRows.rows as Array<Record<string, unknown>>).map((row) => ({
      id: row['id'] as number,
      version: row['version'] as string,
      name: row['name'] as string,
      description: row['description'] as string | undefined,
      appliedAt: new Date(row['applied_at'] as string | number | Date),
      executionTime: row['execution_time'] as number,
      checksum: row['checksum'] as string | undefined,
      metadata: row['metadata'] as Record<string, unknown> | undefined,
    }));

    // Get all available migrations
    const allMetadata = await this.provider.getAllMetadata();
    const appliedVersions = new Set(applied.map((m) => m.version));

    // Get pending migrations
    const pending = allMetadata
      .filter((m) => !appliedVersions.has(m.version))
      .sort((a, b) => a.version.localeCompare(b.version));

    // Determine current and latest versions
    const lastApplied = applied[applied.length - 1];
    const currentVersion = lastApplied ? lastApplied.version : undefined;
    const sortedMetadata = [...allMetadata].sort((a, b) => b.version.localeCompare(a.version));
    const latestVersion = sortedMetadata[0]?.version || undefined;

    // Check for issues
    const issues: string[] = [];

    // Check for missing migrations (applied but not available)
    for (const appliedMigration of applied) {
      if (!allMetadata.find((m) => m.version === appliedMigration.version)) {
        issues.push(`Applied migration ${appliedMigration.version} not found in available migrations`);
      }
    }

    // Check checksums if enabled
    if (this.config.validateChecksums) {
      for (const appliedMigration of applied) {
        if (appliedMigration.checksum) {
          const metadata = allMetadata.find((m) => m.version === appliedMigration.version);
          if (metadata) {
            const migration = await this.provider.getMigration(metadata.version);
            if (migration) {
              const checksum = this.calculateChecksum(migration);
              if (checksum !== appliedMigration.checksum) {
                issues.push(`Checksum mismatch for migration ${appliedMigration.version}`);
              }
            }
          }
        }
      }
    }

    return {
      applied,
      pending,
      currentVersion,
      latestVersion,
      isUpToDate: pending.length === 0,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  /**
   * Reset all migrations
   */
  async reset(connection?: string, force: boolean = false): Promise<MigrationResult> {
    if (!force) {
      throw Errors.badRequest('Reset requires force flag to prevent accidental data loss');
    }

    const status = await this.status(connection);

    // Rollback all applied migrations
    return this.down({
      connection,
      steps: status.applied.length,
    });
  }

  /**
   * Create a new migration file
   */
  async create(name: string): Promise<string> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
    const version = this.config.useTimestamp ? timestamp : await this.generateSequentialVersion();
    const fileName = `${version}_${name}.migration.ts`;

    const template = `/**
 * Migration: ${name}
 * Version: ${version}
 * Created: ${new Date().toISOString()}
 */

import { Kysely, sql } from 'kysely';
import { Migration } from '@omnitron-dev/titan/module/database';

@Migration({
  version: '${version}',
  description: '${name}'
})
export class ${this.toPascalCase(name)}Migration implements IMigration {
  async up(db: Kysely<unknown>): Promise<void> {
    // Add your migration logic here
    await db.schema
      .createTable('example')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('name', 'varchar(255)', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.defaultTo(sql\`CURRENT_TIMESTAMP\`))
      .execute();
  }

  async down(db: Kysely<unknown>): Promise<void> {
    // Add your rollback logic here
    await db.schema.dropTable('example').execute();
  }
}`;

    // Ensure migrations directory exists
    const directory = this.config.directory || './migrations';
    const absoluteDir = resolve(directory);

    if (!existsSync(absoluteDir)) {
      await mkdir(absoluteDir, { recursive: true });
      this.logger.info(`Created migrations directory: ${absoluteDir}`);
    }

    // Write migration file
    const filePath = join(absoluteDir, fileName);
    await writeFile(filePath, template, 'utf-8');

    this.logger.info(`Created migration file: ${filePath}`);
    return filePath;
  }

  /**
   * Run a single migration
   */
  private async runMigration(
    migration: IMigration,
    metadata: MigrationMetadata,
    direction: 'up' | 'down',
    options: MigrationRunOptions
  ): Promise<{
    version: string;
    name: string;
    direction: 'up' | 'down';
    executionTime: number;
    status: 'success' | 'failed' | 'skipped';
    error?: string;
  }> {
    const startTime = Date.now();
    const eventType =
      direction === 'up' ? ('migration.starting' as MigrationEventType) : ('rollback.starting' as MigrationEventType);

    this.emitEvent({
      type: eventType,
      version: metadata.version,
      name: metadata.name,
      direction,
    });

    try {
      // Dry run - just log
      if (options.dryRun) {
        this.logger.info(`[DRY RUN] Would ${direction} migration ${metadata.version}: ${metadata.name}`);
        return {
          version: metadata.version,
          name: metadata.name,
          direction,
          executionTime: 0,
          status: 'success', // Changed from 'skipped' to 'success' for dry runs
        };
      }

      const db = await this.manager.getConnection(options.connection || metadata.connection);

      // Run migration in transaction if specified
      if (options.transactional !== false && metadata.transactional !== false) {
        await db.transaction().execute(async (trx) => {
          await this.executeMigration(migration, trx, direction, options.timeout);

          // Record/remove migration within transaction (for up/down)
          if (direction === 'up') {
            await this.recordMigrationInTransaction(metadata, Date.now() - startTime, migration, trx);
          } else {
            await this.removeMigrationRecordInTransaction(metadata.version, trx);
          }
        });
      } else {
        await this.executeMigration(migration, db, direction, options.timeout);

        // Record/remove migration outside transaction
        if (direction === 'up') {
          await this.recordMigration(metadata, Date.now() - startTime, migration, options.connection);
        } else {
          await this.removeMigrationRecord(metadata.version, options.connection);
        }
      }

      const executionTime = Date.now() - startTime;

      const completedEventType =
        direction === 'up'
          ? ('migration.completed' as MigrationEventType)
          : ('rollback.completed' as MigrationEventType);

      this.emitEvent({
        type: completedEventType,
        version: metadata.version,
        name: metadata.name,
        direction,
        executionTime,
      });

      this.logger.info(
        `✓ ${direction === 'up' ? 'Applied' : 'Rolled back'} migration ${metadata.version}: ${metadata.name} (${executionTime}ms)`
      );

      return {
        version: metadata.version,
        name: metadata.name,
        direction,
        executionTime,
        status: 'success',
      };
    } catch (error) {
      const failedEventType =
        direction === 'up' ? ('migration.failed' as MigrationEventType) : ('rollback.failed' as MigrationEventType);

      this.emitEvent({
        type: failedEventType,
        version: metadata.version,
        name: metadata.name,
        direction,
        error: error as Error,
      });

      this.logger.error(`✗ Failed to ${direction} migration ${metadata.version}: ${error}`);

      return {
        version: metadata.version,
        name: metadata.name,
        direction,
        executionTime: Date.now() - startTime,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute migration with timeout
   */
  private async executeMigration(
    migration: IMigration,
    db: Kysely<unknown> | Transaction<unknown>,
    direction: 'up' | 'down',
    timeout?: number
  ): Promise<void> {
    const timeoutMs = timeout || this.config.defaultTimeout || 60000;

    await Promise.race([
      migration[direction](db),
      new Promise((_, reject) => setTimeout(() => reject(Errors.timeout('database migration', timeoutMs)), timeoutMs)),
    ]);
  }

  /**
   * Record applied migration
   */
  private async recordMigration(
    metadata: MigrationMetadata,
    executionTime: number,
    migration: IMigration,
    connection?: string
  ): Promise<void> {
    const db = await this.manager.getConnection(connection);
    const checksum = this.calculateChecksum(migration);

    await sql`
      INSERT INTO ${sql.table(this.config.tableName!)} (
        version, name, description, execution_time, checksum, metadata
      ) VALUES (
        ${metadata.version},
        ${metadata.name},
        ${metadata.description || null},
        ${executionTime},
        ${checksum},
        ${JSON.stringify(metadata)}
      )
    `.execute(db);
  }

  /**
   * Record applied migration within a transaction
   */
  private async recordMigrationInTransaction(
    metadata: MigrationMetadata,
    executionTime: number,
    migration: IMigration,
    trx: Transaction<unknown>
  ): Promise<void> {
    const checksum = this.calculateChecksum(migration);

    await sql`
      INSERT INTO ${sql.table(this.config.tableName!)} (
        version, name, description, execution_time, checksum, metadata
      ) VALUES (
        ${metadata.version},
        ${metadata.name},
        ${metadata.description || null},
        ${executionTime},
        ${checksum},
        ${JSON.stringify(metadata)}
      )
    `.execute(trx);
  }

  /**
   * Remove migration record
   */
  private async removeMigrationRecord(version: string, connection?: string): Promise<void> {
    const db = await this.manager.getConnection(connection);

    await sql`
      DELETE FROM ${sql.table(this.config.tableName!)}
      WHERE version = ${version}
    `.execute(db);
  }

  /**
   * Remove migration record within a transaction
   */
  private async removeMigrationRecordInTransaction(version: string, trx: Transaction<unknown>): Promise<void> {
    await sql`
      DELETE FROM ${sql.table(this.config.tableName!)}
      WHERE version = ${version}
    `.execute(trx);
  }

  /**
   * Calculate migration checksum
   */
  private calculateChecksum(migration: IMigration): string {
    // Simple checksum based on function strings
    const content = migration.up.toString() + migration.down.toString();
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate sequential version number
   */
  private async generateSequentialVersion(): Promise<string> {
    // Get all existing migrations
    const allMetadata = await this.provider.getAllMetadata();

    if (allMetadata.length === 0) {
      return '001';
    }

    // Extract numeric versions and find the highest
    const numericVersions = allMetadata
      .map((m) => {
        // Try to extract a numeric value from the version string
        const match = m.version.match(/^(\d+)/);
        return match && match[1] ? parseInt(match[1], 10) : 0;
      })
      .filter((v) => !isNaN(v) && v > 0);

    if (numericVersions.length === 0) {
      return '001';
    }

    // Get the max version and increment by 1
    const maxVersion = Math.max(...numericVersions);
    const nextVersion = maxVersion + 1;

    // Pad with zeros to maintain 3-digit format
    return nextVersion.toString().padStart(3, '0');
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
  }

  /**
   * Emit migration event
   */
  private emitEvent(event: MigrationEvent): void {
    this.emit(event.type, event);
  }
}
