/**
 * Suspense Infrastructure
 *
 * Complete Suspense integration for Aether including:
 * - Suspense boundaries
 * - Error boundaries
 * - Async components
 * - Lazy loading
 * - SSR streaming
 *
 * @packageDocumentation
 */

// Suspense component and utilities
export {
  Suspense,
  SuspenseList,
  suspend,
  useSuspense,
  useSuspenseContext,
  createSuspenseResource,
  getCurrentSuspenseContext,
  resetSuspenseIdCounter,
} from './suspense.js';

// Error boundary
export {
  ErrorBoundary,
  Boundary,
  useErrorBoundary,
  withErrorBoundary,
  withRetry,
  resetErrorBoundaryIdCounter,
} from './error-boundary.js';

// Async components
export {
  useAsync,
  prefetch,
  isCached,
  getCached,
  asyncComponent,
  invalidateAsync,
  createAsyncComponent,
  clearAsyncComponentCache,
} from './async-component.js';

// Lazy loading
export {
  lazy,
  preload,
  isLoaded,
  lazyNamed,
  lazyRoute,
  splitCode,
  retryLazy,
  preloadAll,
  clearLazyCache,
} from './lazy.js';

// SSR streaming
export {
  streamSuspenseBoundaries,
  createSSRSuspenseContext,
  createSuspensePlaceholder,
  extractSuspenseBoundaries,
  renderWithSuspenseStreaming,
  renderToReadableStreamWithSuspense,
  hydrateSuspenseBoundaries,
} from './streaming.js';

// Types
export type {
  ErrorInfo,
  LazyOptions,
  SuspenseProps,
  SuspenseState,
  LazyComponent,
  SuspenseContext,
  SuspenseCacheEntry,
  ErrorBoundaryProps,
  AsyncComponentLoader,
  SSRSuspenseContext,
  SuspenseBoundaryMarker,
  StreamingSuspenseOptions,
} from './types.js';

export { isSuspensePromise, SuspensePromise } from './types.js';
