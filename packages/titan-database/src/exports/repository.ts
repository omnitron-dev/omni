/**
 * Repository Pattern Exports
 *
 * @module @omnitron-dev/titan/module/database/repository
 */

export { TransactionAwareRepository } from '../repository/transaction-aware.repository.js';
export type {
  FindManyOptions,
  CursorOptions,
  CursorResult,
} from '../repository/transaction-aware.repository.js';
// Executor type re-exported from @kysera/core for backward compatibility
export type { Executor as RepositoryExecutor } from '@kysera/core';
