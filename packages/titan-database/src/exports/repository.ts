/**
 * Repository Pattern Exports
 *
 * @module @omnitron-dev/titan/module/database/repository
 */

export { TransactionAwareRepository } from '../repository/transaction-aware.repository.js';
export type {
  Executor as RepositoryExecutor,
  FindManyOptions,
  CursorOptions,
  CursorResult,
} from '../repository/transaction-aware.repository.js';
