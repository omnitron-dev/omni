/**
 * Performance extensions for Advanced Editor
 */

export { LazyLoadExtension } from './LazyLoadExtension.js';
export type {
  ExtensionLoader,
  ExtensionLoadingState,
  PreloadStrategy,
  LazyExtensionConfig,
  LazyLoadConfig,
} from './LazyLoadExtension.js';

export { VirtualScrollExtension } from './VirtualScrollExtension.js';
export type { VirtualScrollConfig } from './VirtualScrollExtension.js';

export { DebounceExtension } from './DebounceExtension.js';
export type { DebounceOperation, OperationDebounceConfig, DebounceConfig } from './DebounceExtension.js';

export { MemoizationExtension } from './MemoizationExtension.js';
export type { MemoizationConfig } from './MemoizationExtension.js';
