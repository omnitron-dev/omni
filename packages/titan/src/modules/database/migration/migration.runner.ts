/**
 * Migration Runner
 *
 * Simplified interface for running migrations
 */

import { Injectable, Inject } from '../../../decorators/index.js';
import { DATABASE_MANAGER } from '../database.constants.js';
import type { IDatabaseManager } from '../database.types.js';
import { MigrationService } from './migration.service.js';
import type {
  MigrationRunOptions,
  MigrationDownOptions,
  MigrationResult,
  MigrationStatus,
  MigrationConfig,
} from './migration.types.js';

@Injectable()
export class MigrationRunner {
  private service: MigrationService;
  private initialized: boolean = false;

  constructor(
    @Inject(DATABASE_MANAGER) private manager: IDatabaseManager,
    config?: MigrationConfig
  ) {
    this.service = new MigrationService(this.manager, config);
  }

  /**
   * Initialize migration system
   */
  async init(connection?: string): Promise<void> {
    if (!this.initialized) {
      await this.service.init(connection);
      this.initialized = true;
    }
  }

  /**
   * Run all pending migrations
   */
  async migrate(options?: MigrationRunOptions): Promise<MigrationResult> {
    await this.init(options?.connection);
    return this.service.up(options);
  }

  /**
   * Run specific migrations
   */
  async migrateUp(versions: string[], options?: MigrationRunOptions): Promise<MigrationResult> {
    await this.init(options?.connection);
    return this.service.up({
      ...options,
      versions,
    });
  }

  /**
   * Rollback last migration
   */
  async rollback(options?: MigrationDownOptions): Promise<MigrationResult> {
    await this.init(options?.connection);
    return this.service.down(options);
  }

  /**
   * Rollback specific number of migrations
   */
  async rollbackTo(targetVersion: string, options?: MigrationDownOptions): Promise<MigrationResult> {
    await this.init(options?.connection);
    return this.service.down({
      ...options,
      targetVersion,
    });
  }

  /**
   * Reset all migrations
   */
  async reset(connection?: string, force: boolean = false): Promise<MigrationResult> {
    await this.init(connection);
    return this.service.reset(connection, force);
  }

  /**
   * Get migration status
   */
  async status(connection?: string): Promise<MigrationStatus> {
    await this.init(connection);
    return this.service.status(connection);
  }

  /**
   * Create new migration file
   */
  async create(name: string): Promise<string> {
    return this.service.create(name);
  }

  /**
   * Check if there are pending migrations
   */
  async hasPendingMigrations(connection?: string): Promise<boolean> {
    await this.init(connection);
    const status = await this.service.status(connection);
    return status.pending.length > 0;
  }

  /**
   * Get current version
   */
  async getCurrentVersion(connection?: string): Promise<string | undefined> {
    await this.init(connection);
    const status = await this.service.status(connection);
    return status.currentVersion;
  }

  /**
   * Run migrations in dry-run mode
   */
  async dryRun(options?: MigrationRunOptions): Promise<MigrationResult> {
    await this.init(options?.connection);
    return this.service.up({
      ...options,
      dryRun: true,
    });
  }

  /**
   * Validate migrations (check for issues)
   */
  async validate(connection?: string): Promise<{ valid: boolean; issues?: string[] }> {
    await this.init(connection);
    const status = await this.service.status(connection);

    return {
      valid: !status.issues || status.issues.length === 0,
      issues: status.issues,
    };
  }

  /**
   * Listen to migration events
   */
  on(event: string, listener: (...args: any[]) => void): void {
    this.service.on(event, listener);
  }

  /**
   * Remove event listener
   */
  off(event: string, listener: (...args: any[]) => void): void {
    this.service.off(event, listener);
  }
}
