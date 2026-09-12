/**
 * Transaction System Exports
 *
 * @module @omnitron-dev/titan/module/database/transaction
 */

export {
  AutoTransactional,
  runInTransaction,
  runWithTransaction,
  getTransactionContext,
  getCurrentTransaction,
  isInTransactionContext,
  getExecutor,
  registerTablePlugins,
  getTablePlugins,
  initializeTablePlugins,
  isTablePluginInitialized,
  clearPluginRegistry,
} from '../transaction/transaction.context.js';
export type { TransactionContextData } from '../transaction/transaction.context.js';
