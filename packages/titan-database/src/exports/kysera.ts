/**
 * @kysera Package Re-exports
 *
 * Import from '@omnitron-dev/titan/module/database/kysera' for tree-shaking.
 * Contains only the most commonly used @kysera exports.
 *
 * For specialized needs, consider importing directly from @kysera packages.
 *
 * @module @omnitron-dev/titan/module/database/kysera
 */

// ============================================================================
// @kysera/core - Error Handling
// ============================================================================

export {
  parseDatabaseError,
  DatabaseError as KyseraDatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  NotFoundError as KyseraNotFoundError,
  BadRequestError as KyseraBadRequestError,
  NotNullError,
  CheckConstraintError,
  ErrorCodes,
} from '@kysera/core';

// ============================================================================
// @kysera/core - Pagination
// ============================================================================

export { paginate, paginateCursor, paginateCursorSimple, applyOffset, applyDateRange } from '@kysera/core';

export type {
  PaginationOptions as KyseraPaginationOptions,
  PaginatedResult as KyseraPaginatedResult,
  CursorOptions as KyseraCursorOptions,
  Executor,
} from '@kysera/core';

// ============================================================================
// @kysera/infra - Resilience
// ============================================================================

export { withRetry, CircuitBreaker } from '@kysera/infra';
export type { RetryOptions } from '@kysera/infra';

// ============================================================================
// @kysera/repository - ORM and Utilities
// ============================================================================

export { createORM, upsert, upsertMany, atomicStatusTransition } from '@kysera/repository';

export type { Plugin as KyseraPlugin, PluginOrm, UpsertOptions, StatusTransitionOptions } from '@kysera/repository';

// ============================================================================
// @kysera/executor - Plugin System
// ============================================================================

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
  QueryBuilderContext as ExecutorQueryBuilderContext,
  ExecutorConfig,
  BaseRepositoryLike,
} from '@kysera/executor';

// ============================================================================
// @kysera/soft-delete
// ============================================================================

export { softDeletePlugin } from '@kysera/soft-delete';
export type { SoftDeleteOptions } from '@kysera/soft-delete';

// ============================================================================
// @kysera/timestamps
// ============================================================================

export { timestampsPlugin } from '@kysera/timestamps';
export type { TimestampsOptions } from '@kysera/timestamps';

// ============================================================================
// @kysera/audit
// ============================================================================

export { auditPlugin } from '@kysera/audit';
export type { AuditOptions } from '@kysera/audit';
