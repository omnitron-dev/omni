/**
 * Executor Module
 *
 * Unified plugin-aware execution layer for both Repository and DAL patterns.
 *
 * @module @omnitron-dev/titan/module/database
 */

export {
  ExecutorService,
  type ExecutorPluginConfig,
  type CreateExecutorOptions,
  // Re-exports from @kysera/executor
  type Plugin,
  type KyseraExecutor,
  type KyseraTransaction,
  type QueryBuilderContext,
  type ExecutorConfig,
  type DbContext,
  isKyseraExecutor,
  getPlugins,
  getRawDb,
  wrapTransaction,
  applyPlugins,
  validatePlugins,
  resolvePluginOrder,
  PluginValidationError,
  createContext,
  withTransaction,
} from './executor.service.js';
