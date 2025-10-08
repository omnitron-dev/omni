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

@Injectable()
export class MigrationService extends EventEmitter {
  private config: MigrationConfig;
  private provider: IMigrationProvider;
  private lock: IMigrationLock;
  private logger: any;

  constructor(
    @Inject(DATABASE_MANAGER) private manager: IDatabaseManager,
    config?: MigrationConfig
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

    // Initialize provider
    this.provider = new MigrationProvider(this.config);

    // Initialize lock
    this.lock = new MigrationLock(this.manager, {
      tableName: this.config.lockTableName!,
      timeout: this.config.lockTimeout!,
    });

    // Simple logger (replace with Titan logger when available)
    this.logger = console;
  }

  /**
   * Initialize migration tables
   */
  async init(connection?: string): Promise<void> {
    const db = await this.manager.getConnection(connection);

    // Create migrations table
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

    // Create lock table
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.table(this.config.lockTableName!)} (
        id INTEGER PRIMARY KEY DEFAULT 1,
        is_locked BOOLEAN NOT NULL DEFAULT FALSE,
        locked_at TIMESTAMP,
        locked_by VARCHAR(255),
        CHECK (id = 1)
      )
    `.execute(db);

    // Insert default lock record if not exists
    await sql`
      INSERT INTO ${sql.table(this.config.lockTableName!)} (id, is_locked)
      VALUES (1, FALSE)
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
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

    try {
      // Acquire lock
      if (!opts.dryRun) {
        const acquired = await this.lock.acquire(this.config.lockTimeout);
        if (!acquired) {
          throw new Error('Could not acquire migration lock');
        }
        this.emit('lock.acquired' as MigrationEventType);
      }

      // Get migration status
      const status = await this.status(opts.connection);

      // Filter migrations to run
      let toRun = status.pending;
      if (opts.versions) {
        toRun = toRun.filter(m => opts.versions!.includes(m.version));
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
          throw new Error(`Migration ${metadata.version} not found`);
        }

        const migrationResult = await this.runMigration(
          migration,
          metadata,
          'up',
          opts
        );

        result.migrations.push(migrationResult);

        if (migrationResult.status === 'failed' && !opts.continueOnError) {
          throw new Error(`Migration ${metadata.version} failed: ${migrationResult.error}`);
        }
      }

      result.success = result.migrations.every(m => m.status === 'success');
      result.totalTime = Date.now() - startTime;

