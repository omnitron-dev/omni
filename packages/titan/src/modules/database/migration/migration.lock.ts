/**
 * Migration Lock Implementation
 *
 * Prevents concurrent migration runs
 */

import { sql } from 'kysely';
import type { IDatabaseManager, DatabaseDialect } from '../database.types.js';
import type { IMigrationLock } from './migration.types.js';
import type { Logger } from '../database.internal-types.js';
import { createDefaultLogger } from '../utils/logger.factory.js';
import { Errors } from '../../../errors/index.js';

export interface MigrationLockOptions {
  tableName: string;
  timeout: number;
  instanceId?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class MigrationLock implements IMigrationLock {
  private instanceId: string;
  private isHoldingLock: boolean = false;
  private dialect: DatabaseDialect | undefined;
  private logger: Logger;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(
    private manager: IDatabaseManager,
    private options: MigrationLockOptions
  ) {
    this.instanceId = options.instanceId || this.generateInstanceId();
    this.logger = createDefaultLogger('MigrationLock');
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
  }

  /**
   * Get database dialect
   */
  private async getDialect(): Promise<DatabaseDialect> {
    if (this.dialect) {
      return this.dialect;
    }

    const config = this.manager.getConnectionConfig();
    if (!config) {
      throw Errors.internal('Unable to determine database dialect');
    }

    this.dialect = config.dialect;
    return this.dialect;
  }

  /**
   * Validate connection health with retry
   */
  private async validateConnection(): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const db = await this.manager.getConnection();

        // Test connection with simple query
        await sql`SELECT 1`.execute(db);

        // Connection is healthy
        return;
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.maxRetries - 1) {
          this.logger.warn(
            { attempt, error: lastError.message },
            'Connection validation failed, retrying'
          );
          await this.sleep(this.retryDelayMs * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    throw Errors.unavailable('Database', `Connection validation failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Acquire migration lock
   */
  async acquire(timeout?: number): Promise<boolean> {
    const timeoutMs = timeout || this.options.timeout;
    const startTime = Date.now();

    // Validate connection before attempting to acquire lock
    try {
      await this.validateConnection();
    } catch (error) {
      this.logger.error({ error }, 'Failed to validate connection before acquiring lock');
      return false;
    }

    while (Date.now() - startTime < timeoutMs) {
      const acquired = await this.tryAcquire();
      if (acquired) {
        this.isHoldingLock = true;
        return true;
      }

      // Wait before retrying
      await this.sleep(1000);
    }

    return false;
  }

  /**
   * Try to acquire lock once
   */
  private async tryAcquire(): Promise<boolean> {
    let lastError: Error | undefined;

    // Retry on connection errors
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const db = await this.manager.getConnection();
        const dialect = await this.getDialect();

        // Get expiry condition based on dialect
        const expiryMinutes = 5;
        const expiryCondition = this.getExpiryCondition(dialect, expiryMinutes);

        // Try to acquire lock using UPDATE with WHERE
        const result = await sql`
          UPDATE ${sql.table(this.options.tableName)}
          SET
            is_locked = ${sql.lit(1)},
            locked_at = ${sql.lit(this.getCurrentTimestamp(dialect))},
            locked_by = ${this.instanceId}
          WHERE
            id = 1
            AND (
              is_locked = ${sql.lit(0)}
              OR ${sql.raw(expiryCondition)}
            )
        `.execute(db);

        // Check if we acquired the lock
        return (result.numAffectedRows ?? 0) > 0;
      } catch (error) {
        lastError = error as Error;

        // Check if this is a connection error
        const isConnectionError = this.isConnectionError(error);

        if (isConnectionError && attempt < this.maxRetries - 1) {
          this.logger.warn(
            { attempt, error: lastError.message },
            'Connection error during lock acquisition, retrying'
          );
          await this.sleep(this.retryDelayMs * Math.pow(2, attempt));
          continue;
        }

        this.logger.error({ error, attempt }, 'Error acquiring migration lock');
        return false;
      }
    }

    this.logger.error({ error: lastError }, 'Failed to acquire lock after retries');
    return false;
  }

  /**
   * Check if error is a connection error
   */
  private isConnectionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const errorObj = error as Record<string, unknown>;
    const message = (errorObj['message'] as string)?.toLowerCase() || '';
    const code = errorObj['code'] as string | undefined;

    return (
      message.includes('connection') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('unable to connect') ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'ENOTFOUND'
    );
  }

  /**
   * Get current timestamp for dialect
   */
  private getCurrentTimestamp(dialect: DatabaseDialect): string {
    const now = new Date();

    switch (dialect) {
      case 'postgres':
      case 'mysql':
        return now.toISOString().replace('T', ' ').replace('Z', '');
      case 'sqlite':
        // SQLite stores as ISO8601 string
        return now.toISOString();
      default:
        return now.toISOString();
    }
  }

  /**
   * Get expiry condition SQL for dialect
   */
  private getExpiryCondition(dialect: DatabaseDialect, minutes: number): string {
    const expiryTime = new Date(Date.now() - minutes * 60 * 1000);

    switch (dialect) {
      case 'postgres':
        return `locked_at < CURRENT_TIMESTAMP - INTERVAL '${minutes} minutes'`;
      case 'mysql':
        return `locked_at < DATE_SUB(NOW(), INTERVAL ${minutes} MINUTE)`;
      case 'sqlite': {
        // SQLite: compare with ISO8601 timestamp
        const expiryStr = expiryTime.toISOString();
        return `locked_at < '${expiryStr}'`;
      }
      default:
        throw Errors.badRequest(`Unsupported dialect: ${dialect}`);
    }
  }

  /**
   * Release migration lock
   */
  async release(): Promise<void> {
    if (!this.isHoldingLock) {
      return;
    }

    const db = await this.manager.getConnection();

    try {
      await sql`
        UPDATE ${sql.table(this.options.tableName)}
        SET
          is_locked = ${sql.lit(0)},
          locked_at = NULL,
          locked_by = NULL
        WHERE
          id = 1
          AND locked_by = ${this.instanceId}
      `.execute(db);

      this.isHoldingLock = false;
    } catch (error) {
      this.logger.error('Error releasing migration lock:', error);
      throw error;
    }
  }

  /**
   * Check if lock is held
   */
  async isLocked(): Promise<boolean> {
    const db = await this.manager.getConnection();

    const result = await sql`
      SELECT is_locked, locked_at, locked_by
      FROM ${sql.table(this.options.tableName)}
      WHERE id = 1
    `.execute(db);

    if (result.rows.length === 0) {
      return false;
    }

    const row = result.rows[0] as Record<string, unknown>;

    // Check if lock is held and not expired
    if (row['is_locked']) {
      const lockedAt = new Date(row['locked_at'] as string | number | Date);
      const expiryTime = 5 * 60 * 1000; // 5 minutes
      const isExpired = Date.now() - lockedAt.getTime() > expiryTime;

      return !isExpired;
    }

    return false;
  }

  /**
   * Force release lock (admin operation)
   */
  async forceRelease(): Promise<void> {
    const db = await this.manager.getConnection();

    await sql`
      UPDATE ${sql.table(this.options.tableName)}
      SET
        is_locked = ${sql.lit(0)},
        locked_at = NULL,
        locked_by = NULL
      WHERE id = 1
    `.execute(db);

    this.isHoldingLock = false;
  }

  /**
   * Generate unique instance ID
   */
  private generateInstanceId(): string {
    const hostname = process.env['HOSTNAME'] || 'unknown';
    const pid = process.pid;
    const timestamp = Date.now();
    return `${hostname}-${pid}-${timestamp}`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
