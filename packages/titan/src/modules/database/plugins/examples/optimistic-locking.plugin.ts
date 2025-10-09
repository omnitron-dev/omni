/**
 * Optimistic Locking Plugin
 *
 * Provides optimistic locking support for database records
 */

import type { ITitanPlugin } from '../plugin.types.js';
import type { Kysely, UpdateQueryBuilder, InsertQueryBuilder } from 'kysely';
import { sql } from 'kysely';
import { Errors } from '../../../../errors/index.js';

export interface OptimisticLockingOptions {
  /**
   * Version column name
   */
  versionColumn?: string;

  /**
   * Enable strict mode (throw on version mismatch)
   */
  strict?: boolean;

  /**
   * Tables to apply to (defaults to all)
   */
  tables?: string[];
}

/**
 * Create optimistic locking plugin
 */
export function optimisticLockingPlugin(
  options: OptimisticLockingOptions = {}
): ITitanPlugin {
  const versionColumn = options.versionColumn || 'version';
  const strict = options.strict ?? true;

  return {
    name: 'optimistic-locking',
    version: '1.0.0',
    metadata: {
      description: 'Optimistic locking support with version tracking',
      category: 'utility',
      author: 'Titan Framework',
      compatibility: {
        dialects: ['postgres', 'mysql', 'sqlite'],
      },
    },

    extendRepository(repository: any) {
      // Store original methods
      const originalUpdate = repository.update;
      const originalCreate = repository.create;
      const originalDelete = repository.delete;

      // Override create to set initial version
      repository.create = async function (data: any) {
        const dataWithVersion = {
          ...data,
          [versionColumn]: 1,
        };
        return originalCreate.call(this, dataWithVersion);
      };

      // Override update to check and increment version
      repository.update = async function (
        id: number | string,
        data: any,
        expectedVersion?: number
      ) {
        // Get current record
        const current = await this.findById(id);
        if (!current) {
          throw Errors.notFound('Record', String(id));
        }

        // Check version if provided
        if (expectedVersion !== undefined) {
          if (current[versionColumn] !== expectedVersion) {
            if (strict) {
              throw Errors.conflict(
                `Version mismatch: expected ${expectedVersion}, got ${current[versionColumn]}`
              );
            }
            return null; // Silent failure in non-strict mode
          }
        }

        // Update with incremented version
        const dataWithVersion = {
          ...data,
          [versionColumn]: current[versionColumn] + 1,
        };

        // Perform update with version check
        const result = await this.qb
          .updateTable(this.tableName)
          .set(dataWithVersion)
          .where('id', '=', id)
          .where(versionColumn, '=', current[versionColumn])
          .returningAll()
          .executeTakeFirst();

        if (!result && strict) {
          throw Errors.conflict('Concurrent update detected');
        }

        return result;
      };

      // Override delete to check version
      repository.delete = async function (
        id: number | string,
        expectedVersion?: number
      ) {
        if (expectedVersion !== undefined) {
          const current = await this.findById(id);
          if (!current) {
            throw Errors.notFound('Record', String(id));
          }

          if (current[versionColumn] !== expectedVersion) {
            if (strict) {
              throw Errors.conflict(
                `Version mismatch: expected ${expectedVersion}, got ${current[versionColumn]}`
              );
            }
            return; // Silent failure in non-strict mode
          }

          // Delete with version check
          await this.qb
            .deleteFrom(this.tableName)
            .where('id', '=', id)
            .where(versionColumn, '=', expectedVersion)
            .execute();
        } else {
          return originalDelete.call(this, id);
        }
      };

      // Add utility methods
      repository.updateWithRetry = async function (
        id: number | string,
        updateFn: (current: any) => any,
        maxRetries: number = 3
      ) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          const current = await this.findById(id);
          if (!current) {
            throw Errors.notFound('Record', String(id));
          }

          const updated = updateFn(current);
          const result = await this.update(id, updated, current[versionColumn]);

          if (result) {
            return result;
          }

          if (attempt === maxRetries) {
            throw Errors.conflict(`Failed to update after ${maxRetries} attempts`);
          }

          // Wait before retry with exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 100)
          );
        }
      };

      return repository;
    },

    extendDatabase(db: Kysely<any>) {
      // Add version check helper to database
      (db as any).withVersionCheck = function (
        table: string,
        id: number | string,
        version: number
      ) {
        return this.updateTable(table)
          .where('id', '=', id)
          .where(versionColumn, '=', version);
      };

      return db;
    },

    beforeTransaction() {
      // Could track transaction start for conflict detection
    },

    afterTransaction(result: 'commit' | 'rollback') {
      if (result === 'rollback') {
        // Could log version conflicts that caused rollback
      }
    },
  };
}

// Default export for convenience
export default optimisticLockingPlugin;