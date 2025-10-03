/**
 * Migration Lock Implementation
 *
 * Prevents concurrent migration runs
 */

import { sql } from 'kysely';
import type { IDatabaseManager } from '../database.types.js';
import type { IMigrationLock } from './migration.types.js';

export interface MigrationLockOptions {
  tableName: string;
  timeout: number;
  instanceId?: string;
}

export class MigrationLock implements IMigrationLock {
  private instanceId: string;
  private isHoldingLock: boolean = false;

  constructor(
    private manager: IDatabaseManager,
    private options: MigrationLockOptions
  ) {
    this.instanceId = options.instanceId || this.generateInstanceId();
  }

  /**
   * Acquire migration lock
   */
  async acquire(timeout?: number): Promise<boolean> {
    const timeoutMs = timeout || this.options.timeout;
    const startTime = Date.now();

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
    const db = await this.manager.getConnection();

    try {
      // Try to acquire lock using UPDATE with WHERE
      const result = await sql`
        UPDATE ${sql.table(this.options.tableName)}
        SET
          is_locked = TRUE,
          locked_at = CURRENT_TIMESTAMP,
          locked_by = ${this.instanceId}
        WHERE
          id = 1
          AND (
            is_locked = FALSE
            OR locked_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
          )
      `.execute(db);

      // Check if we acquired the lock
      return (result.numAffectedRows ?? 0) > 0;
    } catch (error) {
      console.error('Error acquiring migration lock:', error);
      return false;
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
          is_locked = FALSE,
          locked_at = NULL,
          locked_by = NULL
        WHERE
          id = 1
          AND locked_by = ${this.instanceId}
      `.execute(db);

      this.isHoldingLock = false;
    } catch (error) {
      console.error('Error releasing migration lock:', error);
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

    const row = result.rows[0] as any;

    // Check if lock is held and not expired
    if (row.is_locked) {
      const lockedAt = new Date(row.locked_at);
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
        is_locked = FALSE,
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}