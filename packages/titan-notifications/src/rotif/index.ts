export * from './rotif.js';
export * from './types.js';
export * from './middleware.js';
export { DLQManager, type DLQCleanupConfig, type DLQStats, type DLQMessageInfo } from './dlq-manager.js';

// Re-export retry strategies from unified utils module
export {
  createRetryDelayFn,
  RetryStrategies,
  type RetryStrategyConfig,
  type RetryStrategyType,
  type RetryDelayFn,
} from '@omnitron-dev/titan/utils';

// Performance utilities for advanced use cases
export {
  parseFieldsFast,
  acquireFields,
  releaseFields,
  getCachedMatcher,
  clearPatternCache,
  chunkArray,
  processWithConcurrency,
  type ParsedFields,
} from './utils.js';