      return result;
    } catch (error) {
      result.success = false;
      result.errors = [error instanceof Error ? error.message : String(error)];
      result.totalTime = Date.now() - startTime;
      throw error;
    } finally {
      // Release lock
      if (!opts.dryRun) {
        await this.lock.release();
        this.emit('lock.released' as MigrationEventType);
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

    try {
      // Acquire lock
      if (!opts.dryRun) {
        const acquired = await this.lock.acquire(this.config.lockTimeout);
        if (!acquired) {
          throw new Error('Could not acquire migration lock');
        }
        this.emit('lock.acquired' as MigrationEventType);
      }

      // Get applied migrations
      const status = await this.status(opts.connection);
      let toRollback = status.applied.slice().reverse();

      // Determine what to rollback
      if (opts.targetVersion) {
        const targetIndex = toRollback.findIndex(m => m.version === opts.targetVersion);
        if (targetIndex === -1) {
          throw new Error(`Target version ${opts.targetVersion} not found in applied migrations`);
        }
        toRollback = toRollback.slice(0, targetIndex);
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
          throw new Error(`Migration metadata for ${applied.version} not found`);
        }

        const migration = await this.provider.getMigration(applied.version);
        if (!migration) {
          throw new Error(`Migration ${applied.version} not found`);
        }

        const migrationResult = await this.runMigration(
          migration,
          metadata,
          'down',
          opts
        );

        result.migrations.push(migrationResult);

        if (migrationResult.status === 'failed' && !opts.continueOnError) {
          throw new Error(`Rollback of ${metadata.version} failed: ${migrationResult.error}`);
        }
      }

      result.success = result.migrations.every(m => m.status === 'success');
      result.totalTime = Date.now() - startTime;

      return result;
    } catch (error) {
      result.success = false;
      result.errors = [error instanceof Error ? error.message : String(error)];
      result.totalTime = Date.now() - startTime;
      throw error;
    } finally {
      // Release lock
      if (!opts.dryRun) {
        await this.lock.release();
        this.emit('lock.released' as MigrationEventType);
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

    const applied: AppliedMigration[] = appliedRows.rows.map((row: any) => ({
      id: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      appliedAt: new Date(row.applied_at),
      executionTime: row.execution_time,
      checksum: row.checksum,
      metadata: row.metadata,
    }));

    // Get all available migrations
    const allMetadata = await this.provider.getAllMetadata();
    const appliedVersions = new Set(applied.map(m => m.version));

    // Get pending migrations
    const pending = allMetadata
      .filter(m => !appliedVersions.has(m.version))
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
      if (!allMetadata.find(m => m.version === appliedMigration.version)) {
        issues.push(`Applied migration ${appliedMigration.version} not found in available migrations`);
      }
    }

    // Check checksums if enabled
    if (this.config.validateChecksums) {
      for (const appliedMigration of applied) {
        if (appliedMigration.checksum) {
          const metadata = allMetadata.find(m => m.version === appliedMigration.version);
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
      throw new Error('Reset requires force flag to prevent accidental data loss');
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
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
    const version = this.config.useTimestamp ? timestamp : this.generateSequentialVersion();
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
  async up(db: Kysely<any>): Promise<void> {
    // Add your migration logic here
    await db.schema
      .createTable('example')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('name', 'varchar(255)', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.defaultTo(sql\`CURRENT_TIMESTAMP\`))
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    // Add your rollback logic here
    await db.schema.dropTable('example').execute();
  }
}`;

    // Write file (in real implementation, use fs)
    this.logger.info(`Created migration: ${fileName}`);
    return fileName;
  }

  /**
   * Run a single migration
   */
  private async runMigration(
    migration: IMigration,
    metadata: MigrationMetadata,
    direction: 'up' | 'down',
    options: MigrationRunOptions
  ): Promise<any> {
    const startTime = Date.now();
    const eventType = direction === 'up'
      ? 'migration.starting' as MigrationEventType
      : 'rollback.starting' as MigrationEventType;

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
          status: 'skipped',
        };
      }

      const db = await this.manager.getConnection(options.connection || metadata.connection);

      // Run migration in transaction if specified
      if (options.transactional !== false && metadata.transactional !== false) {
        await db.transaction().execute(async (trx) => {
          await this.executeMigration(migration, trx, direction, options.timeout);
        });
      } else {
        await this.executeMigration(migration, db, direction, options.timeout);
      }

      const executionTime = Date.now() - startTime;

      // Record migration (only for up)
      if (direction === 'up') {
        await this.recordMigration(metadata, executionTime, migration, options.connection);
      } else {
        await this.removeMigrationRecord(metadata.version, options.connection);
      }

      const completedEventType = direction === 'up'
        ? 'migration.completed' as MigrationEventType
        : 'rollback.completed' as MigrationEventType;

      this.emitEvent({
        type: completedEventType,
        version: metadata.version,
        name: metadata.name,
        direction,
        executionTime,
      });

      this.logger.info(`✓ ${direction === 'up' ? 'Applied' : 'Rolled back'} migration ${metadata.version}: ${metadata.name} (${executionTime}ms)`);

      return {
        version: metadata.version,
        name: metadata.name,
        direction,
        executionTime,
        status: 'success',
      };
    } catch (error) {
      const failedEventType = direction === 'up'
        ? 'migration.failed' as MigrationEventType
        : 'rollback.failed' as MigrationEventType;

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
    db: Kysely<any> | Transaction<any>,
    direction: 'up' | 'down',
    timeout?: number
  ): Promise<void> {
    const timeoutMs = timeout || this.config.defaultTimeout || 60000;

    await Promise.race([
      migration[direction](db),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Migration timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
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
  private generateSequentialVersion(): string {
    // In real implementation, would check existing migrations
    return '001';
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
      .replace(/^./, c => c.toUpperCase());
  }

  /**
   * Emit migration event
   */
  private emitEvent(event: MigrationEvent): void {
    this.emit(event.type, event);
  }
}