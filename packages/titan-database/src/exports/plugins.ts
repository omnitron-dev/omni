/**
 * Plugin System Exports
 *
 * Plugins are now provided directly by @kysera packages.
 * This file provides re-exports for backward compatibility.
 *
 * @module @omnitron-dev/titan/module/database/plugins
 */

// @kysera plugins re-exported for convenience
export { softDeletePlugin } from '@kysera/soft-delete';
export type { SoftDeleteOptions } from '@kysera/soft-delete';

export { timestampsPlugin } from '@kysera/timestamps';
export type { TimestampsOptions } from '@kysera/timestamps';

export { auditPlugin } from '@kysera/audit';
export type { AuditOptions } from '@kysera/audit';

export {
  createExecutor,
  createExecutorSync,
  isKyseraExecutor,
  getPlugins as getExecutorPlugins,
  getRawDb,
  wrapTransaction,
  applyPlugins,
  validatePlugins as validateExecutorPlugins,
  resolvePluginOrder,
  PluginValidationError,
} from '@kysera/executor';

export type {
  Plugin as ExecutorPlugin,
  KyseraExecutor,
  KyseraTransaction,
  ExecutorConfig,
  BaseRepositoryLike,
} from '@kysera/executor';
